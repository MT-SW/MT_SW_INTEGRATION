# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Trwały magazyn panelu — historia wiadomości i szeregi czasowe bramki.

Encje Home Assistanta żyją tak długo, jak wpis konfiguracyjny, a rejestr
zdarzeń nie nadaje się do przewijania czatu. Panel potrzebuje więc własnego
magazynu, który przeżywa restart HA.

Jeden magazyn na wpis konfiguracyjny. Dane trzymamy z górnym limitem, żeby
plik nie puchł w nieskończoność — przy przekroczeniu limitu wypadają
najstarsze rekordy.
"""

from __future__ import annotations

import time
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store

from .api import (
    ATTR_EVENT_MESHTASTIC_API_CONFIG_ENTRY_ID,
    ATTR_EVENT_MESHTASTIC_API_DATA,
    ATTR_EVENT_MESHTASTIC_API_NODE,
    ATTR_EVENT_MESHTASTIC_API_NODE_INFO,
    ATTR_EVENT_MESHTASTIC_API_TELEMETRY_TYPE,
    EVENT_MESHTASTIC_API_NEIGHBOR_INFO,
    EVENT_MESHTASTIC_API_PACKET,
    EVENT_MESHTASTIC_API_POSITION,
    EVENT_MESHTASTIC_API_TELEMETRY,
    EVENT_MESHTASTIC_API_TEXT_MESSAGE,
    EVENT_MESHTASTIC_API_TEXT_MESSAGE_OUT,
    EventMeshtasticApiTelemetryType,
)
from .const import DOMAIN, EVENT_MESHTASTIC_MESSAGE_ACK, LOGGER
from .sniffer import SnifferLog

if TYPE_CHECKING:
    from collections.abc import Callable

    from homeassistant.core import Event, HomeAssistant

    from .data import MeshtasticConfigEntry

STORAGE_VERSION = 1
SAVE_DELAY = 10

MAX_MESSAGES = 2000
MAX_TIMESERIES_POINTS = 1500
MAX_TRACEROUTES_PER_NODE = 10
MAX_NODE_HISTORY_POINTS = 300
# Jakość sygnału zbieramy z każdego pakietu od węzła, więc serii jest więcej niż
# w telemetrii; na dysk trafia jednak nie częściej niż co 5 minut, żeby ciągły
# ruch w eterze nie przepisywał pliku co kilka sekund.
MAX_SIGNAL_HISTORY_POINTS = 1000
SIGNAL_SAVE_INTERVAL_MS = 5 * 60 * 1000
# Próbkujemy z koordynatora, nie ze zdarzeń telemetrii — dzięki temu wykresy
# rosną także wtedy, gdy nikt nie ma otwartego panelu.
TIMESERIES_SAMPLE_SECONDS = 60

# Pola zapisywane w historii statystyk węzła (pakiety i zasoby). MessageToDict
# pomija wartości zerowe, więc brakujące pole w pakiecie oznacza 0 — zapisujemy
# je jawnie, żeby każdy wiersz historii miał komplet pól.
LOCAL_STATS_HISTORY_FIELDS = (
    "numPacketsRx",
    "numPacketsRxBad",
    "numRxDupe",
    "numPacketsTx",
    "numTxRelay",
    "numTxRelayCanceled",
    "numTxDropped",
    "heapTotalBytes",
    "heapFreeBytes",
    "noiseFloor",
)
LOCAL_STATS_EXTENDED_HISTORY_FIELDS = (
    "memoryTotal",
    "memoryFreeCheap",
    "cpuUsagePercent",
    "flashUsedBytes",
    "flashTotalBytes",
    "memoryPsramTotal",
    "memoryPsramFree",
)
_STATS_HISTORY_FIELDS = {
    EventMeshtasticApiTelemetryType.LOCAL_STATS: LOCAL_STATS_HISTORY_FIELDS,
    EventMeshtasticApiTelemetryType.LOCAL_STATS_EXTENDED: LOCAL_STATS_EXTENDED_HISTORY_FIELDS,
}

# Ostatnie wartości telemetrii zapisujemy na dysk, żeby karta Radio po restarcie
# nie świeciła pustkami, zanim radio nadeśle świeży pakiet ze statystykami.
_LAST_TELEMETRY_KEYS = {
    EventMeshtasticApiTelemetryType.DEVICE_METRICS: "deviceMetrics",
    EventMeshtasticApiTelemetryType.LOCAL_STATS: "localStats",
    EventMeshtasticApiTelemetryType.LOCAL_STATS_EXTENDED: "localStatsExtended",
}

# SENT < ACK: późne niejawne potwierdzenie nie zdejmuje potwierdzenia adresata
_ACK_RANK = {"SENT": 1, "ACK": 2, "NAK": 2}
MAX_RELAYS_PER_MESSAGE = 20

_STORES: dict[str, PanelStore] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _apply_ack(message: dict[str, Any], data: Any, now: int) -> None:
    """Dopisz do wysłanej wiadomości dane z jednego potwierdzenia routingu.

    SENT to niejawny ACK własnej bramy: radio usłyszało, że ktoś powtórzył
    naszą wiadomość — każdy taki przekaźnik zapisujemy osobno. ACK przychodzi od
    adresata i niesie drogę, którą wrócił (skoki albo SNR/RSSI). Status nigdy
    się nie cofa.
    """
    ack_type = data.get("ack_type")
    if ack_type not in _ACK_RANK:
        return

    info = {key: data[key] for key in ("relay_node", "rx_snr", "rx_rssi", "hops_away") if key in data}
    info["ts"] = now

    if ack_type == "SENT":
        relays = message.setdefault("relays", [])
        relay = info.get("relay_node") or 0
        existing = next((r for r in relays if relay and r.get("relay_node") == relay), None)
        if existing is not None:
            existing.update(info)
        elif len(relays) < MAX_RELAYS_PER_MESSAGE and (relay or not any(not r.get("relay_node") for r in relays)):
            relays.append(info)
    elif ack_type == "ACK":
        message["ack_info"] = {**info, "from": data.get("from_node")}

    if _ACK_RANK[ack_type] >= _ACK_RANK.get(message.get("ack"), 0):
        message["ack"] = ack_type
        if data.get("error"):
            message["ack_error"] = data["error"]


class PanelStore:
    """Historia wiadomości i telemetrii dla jednego wpisu konfiguracyjnego."""

    def __init__(self, hass: HomeAssistant, entry: MeshtasticConfigEntry) -> None:
        self._hass = hass
        self._entry = entry
        entry_id = entry.entry_id
        self._entry_id = entry_id
        self._store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.panel.{entry_id}")
        self._messages: list[dict[str, Any]] = []
        self._timeseries: list[dict[str, Any]] = []
        # Stan węzłów, który inaczej żyje tylko w pamięci koordynatora i
        # znika po restarcie: ostatnia znana informacja o sąsiadach i to,
        # czy ostatnia wiadomość od węzła była podpisana.
        self._node_state: dict[str, dict[str, Any]] = {}
        self._traceroutes: dict[str, list[dict[str, Any]]] = {}
        # Historia w czasie per węzeł: neighbor_count, position,
        # device_metrics, environment_metrics, power_metrics.
        self._node_history: dict[str, dict[str, list[dict[str, Any]]]] = {}
        # Log sniffera żyje tylko w pamięci (patrz sniffer.py).
        self.sniffer = SnifferLog()
        # tylko w pamięci: ostatni pakiet zapisany w historii sygnału (na węzeł) i czas zapisu na dysk
        self._signal_last_id: dict[int, int] = {}
        self._signal_saved_at = 0
        self._listeners: list[Callable[[str, dict[str, Any]], None]] = []
        self._unsubscribes: list[Callable[[], None]] = []

    # ── cykl życia ──────────────────────────────────────────────────────

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self._messages = data.get("messages", [])
        self._timeseries = data.get("timeseries", [])
        self._node_state = data.get("node_state", {})
        self._traceroutes = data.get("traceroutes", {})
        self._node_history = data.get("node_history", {})
        LOGGER.debug(
            "Panel store %s: wczytano %d wiadomości, %d próbek, %d węzłów ze stanem",
            self._entry_id,
            len(self._messages),
            len(self._timeseries),
            len(self._node_state),
        )

    def async_start(self) -> None:
        """Podłącz nasłuch zdarzeń integracji."""
        bus = self._hass.bus
        self._unsubscribes = [
            bus.async_listen(EVENT_MESHTASTIC_API_TEXT_MESSAGE, self._handle_message_in),
            bus.async_listen(EVENT_MESHTASTIC_API_TEXT_MESSAGE_OUT, self._handle_message_out),
            bus.async_listen(EVENT_MESHTASTIC_MESSAGE_ACK, self._handle_ack),
            bus.async_listen(EVENT_MESHTASTIC_API_NEIGHBOR_INFO, self._handle_neighbor_info),
            bus.async_listen(EVENT_MESHTASTIC_API_TELEMETRY, self._handle_telemetry),
            bus.async_listen(EVENT_MESHTASTIC_API_POSITION, self._handle_position),
            bus.async_listen(EVENT_MESHTASTIC_API_PACKET, self._handle_packet),
            async_track_time_interval(
                self._hass, self._sample_gateway, timedelta(seconds=TIMESERIES_SAMPLE_SECONDS)
            ),
        ]

    async def async_stop(self) -> None:
        for unsub in self._unsubscribes:
            unsub()
        self._unsubscribes = []
        self._listeners = []
        # wymuś zapis oczekujących zmian, zanim wpis zniknie
        await self._store.async_save(self._as_dict())

    def _as_dict(self) -> dict[str, Any]:
        return {
            "messages": self._messages,
            "timeseries": self._timeseries,
            "node_state": self._node_state,
            "traceroutes": self._traceroutes,
            "node_history": self._node_history,
        }

    def _schedule_save(self) -> None:
        self._store.async_delay_save(self._as_dict, SAVE_DELAY)

    # ── subskrypcje panelu ──────────────────────────────────────────────

    def add_listener(self, listener: Callable[[str, dict[str, Any]], None]) -> Callable[[], None]:
        """Zarejestruj odbiorcę zmian (używane przez subskrypcje WebSocket)."""
        self._listeners.append(listener)

        def _remove() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return _remove

    def _notify(self, kind: str, payload: dict[str, Any]) -> None:
        for listener in list(self._listeners):
            try:
                listener(kind, payload)
            except Exception:  # noqa: BLE001 - jeden zepsuty odbiorca nie może ubić reszty
                LOGGER.debug("Odbiorca panelu rzucił wyjątek", exc_info=True)

    # ── odczyt ──────────────────────────────────────────────────────────

    def messages(self, limit: int | None = None) -> list[dict[str, Any]]:
        if limit is None or limit >= len(self._messages):
            return list(self._messages)
        return self._messages[-limit:]

    def timeseries(self) -> list[dict[str, Any]]:
        return list(self._timeseries)

    def _conversation_of(self, message: dict[str, Any]) -> str | None:
        """Klucz rozmowy w tej samej postaci, której używa panel."""
        channel = message.get("to_channel")
        if channel is not None:
            return f"ch:{channel}"
        peer = message.get("to_node") if message.get("direction") == "out" else message.get("from")
        return None if peer is None else f"dm:{peer}"

    def delete_message(self, message_id: Any, ts: Any) -> bool:
        """Usuń pojedynczą wiadomość.

        Dopasowujemy po parze (id, ts), bo samo id bywa puste dla wiadomości
        przychodzących, a znacznik czasu jest nadawany lokalnie przy zapisie.
        """
        before = len(self._messages)
        self._messages = [
            m for m in self._messages if not (m.get("id") == message_id and m.get("ts") == ts)
        ]
        if len(self._messages) == before:
            return False
        self._schedule_save()
        self._notify("deleted", {"id": message_id, "ts": ts})
        return True

    def delete_conversation(self, key: str) -> int:
        """Usuń całą rozmowę — kanał albo wymianę prywatną z jednym węzłem."""
        before = len(self._messages)
        self._messages = [m for m in self._messages if self._conversation_of(m) != key]
        removed = before - len(self._messages)
        if removed:
            self._schedule_save()
            self._notify("conversation_deleted", {"key": key})
        return removed

    def clear_messages(self) -> None:
        self._messages = []
        self._schedule_save()
        self._notify("cleared", {})

    # ── magazyn: statystyki i czyszczenie (zakładka Ustawienia → Pamięć) ─

    def stats(self) -> dict[str, int]:
        conversations = {key for key in (self._conversation_of(m) for m in self._messages) if key is not None}
        return {
            "messages": len(self._messages),
            "conversations": len(conversations),
            "traceroutes": sum(len(routes) for routes in self._traceroutes.values()),
            "history_points": sum(len(series) for kinds in self._node_history.values() for series in kinds.values()),
        }

    def clear_node_data(self) -> None:
        """Usuń zapisane trasy, historię węzłów, sąsiadów i zapamiętane statystyki."""
        self._traceroutes = {}
        self._node_history = {}
        self._node_state = {}
        self._schedule_save()

    def clear_all(self) -> None:
        self.clear_messages()
        self.clear_node_data()
        self._timeseries = []
        self._schedule_save()

    # ── zapis wiadomości ────────────────────────────────────────────────

    def _belongs_to_entry(self, event: Event) -> bool:
        return event.data.get(ATTR_EVENT_MESHTASTIC_API_CONFIG_ENTRY_ID) == self._entry_id

    def _append_message(self, message: dict[str, Any]) -> None:
        self._messages.append(message)
        if len(self._messages) > MAX_MESSAGES:
            del self._messages[: len(self._messages) - MAX_MESSAGES]
        self._schedule_save()
        self._notify("message", message)

    def _build_message(self, event: Event, direction: str) -> dict[str, Any] | None:
        data = event.data.get(ATTR_EVENT_MESHTASTIC_API_DATA) or {}
        text = data.get("message")
        if not text:
            return None

        to = data.get("to") or {}
        node_info = event.data.get(ATTR_EVENT_MESHTASTIC_API_NODE_INFO) or {}

        message = {
            "id": event.data.get("message_id"),
            "ts": _now_ms(),
            "direction": direction,
            "from": data.get("from"),
            "from_name": node_info.get("name"),
            "to_node": to.get("node"),
            "to_channel": to.get("channel"),
            "text": text,
            "reply_id": data.get("reply_id") or 0,
            "emoji": data.get("emoji") or 0,
            "ack": None,
        }
        for key in ("rx_snr", "rx_rssi", "hops_away", "xeddsa_signed", "relay_node"):
            if key in event.data:
                message[key] = event.data[key]
        return message

    def _handle_message_in(self, event: Event) -> None:
        if not self._belongs_to_entry(event):
            return
        message = self._build_message(event, "in")
        if message is not None:
            self._append_message(message)
            if "xeddsa_signed" in message:
                self._remember_signed(message.get("from"), message["xeddsa_signed"])

    def _handle_message_out(self, event: Event) -> None:
        if not self._belongs_to_entry(event):
            return
        message = self._build_message(event, "out")
        if message is not None:
            self._append_message(message)

    def _handle_ack(self, event: Event) -> None:
        """Dopnij potwierdzenie do wysłanej wcześniej wiadomości.

        Zdarzenie ACK nie niesie config_entry_id, więc dopasowujemy po
        request_id — jeśli nie znajdziemy swojej wiadomości, to znaczy że
        potwierdzenie dotyczy innego wpisu i po prostu je pomijamy.
        """
        request_id = event.data.get("request_id")
        if not request_id:
            return

        for message in reversed(self._messages):
            if message.get("id") == request_id and message.get("direction") == "out":
                _apply_ack(message, event.data, _now_ms())
                self._schedule_save()
                self._notify("ack", message)
                return

    # ── stan węzłów (sąsiedzi, podpisywanie, trasy) ──────────────────────

    def node_state(self, node_id: int) -> dict[str, Any]:
        return dict(self._node_state.get(str(node_id), {}))

    def _handle_neighbor_info(self, event: Event) -> None:
        node_id = event.data.get(ATTR_EVENT_MESHTASTIC_API_NODE)
        data = event.data.get(ATTR_EVENT_MESHTASTIC_API_DATA)
        if node_id is None or data is None:
            return
        state = self._node_state.setdefault(str(node_id), {})
        state["neighbor_info"] = data
        self._schedule_save()
        self._record_node_point(node_id, "neighbor_count", {"count": len(data.get("neighbors") or [])})

    def _handle_telemetry(self, event: Event) -> None:
        node_id = event.data.get(ATTR_EVENT_MESHTASTIC_API_NODE)
        data = event.data.get(ATTR_EVENT_MESHTASTIC_API_DATA)
        telemetry_type = event.data.get(ATTR_EVENT_MESHTASTIC_API_TELEMETRY_TYPE)
        if node_id is None or not data:
            return
        last_key = _LAST_TELEMETRY_KEYS.get(telemetry_type)
        if last_key is not None:
            state = self._node_state.setdefault(str(node_id), {})
            state.setdefault("telemetry", {})[last_key] = {"ts": _now_ms(), "data": dict(data)}
            self._schedule_save()
        stats_fields = _STATS_HISTORY_FIELDS.get(telemetry_type)
        if stats_fields is not None:
            point = {field: _as_int(data.get(field)) for field in stats_fields}
            # 0 to u firmware "brak odczytu" — poziomu szumu 0 dBm nie ma, więc go pomijamy
            if "noiseFloor" in point and not point["noiseFloor"]:
                point["noiseFloor"] = None
            self._record_node_point(node_id, telemetry_type.value, point)
            return
        if telemetry_type not in (
            EventMeshtasticApiTelemetryType.DEVICE_METRICS,
            EventMeshtasticApiTelemetryType.ENVIRONMENT_METRICS,
            EventMeshtasticApiTelemetryType.POWER_METRICS,
        ):
            return
        self._record_node_point(node_id, telemetry_type.value, dict(data))

    def _handle_packet(self, event: Event) -> None:
        """Każdy pakiet: zapamiętaj, którędy dotarł; a gdy sniffer włączony — dołóż do jego logu."""
        if not self._belongs_to_entry(event):
            return
        packet = event.data.get(ATTR_EVENT_MESHTASTIC_API_DATA)
        if not isinstance(packet, dict):
            return
        gateway_node = getattr(getattr(self._entry, "runtime_data", None), "gateway_node", None) or {}
        local_node = gateway_node.get("num")
        self._remember_via(packet, local_node)
        if self.sniffer.enabled:
            self.sniffer.add_packet(packet, _now_ms(), local_node)

    def _remember_via(self, packet: dict[str, Any], local_node: int | None) -> None:
        """Z każdego pakietu od węzła: droga (przekaźnik, skoki) i sygnał (SNR, RSSI).

        Firmware podaje przekaźnik jako sam ostatni bajt numeru węzła
        (relay_node), więc nazwę dobiera dopiero panel. Pakiety z MQTT i własne
        pomijamy — nie przeszły przez radio, więc nie mówią nic o drodze w eterze.
        """
        sender = packet.get("from")
        if not isinstance(sender, int) or sender == local_node or packet.get("viaMqtt"):
            return
        hop_start = packet.get("hopStart")
        hop_limit = packet.get("hopLimit")
        hops = (
            hop_start - hop_limit
            if isinstance(hop_start, int) and isinstance(hop_limit, int) and 0 < hop_start and hop_limit <= hop_start
            else None
        )
        snr = packet.get("rxSnr")
        rssi = packet.get("rxRssi")
        # 0 oznacza u firmware "brak odczytu" (proto3 nie odróżnia zera od braku)
        snr_value = float(snr) if isinstance(snr, int | float) and snr != 0 else None
        rssi_value = int(rssi) if isinstance(rssi, int | float) and rssi != 0 else None
        now = _now_ms()

        relay = packet.get("relayNode")
        if relay:
            state = self._node_state.setdefault(str(sender), {})
            previous = state.get("via") or {}
            route_changed = previous.get("relay") != relay or previous.get("hops") != hops
            state["via"] = {"relay": relay, "hops": hops, "ts": now, "snr": snr_value, "rssi": rssi_value}
            # Sygnał zmienia się z każdym pakietem, więc na dysk idzie tylko zmiana drogi
            # albo zapis nie częściej niż raz na minutę.
            if route_changed or now - previous.get("ts", 0) >= 60_000:  # noqa: PLR2004
                self._schedule_save()

        self._record_signal(sender, packet.get("id"), hops, snr_value, rssi_value, now)

    def _record_signal(  # noqa: PLR0913
        self, sender: int, packet_id: Any, hops: int | None, snr: float | None, rssi: int | None, now: int
    ) -> None:
        """Dopisz punkt do historii jakości sygnału węzła — po jednym na pakiet.

        Odczyty z pakietu bezpośredniego opisują łącze z samym węzłem (pola snr/rssi),
        a z pakietu po skokach — tylko ostatni odcinek do przekaźnika (snrVia/rssiVia),
        więc trafiają do osobnych linii wykresu. Bez informacji o skokach nie da się
        ich rozróżnić, więc takiego pakietu nie zapisujemy.
        """
        if hops is None or (snr is None and rssi is None):
            return
        # Ten sam pakiet może przyjść dwa razy (kopia ze sniffera) — liczymy go raz.
        if isinstance(packet_id, int) and self._signal_last_id.get(sender) == packet_id:
            return
        if isinstance(packet_id, int):
            self._signal_last_id[sender] = packet_id
        suffix = "" if hops == 0 else "Via"
        self._record_node_point(
            sender, "signal", {"hops": hops, f"snr{suffix}": snr, f"rssi{suffix}": rssi}, persist=False
        )
        if now - self._signal_saved_at >= SIGNAL_SAVE_INTERVAL_MS:
            self._signal_saved_at = now
            self._schedule_save()

    def _handle_position(self, event: Event) -> None:
        node_id = event.data.get(ATTR_EVENT_MESHTASTIC_API_NODE)
        data = event.data.get(ATTR_EVENT_MESHTASTIC_API_DATA)
        if node_id is None or not data or "latitude" not in data:
            return
        self._record_node_point(
            node_id,
            "position",
            {
                "latitude": data.get("latitude"),
                "longitude": data.get("longitude"),
                "altitude": data.get("altitude"),
            },
        )

    def _record_node_point(self, node_id: Any, kind: str, point: dict[str, Any], *, persist: bool = True) -> None:
        series = self._node_history.setdefault(str(node_id), {}).setdefault(kind, [])
        series.append({"ts": _now_ms(), **point})
        limit = MAX_SIGNAL_HISTORY_POINTS if kind == "signal" else MAX_NODE_HISTORY_POINTS
        if len(series) > limit:
            del series[: len(series) - limit]
        if persist:
            self._schedule_save()

    def node_history(self, node_id: int, kind: str, limit: int | None = None) -> list[dict[str, Any]]:
        series = self._node_history.get(str(node_id), {}).get(kind, [])
        if limit is None or limit >= len(series):
            return list(series)
        return series[-limit:]

    def _remember_signed(self, node_id: Any, signed: Any) -> None:
        if node_id is None or signed is None:
            return
        state = self._node_state.setdefault(str(node_id), {})
        if state.get("signed") == bool(signed):
            return
        state["signed"] = bool(signed)
        self._schedule_save()

    def add_traceroute(self, node_id: int, route: dict[str, Any]) -> None:
        """Zachowaj wynik traceroute, żeby przeżył restart integracji."""
        entries = self._traceroutes.setdefault(str(node_id), [])
        entries.append({"ts": _now_ms(), "route": route})
        if len(entries) > MAX_TRACEROUTES_PER_NODE:
            del entries[: len(entries) - MAX_TRACEROUTES_PER_NODE]
        self._schedule_save()

    def traceroutes(self, node_id: int) -> list[dict[str, Any]]:
        return list(self._traceroutes.get(str(node_id), []))

    # ── szeregi czasowe ─────────────────────────────────────────────────

    def _sample_gateway(self, _now: Any = None) -> None:
        """Dopisz próbkę telemetrii bramki z danych koordynatora."""
        data = getattr(self._entry, "runtime_data", None)
        if data is None or not data.coordinator.data:
            return

        gateway_node = data.gateway_node or {}
        node_id = gateway_node.get("num")
        if node_id is None:
            return

        node_data = data.coordinator.data.get(node_id) or {}
        device_metrics = node_data.get("deviceMetrics") or {}
        local_stats = {
            **(node_data.get("localStats") or {}),
            **(node_data.get("localStatsExtended") or {}),
        }

        point: dict[str, Any] = {"ts": _now_ms()}
        for key, source, field in (
            ("channel_utilization", device_metrics, "channelUtilization"),
            ("air_util_tx", device_metrics, "airUtilTx"),
            ("packets_tx", local_stats, "numPacketsTx"),
            ("packets_rx", local_stats, "numPacketsRx"),
            ("packets_rx_bad", local_stats, "numPacketsRxBad"),
        ):
            value = source.get(field)
            if value is not None:
                point[key] = value

        if len(point) == 1:
            return

        self._timeseries.append(point)
        if len(self._timeseries) > MAX_TIMESERIES_POINTS:
            del self._timeseries[: len(self._timeseries) - MAX_TIMESERIES_POINTS]
        self._schedule_save()


async def async_setup_store(hass: HomeAssistant, entry: MeshtasticConfigEntry) -> PanelStore:
    store = PanelStore(hass, entry)
    await store.async_load()
    store.async_start()
    _STORES[entry.entry_id] = store
    return store


async def async_unload_store(entry_id: str) -> None:
    store = _STORES.pop(entry_id, None)
    if store is not None:
        await store.async_stop()


def get_store(entry_id: str) -> PanelStore | None:
    return _STORES.get(entry_id)
