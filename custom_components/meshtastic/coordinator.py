from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
from functools import wraps
from typing import TYPE_CHECKING, Any

from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import (
    ATTR_EVENT_MESHTASTIC_API_CONFIG_ENTRY_ID,
    ATTR_EVENT_MESHTASTIC_API_DATA,
    ATTR_EVENT_MESHTASTIC_API_NODE,
    EVENT_MESHTASTIC_API_NODE_UPDATED,
    EVENT_MESHTASTIC_API_POSITION,
    EVENT_MESHTASTIC_API_TELEMETRY,
    EventMeshtasticApiTelemetryType,
    MeshtasticApiClientError,
)
from .const import CONF_OPTION_FILTER_NODES, DOMAIN, LOGGER
from .helpers import node_identity_key

EVENT_MESHTASTIC_NODE_IDENTITY_MIGRATED = f"{DOMAIN}_node_identity_migrated"

ATTR_EVENT_MESHTASTIC_IDENTITY_CONFIG_ENTRY_ID = "config_entry_id"
ATTR_EVENT_MESHTASTIC_IDENTITY_KEY = "identity_key"
ATTR_EVENT_MESHTASTIC_IDENTITY_OLD_NODE = "old_node_id"
ATTR_EVENT_MESHTASTIC_IDENTITY_NEW_NODE = "new_node_id"

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.core import Event, HomeAssistant, _DataT

    from .data import MeshtasticConfigEntry


def meshtastic_api_event_callback(f):  # noqa: ANN001, ANN201
    @wraps(f)
    async def wrapper(self: MeshtasticDataUpdateCoordinator, event: Event[_DataT]):  # noqa: ANN202
        try:
            if self.config_entry is None:
                return None

            event_data = deepcopy(event.data)
            config_entry_id = event_data.pop(ATTR_EVENT_MESHTASTIC_API_CONFIG_ENTRY_ID, None)
            if config_entry_id != self.config_entry.entry_id:
                return None

            if not self.data:
                self._logger.debug("Received event but coordinator is not yet initialized")
                return None

            node_id = event_data.get(ATTR_EVENT_MESHTASTIC_API_NODE, None)
            if node_id is None or node_id not in self.data:
                self._logger.debug("Node %d not in coordinator data", node_id)
                return None

            data = event_data.get(ATTR_EVENT_MESHTASTIC_API_DATA, None)
            if data is None:
                self._logger.debug("Event did not contain data")
                return None

            additional_event_data = {
                k: v
                for k, v in event_data.items()
                if k not in [ATTR_EVENT_MESHTASTIC_API_NODE, ATTR_EVENT_MESHTASTIC_API_DATA]
            }

            return await f(self, node_id, data, **additional_event_data)
        except:  # noqa: E722
            self._logger.warning("Failed to handle meshtastic api event", exc_info=True)

    return wrapper


