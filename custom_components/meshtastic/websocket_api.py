# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

"""WebSocket API zasilające panel MT_SW_INTEGRATION.

Panel rozmawia z integracją wyłącznie przez te komendy — nie przez encje
i nie przez proxy TCP. Dzięki temu cały dashboard korzysta z tego samego,
jedynego połączenia do radia, którym zarządza MeshtasticApiClient.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import TYPE_CHECKING, Any

import voluptuous as vol
from google.protobuf.json_format import MessageToDict
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import callback
from homeassistant.helpers.storage import Store

from . import nodedb_cleanup, ondemand
from .aiomeshtastic.interface import TelemetryType
from .const import DOMAIN
from .helpers import panel_enabled, preset_channel_name
from .nodedb_cleanup import NoCriteriaError
from .ondemand import OnDemandError
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
        if entry.state is ConfigEntryState.LOADED
        and getattr(entry, "runtime_data", None) is not None
        # bramka z wyłączonym panelem w opcjach nie jest pokazywana w panelu
        and panel_enabled(entry)
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


def _own_status_message(entry: ConfigEntry) -> str | None:
    """Status własnej bramki — z konfiguracji modułu, bo własnego rozgłoszenia radio nam nie odsyła."""
    try:
        config = entry.runtime_data.client.interface.connected_node_module_config()
        if config is None:
            return None
        return (config.statusmessage.node_status or "").strip() or None
    except Exception:  # noqa: BLE001 - status jest dodatkiem, nie może zepsuć listy węzłów
        return None


def _remembered(node_data: Mapping[str, Any], saved: Mapping[str, Any], key: str) -> tuple[Mapping[str, Any], Any]:
    """Zwróć (dane, czas zapisu): żywe dane koordynatora albo ostatnie zapisane na dysku.

    Czas zapisu jest None, gdy dane są żywe. Po restarcie integracji radio
    przysyła statystyki dopiero przy następnym pakiecie telemetrii, więc do tego
    czasu pokazujemy to, co zapamiętaliśmy.
    """
    live = node_data.get(key)
    if live:
        return live, None
    remembered = saved.get(key) or {}
    data = remembered.get("data") or {}
    if key == "deviceMetrics":
        # czas pracy sprzed restartu byłby teraz nieprawdą
        data = {name: value for name, value in data.items() if name != "uptimeSeconds"}
    return data, (remembered.get("ts") if data else None)


def _client_connected(client: Any) -> bool:
    try:
        return bool(client.is_connected)
    except Exception:  # noqa: BLE001
        return False


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
    store = get_store(entry.entry_id)
    saved = store.node_state(node_id).get("telemetry", {}) if store is not None and node_id is not None else {}
    device_metrics, device_saved_at = _remembered(node_data, saved, "deviceMetrics")
    # LocalStats niesie liczniki pakietów i węzłów, LocalStatsExtended (firmware
    # MT_SW) wyłącznie pamięć i CPU — to rozłączne zbiory pól, więc scalamy je,
    # zamiast wybierać jeden. Na firmware waniliowym drugi człon jest pusty.
    basic_stats, basic_saved_at = _remembered(node_data, saved, "localStats")
    extended_stats, extended_saved_at = _remembered(node_data, saved, "localStatsExtended")
    local_stats = {**basic_stats, **extended_stats}
    saved_times = [ts for ts in (device_saved_at, basic_saved_at, extended_saved_at) if ts]

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
        "is_licensed": bool(user.get("isLicensed")),
        "is_unmessagable": bool(user.get("isUnmessagable")),
        "hw_model": user.get("hwModel"),
        "role": user.get("role"),
        # Dostępność = żywe łącze z radiem, a nie stan koordynatora statystyk —
        # panel działa niezależnie od warstwy statystyk.
        "available": bool(node_id is not None and _client_connected(client)),
        "connected": _client_connected(client),
        "session": getattr(client, "session_id", None),
        "stats_enabled": bool(getattr(getattr(data, "stats", None), "enabled", True)),
        # klient webowy jest niezależny od panelu — przycisk na zakładce Radio
        # pokazujemy tylko wtedy, gdy jest włączony w opcjach
        "web_client": bool((entry.options.get("web_client") or {}).get("enable", False)),
        "stats_ok": bool(getattr(data, "stats", None) is None or data.stats.error is None),
        "stats_error": getattr(getattr(data, "stats", None), "error", None),
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
        "packets_rx_dupe": _as_int(local_stats.get("numRxDupe")),
        "packets_tx_relay_canceled": _as_int(local_stats.get("numTxRelayCanceled")),
        "nodes_online": _as_int(local_stats.get("numOnlineNodes")),
        "nodes_total": _as_int(local_stats.get("numTotalNodes")),
        "noise_floor": _as_float(local_stats.get("noiseFloor")),
        "heap_free": _as_int(local_stats.get("heapFreeBytes") or local_stats.get("memoryFreeCheap")),
        "heap_total": _as_int(local_stats.get("heapTotalBytes") or local_stats.get("memoryTotal")),
        "cpu_usage": _as_float(local_stats.get("cpuUsagePercent")),
        "flash_used": _as_int(local_stats.get("flashUsedBytes")),
        "flash_total": _as_int(local_stats.get("flashTotalBytes")),
        "psram_free": _as_int(local_stats.get("memoryPsramFree")),
        "psram_total": _as_int(local_stats.get("memoryPsramTotal")),
        "tracked_nodes": len(coordinator.data or {}),
        "stats_saved_at": min(saved_times) if saved_times else None,
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

    # Kanał bez nazwy nazywa się jak preset LoRa (np. „MediumFast”), tak jak w
    # firmware i w aplikacji — panel pokazuje display_name zamiast „Kanał 0”.
    preset_name = "LongFast"
    with contextlib.suppress(Exception):
        local = entry.runtime_data.client.interface.connected_node_local_config()
        preset_name = preset_channel_name(local.lora if local is not None else None)

    channels = []
    for channel in raw_channels or []:
        settings = channel.get("settings", {}) or {}
        role = channel.get("role", "DISABLED")
        own_name = settings.get("name") or ""
        channels.append(
            {
                "index": channel.get("index", 0),
                "role": role,
                "name": own_name,
                "display_name": own_name or (preset_name if role != "DISABLED" else ""),
                "preset_name": preset_name,
                "psk": settings.get("psk") or "",
                "has_psk": bool(settings.get("psk")),
                "uplink_enabled": bool(settings.get("uplinkEnabled")),
                "downlink_enabled": bool(settings.get("downlinkEnabled")),
                "position_precision": (settings.get("moduleSettings", {}) or {}).get("positionPrecision"),
                "is_muted": bool((settings.get("moduleSettings", {}) or {}).get("isMuted")),
            }
        )

    connection.send_result(msg["id"], {"channels": channels})


def _coordinate(position: Mapping[str, Any], name: str) -> float | None:
    """Współrzędna w stopniach — radio podaje ją jako liczbę całkowitą *1e7 (latitudeI)."""
    value = position.get(name)
    if value is not None:
        return value
    scaled = position.get(f"{name}I")
    if scaled is None:
        return None
    try:
        return round(float(scaled) * 1e-7, 7)
    except (TypeError, ValueError):
        return None


class _NodePayloadContext:
    """Dane wspólne dla całej listy węzłów — liczone raz, nie per węzeł."""

    def __init__(self, entry: ConfigEntry) -> None:
        self.entry = entry
        gateway_node = entry.runtime_data.gateway_node or {}
        self.gateway_id = gateway_node.get("num")
        try:
            self.gateway_signs = bool((entry.runtime_data.client.metadata or {}).get("hasXeddsa"))
        except Exception:  # noqa: BLE001 - metadata jest best-effort, nie może zerwać listy węzłów
            self.gateway_signs = False
        try:
            self.tracked = set(entry.runtime_data.coordinator.data or {})
        except Exception:  # noqa: BLE001 - warstwa statystyk nie może zepsuć panelu
            self.tracked = set()
        self.store = get_store(entry.entry_id)
        self.own_status = _own_status_message(entry)


def _node_payload(context: _NodePayloadContext, node_id: int, node: Mapping[str, Any]) -> dict[str, Any]:
    """Jeden wiersz listy węzłów panelu — wspólny dla ws_nodes i subskrypcji na żywo."""
    gateway_id = context.gateway_id
    store = context.store
    own_status = context.own_status
    tracked = context.tracked
    gateway_signs = context.gateway_signs
    user = node.get("user", {}) or {}
    position = node.get("position", {}) or {}
    device_metrics = node.get("deviceMetrics", {}) or {}
    environment_metrics = node.get("environmentMetrics", {}) or {}
    # Sąsiedzi i status podpisywania żyją tylko w pamięci połączenia z
    # radiem i znikają po restarcie integracji — dopóki nie przyjdzie
    # świeży pakiet od danego węzła, sięgamy do tego, co zdążyliśmy
    # zapisać na dysk przed restartem.
    saved_state = store.node_state(node_id) if store is not None else {}
    neighbor_info = node.get("neighborInfo") or saved_state.get("neighbor_info") or {}
    # Węzeł podpisuje pakiety, jeśli samo urządzenie oznaczyło tak jego wpis
    # w bazie (hasXeddsaSigned — zostaje między czyszczeniami bazy) albo
    # widzieliśmy od niego podpisaną wiadomość. Własnej bramki radio nigdy
    # nie ocenia po odebranych pakietach (nie słyszy siebie), więc ona
    # podpisuje wtedy, gdy firmware ma XEdDSA (DeviceMetadata.has_xeddsa).
    signed = node.get("hasXeddsaSigned") or saved_state.get("signed", False)
    if node_id == gateway_id and gateway_signs:
        signed = True

    neighbors = [
        {
            "node_id": neighbor.get("nodeId"),
            "snr": _as_float(neighbor.get("snr")),
        }
        for neighbor in (neighbor_info.get("neighbors") or [])
        if neighbor.get("nodeId") is not None
    ]

    return {
        "node_id": node_id,
        "node_hex": f"!{node_id:08x}" if isinstance(node_id, int) else None,
        "long_name": user.get("longName"),
        "short_name": user.get("shortName"),
        "hw_model": user.get("hwModel"),
        "role": user.get("role"),
        "is_gateway": node_id == gateway_id,
        "is_tracked": node_id in tracked,
        "is_favorite": bool(node.get("isFavorite")),
        "is_ignored": bool(node.get("isIgnored")),
        "is_muted": bool(node.get("isMuted")),
        "heard_on_current_lora": node.get("heardOnCurrentLora"),
        "channel": _as_int(node.get("channel")),
        "last_heard": node.get("lastHeard"),
        "snr": _as_float(node.get("snr")),
        "signed": bool(signed),
        "hops_away": _as_int(node.get("hopsAway")),
        # droga ostatniego pakietu od tego węzła (ostatni bajt przekaźnika i skoki)
        "via_relay": _as_int((saved_state.get("via") or {}).get("relay")),
        "via_hops": _as_int((saved_state.get("via") or {}).get("hops")),
        "via_ts": _as_int((saved_state.get("via") or {}).get("ts")),
        # ostatnia wiadomość statusu rozgłoszona przez węzeł (moduł Status Message)
        "status_message": (
            own_status
            if node_id == gateway_id
            else ((saved_state.get("status") or {}).get("text") or None)
        ),
        "status_ts": None if node_id == gateway_id else _as_int((saved_state.get("status") or {}).get("ts")),
        "via_snr": _as_float((saved_state.get("via") or {}).get("snr")),
        "via_rssi": _as_int((saved_state.get("via") or {}).get("rssi")),
        "via_mqtt": bool(node.get("viaMqtt")),
        "latitude": _coordinate(position, "latitude"),
        "longitude": _coordinate(position, "longitude"),
        "altitude": _as_int(position.get("altitude")),
        "position_time": position.get("time"),
        "precision_bits": _as_int(position.get("precisionBits")),
        "battery_level": _as_int(device_metrics.get("batteryLevel")),
        "voltage": _as_float(device_metrics.get("voltage")),
        "channel_utilization": _as_float(device_metrics.get("channelUtilization")),
        "air_util_tx": _as_float(device_metrics.get("airUtilTx")),
        "uptime_seconds": _as_int(device_metrics.get("uptimeSeconds")),
        "temperature": _as_float(environment_metrics.get("temperature")),
        "humidity": _as_float(environment_metrics.get("relativeHumidity")),
        "pressure": _as_float(environment_metrics.get("barometricPressure")),
        "neighbors": neighbors,
    }


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

    # Panel celowo czyta pełną bazę węzłów z urządzenia, a nie coordinator.data.
    # Koordynator jest przefiltrowany opcją "nodes" wpisu konfiguracyjnego,
    # która decyduje wyłącznie o tym, dla których węzłów powstają encje HA.
    # Panel ma pokazywać to samo, co widzi radio — jak klient WWW.
    context = _NodePayloadContext(entry)
    nodes = [
        _node_payload(context, node_id, node)
        for node_id, node in entry.runtime_data.client.get_all_nodes_sync().items()
    ]
    nodes.sort(key=lambda n: (n["long_name"] or n["node_hex"] or "").lower())
    connection.send_result(msg["id"], {"nodes": nodes})


_NODE_PUSH_DELAY_SECONDS = 0.75


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/subscribe_nodes",
        vol.Required("entry_id"): str,
    }
)
@callback
def ws_subscribe_nodes(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """
    Lista węzłów na żywo — tak jak w aplikacji.

    Najpierw pełna migawka, potem wyłącznie zmienione węzły, zebrane w paczki
    co ułamek sekundy. Źródłem jest bezpośrednio baza węzłów połączenia z
    radiem — bez koordynatora statystyk, bez rejestru encji i bez odpytywania
    co 10 s. Dodanie do ulubionych czy usunięcie węzła widać od razu.
    """
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return

    client = entry.runtime_data.client
    pending: set[int] = set()
    state: dict[str, Any] = {"handle": None, "full": False}

    def _send(payload: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    def _snapshot() -> None:
        context = _NodePayloadContext(entry)
        nodes = [_node_payload(context, node_id, node) for node_id, node in client.get_all_nodes_sync().items()]
        _send(
            {
                "kind": "snapshot",
                "nodes": nodes,
                "connected": _client_connected(client),
                "session": getattr(client, "session_id", None),
            }
        )

    @callback
    def _flush() -> None:
        state["handle"] = None
        try:
            if state["full"]:
                state["full"] = False
                pending.clear()
                _snapshot()
                return
            if not pending:
                return
            database = client.get_all_nodes_sync()
            context = _NodePayloadContext(entry)
            upsert = []
            remove = []
            for node_id in pending:
                node = database.get(node_id)
                if node is None:
                    remove.append(node_id)
                else:
                    upsert.append(_node_payload(context, node_id, node))
            pending.clear()
            _send({"kind": "delta", "upsert": upsert, "remove": remove})
        except Exception:  # noqa: BLE001 - błąd jednej paczki nie może zerwać subskrypcji
            _LOGGER.debug("Wysłanie zmian listy węzłów nie powiodło się", exc_info=True)

    @callback
    def _on_node_changed(node_id: int | None) -> None:
        if node_id is None:
            state["full"] = True
        else:
            pending.add(node_id)
        if state["handle"] is None:
            state["handle"] = hass.loop.call_later(_NODE_PUSH_DELAY_SECONDS, _flush)

    @callback
    def _on_link_state(link_state: str) -> None:
        _send({"kind": "connection", "connected": link_state == "connected", "state": link_state})

    remove_node_listener = client.add_node_change_listener(_on_node_changed)
    remove_link_listener = client.add_connection_state_listener(_on_link_state)

    @callback
    def _unsubscribe() -> None:
        remove_node_listener()
        remove_link_listener()
        if state["handle"] is not None:
            state["handle"].cancel()
            state["handle"] = None

    connection.subscriptions[msg["id"]] = _unsubscribe
    connection.send_result(msg["id"])
    _snapshot()


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


def _field_meta(descriptor: Any) -> dict[str, Any]:
    """Opis pola dla formularza: typ i dozwolone wartości.

    Frontend nie zna protobufów, więc to backend mówi mu, czy dane pole
    jest przełącznikiem, liczbą, tekstem czy listą wyboru. Dzięki temu
    formularz obsługuje też pola, które firmware doda w przyszłości.
    """
    kind = "string"
    options = None

    enum_name = None

    if descriptor.type == descriptor.TYPE_BOOL:
        kind = "bool"
    elif descriptor.type == descriptor.TYPE_ENUM:
        kind = "enum"
        enum_name = descriptor.enum_type.name
        options = [value.name for value in descriptor.enum_type.values]
    elif descriptor.type in (descriptor.TYPE_FLOAT, descriptor.TYPE_DOUBLE):
        kind = "float"
    elif descriptor.type in (
        descriptor.TYPE_INT32,
        descriptor.TYPE_INT64,
        descriptor.TYPE_UINT32,
        descriptor.TYPE_UINT64,
        descriptor.TYPE_SINT32,
        descriptor.TYPE_SINT64,
        descriptor.TYPE_FIXED32,
        descriptor.TYPE_FIXED64,
    ):
        kind = "int"
    elif descriptor.type == descriptor.TYPE_BYTES:
        kind = "bytes"
    elif descriptor.type == descriptor.TYPE_MESSAGE:
        kind = "message"

    repeated = descriptor.label == descriptor.LABEL_REPEATED
    return {
        "type": kind,
        "enum": enum_name,
        "options": options,
        # Pola binarne, zagnieżdżone i powtarzalne pokazujemy, ale nie pozwalamy
        # ich edytować — formularz nie ma dla nich sensownej kontrolki.
        "editable": kind not in ("bytes", "message") and not repeated,
        "repeated": repeated,
    }


def _config_schema() -> dict[str, Any]:
    from .aiomeshtastic.protobuf import config_pb2, module_config_pb2  # noqa: PLC0415

    schema: dict[str, Any] = {"local": {}, "module": {}}
    for group, message in (("local", config_pb2.Config), ("module", module_config_pb2.ModuleConfig)):
        for section in message.DESCRIPTOR.fields:
            if section.message_type is None:
                continue
            schema[group][section.json_name] = {
                field.json_name: _field_meta(field) for field in section.message_type.fields
            }
    return schema


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/config",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Pełna konfiguracja bramki — sekcje localConfig i moduleConfig.

    Tylko odczyt. Zapis wymaga wiadomości administracyjnych i trafi tu
    w osobnym wydaniu, bo nieudany zapis konfiguracji LoRa wyrzuca węzeł
    z sieci bez drogi powrotnej.
    """
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return

    client = entry.runtime_data.client
    try:
        local_config = await client.async_get_node_local_config()
        module_config = await client.async_get_node_module_config()
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Nie udało się pobrać konfiguracji: %s", err)
        connection.send_error(msg["id"], "config_failed", str(err))
        return

    local_config = dict(local_config or {})
    module_config = dict(module_config or {})
    await _augment_config_for_panel(client, local_config, module_config)

    connection.send_result(
        msg["id"],
        {
            "local_config": local_config,
            "module_config": module_config,
            "schema": _config_schema(),
        },
    )


