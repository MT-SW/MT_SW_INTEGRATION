# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""
Grupy węzłów w części zbierającej dane.

Jedna lista grup: własne (zapisane w opcjach integracji) plus te zrobione wcześniej ręcznie,
złączone po nazwie. Każda grupa dostaje w Home Assistancie etykietę ``MT_SW: <nazwa>`` przypisaną
do urządzeń jej węzłów, więc grupę można użyć w pulpitach, automatyzacjach i skryptach
(cel „etykieta”). Synchronizacja nigdy nie rzuca wyjątku i rusza tylko etykiety z naszym prefiksem.
"""

from __future__ import annotations

import typing

from homeassistant.helpers import device_registry as dr

from .const import CONF_OPTION_FILTER_NODES, CONF_OPTION_NODE_GROUPS, DOMAIN, LOGGER
from .helpers import device_by_identifier

if typing.TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from .data import MeshtasticConfigEntry

LABEL_PREFIX = "MT_SW: "


async def async_all_groups(hass: HomeAssistant, entry: MeshtasticConfigEntry) -> dict[str, list[int]]:
    """Wszystkie grupy węzłów: nazwa -> numery węzłów (bez duplikatów, w stałej kolejności)."""
    merged: dict[str, set[int]] = {}
    for group in entry.options.get(CONF_OPTION_NODE_GROUPS, []):
        merged.setdefault(str(group.get("name")), set()).update(int(n) for n in group.get("node_ids", []))
    try:
        from .websocket_api import _ui_settings_store  # noqa: PLC0415

        saved = ((await _ui_settings_store(hass).async_load()) or {}).get("node_groups") or {}
        for name, ids in saved.items():
            merged.setdefault(str(name), set()).update(int(n) for n in ids)
    except Exception:  # noqa: BLE001
        LOGGER.debug("Could not read earlier node groups", exc_info=True)
    return {name: sorted(ids) for name, ids in merged.items() if name}


async def async_sync_group_labels(hass: HomeAssistant, entry: MeshtasticConfigEntry) -> None:
    """Etykiety HA zgodne z grupami: dodaje brakujące, zdejmuje te, których węzeł już nie jest w grupie."""
    try:
        from homeassistant.helpers import label_registry as lr  # noqa: PLC0415

        groups = await async_all_groups(hass, entry)
        label_registry = lr.async_get(hass)
        device_registry = dr.async_get(hass)
        tracked = {el["id"]: el for el in entry.options.get(CONF_OPTION_FILTER_NODES, [])}

        label_ids: dict[str, str] = {}
        for name in groups:
            full = f"{LABEL_PREFIX}{name}"
            label = label_registry.async_get_label_by_name(full) or label_registry.async_create(
                full, icon="mdi:radio-tower"
            )
            label_ids[name] = label.label_id
        ours = {label.label_id for label in label_registry.async_list_labels() if label.name.startswith(LABEL_PREFIX)}

        wanted: dict[str, set[str]] = {}
        for name, ids in groups.items():
            for num in ids:
                el = tracked.get(num)
                if el is None:
                    continue
                device = None
                for ident in (el.get("identity_key"), str(num)):
                    if ident:
                        device = device_by_identifier(device_registry, (DOMAIN, ident), entry.entry_id)
                        if device is not None:
                            break
                if device is not None:
                    wanted.setdefault(device.id, set()).add(label_ids[name])

        for device in dr.async_entries_for_config_entry(device_registry, entry.entry_id):
            desired = (set(device.labels) - ours) | wanted.get(device.id, set())
            if desired != set(device.labels):
                device_registry.async_update_device(device.id, labels=desired)
    except Exception:  # noqa: BLE001
        LOGGER.warning("Syncing group labels failed", exc_info=True)