class MeshtasticDataUpdateCoordinator(DataUpdateCoordinator):
    config_entry: MeshtasticConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
    ) -> None:
        super().__init__(
            hass=hass,
            logger=LOGGER,
            name=DOMAIN,
            update_interval=timedelta(hours=1),
        )
        self._logger = LOGGER.getChild(self.__class__.__name__)
        self._tracked_identity_by_num: dict[int, str] = {}
        self._remove_event_listeners = []
        self._remove_event_listeners.append(
            hass.bus.async_listen(EVENT_MESHTASTIC_API_NODE_UPDATED, self._api_node_updated)
        )
        self._remove_event_listeners.append(hass.bus.async_listen(EVENT_MESHTASTIC_API_TELEMETRY, self._api_telemetry))
        self._remove_event_listeners.append(hass.bus.async_listen(EVENT_MESHTASTIC_API_POSITION, self._api_position))

    async def async_shutdown(self) -> None:
        await super().async_shutdown()

        for remove_listener in self._remove_event_listeners:
            try:
                remove_listener()
            except:  # noqa: E722
                self._logger.debug("Could not remove event listeners", exc_info=True)

    @meshtastic_api_event_callback
    async def _api_node_updated(self, node_id: int, node_data: Mapping[str, Any], **kwargs) -> None:  # noqa: ANN003, ARG002
        if self.data[node_id] != node_data:
            data = deepcopy(self.data)
            data[node_id].update(node_data)
            self.async_set_updated_data(data)

    @meshtastic_api_event_callback
    async def _api_telemetry(
        self,
        node_id: int,
        data: Mapping[str, Any],
        *,
        telemetry_type: EventMeshtasticApiTelemetryType,
        **kwargs,  # noqa: ANN003, ARG002
    ) -> None:
        if telemetry_type == EventMeshtasticApiTelemetryType.DEVICE_METRICS:
            metric_type = "deviceMetrics"
        elif telemetry_type == EventMeshtasticApiTelemetryType.LOCAL_STATS:
            metric_type = "localStats"
        elif telemetry_type == EventMeshtasticApiTelemetryType.POWER_METRICS:
            metric_type = "powerMetrics"
        elif telemetry_type == EventMeshtasticApiTelemetryType.ENVIRONMENT_METRICS:
            metric_type = "environmentMetrics"
        elif telemetry_type == EventMeshtasticApiTelemetryType.HOST_METRICS:
            metric_type = "hostMetrics"
        else:
            self._logger.warning("Unsupported telemetry type %s", telemetry_type)
            return

        new_metrics = data
        existing_metrics = self.data[node_id].get(metric_type, None)
        if existing_metrics == new_metrics:
            self._logger.debug("Received telemetry identical to existing metrics, ignoring event")
            return

        data = deepcopy(self.data)
        data[node_id][metric_type] = new_metrics
        self.async_set_updated_data(data)

    @meshtastic_api_event_callback
    async def _api_position(
        self,
        node_id: int,
        data: Mapping[str, Any],
        **kwargs,  # noqa: ANN003, ARG002
    ) -> None:
        new_position = data
        existing_position = self.data[node_id].get("position", {})
        if existing_position == new_position:
            self._logger.debug("Received position identical to existing position, ignoring event")
            return

        data = deepcopy(self.data)
        data[node_id]["position"] = new_position
        self.async_set_updated_data(data)

    async def _node_updated(self, event: Event) -> None:
        if self.config_entry is None:
            return

        event_data = deepcopy(event.data)
        config_entry_id = event_data.pop("config_entry_id", None)
        if config_entry_id != self.config_entry.entry_id:
            return

        if not self.data:
            self._logger.debug("Received updated metrics but coordinator data is empty")
            return

        node_id = event_data.get("num", None)
        if node_id is None or node_id not in self.data:
            self._logger.debug("Node %d not in coordinator data", node_id)
            return

        if self.data[node_id] != event_data:
            data = deepcopy(self.data)
            data[node_id] = event_data
            self.async_set_updated_data(data)

    async def _async_update_data(self) -> Any:
        if self.config_entry is None or self.config_entry.runtime_data is None:
            self._logger.warning("Update data requested but config entry is empty")
            return None

        try:
            node_infos = await self.config_entry.runtime_data.client.async_get_all_nodes()
        except MeshtasticApiClientError as exception:
            raise UpdateFailed(exception) from exception

        filter_nodes = self.config_entry.options.get(CONF_OPTION_FILTER_NODES, [])
        filter_node_nums = [el["id"] for el in filter_nodes]
        configured_identity_keys = {el["identity_key"] for el in filter_nodes if el.get("identity_key")}

        # Node numbers are normally stable, but the firmware regenerates a
        # new random num if it detects a collision with another node on
        # the mesh. Build an identity_key -> live num index from
        # everything currently visible on the mesh so a tracked node
        # whose num just changed can still be found via the identity
        # (public key) it had the last time we saw it.
        live_identity_index = {
            node_identity_key(node_num, node_info): node_num for node_num, node_info in node_infos.items()
        }

        resolved_node_nums = set()
        for el in filter_nodes:
            tracked_num = el["id"]
            if tracked_num in node_infos:
                resolved_node_nums.add(tracked_num)
                continue

            # not currently live under its configured number — try to
            # follow it via identity, preferring the identity stored in
            # the filter config itself (durable across HA restarts) and
            # falling back to what we've observed so far this session
            known_identity_key = el.get("identity_key") or self._tracked_identity_by_num.get(tracked_num)
            new_num = live_identity_index.get(known_identity_key) if known_identity_key else None
            if new_num is not None and new_num != tracked_num:
                self._logger.info(
                    "Node %d appears to have a new node number %d (unchanged identity %s)",
                    tracked_num,
                    new_num,
                    known_identity_key,
                )
                resolved_node_nums.add(new_num)
                self.hass.bus.async_fire(
                    EVENT_MESHTASTIC_NODE_IDENTITY_MIGRATED,
                    {
                        ATTR_EVENT_MESHTASTIC_IDENTITY_CONFIG_ENTRY_ID: self.config_entry.entry_id,
                        ATTR_EVENT_MESHTASTIC_IDENTITY_KEY: known_identity_key,
                        ATTR_EVENT_MESHTASTIC_IDENTITY_OLD_NODE: tracked_num,
                        ATTR_EVENT_MESHTASTIC_IDENTITY_NEW_NODE: new_num,
                    },
                )
            # else: node is genuinely offline / not heard from yet this
            # session, same as before — it stays out of self.data until
            # it (or its new num) is seen again.

        new_data = {node_num: deepcopy(node_infos[node_num]) for node_num in resolved_node_nums}

        # merge (not replace) so a node that's simply offline this poll
        # doesn't lose its last-known identity. Drop entries only for
        # numbers that have genuinely fallen out of the filter — checked
        # by identity first (so a migrated node's new num isn't pruned
        # just because it doesn't literally match the configured raw
        # number), falling back to the raw number for filter entries
        # that don't have a stored identity_key yet.
        for node_num, node_info in new_data.items():
            self._tracked_identity_by_num[node_num] = node_identity_key(node_num, node_info)
        self._tracked_identity_by_num = {
            node_num: identity_key
            for node_num, identity_key in self._tracked_identity_by_num.items()
            if node_num in filter_node_nums or identity_key in configured_identity_keys
        }

        return new_data

    def resolve_node_id(self, identity_key: str) -> int | None:
        """Return the current node number for a known identity key, if any."""
        if not self.data:
            return None
        for node_num, node_data in self.data.items():
            if node_identity_key(node_num, node_data) == identity_key:
                return node_num
        return None

    def identity_key_for(self, node_id: int) -> str:
        """
        Return the best-known identity key for a tracked node number.

        Uses live data when the node is currently online, falls back to
        the identity it was last seen under if it's temporarily offline,
        and otherwise falls back to the same raw-number format
        node_identity_key() itself uses for a node we've never seen.
        """
        if self.data and node_id in self.data:
            return node_identity_key(node_id, self.data[node_id])
        if node_id in self._tracked_identity_by_num:
            return self._tracked_identity_by_num[node_id]
        return node_identity_key(node_id, None)