async def _augment_config_for_panel(client: Any, local_config: dict, module_config: dict) -> None:
    """
    Dołóż do konfiguracji to, co formularze panelu pokazują, a czego nie ma w
    samych sekcjach — bez tego pola były puste, a ich zapis ginął po cichu.

    - ekran dotykowy (DeviceUIConfig) — radio wysyła go osobno od configu,
    - stała pozycja (szerokość, długość, wysokość) — z pozycji własnego węzła,
    - port MQTT — radio trzyma go w adresie jako „host:port”,
    - gotowe wiadomości — osobna wiadomość administracyjna, pobierana raz.
    """
    interface = client.interface
    with contextlib.suppress(Exception):
        device_ui = interface.connected_node_device_ui()
        if device_ui is not None:
            local_config["deviceUi"] = MessageToDict(device_ui)

    with contextlib.suppress(Exception):
        position = dict(local_config.get("position") or {})
        fixed = interface.connected_node_fixed_position() if position.get("fixedPosition") else None
        if fixed is not None:
            position["fixedLat"] = fixed["latitude"]
            position["fixedLng"] = fixed["longitude"]
            position["fixedAltitude"] = fixed["altitude"]
            local_config["position"] = position

    with contextlib.suppress(Exception):
        mqtt = dict(module_config.get("mqtt") or {})
        address = str(mqtt.get("address") or "")
        host, sep, port = address.rpartition(":")
        if sep and host and port.isdigit():
            mqtt["address"] = host
            mqtt["port"] = int(port)
            module_config["mqtt"] = mqtt

    with contextlib.suppress(Exception):
        messages = await asyncio.wait_for(interface.get_canned_messages(), timeout=6)
        canned = dict(module_config.get("cannedMessage") or {})
        canned["messages"] = messages
        module_config["cannedMessage"] = canned


