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
    # LocalStats niesie liczniki pakietów i węzłów, LocalStatsExtended (firmware
    # MT_SW) wyłącznie pamięć i CPU — to rozłączne zbiory pól, więc scalamy je,
    # zamiast wybierać jeden. Na firmware waniliowym drugi człon jest pusty.
    local_stats = {
        **(node_data.get("localStats") or {}),
        **(node_data.get("localStatsExtended") or {}),
    }

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
                "psk": settings.get("psk") or "",
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

    gateway_node = entry.runtime_data.gateway_node or {}
    gateway_id = gateway_node.get("num")

    # Panel celowo czyta pełną bazę węzłów z urządzenia, a nie coordinator.data.
    # Koordynator jest przefiltrowany opcją "nodes" wpisu konfiguracyjnego,
    # która decyduje wyłącznie o tym, dla których węzłów powstają encje HA.
    # Panel ma pokazywać to samo, co widzi radio — jak klient WWW.
    try:
        all_nodes = await entry.runtime_data.client.async_get_all_nodes()
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Nie udało się pobrać bazy węzłów: %s", err)
        connection.send_error(msg["id"], "nodes_failed", str(err))
        return

    tracked = set(entry.runtime_data.coordinator.data or {})

    nodes = []
    for node_id, node in all_nodes.items():
        user = node.get("user", {}) or {}
        position = node.get("position", {}) or {}
        device_metrics = node.get("deviceMetrics", {}) or {}
        environment_metrics = node.get("environmentMetrics", {}) or {}
        neighbor_info = node.get("neighborInfo", {}) or {}

        neighbors = [
            {
                "node_id": neighbor.get("nodeId"),
                "snr": _as_float(neighbor.get("snr")),
            }
            for neighbor in (neighbor_info.get("neighbors") or [])
            if neighbor.get("nodeId") is not None
        ]

        nodes.append(
            {
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
                "signed": bool(node.get("signed")),
                "hops_away": _as_int(node.get("hopsAway")),
                "via_mqtt": bool(node.get("viaMqtt")),
                "latitude": position.get("latitude"),
                "longitude": position.get("longitude"),
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

    connection.send_result(
        msg["id"],
        {
            "local_config": local_config or {},
            "module_config": module_config or {},
            "schema": _config_schema(),
        },
    )


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
    """Prześledź trasę do węzła."""
    await _run_node_action(hass, connection, msg, lambda c, m: c.request_traceroute(m["node_id"]))


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
            msg["long_name"], msg["short_name"], is_licensed=msg["is_licensed"]
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
        vol.Required("type"): f"{WS_PREFIX}/device_action",
        vol.Required("entry_id"): str,
        vol.Required("action"): vol.In(["reboot", "shutdown", "factory_reset", "nodedb_reset"]),
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
        ws_config,
        ws_set_favorite,
        ws_set_ignored,
        ws_remove_node,
        ws_request_position,
        ws_request_neighbors,
        ws_traceroute,
        ws_set_config,
        ws_delete_message,
        ws_delete_conversation,
        ws_set_owner,
        ws_set_channel,
        ws_device_action,
    ):
        websocket_api.async_register_command(hass, handler)
