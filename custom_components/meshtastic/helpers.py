from __future__ import annotations

import typing
from collections import defaultdict

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
    filter_node_nums = [el["id"] for el in filter_nodes]
    if not entry.runtime_data.coordinator.data:
        return {}

    return {
        node_num: node_info
        for node_num, node_info in entry.runtime_data.coordinator.data.items()
        if node_num in filter_node_nums
    }


_remove_listeners = defaultdict(lambda: defaultdict(list))


async def setup_platform_entry(
    hass: HomeAssistant,
    entry: MeshtasticConfigEntry,
    async_add_entities: AddEntitiesCallback,
    entity_factory: Callable[[typing.Mapping[int, typing.Mapping[str, Any]], MeshtasticData], Iterable[Entity]],
) -> None:
    entities = list(entity_factory(get_nodes(entry), entry.runtime_data))
    async_add_entities(entities)
    platform = entity_platform.async_get_current_platform()

    # remove stale entities, but only for nodes that fully dropped out of
    # the filter — a metric-specific entity temporarily missing (e.g.
    # localStats telemetry not received yet since restart) must NOT be
    # treated as stale
    registry = er.async_get(hass)
    allowed_node_ids = get_nodes(entry).keys()
    allowed_prefixes = tuple(f"{entry.entry_id}_{platform.domain}_{node_id}_" for node_id in allowed_node_ids)
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
        existing_unique_ids = {e.unique_id for e in platform.entities.values()}
        new_entities = [s for s in entities if s.unique_id not in existing_unique_ids]
        if new_entities:
            async_add_entities(new_entities)

    remove_listener = entry.runtime_data.coordinator.async_add_listener(on_coordinator_data_update)
    _remove_listeners[platform.domain][entry.entry_id].append(remove_listener)


async def async_unload_entry(
    hass: HomeAssistant,  # noqa: ARG001
    entry: MeshtasticConfigEntry,
) -> bool:
    platform = entity_platform.async_get_current_platform()
    for remove_listener in _remove_listeners[platform.domain].pop(entry.entry_id, []):
        remove_listener()

    return True


async def fetch_meshtastic_hardware_names(hass: HomeAssistant) -> typing.Mapping[str, str]:
    try:
        session = async_get_clientsession(hass)
        async with session.get("https://api.meshtastic.org/resource/deviceHardware", raise_for_status=True) as response:
            response_json = await response.json()
            device_hardware_names = {h["hwModelSlug"]: h["displayName"] for h in response_json}
    except Exception:  # noqa: BLE001
        LOGGER.info("Failed to fetch meshtastic hardware infos", exc_info=True)
        device_hardware_names = {}
    return device_hardware_names
