"""
Scalanie urządzeń i encji węzła, który wrócił pod NOWYM numerem.

Planowanie jest w identity.py (czyste funkcje, testowalne bez HA); tutaj tylko
wykonanie na rejestrach urządzeń i encji. Wszystko jest idempotentne i
opakowane tak, by błąd nigdy nie zatrzymał startu panelu ani statystyk.
"""

from __future__ import annotations

import dataclasses
import typing
from typing import Any

from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import CONF_OPTION_FILTER_NODES, DOMAIN, LOGGER
from .identity import (
    DeviceRecord,
    MergePlan,
    node_identity_key,
    plan_device_merges,
    plan_entity_migration,
    plan_key_canonicalisation,
)

if typing.TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from .data import MeshtasticConfigEntry


def device_records(hass: HomeAssistant, entry: MeshtasticConfigEntry) -> list[DeviceRecord]:
    """Urządzenia tego wpisu w postaci niezależnej od HA."""
    registry = dr.async_get(hass)
    shorts: dict[int, str] = {}
    for el in entry.options.get(CONF_OPTION_FILTER_NODES, []):
        if el.get("short_name"):
            shorts[el["id"]] = el["short_name"]
    records = []
    for device in dr.async_entries_for_config_entry(registry, entry.entry_id):
        nums, keys = set(), set()
        for domain, ident in device.identifiers:
            if domain != DOMAIN:
                continue
            if ident.isdigit():
                nums.add(int(ident))
            else:
                keys.add(ident)
        if not nums and not keys:
            continue
        created = getattr(device, "created_at", None)
        records.append(
            DeviceRecord(
                id=device.id,
                nums=frozenset(nums),
                keys=frozenset(keys),
                name=device.name,
                model_id=device.model_id,
                short_name=next((shorts[n] for n in nums if n in shorts), None),
                macs=frozenset(v for k, v in device.connections if k == dr.CONNECTION_NETWORK_MAC),
                created=created.timestamp() if created is not None else None,
            )
        )
    return records


def _migrate_entities(
    hass: HomeAssistant, entry: MeshtasticConfigEntry, source_keys: typing.Iterable[str], target_key: str
) -> int:
    registry = er.async_get(hass)
    entities = [
        (e.entity_id, e.unique_id)
        for e in er.async_entries_for_config_entry(registry, entry.entry_id)
        if e.unique_id
    ]
    renames, removals = plan_entity_migration(entities, entry.entry_id, source_keys, target_key)
    changed = 0
    for entity_id in removals:
        try:
            registry.async_remove(entity_id)
            changed += 1
        except Exception:  # noqa: BLE001
            LOGGER.warning("Could not remove duplicate entity %s", entity_id, exc_info=True)
    for entity_id, new_uid in renames:
        try:
            registry.async_update_entity(entity_id, new_unique_id=new_uid)
            LOGGER.info("Entity %s kept: unique_id moved to identity %s", entity_id, target_key)
            changed += 1
        except Exception:  # noqa: BLE001
            LOGGER.warning("Could not migrate entity %s to %s", entity_id, new_uid, exc_info=True)
    return changed


def find_merge_plans(
    hass: HomeAssistant,
    entry: MeshtasticConfigEntry,
    live_nodes: typing.Mapping[int, typing.Mapping[str, Any]],
    gateway_num: int | None,
) -> list[MergePlan]:
    """Znalezione grupy duplikatów (bez wykonywania czegokolwiek) — do pokazania użytkownikowi."""
    protected = {gateway_num} if gateway_num is not None else set()
    result = plan_device_merges(device_records(hass, entry), live_nodes, protected)
    for message in result.skipped:
        LOGGER.debug("Node merge skipped: %s", message)
    return list(result.plans)


def plan_with_kept_node(
    plan: MergePlan, kept_num: int, live_nodes: typing.Mapping[int, typing.Mapping[str, Any]]
) -> MergePlan:
    """Plan z tożsamością docelową wyliczoną dla węzła, który użytkownik chce zachować."""
    info = live_nodes.get(kept_num)
    if info is None:
        return plan
    target = node_identity_key(kept_num, info)
    keys = frozenset(plan.keys | {target})
    name = ((info.get("user") or {}).get("longName")) or plan.name
    return dataclasses.replace(plan, target_key=target, keys=keys, source_keys=frozenset(keys - {target}), name=name)


