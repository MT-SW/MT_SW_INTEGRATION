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

from .aiomeshtastic.protobuf import portnums_pb2
from .sniffer_decode import ChannelKeys, decode_payload, hash_matches, printable_preview, try_decrypt

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


def describe_payload(port: int | None, payload: bytes) -> str:
    """Krótki opis zawartości pakietu (zgodność wstecz — pełne dekodowanie w sniffer_decode)."""
    return decode_payload(port, payload)[0]


def build_entry(  # noqa: PLR0913, PLR0915
    packet: Mapping[str, Any],
    seq: int,
    now_ms: int,
    local_node: int | None,
    *,
    source: str = "radio",
    keys: list[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Zamień pakiet (MessageToDict z API albo z MQTT) na wpis logu.

    Wpis ma tylko proste typy, więc idzie wprost do JSON-a w panelu i do
    eksportu. Pakiet zaszyfrowany próbujemy odszyfrować znanymi kluczami
    (kanały bramki + publiczne kanały domyślne, dopasowanie po hashu kanału
    — jak w firmware). Gdy się nie da, wpis mówi, co wiadomo: do jakich
    znanych nazw kanałów pasuje hash, czy to PKI, oraz niesie surowe bajty
    z podglądem ASCII.
    """
    decoded = packet.get("decoded") or {}
    port = decoded.get("portnum")
    port_number = _port_number(port)
    payload = _decode_b64(decoded.get("payload"))
    encrypted = _decode_b64(packet.get("encrypted"))

    sender = packet.get("from")
    destination = packet.get("to")
    channel = packet.get("channel", 0)
    pki = bool(packet.get("pkiEncrypted"))

    decrypted_with = None
    hash_names: list[str] = []
    if encrypted and not decoded and not pki:
        data, key = try_decrypt(
            encrypted,
            packet.get("id"),
            sender,
            channel if isinstance(channel, int) else None,
            keys or [],
            name_hint=packet.get("mqtt_channel_name"),
        )
        if data is not None:
            port_number = int(data.portnum)
            port = portnums_pb2.PortNum.Name(port_number) if port_number in portnums_pb2.PortNum.values() else port_number
            payload = bytes(data.payload)
            decoded = {"portnum": port}
            decrypted_with = {"name": key["name"], "source": key["source"], "plain": bool(key.get("plain"))}
        else:
            hash_names = hash_matches(channel if isinstance(channel, int) else None, keys or [])

    info, fields = decode_payload(port_number, payload) if decoded else ("", [])
    raw = payload or encrypted
    still_encrypted = bool(encrypted) and not decoded

    hop_start = packet.get("hopStart")
    hop_limit = packet.get("hopLimit")
    hops_away = hop_start - hop_limit if isinstance(hop_start, int) and hop_start > 0 and isinstance(hop_limit, int) else None

    return {
        "seq": seq,
        "ts": now_ms,
        "from": sender,
        "to": destination,
        "id": packet.get("id"),
        "channel": channel,
        "port": _port_label(port, port_number) if decoded else ("PKI" if pki else "ENCRYPTED"),
        "port_num": port_number,
        "info": info,
        # pełna treść do rozwinięcia w panelu: [{"k": nazwa, "v": wartość, "t": typ}]
        "fields": fields,
        "encrypted": still_encrypted,
        # czym udało się odszyfrować (kanał bramki albo publiczny kanał domyślny)
        "decrypted_with": decrypted_with,
        # przy nieudanym odszyfrowaniu: znane nazwy kanałów o tym samym hashu
        "channel_hash_matches": hash_names,
        # Wiadomość prywatna do innego węzła: firmware szyfruje ją kluczem PKI
        # odbiorcy i wysyła z numerem kanału 0 — bez klucza prywatnego odbiorcy
        # nikt jej nie odczyta (aplikacja na telefonie też nie).
        "pki_likely": bool(
            still_encrypted
            and not pki
            and channel == 0
            and destination not in (None, BROADCAST)
            and not hash_names
        ),
        "payload_hex": raw[:MAX_PAYLOAD_BYTES].hex(),
        "payload_ascii": printable_preview(raw) if (still_encrypted or not fields) and raw else "",
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
        "pki": pki,
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
        # klucze do odszyfrowania pakietów z obcych kanałów (ustawiane przez magazyn)
        self.channel_keys: ChannelKeys | None = None

    def _keys(self) -> list[Mapping[str, Any]] | None:
        return self.channel_keys.keys() if self.channel_keys is not None else None

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
        self._entries.append(build_entry(packet, self._seq, now_ms, local_node, keys=self._keys()))

    def add_mqtt_packet(self, packet: Mapping[str, Any], now_ms: int, local_node: int | None) -> None:
        if not self.mqtt_enabled:
            return
        self._seq += 1
        self._entries.append(build_entry(packet, self._seq, now_ms, local_node, source="mqtt", keys=self._keys()))

    def entries_since(self, seq: int = 0, limit: int = MAX_ENTRIES) -> list[dict[str, Any]]:
        """Wpisy nowsze niż seq (od najstarszego); przy nadmiarze — najnowsze limit wpisów."""
        found = [entry for entry in self._entries if entry["seq"] > seq]
        return found[-limit:] if limit < len(found) else found

    def clear(self) -> None:
        # numeracja idzie dalej, żeby odpytujący panel nie pomylił wpisów
        self._entries.clear()
