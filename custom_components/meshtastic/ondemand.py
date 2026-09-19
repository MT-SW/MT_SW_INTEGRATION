# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""OnDemand — zapytania diagnostyczne do węzłów i sterowanie snifferem.

Firmware MT_SW ma moduł nasłuchujący na porcie 354 (ON_DEMAND_APP; PRIVATE_APP
zajmuje tam moduł gier, a upstreamowy PortNum tego numeru nie zna, dlatego
w kodzie występuje literał). Klient wysyła OnDemand.request z typem zapytania,
węzeł odpowiada OnDemand.response. Duże odpowiedzi (listy) węzeł tnie na kilka
pakietów, opisanych packet_index / packet_total — zbieramy je i sklejamy.

Sniffer korzysta z tego samego kanału: REQUEST_SNIFFER_ENABLE / DISABLE /
STATE, każde z odpowiedzią RESPONSE_SNIFFER_STATE. Firmware honoruje włączenie
i wyłączenie wyłącznie wtedy, gdy polecenie przychodzi od lokalnie podłączonego
telefonu, więc adresatem jest zawsze własna bramka. Stan jest tylko w RAM
urządzenia (po restarcie zawsze wyłączony), a wsparcie wykrywamy przez
REQUEST_FW_PLUS_VERSION: wersja >= 3 oznacza sniffer.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import weakref
from typing import Any

from google.protobuf.json_format import MessageToDict
from google.protobuf.message import DecodeError

from .aiomeshtastic.connection.errors import ClientApiNotConnectedError
from .aiomeshtastic.packet import Packet
from .aiomeshtastic.protobuf import mesh_pb2, ondemand_pb2, portnums_pb2
from .const import LOGGER

ON_DEMAND_PORT = 354
SNIFFER_MIN_FW_PLUS_VERSION = 3

# Nazwa zapytania w panelu -> typ żądania. Sniffera tu nie ma celowo: ma własne
# polecenia, bo działa wyłącznie lokalnie.
QUERIES: dict[str, int] = {
    "node_stats": ondemand_pb2.REQUEST_NODE_STATS,
    "ping": ondemand_pb2.REQUEST_PING,
    "ping_ack": ondemand_pb2.REQUEST_PING_ACK,
    "nodes_online": ondemand_pb2.REQUEST_NODES_ONLINE,
    "routing_errors": ondemand_pb2.REQUEST_ROUTING_ERRORS,
    "port_counters": ondemand_pb2.REQUEST_PORT_COUNTER_HISTORY,
    "air_activity": ondemand_pb2.REQUEST_AIR_ACTIVITY_HISTORY,
    "exchange": ondemand_pb2.REQUEST_PACKET_EXCHANGE_HISTORY,
    "rx_avg_time": ondemand_pb2.REQUEST_RX_AVG_TIME,
    "rx_packet_history": ondemand_pb2.REQUEST_PACKET_RX_HISTORY,
    "fw_plus_version": ondemand_pb2.REQUEST_FW_PLUS_VERSION,
}

_SNIFFER_REQUESTS = {
    ondemand_pb2.REQUEST_SNIFFER_ENABLE,
    ondemand_pb2.REQUEST_SNIFFER_DISABLE,
    ondemand_pb2.REQUEST_SNIFFER_STATE,
}

_LOCKS: weakref.WeakKeyDictionary[Any, asyncio.Lock] = weakref.WeakKeyDictionary()