def apply_merge_plan(hass: HomeAssistant, entry: MeshtasticConfigEntry, plan: MergePlan) -> int:
    """Wykonaj jedno scalenie. Zwraca liczbę zmienionych wpisów encji; nigdy nie rzuca."""
    changed_entities = 0
    device_registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)
    try:
        survivor = device_registry.async_get(plan.survivor_id)
        if survivor is None:
            return 0
        LOGGER.info(
            "Merging devices %s into %s (%s) by %s; identity -> %s, node numbers %s",
            list(plan.loser_ids),
            plan.survivor_id,
            plan.name,
            plan.reason,
            plan.target_key,
            sorted(plan.nums),
        )
        changed_entities += _migrate_entities(hass, entry, plan.source_keys, plan.target_key)
        extra_connections: set[tuple[str, str]] = set()
        for loser_id in plan.loser_ids:
            loser = device_registry.async_get(loser_id)
            if loser is None:
                continue
            extra_connections |= {(k, v) for k, v in loser.connections if k == dr.CONNECTION_NETWORK_MAC}
            for reg_entry in er.async_entries_for_device(entity_registry, loser_id, include_disabled_entities=True):
                try:
                    entity_registry.async_update_entity(reg_entry.entity_id, device_id=plan.survivor_id)
                except Exception:  # noqa: BLE001
                    LOGGER.warning("Could not re-attach entity %s", reg_entry.entity_id, exc_info=True)
            if loser.config_entries == {entry.entry_id}:
                device_registry.async_remove_device(loser_id)
            else:
                device_registry.async_update_device(loser_id, remove_config_entry_id=entry.entry_id)
        identifiers = {(DOMAIN, str(n)) for n in plan.nums} | {(DOMAIN, k) for k in plan.keys}
        kwargs: dict[str, Any] = {"new_identifiers": identifiers}
        if plan.name:
            kwargs["name"] = plan.name
        try:
            device_registry.async_update_device(plan.survivor_id, **kwargs)
        except Exception:  # noqa: BLE001
            LOGGER.warning("Could not update merged device %s", plan.survivor_id, exc_info=True)
        if extra_connections:
            try:
                device_registry.async_update_device(plan.survivor_id, merge_connections=extra_connections)
            except Exception:  # noqa: BLE001
                LOGGER.debug("Could not move MAC connections to merged device", exc_info=True)
    except Exception:  # noqa: BLE001
        LOGGER.warning("Merging devices into %s failed", plan.survivor_id, exc_info=True)
    return changed_entities


def canonicalise_keys(
    hass: HomeAssistant, entry: MeshtasticConfigEntry, live_nodes: typing.Mapping[int, typing.Mapping[str, Any]]
) -> int:
    """Urządzenia z kilkoma kluczami (np. num_… + pk_…): encje na klucz bieżący."""
    changed = 0
    try:
        for _device_id, target, sources in plan_key_canonicalisation(device_records(hass, entry), live_nodes):
            changed += _migrate_entities(hass, entry, sources, target)
    except Exception:  # noqa: BLE001
        LOGGER.warning("Key canonicalisation failed", exc_info=True)
    return changed


async def async_reconcile_nodes(
    hass: HomeAssistant,
    entry: MeshtasticConfigEntry,
    live_nodes: typing.Mapping[int, typing.Mapping[str, Any]],
    gateway_num: int | None,
) -> int:
    """
    Automatyczne scalenie duplikatów (start integracji, NodeInfo pod nowym numerem).
    Zwraca liczbę zmienionych wpisów w rejestrze encji. Nigdy nie rzuca wyjątku.
    """
    changed_entities = 0
    try:
        for plan in find_merge_plans(hass, entry, live_nodes, gateway_num):
            changed_entities += apply_merge_plan(hass, entry, plan)
        changed_entities += canonicalise_keys(hass, entry, live_nodes)
    except Exception:  # noqa: BLE001
        LOGGER.warning("Node identity reconciliation failed — continuing without it", exc_info=True)
    return changed_entities
