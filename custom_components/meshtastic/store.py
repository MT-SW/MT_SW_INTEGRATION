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
    ATTR_EVENT_MESHTASTIC_API_NODE_INFO,
    EVENT_MESHTASTIC_API_TEXT_MESSAGE,
    EVENT_MESHTASTIC_API_TEXT_MESSAGE_OUT,
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
        self._listeners: list[Callable[[str, dict[str, Any]], None]] = []
        self._unsubscribes: list[Callable[[], None]] = []

    # ── cykl życia ──────────────────────────────────────────────────────

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self._messages = data.get("messages", [])
        self._timeseries = data.get("timeseries", [])
        LOGGER.debug(
            "Panel store %s: wczytano %d wiadomości, %d próbek",
            self._entry_id,
            len(self._messages),
            len(self._timeseries),
        )

    def async_start(self) -> None:
        """Podłącz nasłuch zdarzeń integracji."""
        bus = self._hass.bus
        self._unsubscribes = [
            bus.async_listen(EVENT_MESHTASTIC_API_TEXT_MESSAGE, self._handle_message_in),
            bus.async_listen(EVENT_MESHTASTIC_API_TEXT_MESSAGE_OUT, self._handle_message_out),
            bus.async_listen(EVENT_MESHTASTIC_MESSAGE_ACK, self._handle_ack),
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
        return {"messages": self._messages, "timeseries": self._timeseries}

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
        for key in ("rx_snr", "rx_rssi", "hops_away"):
            if key in event.data:
                message[key] = event.data[key]
        return message

    def _handle_message_in(self, event: Event) -> None:
        if not self._belongs_to_entry(event):
            return
        message = self._build_message(event, "in")
        if message is not None:
            self._append_message(message)

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
        local_stats = node_data.get("localStatsExtended") or node_data.get("localStats") or {}

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
