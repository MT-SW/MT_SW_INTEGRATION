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
    EVENT_MESHTASTIC_API_POSITION,
    EVENT_MESHTASTIC_API_TELEMETRY,
    EVENT_MESHTASTIC_API_TEXT_MESSAGE,
    EVENT_MESHTASTIC_API_TEXT_MESSAGE_OUT,
    EventMeshtasticApiTelemetryType,
)
from .const import DOMAIN, EVENT_MESHTASTIC_MESSAGE_ACK, LOGGER

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
# Próbkujemy z koordynatora, nie ze zdarzeń telemetrii — dzięki temu wykresy
# rosną także wtedy, gdy nikt nie ma otwartego panelu.
TIMESERIES_SAMPLE_SECONDS = 60

_STORES: dict[str, PanelStore] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


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
        for key in ("rx_snr", "rx_rssi", "hops_away", "xeddsa_signed"):
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
                message["ack"] = event.data.get("ack_type")
                if event.data.get("error"):
                    message["ack_error"] = event.data["error"]
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
        if telemetry_type not in (
            EventMeshtasticApiTelemetryType.DEVICE_METRICS,
            EventMeshtasticApiTelemetryType.ENVIRONMENT_METRICS,
            EventMeshtasticApiTelemetryType.POWER_METRICS,
        ):
            return
        self._record_node_point(node_id, telemetry_type.value, dict(data))

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

    def _record_node_point(self, node_id: Any, kind: str, point: dict[str, Any]) -> None:
        series = self._node_history.setdefault(str(node_id), {}).setdefault(kind, [])
        series.append({"ts": _now_ms(), **point})
        if len(series) > MAX_NODE_HISTORY_POINTS:
            del series[: len(series) - MAX_NODE_HISTORY_POINTS]
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
