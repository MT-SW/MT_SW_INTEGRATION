# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Komendy WebSocket logu Sniffera (strony grup, eksport) i rozmiaru buforów logów.

Sniffer trzyma do 25 000 wpisów, więc panel nigdy nie dostaje całego bufora:

* ``sniffer_query``  — strona grup pakietów (najnowsze pierwsze); grupowanie
  i filtrowanie robi serwer. ``upto`` zamraża widok na numerze wpisu, dzięki
  czemu przewijanie wstecz nie przesuwa listy, gdy napływają nowe pakiety.
* ``sniffer_entries`` — kolejna porcja surowych wpisów do eksportu (JSON/CSV);
  panel składa plik z porcji, więc zakładka się nie zawiesza.
* ``log_capacity_get`` / ``log_capacity_set`` — rozmiar bufora sniffera albo
  logów debugowania (5 000 / 10 000 / 25 000), zapisywany w magazynie panelu.

Komendy rejestruje debug_logs.async_register_commands (ten sam zestaw „logów”).
"""

from __future__ import annotations

import logging
from functools import partial
from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant.components import websocket_api

from . import debug_logs
from .const import DOMAIN
from .sniffer import CAPACITY_CHOICES, DEFAULT_CAPACITY, SnifferFilter

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

WS_PREFIX = DOMAIN
MAX_PAGE = 200
MAX_EXPORT_CHUNK = 2000

_FILTER_SCHEMA = {
    vol.Optional("filter", default=""): vol.All(str, vol.Length(max=200)),
    vol.Optional("node_ids", default=[]): vol.All([int], vol.Length(max=5000)),
    vol.Optional("ports", default=[]): vol.All([str], vol.Length(max=200)),
    vol.Optional("source", default="all"): vol.In(["all", "radio", "mqtt"]),
}


def _store(connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> Any:
    from .store import get_store  # noqa: PLC0415 - store importuje sniffer, więc dopiero tutaj

    store = get_store(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], "not_found", "Magazyn panelu nie jest załadowany")
    return store


def _filter(msg: dict[str, Any]) -> SnifferFilter:
    return SnifferFilter.make(msg["filter"], msg["node_ids"], msg["ports"], msg["source"])


def _meta(store: Any) -> dict[str, Any]:
    log = store.sniffer
    return {
        "last_seq": log.last_seq,
        "first_seq": log.first_seq,
        "count": log.count,
        "capacity": log.capacity,
        "enabled": log.enabled,
        "mqtt_enabled": log.mqtt_enabled,
    }


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/sniffer_query",
        vol.Required("entry_id"): str,
        vol.Optional("grouped", default=True): bool,
        vol.Optional("upto"): vol.All(int, vol.Range(min=0)),
        vol.Optional("offset", default=0): vol.All(int, vol.Range(min=0)),
        vol.Optional("limit", default=100): vol.All(int, vol.Range(min=0, max=MAX_PAGE)),
        **_FILTER_SCHEMA,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sniffer_query(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Strona grup pakietów dla filtra: {groups, total, receptions, upto, ...meta}."""
    store = _store(connection, msg)
    if store is None:
        return
    # indeks grup dla nowego filtra liczy się setki ms — poza pętlą zdarzeń
    result = await hass.async_add_executor_job(
        partial(
            store.sniffer.query,
            _filter(msg),
            grouped=msg["grouped"],
            upto=msg.get("upto"),
            offset=msg["offset"],
            limit=msg["limit"],
        )
    )
    connection.send_result(msg["id"], {**_meta(store), **result})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/sniffer_entries",
        vol.Required("entry_id"): str,
        vol.Optional("after", default=0): vol.All(int, vol.Range(min=0)),
        vol.Optional("limit", default=1000): vol.All(int, vol.Range(min=1, max=MAX_EXPORT_CHUNK)),
        **_FILTER_SCHEMA,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sniffer_entries(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Porcja surowych wpisów po numerze `after` (eksport): {entries, next, done}."""
    store = _store(connection, msg)
    if store is None:
        return
    result = await hass.async_add_executor_job(store.sniffer.export_page, _filter(msg), msg["after"], msg["limit"])
    connection.send_result(msg["id"], result)


def _capacity_state(store: Any) -> dict[str, Any]:
    return {
        "choices": list(CAPACITY_CHOICES),
        "default": DEFAULT_CAPACITY,
        "sniffer": {"capacity": store.sniffer.capacity, "count": store.sniffer.count},
        "debug": {"capacity": debug_logs.get_capacity()},
    }


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/log_capacity_get", vol.Required("entry_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_log_capacity_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Rozmiary buforów: sniffera i logów debugowania."""
    store = _store(connection, msg)
    if store is None:
        return
    connection.send_result(msg["id"], _capacity_state(store))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/log_capacity_set",
        vol.Required("entry_id"): str,
        vol.Required("kind"): vol.In(["sniffer", "debug"]),
        vol.Required("capacity"): vol.In(list(CAPACITY_CHOICES)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_log_capacity_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Ustaw rozmiar bufora; zmniejszenie usuwa najstarsze wpisy. Wartość przetrwa restart."""
    store = _store(connection, msg)
    if store is None:
        return
    removed = store.set_log_capacity(msg["kind"], msg["capacity"])
    connection.send_result(msg["id"], {**_capacity_state(store), "removed": removed})


def async_register_commands(hass: HomeAssistant) -> None:
    """Zarejestruj komendy. Błąd rejestracji nie może zatrzymać panelu."""
    try:
        for handler in (ws_sniffer_query, ws_sniffer_entries, ws_log_capacity_get, ws_log_capacity_set):
            websocket_api.async_register_command(hass, handler)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Sniffer WebSocket commands could not be registered", exc_info=True)