def _node_action_schema(name: str) -> dict:
    return {
        vol.Required("type"): f"{WS_PREFIX}/{name}",
        vol.Required("entry_id"): str,
        vol.Required("node_id"): int,
    }


async def _run_node_action(hass, connection, msg, action):
    """Wspólna obsługa akcji na węźle — jeden kształt błędu dla wszystkich."""
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return
    try:
        result = await action(entry.runtime_data.client, msg)
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Akcja %s nie powiodła się: %s", msg["type"], err)
        connection.send_error(msg["id"], "action_failed", str(err))
        return

    # Część akcji zwraca bool — brak potwierdzenia z radia to niepowodzenie,
    # a nie sukces. Wcześniej każdy wynik nie-słownikowy był raportowany jako
    # udany, przez co nieudane usunięcie węzła wyglądało na wykonane.
    if result is False:
        connection.send_result(msg["id"], {"confirmed": False})
        return

    connection.send_result(
        msg["id"],
        {"confirmed": True, "result": result if isinstance(result, dict) else None},
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/set_favorite",
        vol.Required("entry_id"): str,
        vol.Required("node_id"): int,
        vol.Required("favorite"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_favorite(hass, connection, msg) -> None:
    """Oznacz węzeł jako ulubiony na urządzeniu (albo zdejmij oznaczenie)."""
    await _run_node_action(
        hass, connection, msg, lambda c, m: c.set_node_favorite(m["node_id"], m["favorite"])
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/set_ignored",
        vol.Required("entry_id"): str,
        vol.Required("node_id"): int,
        vol.Required("ignored"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_ignored(hass, connection, msg) -> None:
    """Dodaj węzeł do ignorowanych na urządzeniu (albo usuń z listy)."""
    await _run_node_action(
        hass, connection, msg, lambda c, m: c.set_node_ignored(m["node_id"], m["ignored"])
    )


@websocket_api.websocket_command(_node_action_schema("remove_node"))
@websocket_api.require_admin
@websocket_api.async_response
async def ws_remove_node(hass, connection, msg) -> None:
    """Usuń węzeł z bazy urządzenia."""
    await _run_node_action(hass, connection, msg, lambda c, m: c.async_remove_node(m["node_id"]))


@websocket_api.websocket_command(_node_action_schema("request_position"))
@websocket_api.require_admin
@websocket_api.async_response
async def ws_request_position(hass, connection, msg) -> None:
    """Poproś węzeł o aktualną pozycję."""
    await _run_node_action(hass, connection, msg, lambda c, m: c.request_position(m["node_id"]))


@websocket_api.websocket_command(
    {
        **_node_action_schema("request_telemetry"),
        vol.Optional("telemetry_type", default=str(TelemetryType.DEVICE_METRICS)): vol.In(
            [str(kind) for kind in TelemetryType]
        ),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_request_telemetry(hass, connection, msg) -> None:
    """Poproś węzeł o telemetrię — domyślnie o metryki urządzenia (bateria, napięcie, eter)."""
    await _run_node_action(
        hass, connection, msg, lambda c, m: c.request_telemetry(m["node_id"], TelemetryType(m["telemetry_type"]))
    )


@websocket_api.websocket_command(_node_action_schema("request_neighbors"))
@websocket_api.require_admin
@websocket_api.async_response
async def ws_request_neighbors(hass, connection, msg) -> None:
    """Poproś węzeł o listę sąsiadów."""
    await _run_node_action(hass, connection, msg, lambda c, m: c.request_neighbor_info(m["node_id"]))


@websocket_api.websocket_command(_node_action_schema("traceroute"))
@websocket_api.require_admin
@websocket_api.async_response
async def ws_traceroute(hass, connection, msg) -> None:
    """Prześledź trasę do węzła — i zachowaj wynik, żeby przeżył restart."""

    async def _action(c, m):
        result = await c.request_traceroute(m["node_id"])
        store = get_store(m["entry_id"])
        if store is not None and isinstance(result, dict):
            store.add_traceroute(m["node_id"], result)
        return result

    await _run_node_action(hass, connection, msg, _action)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/traceroute_history",
        vol.Required("entry_id"): str,
        vol.Required("node_id"): int,
    }
)
@websocket_api.async_response
async def ws_traceroute_history(hass, connection, msg) -> None:
    """Zwróć wcześniej zapisane trasy do węzła."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    connection.send_result(msg["id"], {"routes": store.traceroutes(msg["node_id"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/set_config",
        vol.Required("entry_id"): str,
        vol.Required("group"): vol.In(["local", "module"]),
        vol.Required("section"): str,
        vol.Required("values"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Zapisz jedną sekcję konfiguracji do bramki.

    Zapis obejmuje wyłącznie wskazaną sekcję — radio scala ją z resztą
    własnej konfiguracji, więc pola pominięte w żądaniu zostają nietknięte.
    """
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return

    try:
        await entry.runtime_data.client.async_set_config(
            msg["section"], msg["values"], is_module=msg["group"] == "module"
        )
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Zapis sekcji %s nie powiódł się: %s", msg["section"], err)
        connection.send_error(msg["id"], "set_config_failed", str(err))
        return

    connection.send_result(msg["id"], {"saved": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/delete_message",
        vol.Required("entry_id"): str,
        vol.Required("ts"): int,
        vol.Optional("message_id"): vol.Any(int, None),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_message(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Usuń jedną wiadomość z historii panelu."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    connection.send_result(msg["id"], {"deleted": store.delete_message(msg.get("message_id"), msg["ts"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/delete_conversation",
        vol.Required("entry_id"): str,
        vol.Required("key"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_conversation(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Usuń całą rozmowę z historii panelu."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    connection.send_result(msg["id"], {"deleted": store.delete_conversation(msg["key"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/set_owner",
        vol.Required("entry_id"): str,
        vol.Required("long_name"): str,
        vol.Required("short_name"): str,
        vol.Optional("is_licensed", default=False): bool,
        vol.Optional("is_unmessagable"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_owner(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Zmień nazwę długą i krótką bramki."""
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return
    try:
        await entry.runtime_data.client.async_set_owner(
            msg["long_name"],
            msg["short_name"],
            is_licensed=msg["is_licensed"],
            is_unmessagable=msg.get("is_unmessagable"),
        )
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Zapis właściciela nie powiódł się: %s", err)
        connection.send_error(msg["id"], "set_owner_failed", str(err))
        return
    connection.send_result(msg["id"], {"saved": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/set_channel",
        vol.Required("entry_id"): str,
        vol.Required("channel"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_channel(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Zapisz jeden kanał bramki."""
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return
    try:
        await entry.runtime_data.client.async_set_channel(msg["channel"])
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Zapis kanału nie powiódł się: %s", err)
        connection.send_error(msg["id"], "set_channel_failed", str(err))
        return
    connection.send_result(msg["id"], {"saved": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/node_history",
        vol.Required("entry_id"): str,
        vol.Required("node_id"): int,
        vol.Required("kind"): vol.In(
            [
                "neighbor_count",
                "position",
                "device_metrics",
                "environment_metrics",
                "power_metrics",
                "local_stats",
                "local_stats_extended",
                "signal",
            ]
        ),
    }
)
@websocket_api.async_response
async def ws_node_history(hass, connection, msg) -> None:
    """Zwróć zapisaną historię jednej serii dla węzła (telemetria, pozycja, sąsiedzi)."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    connection.send_result(msg["id"], {"points": store.node_history(msg["node_id"], msg["kind"])})

@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/device_action",
        vol.Required("entry_id"): str,
        vol.Required("action"): vol.In(
            ["reboot", "shutdown", "factory_reset", "nodedb_reset", "factory_reset_device", "reboot_ota"]
        ),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_device_action(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Restart, wyłączenie, reset fabryczny albo reset bazy węzłów."""
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return
    try:
        await entry.runtime_data.client.async_device_action(msg["action"])
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Akcja urządzenia %s nie powiodła się: %s", msg["action"], err)
        connection.send_error(msg["id"], "device_action_failed", str(err))
        return
    connection.send_result(msg["id"], {"done": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/ondemand",
        vol.Required("entry_id"): str,
        vol.Required("node_id"): int,
        vol.Required("query"): vol.In(list(ondemand.QUERIES)),
        vol.Optional("timeout", default=20): vol.All(vol.Coerce(float), vol.Range(min=3, max=60)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ondemand(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Zapytanie OnDemand (port 354) do węzła — diagnostyka jak w aplikacji."""
    entry = _entry_by_id(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return
    try:
        result = await ondemand.request_on_demand(
            entry.runtime_data.client.interface,
            msg["node_id"],
            ondemand.QUERIES[msg["query"]],
            timeout=msg["timeout"],
        )
    except OnDemandError as err:
        connection.send_error(msg["id"], "ondemand_failed", err.code)
        return
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Zapytanie OnDemand %s nie powiodło się: %s", msg["query"], err)
        connection.send_error(msg["id"], "ondemand_failed", str(err))
        return
    connection.send_result(msg["id"], {**result, "query": msg["query"], "node_id": msg["node_id"]})


def _sniffer_target(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> tuple[ConfigEntry, Any, int] | None:
    """Bramka, magazyn i numer własnego węzła — sniffer działa wyłącznie lokalnie."""
    entry = _entry_by_id(hass, msg["entry_id"])
    store = get_store(msg["entry_id"])
    node_id = ((entry.runtime_data.gateway_node or {}).get("num")) if entry is not None else None
    if entry is None or store is None or node_id is None:
        connection.send_error(msg["id"], "not_found", "Bramka nie jest jeszcze gotowa")
        return None
    return entry, store, node_id


def _sniffer_status(store: Any, *, supported: bool, reason: str | None = None) -> dict[str, Any]:
    log = store.sniffer
    return {
        "supported": supported,
        "reason": reason,
        "fw_plus_version": log.fw_plus_version,
        "min_fw_plus_version": ondemand.MIN_FW_PLUS_VERSION,
        "enabled": log.enabled,
        "count": log.count,
        "capacity": log.capacity,
        "last_seq": log.last_seq,
        "mqtt_enabled": log.mqtt_enabled,
        "mqtt_connected": store.mqtt_sniffer_connected,
        "mqtt_error": store.mqtt_sniffer_error,
    }


# Brak odpowiedzi na pytanie o FW+ znaczy zwykle firmware bez OnDemand. Na takim radiu każda
# próba to kilka sekund czekania i zbędny pakiet, a panele pytają przy każdym otwarciu,
# więc taki wynik pamiętamy przez 10 minut (przycisk "Sprawdź ponownie" pomija ten czas).
FW_PROBE_RETRY_SECONDS = 600


async def _fw_plus_version(
    entry: ConfigEntry, store: Any, node_id: int, *, force: bool = False
) -> tuple[int | None, str | None]:
    """Wersja FW+ własnej bramki: (wersja, None) albo (None, przyczyna braku).

    Wersję z funkcjami MT_SW (od 2) trzymamy do końca połączenia. Starszą, jak i brak
    odpowiedzi, pamiętamy tylko przez FW_PROBE_RETRY_SECONDS: po aktualizacji
    firmware nie chcemy ciągle pokazywać starego wyniku.
    """
    log = store.sniffer
    if force:
        log.fw_plus_version = None
        log.fw_plus_error = None
    recently = time.monotonic() - log.fw_plus_checked_at < FW_PROBE_RETRY_SECONDS
    if log.fw_plus_version is not None and (log.fw_plus_version >= ondemand.MIN_FW_PLUS_VERSION or recently):
        return log.fw_plus_version, None
    if log.fw_plus_error == "timeout" and recently:
        return None, log.fw_plus_error
    try:
        version = await ondemand.query_fw_plus_version(entry.runtime_data.client.interface, node_id)
    except OnDemandError as err:
        if err.code == "timeout":
            log.fw_plus_error = err.code
            log.fw_plus_checked_at = time.monotonic()
        return None, err.code
    log.fw_plus_version = version
    log.fw_plus_error = None
    log.fw_plus_checked_at = time.monotonic()
    return version, None


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/capabilities", vol.Required("entry_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capabilities(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Czy bramka ma firmware z funkcjami MT_SW (OnDemand, sniffer) — od FW+ w wersji 2 wszystkie naraz."""
    target = _sniffer_target(hass, connection, msg)
    if target is None:
        return
    entry, store, node_id = target
    version, error = await _fw_plus_version(entry, store, node_id)
    connection.send_result(
        msg["id"],
        {
            "supported": version is not None and version >= ondemand.MIN_FW_PLUS_VERSION,
            "fw_plus_version": version,
            "min_fw_plus_version": ondemand.MIN_FW_PLUS_VERSION,
            "reason": error,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/sniffer_state",
        vol.Required("entry_id"): str,
        vol.Optional("force", default=False): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sniffer_state(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Czy firmware wspiera sniffer i czy jest włączony.

    Stan jest tylko w RAM radia (po restarcie zawsze wyłączony), więc odpytujemy
    go po każdym połączeniu, zamiast cokolwiek pamiętać.
    """
    target = _sniffer_target(hass, connection, msg)
    if target is None:
        return
    entry, store, node_id = target
    log = store.sniffer
    interface = entry.runtime_data.client.interface

    version, error = await _fw_plus_version(entry, store, node_id, force=msg.get("force", False))
    if error is not None:
        connection.send_result(msg["id"], _sniffer_status(store, supported=False, reason=error))
        return
    if version < ondemand.MIN_FW_PLUS_VERSION:
        connection.send_result(msg["id"], _sniffer_status(store, supported=False, reason="old_firmware"))
        return

    try:
        log.enabled = await ondemand.query_sniffer_state(interface, node_id)
    except OnDemandError as err:
        connection.send_result(msg["id"], _sniffer_status(store, supported=True, reason=err.code))
        return
    connection.send_result(msg["id"], _sniffer_status(store, supported=True))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/sniffer_set",
        vol.Required("entry_id"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sniffer_set(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Włącz albo wyłącz sniffer na własnej bramce."""
    target = _sniffer_target(hass, connection, msg)
    if target is None:
        return
    entry, store, node_id = target
    log = store.sniffer
    version, _error = await _fw_plus_version(entry, store, node_id)
    if version is None or version < ondemand.MIN_FW_PLUS_VERSION:
        connection.send_error(msg["id"], "sniffer_unsupported", "unsupported")
        return
    try:
        log.enabled = await ondemand.set_sniffer(entry.runtime_data.client.interface, node_id, msg["enabled"])
    except OnDemandError as err:
        connection.send_error(msg["id"], "sniffer_failed", err.code)
        return
    connection.send_result(msg["id"], _sniffer_status(store, supported=True))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/sniffer_mqtt_set",
        vol.Required("entry_id"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sniffer_mqtt_set(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    entry = _entry_by_id(hass, msg["entry_id"])
    store = get_store(msg["entry_id"])
    if entry is None or store is None:
        connection.send_error(msg["id"], "not_found", "Bramka nie jest jeszcze gotowa")
        return
    await store.async_set_mqtt_sniffer(msg["enabled"])
    connection.send_result(msg["id"], _sniffer_status(store, supported=True))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/sniffer_log",
        vol.Required("entry_id"): str,
        vol.Optional("since", default=0): int,
        vol.Optional("limit", default=5000): vol.All(int, vol.Range(min=1, max=5000)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sniffer_log(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Wpisy logu sniffera nowsze niż `since` (numer kolejny ostatnio odebranego)."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    connection.send_result(
        msg["id"],
        {
            "entries": store.sniffer.entries_since(msg["since"], msg["limit"]),
            "last_seq": store.sniffer.last_seq,
            "enabled": store.sniffer.enabled,
            "mqtt_enabled": store.sniffer.mqtt_enabled,
            "count": store.sniffer.count,
            "capacity": store.sniffer.capacity,
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/sniffer_clear", vol.Required("entry_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sniffer_clear(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Wyczyść log sniffera."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    store.sniffer.clear()
    connection.send_result(msg["id"], {"cleared": True})


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/storage_stats", vol.Required("entry_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_storage_stats(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Ile danych panel trzyma na dysku (Ustawienia → Pamięć)."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    connection.send_result(msg["id"], store.stats())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/storage_clear",
        vol.Required("entry_id"): str,
        vol.Required("kind"): vol.In(["messages", "nodes", "all"]),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_storage_clear(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Usuń dane zapisane przez panel; nie dotyka radia ani encji Home Assistanta."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    if msg["kind"] == "messages":
        store.clear_messages()
    elif msg["kind"] == "nodes":
        store.clear_node_data()
    else:
        store.clear_all()
    connection.send_result(msg["id"], {"cleared": msg["kind"]})


# ── czyszczenie bazy węzłów radia (Ustawienia → Pamięć) ──────────────

_NODEDB_FILTER = {
    vol.Required("entry_id"): str,
    vol.Optional("inactive_days", default=0): vol.All(int, vol.Range(min=0, max=365)),
    vol.Optional("kind", default="all"): vol.In(list(nodedb_cleanup.KINDS)),
}


async def _nodedb_candidates(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> tuple[Any, list[dict[str, Any]]] | None:
    """Węzły do usunięcia dla wybranych warunków; przy błędzie odpowiada i zwraca None.

    Lista zawsze powstaje po stronie serwera z aktualnej bazy radia — panel podaje tylko
    warunki, więc nie da się usunąć czegokolwiek spoza tego, co pokazał podgląd.
    """
    entry = _entry_by_id(hass, msg["entry_id"])
    store = get_store(msg["entry_id"])
    if entry is None or store is None:
        connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")
        return None
    try:
        nodes = await entry.runtime_data.client.async_get_all_nodes()
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        connection.send_error(msg["id"], "nodes_failed", str(err))
        return None
    try:
        candidates = nodedb_cleanup.select_candidates(
            nodes,
            own_node=(entry.runtime_data.gateway_node or {}).get("num"),
            protected=set(entry.runtime_data.coordinator.data or {}),
            inactive_days=msg.get("inactive_days", 0),
            kind=msg.get("kind", "all"),
        )
    except NoCriteriaError:
        connection.send_error(msg["id"], "no_criteria", "Wybierz czas nieaktywności albo rodzaj węzłów")
        return None
    return store, candidates


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/nodedb_preview", **_NODEDB_FILTER})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_nodedb_preview(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Ile i które węzły zostałyby usunięte — bez usuwania czegokolwiek."""
    found = await _nodedb_candidates(hass, connection, msg)
    if found is None:
        return
    _store, candidates = found
    limit = nodedb_cleanup.PREVIEW_LIMIT
    connection.send_result(
        msg["id"],
        {"count": len(candidates), "nodes": candidates[:limit], "more": max(0, len(candidates) - limit)},
    )


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/nodedb_clean", **_NODEDB_FILTER})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_nodedb_clean(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Usuń wybrane węzły z bazy radia. Usuwanie trwa w tle, postęp podaje nodedb_status."""
    found = await _nodedb_candidates(hass, connection, msg)
    if found is None:
        return
    store, candidates = found
    if store.cleanup.running:
        connection.send_error(msg["id"], "busy", "Czyszczenie już trwa")
        return
    if not candidates:
        connection.send_result(msg["id"], {"started": False, "total": 0})
        return
    store.start_cleanup([item["node_id"] for item in candidates], "manual")
    connection.send_result(msg["id"], {"started": True, "total": len(candidates)})


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/nodedb_status", vol.Required("entry_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_nodedb_status(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Postęp bieżącego (albo ostatniego) usuwania i ustawienia automatycznego czyszczenia."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    connection.send_result(msg["id"], {"job": store.cleanup.status(), "auto": dict(store.auto_clean)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/nodedb_auto_set",
        vol.Required("entry_id"): str,
        vol.Required("enabled"): bool,
        vol.Required("inactivity_days"): vol.All(int, vol.Range(min=1, max=365)),
        vol.Required("interval_days"): vol.All(int, vol.Range(min=1, max=90)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_nodedb_auto_set(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Włącz/wyłącz automatyczne czyszczenie bazy węzłów i ustaw jego progi."""
    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
        return
    settings = store.set_auto_clean(
        enabled=msg["enabled"], inactivity_days=msg["inactivity_days"], interval_days=msg["interval_days"]
    )
    connection.send_result(msg["id"], {"auto": settings})


# ── Ustawienia mapy (źródło kafli i klucze API) ──────────────────────
# Trzymane po stronie serwera, a nie w localStorage przeglądarki: klucz
# wpisany raz ma być widoczny w każdej przeglądarce i w aplikacji mobilnej HA.
# Jeden zestaw na całą integrację, nie na wpis — mapa nie zależy od bramki.

MAP_SETTINGS_VERSION = 1


def _map_settings_store(hass: HomeAssistant) -> Store:
    key = f"{DOMAIN}_map_settings_store"
    store = hass.data.get(key)
    if store is None:
        store = Store(hass, MAP_SETTINGS_VERSION, f"{DOMAIN}.map_settings")
        hass.data[key] = store
    return store


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/map_settings"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_map_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Zapisane źródło kafli mapy i klucze API dostawców (puste, gdy nic nie zapisano)."""
    data = await _map_settings_store(hass).async_load()
    connection.send_result(msg["id"], {"settings": data or {}})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/map_settings_set",
        vol.Required("settings"): vol.Schema(
            {
                vol.Optional("preset"): vol.All(str, vol.Length(max=64)),
                vol.Optional("custom_url"): vol.All(str, vol.Length(max=1000)),
                vol.Optional("keys"): {vol.All(str, vol.Length(max=64)): vol.All(str, vol.Length(max=500))},
            }
        ),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_map_settings_set(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Zapisz źródło kafli mapy i klucze API dostawców."""
    settings = dict(msg["settings"])
    # puste klucze nie mają sensu w pliku — kasujemy je, zamiast trzymać ""
    settings["keys"] = {name: value for name, value in settings.get("keys", {}).items() if value}
    await _map_settings_store(hass).async_save(settings)
    connection.send_result(msg["id"], {"saved": True})


# ── Ustawienia interfejsu panelu (wspólne dla wszystkich przeglądarek) ──
# Na razie jedno: czy czat sam ładuje podglądy obrazków z linków. Jak klucze map, ma być
# raz dla całego Home Assistanta, a nie osobno w każdej przeglądarce i w aplikacji mobilnej.

UI_SETTINGS_VERSION = 1
# Domyślnie włączone: panel działa na urządzeniu na stałe podłączonym do sieci, nie na telefonie
# z pakietem danych. Wyłączone, obrazek ładuje się dopiero po kliknięciu (przycisk przy polu pisania).
UI_SETTINGS_DEFAULTS: dict[str, Any] = {"auto_load_images": True}


def _ui_settings_store(hass: HomeAssistant) -> Store:
    key = f"{DOMAIN}_ui_settings_store"
    store = hass.data.get(key)
    if store is None:
        store = Store(hass, UI_SETTINGS_VERSION, f"{DOMAIN}.ui_settings")
        hass.data[key] = store
    return store


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/ui_settings"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ui_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Ustawienia interfejsu panelu; brakujące wartości mają domyślne."""
    saved = await _ui_settings_store(hass).async_load()
    connection.send_result(msg["id"], {"settings": {**UI_SETTINGS_DEFAULTS, **(saved or {})}})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/ui_settings_set",
        vol.Required("settings"): vol.Schema({vol.Optional("auto_load_images"): bool}),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ui_settings_set(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Zmień ustawienia interfejsu panelu — tylko przesłane pola, reszta zostaje."""
    store = _ui_settings_store(hass)
    merged = {**UI_SETTINGS_DEFAULTS, **((await store.async_load()) or {}), **msg["settings"]}
    await store.async_save(merged)
    connection.send_result(msg["id"], {"settings": merged})


def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Zarejestruj komendy panelu. Wołane raz, z async_setup."""
    for handler in (
        ws_gateways,
        ws_channels,
        ws_nodes,
        ws_subscribe_nodes,
        ws_messages,
        ws_timeseries,
        ws_send_message,
        ws_clear_messages,
        ws_subscribe_messages,
        ws_config,
        ws_set_favorite,
        ws_set_ignored,
        ws_remove_node,
        ws_request_position,
        ws_request_neighbors,
        ws_request_telemetry,
        ws_traceroute,
        ws_traceroute_history,
        ws_node_history,
        ws_ondemand,
        ws_capabilities,
        ws_sniffer_state,
        ws_sniffer_set,
        ws_sniffer_mqtt_set,
        ws_sniffer_log,
        ws_sniffer_clear,
        ws_storage_stats,
        ws_storage_clear,
        ws_nodedb_preview,
        ws_nodedb_clean,
        ws_nodedb_status,
        ws_nodedb_auto_set,
        ws_map_settings,
        ws_map_settings_set,
        ws_ui_settings,
        ws_ui_settings_set,
        ws_set_config,
        ws_delete_message,
        ws_delete_conversation,
        ws_set_owner,
        ws_set_channel,
        ws_device_action,
    ):
        websocket_api.async_register_command(hass, handler)
