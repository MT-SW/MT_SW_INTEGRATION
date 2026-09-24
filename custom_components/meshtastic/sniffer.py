# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Log sniffera — bufor pakietów, które radio przekazało do integracji.

Gdy sniffer jest włączony, firmware przekazuje przez API także pakiety
usłyszane w eterze, a niezaadresowane do węzła. Integracja i tak dostaje każdy
pakiet jako zdarzenie (EVENT_MESHTASTIC_API_PACKET), więc tutaj wystarczy je
zbierać, dopóki sniffer jest włączony. Log jest pełny, bez filtrowania —
razem z pakietami do i od bramki — żeby dało się obejrzeć np. zapytanie
traceroute razem z jego odpowiedzią.

Bufor żyje wyłącznie w pamięci: ma limit i nie jest zapisywany na dysk, bo
ruch w eterze bywa duży. Do zachowania służy eksport w panelu.
"""

from __future__ import annotations

import base64
import binascii
from collections import deque
from typing import TYPE_CHECKING, Any

from .aiomeshtastic.protobuf import admin_pb2, mesh_pb2, ondemand_pb2, portnums_pb2, telemetry_pb2

if TYPE_CHECKING:
    from collections.abc import Mapping

MAX_ENTRIES = 5000
MAX_PAYLOAD_BYTES = 256
MAX_INFO_LENGTH = 160
BROADCAST = 0xFFFFFFFF
ON_DEMAND_PORT = 354


def _port_number(port: Any) -> int | None:
    """MessageToDict oddaje nazwę znanego portu albo liczbę dla nieznanego."""
    if isinstance(port, int):
        return port
    if isinstance(port, str):
        try:
            return int(portnums_pb2.PortNum.Value(port))
        except ValueError:
            return None
    return None


def _port_label(port: Any, number: int | None) -> str:
    if number == ON_DEMAND_PORT:
        return "ON_DEMAND_APP"
    if isinstance(port, str):
        return port
    return f"PORT_{number}" if number is not None else "?"


def _decode_b64(value: Any) -> bytes:
    if not isinstance(value, str):
        return b""
    try:
        return base64.b64decode(value)
    except (binascii.Error, ValueError):
        return b""


def describe_payload(port: int | None, payload: bytes) -> str:  # noqa: PLR0911, PLR0912
    """Krótki opis zawartości pakietu; pusty, gdy nie umiemy go odczytać."""
    if port is None or not payload:
        return ""
    try:
        if port == portnums_pb2.PortNum.TEXT_MESSAGE_APP:
            return payload.decode("utf-8", errors="replace")[:MAX_INFO_LENGTH]
        if port == portnums_pb2.PortNum.POSITION_APP:
            position = mesh_pb2.Position()
            position.ParseFromString(payload)
            text = f"{position.latitude_i * 1e-7:.5f}, {position.longitude_i * 1e-7:.5f}"
            return f"{text} ({position.altitude} m)" if position.altitude else text
        if port == portnums_pb2.PortNum.NODEINFO_APP:
            user = mesh_pb2.User()
            user.ParseFromString(payload)
            return f"{user.long_name} ({user.short_name})" if user.long_name else user.id
        if port == portnums_pb2.PortNum.TELEMETRY_APP:
            telemetry = telemetry_pb2.Telemetry()
            telemetry.ParseFromString(payload)
            return telemetry.WhichOneof("variant") or ""
        if port == portnums_pb2.PortNum.ROUTING_APP:
            routing = mesh_pb2.Routing()
            routing.ParseFromString(payload)
            variant = routing.WhichOneof("variant")
            if variant == "error_reason":
                return mesh_pb2.Routing.Error.Name(routing.error_reason)
            return variant or ""
        if port == portnums_pb2.PortNum.TRACEROUTE_APP:
            route = mesh_pb2.RouteDiscovery()
            route.ParseFromString(payload)
            return f"route {len(route.route)} / back {len(route.route_back)}"
        if port == portnums_pb2.PortNum.NEIGHBORINFO_APP:
            neighbors = mesh_pb2.NeighborInfo()
            neighbors.ParseFromString(payload)
            return f"{len(neighbors.neighbors)} neighbors"
        if port == portnums_pb2.PortNum.ADMIN_APP:
            admin = admin_pb2.AdminMessage()
            admin.ParseFromString(payload)
            return admin.WhichOneof("payload_variant") or ""
        if port == ON_DEMAND_PORT:
            message = ondemand_pb2.OnDemand()
            message.ParseFromString(payload)
            variant = message.WhichOneof("variant")
            if variant == "request":
                return ondemand_pb2.OnDemandType.Name(message.request.request_type)
            if variant == "response":
                return ondemand_pb2.OnDemandType.Name(message.response.response_type)
    except Exception:  # noqa: BLE001 - uszkodzony albo obcy pakiet nie może zepsuć logu
        return ""
    return ""


def build_entry(
    packet: Mapping[str, Any], seq: int, now_ms: int, local_node: int | None, *, source: str = "radio"
) -> dict[str, Any]:
    """Zamień pakiet (MessageToDict z API) na wpis logu.

    Wpis ma tylko proste typy, więc idzie wprost do JSON-a w panelu i do
    eksportu. Zawartość pakietów zaszyfrowanych nie jest odczytywana — trafia
    do logu jako surowy zapis szesnastkowy.
    """
    decoded = packet.get("decoded") or {}
    port = decoded.get("portnum")
    port_number = _port_number(port)

    payload = _decode_b64(decoded.get("payload"))
    encrypted = _decode_b64(packet.get("encrypted"))
    raw = payload or encrypted

    hop_start = packet.get("hopStart")
    hop_limit = packet.get("hopLimit")
    hops_away = hop_start - hop_limit if isinstance(hop_start, int) and hop_start > 0 and isinstance(hop_limit, int) else None

    sender = packet.get("from")
    destination = packet.get("to")

    return {
        "seq": seq,
        "ts": now_ms,
        "from": sender,
        "to": destination,
        "id": packet.get("id"),
        "channel": packet.get("channel", 0),
        "port": _port_label(port, port_number) if decoded else "ENCRYPTED",
        "port_num": port_number,
        "info": describe_payload(port_number, payload),
        "encrypted": bool(encrypted) and not decoded,
        "payload_hex": raw[:MAX_PAYLOAD_BYTES].hex(),
        "payload_size": len(raw),
        "rx_snr": packet.get("rxSnr"),
        "rx_rssi": packet.get("rxRssi"),
        "hop_limit": hop_limit,
        "hop_start": hop_start,
        "hops_away": hops_away,
        "relay_node": packet.get("relayNode"),
        "want_ack": bool(packet.get("wantAck")),
        "via_mqtt": bool(packet.get("viaMqtt")),
        "signed": bool(packet.get("xeddsaSigned")),
        "pki": bool(packet.get("pkiEncrypted")),
        "broadcast": destination == BROADCAST,
        "from_us": local_node is not None and sender == local_node,
        "to_us": local_node is not None and destination == local_node,
        "source": source,
        "mqtt_channel_name": packet.get("mqtt_channel_name"),
        # Bramka, która ten odbiór przekazała: przy MQTT — gateway_id z koperty
        # (np. "!a1b2c3d4"), przy radiu — nasza własna bramka. Panel grupuje po
        # (from, id) odbiory tego samego pakietu z różnych bram i przekaźników.
        "gateway": packet.get("mqtt_gateway_id")
        or (f"!{local_node:08x}" if source == "radio" and isinstance(local_node, int) else None),
    }


class SnifferLog:
    """Bufor pierścieniowy wpisów i to, co wiemy o stanie sniffera na radiu."""

    def __init__(self, capacity: int = MAX_ENTRIES) -> None:
        # None = nie wiemy: stan sniffera jest tylko w RAM radia, więc po
        # restarcie integracji trzeba go zapytać, zanim zaczniemy zbierać.
        self.enabled: bool | None = None
        self.fw_plus_version: int | None = None
        # brak odpowiedzi na pytanie o FW+ pamiętamy przez jakiś czas (patrz websocket_api)
        self.fw_plus_error: str | None = None
        self.fw_plus_checked_at = 0.0
        self.capacity = capacity
        self._entries: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._seq = 0
        self.mqtt_enabled = False

    @property
    def last_seq(self) -> int:
        return self._seq

    @property
    def count(self) -> int:
        return len(self._entries)

    def add_packet(self, packet: Mapping[str, Any], now_ms: int, local_node: int | None) -> None:
        if not self.enabled:
            return
        self._seq += 1
        self._entries.append(build_entry(packet, self._seq, now_ms, local_node))

    def add_mqtt_packet(self, packet: Mapping[str, Any], now_ms: int, local_node: int | None) -> None:
        if not self.mqtt_enabled:
            return
        self._seq += 1
        self._entries.append(build_entry(packet, self._seq, now_ms, local_node, source="mqtt"))

    def entries_since(self, seq: int = 0, limit: int = MAX_ENTRIES) -> list[dict[str, Any]]:
        """Wpisy nowsze niż seq (od najstarszego); przy nadmiarze — najnowsze limit wpisów."""
        found = [entry for entry in self._entries if entry["seq"] > seq]
        return found[-limit:] if limit < len(found) else found

    def clear(self) -> None:
        # numeracja idzie dalej, żeby odpytujący panel nie pomylił wpisów
        self._entries.clear()
