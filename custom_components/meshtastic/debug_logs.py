# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Debugowanie: dwa niezależne logi w panelu (Ustawienia → Debugowanie).

* „Urządzenie” — rekordy logu firmware (FromRadio.log_record), czyli to samo,
  co radio wypisuje na porcie szeregowym. Tak jak w aplikacji Android:
  przez Bluetooth działa z każdym firmware, przez Wi-Fi/TCP i USB (port
  szeregowy) tylko z firmware MT_SW. Radio wysyła logi wyłącznie wtedy, gdy ma
  włączone „Logi debugowania” (config.security.debug_log_api_enabled).
* „Integracja” — logi Pythona samej integracji (logger
  ``custom_components.meshtastic`` wraz z podrzędnymi, w tym aiomeshtastic).

Oba bufory są w pamięci (pierścień, domyślnie 25 000 wpisów każdy — do wyboru
5 000 / 10 000 / 25 000), bez zapisu na dysk. Wpis to krotka (nie słownik), a
długość pojedynczej linii jest ograniczona. Panel nie pobiera całego bufora:
dostaje indeks numerów pasujących wpisów (`debug_logs_index`), a treść
wyświetlanych wierszy dociąga po numerach (`debug_logs_get`). Moduł jest odizolowany
od reszty integracji: każdy błąd przy zbieraniu jest łapany i logowany na
poziomie debug — nigdy nie zatrzymuje panelu ani statystyk.
"""

from __future__ import annotations

import collections
import contextlib
import itertools
import logging
import secrets
import sys
import threading
import time
from functools import partial
from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant.components import websocket_api

from .const import CONF_CONNECTION_TYPE, DOMAIN, ConnectionType

if TYPE_CHECKING:
    from collections.abc import Callable

    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

WS_PREFIX = DOMAIN
CAPACITY_CHOICES = (5000, 10000, 25000)
DEFAULT_CAPACITY = 25000
CAPACITY = DEFAULT_CAPACITY  # zgodność wstecz
MAX_LIST_LIMIT = DEFAULT_CAPACITY
MAX_GET_IDS = 500
MAX_MESSAGE_LENGTH = 1500  # dłuższe linie (np. ślady wyjątków) są obcinane — pilnuje pamięci
ROOT_LOGGER_NAME = "custom_components.meshtastic"
_HANDLER_MARK = "_mt_sw_debug_log_handler"

# wybrany rozmiar buforów (wspólny; zapisywany w magazynie panelu, patrz store.py)
_capacity = DEFAULT_CAPACITY

# Litery poziomów jak w aplikacji ("D/źródło: treść"): LogRecord.Level → litera.
_DEVICE_LEVELS = {50: "C", 40: "E", 30: "W", 20: "I", 10: "D", 5: "T", 0: "U"}
_PY_LEVELS = {
    logging.CRITICAL: "C",
    logging.ERROR: "E",
    logging.WARNING: "W",
    logging.INFO: "I",
    logging.DEBUG: "D",
}


def _clip(message: str) -> str:
    if len(message) <= MAX_MESSAGE_LENGTH:
        return message
    return f"{message[:MAX_MESSAGE_LENGTH]} …(+{len(message) - MAX_MESSAGE_LENGTH} znaków)"


def format_line_time(ts: float, tz_offset_min: int) -> str:
    """Czas wiersza w strefie przeglądarki ("2026-10-02 14:03:11") — tak jak go widać w panelu."""
    moment = time.gmtime(ts + tz_offset_min * 60)
    return time.strftime("%Y-%m-%d %H:%M:%S", moment)


class LogBuffer:
    """Ograniczony bufor z rosnącym numerem wpisu (id) — do dopytywania przyrostowego."""

    def __init__(self, capacity: int | None = None) -> None:
        capacity = _capacity if capacity is None else capacity
        self.capacity = capacity
        # epoch zmienia się przy każdym nowym buforze (przeładowanie wpisu) — panel
        # wie wtedy, że numeracja zaczęła się od nowa i zaczyna listę od zera.
        self.epoch = secrets.token_hex(4)
        # wpis: (id, ts, level, source, message, extra | None) — numery są ciągłe
        self._entries: collections.deque[tuple[Any, ...]] = collections.deque(maxlen=capacity)
        self._last_id = 0
        self._lock = threading.Lock()

    @property
    def last_id(self) -> int:
        return self._last_id

    @property
    def first_id(self) -> int:
        """Numer najstarszego wpisu (last_id + 1, gdy bufor jest pusty)."""
        with self._lock:
            return self._entries[0][0] if self._entries else self._last_id + 1

    @property
    def count(self) -> int:
        return len(self._entries)

    def set_capacity(self, capacity: int) -> int:
        """Zmień rozmiar; zmniejszenie usuwa najstarsze wpisy. Zwraca liczbę usuniętych."""
        capacity = int(capacity)
        with self._lock:
            if capacity == self.capacity:
                return 0
            before = len(self._entries)
            keep = list(self._entries)[-capacity:]
            self.capacity = capacity
            self._entries = collections.deque(keep, maxlen=capacity)
            return before - len(keep)

    def add(self, level: str, source: str, message: str, ts: float | None = None, **extra: Any) -> None:
        with self._lock:
            self._last_id += 1
            self._entries.append(
                (
                    self._last_id,
                    round(time.time() if ts is None else ts, 3),
                    sys.intern(level),
                    sys.intern(source),
                    _clip(message),
                    extra or None,
                )
            )

    @staticmethod
    def _as_dict(item: tuple[Any, ...]) -> dict[str, Any]:
        entry = {"id": item[0], "ts": item[1], "level": item[2], "source": item[3], "message": item[4]}
        if item[5]:
            entry.update(item[5])
        return entry

    def _after(self, since: int) -> list[tuple[Any, ...]]:
        """Wpisy o numerze większym niż since (numeracja w buforze jest ciągła)."""
        with self._lock:
            total = len(self._entries)
            if not total or since >= self._last_id:
                return []
            missing = self._last_id - max(since, self._entries[0][0] - 1)
            if missing >= total:
                return list(self._entries)
            return list(itertools.islice(reversed(self._entries), missing))[::-1]

    def entries_since(self, since: int = 0, limit: int = MAX_LIST_LIMIT) -> list[dict[str, Any]]:
        if limit <= 0:
            return []
        items = self._after(since)
        if len(items) > limit:
            items = items[-limit:]
        return [self._as_dict(item) for item in items]

    def get_many(self, ids: list[int]) -> list[dict[str, Any]]:
        """Wpisy o podanych numerach (nieistniejące — już wypchnięte z bufora — pomijamy)."""
        with self._lock:
            if not self._entries:
                return []
            first = self._entries[0][0]
            snapshot = list(self._entries) if len(ids) > 40 else None
            out = []
            for entry_id in ids[:MAX_GET_IDS]:
                position = entry_id - first
                if 0 <= position < len(self._entries):
                    item = snapshot[position] if snapshot is not None else self._entries[position]
                    out.append(self._as_dict(item))
            return out

    def index(
        self,
        since: int = 0,
        *,
        hide_levels: frozenset[str] = frozenset(),
        query: str = "",
        tz_offset_min: int = 0,
    ) -> list[int] | None:
        """
        Numery wpisów nowszych niż `since`, które przechodzą filtr (poziomy ukryte + tekst).
        Bez żadnego filtra zwraca None — panel wtedy liczy numery sam (first_id..last_id).
        Tekst szukany jest w wierszu "L/źródło: treść"; z czasem tylko gdy fraza zawiera cyfrę.
        """
        needle = query.strip().lower()
        if not hide_levels and not needle:
            return None
        with_time = any(ch.isdigit() for ch in needle)
        found = []
        for item in self._after(since):
            if item[2] in hide_levels:
                continue
            if needle:
                line = f"{item[2]}/{item[3] or '-'}: {item[4]}"
                if with_time:
                    line = f"{format_line_time(item[1], tz_offset_min)}  {line}"
                if needle not in line.lower():
                    continue
            found.append(item[0])
        return found

    def clear(self) -> None:
        # numeracja leci dalej, żeby panel nie wziął czyszczenia za restart bufora
        with self._lock:
            self._entries.clear()

    def meta(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "capacity": self.capacity,
            "last_id": self._last_id,
            "first_id": self.first_id,
            "epoch": self.epoch,
        }


# ── log urządzenia ───────────────────────────────────────────────────────────


class DeviceLog:
    """Rekordy logu firmware jednej bramki + stan zbierania."""

    def __init__(self, entry: ConfigEntry, client: Any) -> None:
        self.entry = entry
        self.client = client
        self.buffer = LogBuffer()
        # Zbieranie jest tanie (bufor ograniczony), a radio i tak wysyła logi tylko po
        # włączeniu API logów w jego konfiguracji — domyślnie więc zbieramy.
        self.collecting = True
        self._remove_listener: Callable[[], None] | None = None

    def attach(self) -> None:
        interface = self.client.interface
        self._remove_listener = interface.add_log_record_listener(self._on_record)

    def detach(self) -> None:
        remove, self._remove_listener = self._remove_listener, None
        if remove is not None:
            with contextlib.suppress(Exception):
                remove()

    def _on_record(self, record: Any) -> None:
        if not self.collecting:
            return
        try:
            level = _DEVICE_LEVELS.get(int(record.level), None)
            if level is None:
                level = "?"
            extra = {"device_time": int(record.time)} if getattr(record, "time", 0) else {}
            # firmware kończy linie znakiem nowej linii — jak w aplikacji obcinamy go
            self.buffer.add(level, record.source or "-", record.message.rstrip(), **extra)
        except Exception:  # noqa: BLE001
            _LOGGER.debug("Could not store device log record", exc_info=True)

    @property
    def connection_type(self) -> str | None:
        return self.entry.data.get(CONF_CONNECTION_TYPE)

    @property
    def any_firmware(self) -> bool:
        """Bluetooth: logi działają z każdym firmware; TCP i USB: tylko z MT_SW (reguła z aplikacji)."""
        return self.connection_type == ConnectionType.BLUETOOTH.value

    def firmware_api_enabled(self) -> bool | None:
        with contextlib.suppress(Exception):
            config = self.client.interface.connected_node_local_config()
            if config is not None:
                return bool(config.security.debug_log_api_enabled)
        return None

    def status(self) -> dict[str, Any]:
        return {
            **self.buffer.meta(),
            "collecting": self.collecting,
            "connection_type": self.connection_type,
            "any_firmware": self.any_firmware,
            "firmware_api_enabled": self.firmware_api_enabled(),
        }


_DEVICE_LOGS: dict[str, DeviceLog] = {}


def async_attach_entry(hass: HomeAssistant, entry: ConfigEntry, client: Any) -> None:
    """Podłącz zbieranie logów do wpisu — wołane zaraz po utworzeniu klienta, przed połączeniem."""
    try:
        async_detach_entry(hass, entry.entry_id)
        device = DeviceLog(entry, client)
        device.attach()
        _DEVICE_LOGS[entry.entry_id] = device
        _install_integration_handler(entry.entry_id)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Debug log capture could not be attached", exc_info=True)


def async_detach_entry(hass: HomeAssistant, entry_id: str) -> None:  # noqa: ARG001
    """Odepnij logi wpisu i zdejmij handler, gdy nie został żaden wpis."""
    try:
        device = _DEVICE_LOGS.pop(entry_id, None)
        if device is not None:
            device.detach()
        _remove_integration_handler(entry_id)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Debug log capture could not be detached", exc_info=True)


# ── log integracji ───────────────────────────────────────────────────────────

INTEGRATION_LOG = LogBuffer()


def get_capacity() -> int:
    return _capacity


def set_capacity(capacity: int) -> int:
    """Rozmiar obu logów naraz (urządzenia każdej bramki i integracji). Zwraca liczbę usuniętych wpisów."""
    global _capacity  # noqa: PLW0603
    _capacity = int(capacity)
    removed = INTEGRATION_LOG.set_capacity(_capacity)
    for device in _DEVICE_LOGS.values():
        removed += device.buffer.set_capacity(_capacity)
    return removed


class _BufferHandler(logging.Handler):
    """Wrzuca rekordy loggera integracji do bufora; nigdy nie rzuca wyjątku."""

    def __init__(self, buffer: LogBuffer) -> None:
        super().__init__(level=logging.NOTSET)
        self._buffer = buffer
        self._local = threading.local()
        setattr(self, _HANDLER_MARK, True)

    def emit(self, record: logging.LogRecord) -> None:
        if getattr(self._local, "busy", False):
            return
        self._local.busy = True
        try:
            message = record.getMessage()
            if record.exc_info:
                message = f"{message}\n{logging.Formatter().formatException(record.exc_info)}"
            elif record.exc_text:
                message = f"{message}\n{record.exc_text}"
            name = record.name
            prefix = ROOT_LOGGER_NAME + "."
            if name.startswith(prefix):
                name = name[len(prefix) :]
            level = _PY_LEVELS.get(record.levelno) or _PY_LEVELS.get(
                max((lv for lv in _PY_LEVELS if lv <= record.levelno), default=logging.DEBUG), "D"
            )
            self._buffer.add(level, name, message, ts=record.created)
        except Exception:  # noqa: BLE001, S110
            pass
        finally:
            self._local.busy = False


_active_entries: set[str] = set()
_handler: _BufferHandler | None = None
_previous_logger_level: int | None = None  # ustawione, gdy włączyliśmy zbieranie DEBUG


def _strip_stale_handlers(logger: logging.Logger) -> None:
    """Zdejmij handlery z poprzedniego załadowania modułu (reload) — bez duplikatów."""
    for existing in list(logger.handlers):
        if getattr(existing, _HANDLER_MARK, False):
            logger.removeHandler(existing)


def _install_integration_handler(entry_id: str) -> None:
    global _handler  # noqa: PLW0603
    _active_entries.add(entry_id)
    logger = logging.getLogger(ROOT_LOGGER_NAME)
    if _handler is not None and _handler in logger.handlers:
        return
    _strip_stale_handlers(logger)
    _handler = _BufferHandler(INTEGRATION_LOG)
    # Jeden handler na rodzicu wystarcza: aiomeshtastic i pozostałe loggery integracji
    # są jego dziećmi i propagują rekordy w górę.
    logger.addHandler(_handler)


def _remove_integration_handler(entry_id: str) -> None:
    global _handler  # noqa: PLW0603
    _active_entries.discard(entry_id)
    if _active_entries:
        return
    logger = logging.getLogger(ROOT_LOGGER_NAME)
    _strip_stale_handlers(logger)
    _handler = None
    set_debug_capture(enabled=False)


def debug_capture_enabled() -> bool:
    return _previous_logger_level is not None


def set_debug_capture(*, enabled: bool) -> None:
    """Zbieraj też poziom DEBUG: podnosi poziom loggera integracji (i wpisuje DEBUG do logu HA)."""
    global _previous_logger_level  # noqa: PLW0603
    logger = logging.getLogger(ROOT_LOGGER_NAME)
    if enabled and _previous_logger_level is None:
        _previous_logger_level = logger.level
        logger.setLevel(logging.DEBUG)
    elif not enabled and _previous_logger_level is not None:
        logger.setLevel(_previous_logger_level)
        _previous_logger_level = None


# ── komendy WebSocket (tylko administrator) ──────────────────────────────────


def _device_or_error(connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> DeviceLog | None:
    device = _DEVICE_LOGS.get(msg["entry_id"])
    if device is None:
        connection.send_error(msg["id"], "not_found", "Logi tej bramki nie są dostępne")
    return device


def _integration_status() -> dict[str, Any]:
    return {**INTEGRATION_LOG.meta(), "debug_capture": debug_capture_enabled()}


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/debug_logs_status", vol.Required("entry_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_debug_logs_status(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Stan obu logów: liczba wpisów, zbieranie, rodzaj połączenia i API logów w radiu."""
    device = _device_or_error(connection, msg)
    if device is None:
        return
    connection.send_result(msg["id"], {"device": device.status(), "integration": _integration_status()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/debug_logs_list",
        vol.Required("entry_id"): str,
        vol.Required("source"): vol.In(["device", "integration"]),
        vol.Optional("since", default=0): vol.All(int, vol.Range(min=0)),
        vol.Optional("limit", default=MAX_LIST_LIMIT): vol.All(int, vol.Range(min=1, max=MAX_LIST_LIMIT)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_debug_logs_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Wpisy nowsze niż `since` (id ostatnio odebranego) — do dopytywania przyrostowego."""
    if msg["source"] == "device":
        device = _device_or_error(connection, msg)
        if device is None:
            return
        buffer, extra = device.buffer, {"collecting": device.collecting}
    else:
        buffer, extra = INTEGRATION_LOG, {"debug_capture": debug_capture_enabled()}
    connection.send_result(
        msg["id"], {"entries": buffer.entries_since(msg["since"], msg["limit"]), **buffer.meta(), **extra}
    )


def _buffer_for(connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> tuple[LogBuffer, dict[str, Any]] | None:
    if msg["source"] == "device":
        device = _device_or_error(connection, msg)
        if device is None:
            return None
        return device.buffer, {"collecting": device.collecting}
    return INTEGRATION_LOG, {"debug_capture": debug_capture_enabled()}


MAX_INLINE_TAIL = 300


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/debug_logs_index",
        vol.Required("entry_id"): str,
        vol.Required("source"): vol.In(["device", "integration"]),
        # wszystko, co panel już zna: numery nowsze niż `since` zostaną dopisane do jego indeksu
        vol.Optional("since", default=0): vol.All(int, vol.Range(min=0)),
        vol.Optional("hide_levels", default=[]): [vol.All(str, vol.Length(min=1, max=1))],
        vol.Optional("query", default=""): vol.All(str, vol.Length(max=200)),
        vol.Optional("tz_offset", default=0): vol.All(int, vol.Range(min=-1440, max=1440)),
        # tyle najnowszych pasujących wpisów dołączamy od razu (reszta: debug_logs_get)
        vol.Optional("tail", default=100): vol.All(int, vol.Range(min=0, max=MAX_INLINE_TAIL)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_debug_logs_index(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """
    Indeks pasujących wpisów zamiast całego bufora.

    `ids` to numery pasujące do filtra i nowsze niż `since` (None = filtra nie ma
    i panel liczy numery sam z first_id..last_id). Do tego `entries` — kilka
    najnowszych pasujących wpisów w całości, żeby nowe wiersze nie wymagały
    drugiego zapytania.
    """
    found = _buffer_for(connection, msg)
    if found is None:
        return
    buffer, extra = found
    # przeszukanie 25 000 wpisów trwa dziesiątki ms — poza pętlą zdarzeń
    ids = await hass.async_add_executor_job(
        partial(
            buffer.index,
            msg["since"],
            hide_levels=frozenset(msg["hide_levels"]),
            query=msg["query"],
            tz_offset_min=msg["tz_offset"],
        )
    )
    tail = msg["tail"]
    tail_ids = ids[max(len(ids) - tail, 0) :] if ids is not None and tail else []
    if ids is None:
        entries = buffer.entries_since(msg["since"], msg["tail"])
    else:
        entries = buffer.get_many(tail_ids)
    connection.send_result(msg["id"], {"ids": ids, "entries": entries, **buffer.meta(), **extra})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/debug_logs_get",
        vol.Required("entry_id"): str,
        vol.Required("source"): vol.In(["device", "integration"]),
        vol.Required("ids"): vol.All([int], vol.Length(max=MAX_GET_IDS)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_debug_logs_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Treść wpisów o podanych numerach (do widocznych wierszy listy i do eksportu porcjami)."""
    found = _buffer_for(connection, msg)
    if found is None:
        return
    buffer, _ = found
    connection.send_result(msg["id"], {"entries": buffer.get_many(msg["ids"]), **buffer.meta()})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/debug_logs_clear",
        vol.Required("entry_id"): str,
        vol.Required("source"): vol.In(["device", "integration"]),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_debug_logs_clear(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Wyczyść wybrany log."""
    if msg["source"] == "device":
        device = _device_or_error(connection, msg)
        if device is None:
            return
        device.buffer.clear()
    else:
        INTEGRATION_LOG.clear()
    connection.send_result(msg["id"], {"cleared": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/debug_logs_collect",
        vol.Required("entry_id"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_debug_logs_collect(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Włącz/wyłącz zbieranie logów urządzenia (przez Bluetooth także subskrypcję logów radia)."""
    device = _device_or_error(connection, msg)
    if device is None:
        return
    device.collecting = msg["enabled"]
    try:
        await device.client.interface.set_log_collection(msg["enabled"])
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Switching device log collection failed", exc_info=True)
    connection.send_result(msg["id"], device.status())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/debug_logs_firmware_api",
        vol.Required("entry_id"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_debug_logs_firmware_api(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Przełącznik „Logi debugowania” w konfiguracji bezpieczeństwa radia (jak w aplikacji)."""
    device = _device_or_error(connection, msg)
    if device is None:
        return
    try:
        await device.client.async_set_config("security", {"debugLogApiEnabled": msg["enabled"]}, is_module=False)
    except Exception as err:  # noqa: BLE001 - błąd radia nie może zerwać połączenia WS
        _LOGGER.warning("Zmiana API logów debugowania w radiu nie powiodła się: %s", err)
        connection.send_error(msg["id"], "set_config_failed", str(err))
        return
    connection.send_result(msg["id"], device.status())


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/debug_logs_capture_debug", vol.Required("enabled"): bool})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_debug_logs_capture_debug(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Zbieraj w logu integracji także poziom DEBUG."""
    set_debug_capture(enabled=msg["enabled"])
    connection.send_result(msg["id"], _integration_status())


def async_register_commands(hass: HomeAssistant) -> None:
    """Zarejestruj komendy. Błąd rejestracji nie może zatrzymać panelu."""
    try:
        for handler in (
            ws_debug_logs_status,
            ws_debug_logs_list,
            ws_debug_logs_index,
            ws_debug_logs_get,
            ws_debug_logs_clear,
            ws_debug_logs_collect,
            ws_debug_logs_firmware_api,
            ws_debug_logs_capture_debug,
        ):
            websocket_api.async_register_command(hass, handler)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Debug log WebSocket commands could not be registered", exc_info=True)
    try:
        from . import sniffer_ws  # noqa: PLC0415 - komendy sniffera i rozmiaru buforów rejestrujemy razem z logami

        sniffer_ws.async_register_commands(hass)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Sniffer WebSocket commands could not be registered", exc_info=True)