class OnDemandError(Exception):
    """Zapytanie OnDemand nie dało odpowiedzi; code to krótki, stały opis przyczyny."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def expected_response(request_type: int) -> int:
    """Typ odpowiedzi, jakiego oczekujemy na dane żądanie."""
    if request_type in _SNIFFER_REQUESTS:
        return ondemand_pb2.RESPONSE_SNIFFER_STATE
    name = ondemand_pb2.OnDemandType.Name(request_type)
    return ondemand_pb2.OnDemandType.Value(name.replace("REQUEST_", "RESPONSE_", 1))


def _to_dict(message: Any) -> dict[str, Any]:
    # Pola bez obecności (nie-optional) o wartości 0 protobuf domyślnie pomija,
    # a dla histori liczników 0 jest pełnoprawną wartością.
    try:
        return MessageToDict(message, always_print_fields_with_no_presence=True)
    except TypeError:  # starsza wersja protobuf
        return MessageToDict(message, including_default_value_fields=True)


def port_name(port: int) -> str:
    if port == ON_DEMAND_PORT:
        return "ON_DEMAND_APP"
    try:
        return portnums_pb2.PortNum.Name(port)
    except ValueError:
        return f"PORT_{port}"


def _routing_error_name(number: int) -> str:
    try:
        return mesh_pb2.Routing.Error.Name(number)
    except ValueError:
        return f"ERROR_{number}"


def _enrich(kind: str | None, data: dict[str, Any]) -> None:
    """Dopisz czytelne nazwy do numerów portów i błędów routingu."""
    if kind == "port_counter_history":
        for entry in data.get("portCounterHistory", []):
            entry["name"] = port_name(int(entry.get("port", 0)))
    elif kind == "routing_errors":
        for entry in data.get("routingErrors", []):
            entry["name"] = _routing_error_name(int(entry.get("num", 0)))
    elif kind == "exchange_packet_log":
        for entry in data.get("exchangeList", []):
            entry["portName"] = port_name(int(entry.get("portNum", 0)))


def _lock_for(interface: Any) -> asyncio.Lock:
    lock = _LOCKS.get(interface)
    if lock is None:
        lock = asyncio.Lock()
        _LOCKS[interface] = lock
    return lock


async def request_on_demand(
    interface: Any,
    node_id: int,
    request_type: int,
    *,
    timeout: float = 20.0,  # noqa: ASYNC109
    part_timeout: float = 5.0,
) -> dict[str, Any]:
    """Wyślij zapytanie OnDemand do węzła i zaczekaj na (wieloczęściową) odpowiedź.

    Zapytania do jednego radia idą pojedynczo — równoległe obciążałyby i
    urządzenie, i łącze LoRa. Odpowiedź dopasowujemy po request_id; gdy
    firmware go nie ustawi, po nadawcy i typie odpowiedzi.
    """
    async with _lock_for(interface):
        return await _request(interface, node_id, request_type, timeout=timeout, part_timeout=part_timeout)


async def _request(  # noqa: PLR0912, PLR0915
    interface: Any,
    node_id: int,
    request_type: int,
    *,
    timeout: float,  # noqa: ASYNC109
    part_timeout: float,
) -> dict[str, Any]:
    connection = interface._connection  # noqa: SLF001
    expected = expected_response(request_type)
    packet_id = connection._generate_packet_id()  # noqa: SLF001

    to_radio = mesh_pb2.ToRadio()
    mesh_packet = to_radio.packet
    mesh_packet.id = packet_id
    mesh_packet.to = node_id
    mesh_packet.priority = mesh_pb2.MeshPacket.Priority.RELIABLE
    mesh_packet.want_ack = True
    mesh_packet.decoded.portnum = ON_DEMAND_PORT
    mesh_packet.decoded.want_response = True
    mesh_packet.decoded.payload = ondemand_pb2.OnDemand(
        request=ondemand_pb2.OnDemandRequest(request_type=request_type)
    ).SerializeToString()

    loop = asyncio.get_running_loop()
    sent_at = 0.0
    first_rx_at: float | None = None
    parts: dict[int, ondemand_pb2.OnDemandResponse] = {}
    expected_parts = 1
    meta: dict[str, Any] = {}

    async def _send() -> None:
        nonlocal sent_at
        sent_at = loop.time()
        await connection.send_packet(to_radio)

    try:
        async with asyncio.timeout(timeout) as budget:
            async with contextlib.aclosing(connection.listen(on_start=_send())) as stream:
                async for from_radio in stream:
                    packet = Packet(from_radio)
                    data = packet.data
                    if data is None:
                        continue

                    if data.portnum == portnums_pb2.PortNum.ROUTING_APP:
                        if data.request_id == packet_id:
                            routing = packet.app_payload
                            if (
                                routing is not None
                                and routing.HasField("error_reason")
                                and routing.error_reason != mesh_pb2.Routing.Error.NONE
                            ):
                                code = f"routing:{_routing_error_name(routing.error_reason)}"
                                raise OnDemandError(code)  # noqa: TRY301
                        continue

                    if data.portnum != ON_DEMAND_PORT:
                        continue

                    message = ondemand_pb2.OnDemand()
                    try:
                        message.ParseFromString(data.payload)
                    except DecodeError:
                        continue
                    if message.WhichOneof("variant") != "response":
                        continue
                    response = message.response

                    by_request_id = data.request_id == packet_id
                    by_sender = (
                        not data.request_id and packet.from_id == node_id and response.response_type == expected
                    )
                    if not (by_request_id or by_sender):
                        continue
                    if response.response_type != expected:
                        LOGGER.debug("OnDemand: odpowiedź %s zamiast %s", response.response_type, expected)

                    index = message.packet_index if message.HasField("packet_index") else len(parts)
                    if message.HasField("packet_total"):
                        expected_parts = max(expected_parts, message.packet_total)
                    parts[index] = response

                    if first_rx_at is None:
                        first_rx_at = loop.time()
                        mp = packet.mesh_packet
                        if mp is not None:
                            if mp.hop_start > 0:
                                meta["hops_away"] = mp.hop_start - mp.hop_limit
                            if mp.HasField("rx_rssi"):
                                meta["rx_rssi"] = mp.rx_rssi
                                meta["rx_snr"] = mp.rx_snr

                    if len(parts) >= expected_parts:
                        break
                    # kolejne części: czekamy krócej niż na pierwszą odpowiedź
                    budget.reschedule(loop.time() + part_timeout)
    except TimeoutError:
        if not parts:
            raise OnDemandError("timeout") from None
        LOGGER.debug("OnDemand: dostaliśmy %d z %d części", len(parts), expected_parts)
    except ClientApiNotConnectedError:
        raise OnDemandError("not_connected") from None

    merged = ondemand_pb2.OnDemandResponse()
    for index in sorted(parts):
        merged.MergeFrom(parts[index])

    kind = merged.WhichOneof("response_data")
    payload = _to_dict(getattr(merged, kind)) if kind else {}
    _enrich(kind, payload)

    rtt_ms = int(((first_rx_at or loop.time()) - sent_at) * 1000)
    return {
        "response_type": ondemand_pb2.OnDemandType.Name(merged.response_type),
        "kind": kind,
        "data": payload,
        "parts": len(parts),
        "expected_parts": expected_parts,
        "rtt_ms": rtt_ms,
        "received_at": int(time.time() * 1000),
        **meta,
    }


async def query_fw_plus_version(interface: Any, node_id: int, *, timeout: float = 8.0) -> int:  # noqa: ASYNC109
    result = await request_on_demand(interface, node_id, ondemand_pb2.REQUEST_FW_PLUS_VERSION, timeout=timeout)
    return int(result["data"].get("versionNumber", 0))


async def query_sniffer_state(interface: Any, node_id: int, *, timeout: float = 8.0) -> bool:  # noqa: ASYNC109
    result = await request_on_demand(interface, node_id, ondemand_pb2.REQUEST_SNIFFER_STATE, timeout=timeout)
    return bool(result["data"].get("enabled", False))


async def set_sniffer(interface: Any, node_id: int, enabled: bool, *, timeout: float = 8.0) -> bool:  # noqa: ASYNC109
    request_type = ondemand_pb2.REQUEST_SNIFFER_ENABLE if enabled else ondemand_pb2.REQUEST_SNIFFER_DISABLE
    result = await request_on_demand(interface, node_id, request_type, timeout=timeout)
    # firmware odpowiada realnym stanem — także wtedy, gdy zignorował polecenie
    return bool(result["data"].get("enabled", False))
