# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

from __future__ import annotations

import base64
import time
import typing
from collections import defaultdict

import aiohttp
from homeassistant.helpers import entity_platform
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_OPTION_FILTER_NODES, LOGGER

if typing.TYPE_CHECKING:
    from collections.abc import Callable, Iterable
    from typing import Any

    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity import Entity
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

    from .data import MeshtasticConfigEntry, MeshtasticData


def get_nodes(entry: MeshtasticConfigEntry) -> typing.Mapping[int, typing.Mapping[str, Any]]:
    filter_nodes = entry.options.get(CONF_OPTION_FILTER_NODES, [])
    filter_node_nums = {el["id"] for el in filter_nodes}
    configured_identity_keys = {el["identity_key"] for el in filter_nodes if el.get("identity_key")}
    if not entry.runtime_data.coordinator.data:
        return {}

    return {
        node_num: node_info
        for node_num, node_info in entry.runtime_data.coordinator.data.items()
        if node_num in filter_node_nums or node_identity_key(node_num, node_info) in configured_identity_keys
    }


def node_identity_key(node_id: int, node_data: typing.Mapping[str, Any] | None) -> str:
    """
    Return a stable identity key for a node.

    Meshtastic node numbers (``num``) are normally derived from the radio's
    MAC address, but the firmware regenerates a new random ``num`` if it
    detects a collision with another node on the mesh. The node's PKI public
    key survives that change, so it is a much more stable identity than the
    raw number. Falls back to the node number when no public key is known
    yet (older firmware, or a node we haven't received a NodeInfo for).
    """
    public_key_b64 = (node_data or {}).get("user", {}).get("publicKey")
    if public_key_b64:
        public_key_hex = base64.b64decode(public_key_b64).hex()
        if public_key_hex:
            return f"pk_{public_key_hex}"
    return f"num_{node_id}"


_remove_listeners = defaultdict(lambda: defaultdict(list))
_known_unique_ids: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))


async def setup_platform_entry(
    hass: HomeAssistant,
    entry: MeshtasticConfigEntry,
    async_add_entities: AddEntitiesCallback,
    entity_factory: Callable[[typing.Mapping[int, typing.Mapping[str, Any]], MeshtasticData], Iterable[Entity]],
) -> None:
    entities = list(entity_factory(get_nodes(entry), entry.runtime_data))
    async_add_entities(entities)
    platform = entity_platform.async_get_current_platform()

    known_unique_ids = _known_unique_ids[platform.domain][entry.entry_id]
    known_unique_ids.clear()
    known_unique_ids.update(e.unique_id for e in entities)
   
    # remove stale entities, but only for nodes that were actually
    # unselected in the filter option — a node temporarily offline/not
    # yet reporting into coordinator.data (or a metric temporarily
    # missing) must NOT be treated as stale. Base this on the configured
    # filter list itself, not on which nodes currently have live data.
    registry = er.async_get(hass)
    filter_nodes = entry.options.get(CONF_OPTION_FILTER_NODES, [])
    allowed_node_ids = {el["id"] for el in filter_nodes}
    coordinator = entry.runtime_data.coordinator
    allowed_identity_keys = {coordinator.identity_key_for(node_id) for node_id in allowed_node_ids}
    allowed_prefixes = tuple(
        f"{entry.entry_id}_{platform.domain}_{identity_key}_" for identity_key in allowed_identity_keys
    )
    for reg_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
        if reg_entry.domain == platform.domain and not reg_entry.unique_id.startswith(allowed_prefixes):
            registry.async_remove(reg_entry.entity_id)

    # defensive cleanup: ensure no stale listener remains from a previous
    # setup of this entry/platform (guards against duplicate entity
    # registration if unload wasn't called cleanly before a reload)
    for stale_remove in _remove_listeners[platform.domain].pop(entry.entry_id, []):
        stale_remove()

    def on_coordinator_data_update() -> None:
        entities = entity_factory(get_nodes(entry), entry.runtime_data)
        new_entities = [s for s in entities if s.unique_id not in known_unique_ids]
        if new_entities:
            known_unique_ids.update(e.unique_id for e in new_entities)
            async_add_entities(new_entities)

    remove_listener = entry.runtime_data.coordinator.async_add_listener(on_coordinator_data_update)
    _remove_listeners[platform.domain][entry.entry_id].append(remove_listener)


_NODE_SCOPED_DOMAINS = ("sensor", "binary_sensor", "device_tracker", "button")


async def async_prune_stale_node_entities(hass: HomeAssistant, entry: MeshtasticConfigEntry) -> None:
    """
    Remove entities for nodes that are no longer in the tracked filter list.

    Mirrors the per-platform cleanup already done once at initial setup
    inside setup_platform_entry(), but callable on demand — e.g. right
    after the filter option changes, without a full integration reload —
    and across all node-scoped platforms in a single registry pass.
    """
    registry = er.async_get(hass)
    filter_nodes = entry.options.get(CONF_OPTION_FILTER_NODES, [])
    allowed_node_ids = {el["id"] for el in filter_nodes}
    coordinator = entry.runtime_data.coordinator
    allowed_identity_keys = {coordinator.identity_key_for(node_id) for node_id in allowed_node_ids}

    for reg_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
        if reg_entry.domain not in _NODE_SCOPED_DOMAINS:
            continue
        allowed_prefixes = tuple(
            f"{entry.entry_id}_{reg_entry.domain}_{identity_key}_" for identity_key in allowed_identity_keys
        )
        if not reg_entry.unique_id.startswith(allowed_prefixes):
            registry.async_remove(reg_entry.entity_id)


async def async_unload_entry(
    hass: HomeAssistant,  # noqa: ARG001
    entry: MeshtasticConfigEntry,
) -> bool:
    platform = entity_platform.async_get_current_platform()
    for remove_listener in _remove_listeners[platform.domain].pop(entry.entry_id, []):
        remove_listener()
    _known_unique_ids[platform.domain].pop(entry.entry_id, None)

    return True


_hardware_names_cache: typing.Mapping[str, str] | None = None
_hardware_names_cache_at: float = 0.0
_HARDWARE_NAMES_TTL_SECONDS = 24 * 60 * 60


async def fetch_meshtastic_hardware_names(hass: HomeAssistant) -> typing.Mapping[str, str]:
    """
    Fetch the hwModel -> display name mapping from api.meshtastic.org.

    Cached for _HARDWARE_NAMES_TTL_SECONDS — this list changes rarely, if
    ever, during a running session. Without this cache, every call to
    _setup_meshtastic_devices() (including every live node-filter change,
    not just initial setup) would wait on an external HTTP call just to
    build the device registry, even though everything else it needs is
    already available locally.
    """
    global _hardware_names_cache, _hardware_names_cache_at  # noqa: PLW0603

    now = time.monotonic()
    if _hardware_names_cache is not None and (now - _hardware_names_cache_at) < _HARDWARE_NAMES_TTL_SECONDS:
        return _hardware_names_cache

    try:
        session = async_get_clientsession(hass)
        async with session.get(
            "https://api.meshtastic.org/resource/deviceHardware",
            raise_for_status=True,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as response:
            response_json = await response.json()
            device_hardware_names = {h["hwModelSlug"]: h["displayName"] for h in response_json}
    except Exception:  # noqa: BLE001
        LOGGER.info("Failed to fetch meshtastic hardware infos", exc_info=True)
        return _hardware_names_cache or {}

    _hardware_names_cache = device_hardware_names
    _hardware_names_cache_at = now
    return device_hardware_names
