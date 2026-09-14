# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

"""WebSocket API zasilające panel MT_SW_INTEGRATION.

Panel rozmawia z integracją wyłącznie przez te komendy — nie przez encje
i nie przez proxy TCP. Dzięki temu cały dashboard korzysta z tego samego,
jedynego połączenia do radia, którym zarządza MeshtasticApiClient.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState

from .const import DOMAIN

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

WS_PREFIX = DOMAIN


def _loaded_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    """Wpisy konfiguracyjne, które są w pełni załadowane i mają runtime_data."""
    return [
        entry
        for entry in hass.config_entries.async_entries(DOMAIN)
        if entry.state is ConfigEntryState.LOADED and getattr(entry, "runtime_data", None) is not None
    ]


def _entry_by_id(hass: HomeAssistant, entry_id: str) -> ConfigEntry | None:
    return next((entry for entry in _loaded_entries(hass) if entry.entry_id == entry_id), None)


def _as_float(value: Any) -> float | None:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _gateway_payload(entry: ConfigEntry) -> Mapping[str, Any]:
    """Zbierz status bramki z koordynatora i klienta API.

    Wszystkie pola są opcjonalne — świeżo po starcie część danych jeszcze nie
    dotarła z radia, a frontend musi umieć się wtedy wyrenderować.
    """
    data = entry.runtime_data
    client = data.client
    coordinator = data.coordinator
    gateway_node = data.gateway_node or {}

    node_id = gateway_node.get("num")
    node_data: Mapping[str, Any] = {}
    if node_id is not None and coordinator.data:
        node_data = coordinator.data.get(node_id, {}) or {}

    user = gateway_node.get("user", {}) or {}
    device_metrics = node_data.get("deviceMetrics", {}) or {}
    local_stats = node_data.get("localStats", {}) or {}

    try:
        metadata = client.metadata or {}
    except Exception:  # noqa: BLE001 - metadata jest best-effort, nigdy nie może wywalić panelu
        _LOGGER.debug("Nie udało się odczytać metadanych bramki", exc_info=True)
        metadata = {}

    return {
        "entry_id": entry.entry_id,
        "title": entry.title,
        "node_id": node_id,
        "node_hex": f"!{node_id:08x}" if isinstance(node_id, int) else None,
        "long_name": user.get("longName"),
        "short_name": user.get("shortName"),
        "hw_model": user.get("hwModel"),
        "role": user.get("role"),
        "available": bool(coordinator.last_update_success and node_id is not None),
        "firmware_version": metadata.get("firmwareVersion"),
        "device_state_version": metadata.get("deviceStateVersion"),
        "has_wifi": metadata.get("hasWifi"),
        "has_bluetooth": metadata.get("hasBluetooth"),
        "uptime_seconds": _as_int(device_metrics.get("uptimeSeconds")),
        "battery_level": _as_int(device_metrics.get("batteryLevel")),
        "voltage": _as_float(device_metrics.get("voltage")),
        "channel_utilization": _as_float(device_metrics.get("channelUtilization")),
        "air_util_tx": _as_float(device_metrics.get("airUtilTx")),
        "packets_tx": _as_int(local_stats.get("numPacketsTx")),
        "packets_rx": _as_int(local_stats.get("numPacketsRx")),
        "packets_rx_bad": _as_int(local_stats.get("numPacketsRxBad")),
        "packets_tx_relay": _as_int(local_stats.get("numTxRelay")),
        "packets_tx_dropped": _as_int(local_stats.get("numTxDropped")),
        "nodes_online": _as_int(local_stats.get("numOnlineNodes")),
        "nodes_total": _as_int(local_stats.get("numTotalNodes")),
        "noise_floor": _as_float(local_stats.get("noiseFloor")),
        "tracked_nodes": len(coordinator.data or {}),
    }


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/gateways"})
@websocket_api.async_response
async def ws_gateways(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Lista bramek wraz z ich aktualnym statusem."""
    gateways = [_gateway_payload(entry) for entry in _loaded_entries(hass)]
    connection.send_result(msg["id"], {"gateways": gateways})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/channels",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.async_response
async def ws_channels(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Tabela kanałów skonfigurowanych na bramce."""
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return

    try:
        raw_channels = await entry.runtime_data.client.async_get_channels()
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Nie udało się pobrać kanałów: %s", err)
        connection.send_error(msg["id"], "channels_failed", str(err))
        return

    channels = []
    for channel in raw_channels or []:
        settings = channel.get("settings", {}) or {}
        channels.append(
            {
                "index": channel.get("index", 0),
                "role": channel.get("role", "DISABLED"),
                "name": settings.get("name") or "",
                "has_psk": bool(settings.get("psk")),
                "uplink_enabled": bool(settings.get("uplinkEnabled")),
                "downlink_enabled": bool(settings.get("downlinkEnabled")),
                "position_precision": (settings.get("moduleSettings", {}) or {}).get("positionPrecision"),
            }
        )

    connection.send_result(msg["id"], {"channels": channels})


def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Zarejestruj komendy panelu. Wołane raz, z async_setup."""
    websocket_api.async_register_command(hass, ws_gateways)
    websocket_api.async_register_command(hass, ws_channels)
