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

from . import ondemand
from .const import DOMAIN
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
    try:
        gateway_signs = bool((entry.runtime_data.client.metadata or {}).get("hasXeddsa"))
    except Exception:  # noqa: BLE001 - metadata jest best-effort, nie może zerwać listy węzłów
        gateway_signs = False

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
    store = get_store(msg["entry_id"])

    nodes = []
    for node_id, node in all_nodes.items():
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
                "signed": bool(signed),
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
        "min_fw_plus_version": ondemand.SNIFFER_MIN_FW_PLUS_VERSION,
        "enabled": log.enabled,
        "count": log.count,
        "capacity": log.capacity,
        "last_seq": log.last_seq,
    }


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/sniffer_state", vol.Required("entry_id"): str})
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

    try:
        if log.fw_plus_version is None:
            log.fw_plus_version = await ondemand.query_fw_plus_version(interface, node_id)
    except OnDemandError as err:
        connection.send_result(msg["id"], _sniffer_status(store, supported=False, reason=err.code))
        return
    if log.fw_plus_version < ondemand.SNIFFER_MIN_FW_PLUS_VERSION:
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
    if log.fw_plus_version is None or log.fw_plus_version < ondemand.SNIFFER_MIN_FW_PLUS_VERSION:
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
        ws_traceroute_history,
        ws_node_history,
        ws_ondemand,
        ws_sniffer_state,
        ws_sniffer_set,
        ws_sniffer_log,
        ws_sniffer_clear,
        ws_storage_stats,
        ws_storage_clear,
        ws_set_config,
        ws_delete_message,
        ws_delete_conversation,
        ws_set_owner,
        ws_set_channel,
        ws_device_action,
    ):
        websocket_api.async_register_command(hass, handler)
