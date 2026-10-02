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

Oba bufory są w pamięci (pierścień), bez zapisu na dysk. Moduł jest odizolowany
od reszty integracji: każdy błąd przy zbieraniu jest łapany i logowany na
poziomie debug — nigdy nie zatrzymuje panelu ani statystyk.
"""

from __future__ import annotations

import collections
import contextlib
import logging
import secrets
import threading
import time
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
CAPACITY = 2000
MAX_LIST_LIMIT = 2000
ROOT_LOGGER_NAME = "custom_components.meshtastic"
_HANDLER_MARK = "_mt_sw_debug_log_handler"

# Litery poziomów jak w aplikacji ("D/źródło: treść"): LogRecord.Level → litera.
_DEVICE_LEVELS = {50: "C", 40: "E", 30: "W", 20: "I", 10: "D", 5: "T", 0: "U"}
_PY_LEVELS = {
    logging.CRITICAL: "C",
    logging.ERROR: "E",
    logging.WARNING: "W",
    logging.INFO: "I",
    logging.DEBUG: "D",
}


class LogBuffer:
    """Ograniczony bufor z rosnącym numerem wpisu (id) — do dopytywania przyrostowego."""

    def __init__(self, capacity: int = CAPACITY) -> None:
        self.capacity = capacity
        # epoch zmienia się przy każdym nowym buforze (przeładowanie wpisu) — panel
        # wie wtedy, że numeracja zaczęła się od nowa i zaczyna listę od zera.
        self.epoch = secrets.token_hex(4)
        self._entries: collections.deque[dict[str, Any]] = collections.deque(maxlen=capacity)
        self._last_id = 0
        self._lock = threading.Lock()

    @property
    def last_id(self) -> int:
        return self._last_id

    @property
    def count(self) -> int:
        return len(self._entries)

    def add(self, level: str, source: str, message: str, ts: float | None = None, **extra: Any) -> None:
        with self._lock:
            self._last_id += 1
            entry = {
                "id": self._last_id,
                "ts": round(time.time() if ts is None else ts, 3),
                "level": level,
                "source": source,
                "message": message,
            }
            entry.update(extra)
            self._entries.append(entry)

    def entries_since(self, since: int = 0, limit: int = MAX_LIST_LIMIT) -> list[dict[str, Any]]:
        with self._lock:
            items = [entry for entry in self._entries if entry["id"] > since]
        return items[-limit:] if len(items) > limit else items

    def clear(self) -> None:
        # numeracja leci dalej, żeby panel nie wziął czyszczenia za restart bufora
        with self._lock:
            self._entries.clear()

    def meta(self) -> dict[str, Any]:
        return {"count": self.count, "capacity": self.capacity, "last_id": self._last_id, "epoch": self.epoch}


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
            ws_debug_logs_clear,
            ws_debug_logs_collect,
            ws_debug_logs_firmware_api,
            ws_debug_logs_capture_debug,
        ):
            websocket_api.async_register_command(hass, handler)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Debug log WebSocket commands could not be registered", exc_info=True)
