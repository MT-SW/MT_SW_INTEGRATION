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
from .store import get_store

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

WS_PREFIX = DOMAIN

DEFAULT_MESSAGE_LIMIT = 500


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


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/nodes",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.async_response
async def ws_nodes(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Lekka lista węzłów — tyle, ile trzeba do rozwiązania nazw w czacie."""
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return

    nodes = []
    for node_id, node in (entry.runtime_data.coordinator.data or {}).items():
        user = node.get("user", {}) or {}
        nodes.append(
            {
                "node_id": node_id,
                "node_hex": f"!{node_id:08x}" if isinstance(node_id, int) else None,
                "long_name": user.get("longName"),
                "short_name": user.get("shortName"),
                "last_heard": node.get("lastHeard"),
            }
        )
    nodes.sort(key=lambda n: (n["long_name"] or n["node_hex"] or "").lower())
    connection.send_result(msg["id"], {"nodes": nodes})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/messages",
        vol.Required("entry_id"): str,
        vol.Optional("limit", default=DEFAULT_MESSAGE_LIMIT): vol.All(int, vol.Range(min=1, max=2000)),
    }
)
@websocket_api.async_response
async def ws_messages(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Historia wiadomości z trwałego magazynu."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    connection.send_result(msg["id"], {"messages": store.messages(msg["limit"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/timeseries",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.async_response
async def ws_timeseries(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Szereg czasowy telemetrii bramki do wykresów."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    connection.send_result(msg["id"], {"points": store.timeseries()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/send_message",
        vol.Required("entry_id"): str,
        vol.Required("text"): vol.All(str, vol.Length(min=1, max=228)),
        vol.Optional("channel_index"): vol.All(int, vol.Range(min=0, max=7)),
        vol.Optional("node_id"): int,
    }
)
@websocket_api.async_response
async def ws_send_message(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Wyślij wiadomość tekstową na kanał albo bezpośrednio do węzła."""
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return

    node_id = msg.get("node_id")
    channel_index = msg.get("channel_index")
    if node_id is None and channel_index is None:
        connection.send_error(msg["id"], "invalid_target", "Podaj node_id albo channel_index")
        return

    client = entry.runtime_data.client
    try:
        if node_id is not None:
            sent = await client.send_text(msg["text"], destination_id=node_id, want_ack=True)
        else:
            sent = await client.send_text(msg["text"], channel_index=channel_index, want_ack=True)
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Nie udało się wysłać wiadomości: %s", err)
        connection.send_error(msg["id"], "send_failed", str(err))
        return

    connection.send_result(msg["id"], {"sent": bool(sent)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/clear_messages",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_clear_messages(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Wyczyść historię wiadomości."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    store.clear_messages()
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/subscribe_messages",
        vol.Required("entry_id"): str,
    }
)
def ws_subscribe_messages(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Strumień nowych wiadomości i potwierdzeń.

    Panel dostaje je natychmiast, zamiast czekać na kolejne odpytanie —
    to jest różnica między czatem a tabelą odświeżaną co 10 sekund.
    """
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return

    def _forward(kind: str, payload: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"kind": kind, "message": payload}))

    connection.subscriptions[msg["id"]] = store.add_listener(_forward)
    connection.send_result(msg["id"], {})


def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Zarejestruj komendy panelu. Wołane raz, z async_setup."""
    for handler in (
        ws_gateways,
        ws_channels,
        ws_nodes,
        ws_messages,
        ws_timeseries,
        ws_send_message,
        ws_clear_messages,
        ws_subscribe_messages,
    ):
        websocket_api.async_register_command(hass, handler)
