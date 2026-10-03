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

Bufor żyje wyłącznie w pamięci: ma limit (domyślnie 25 000 wpisów, do wyboru
5 000 / 10 000 / 25 000) i nie jest zapisywany na dysk, bo ruch w eterze bywa
duży. Do zachowania służy eksport w panelu.

Żeby 25 000 wpisów nie zajmowało dziesiątek MB, wpis w buforze to lekki obiekt
(`__slots__`, bajty zamiast zapisu szesnastkowego, bez rozwiniętej listy pól).
Pełny słownik — z polami i danymi strukturalnymi — powstaje dopiero dla tych
wpisów, które panel faktycznie pokazuje (`unpack`). Panel nie dostaje całego
bufora: pyta o stronę grup pakietów (`SnifferLog.query`) albo o przyrost
(`entries_since`), a grupowanie i filtrowanie robi serwer.
"""

from __future__ import annotations

import base64
import binascii
import sys
import threading
import time
from bisect import bisect_right
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .aiomeshtastic.protobuf import portnums_pb2
from .sniffer_decode import (
    ChannelKeys,
    decode_payload,
    decode_structured,
    hash_matches,
    printable_preview,
    try_decrypt,
)

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping

# Dozwolone wielkości bufora (wybór w panelu); domyślnie największy.
CAPACITY_CHOICES = (5000, 10000, 25000)
DEFAULT_CAPACITY = 25000
MAX_ENTRIES = DEFAULT_CAPACITY  # zgodność wstecz: górna granica bufora
MAX_PAYLOAD_BYTES = 256  # tyle bajtów trafia do podglądu hex
STORED_PAYLOAD_BYTES = 512  # tyle bajtów trzymamy w buforze (do ponownego zdekodowania)
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


def _build(  # noqa: PLR0913, PLR0915
    packet: Mapping[str, Any],
    seq: int,
    now_ms: int,
    local_node: int | None,
    *,
    source: str = "radio",
    keys: list[Mapping[str, Any]] | None = None,
) -> tuple[dict[str, Any], bytes]:
    """Zamień pakiet (MessageToDict z API albo z MQTT) na wpis logu (+ bajty do ponownego zdekodowania).

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
    request_id = decoded.get("requestId") if isinstance(decoded.get("requestId"), int) else 0

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
            request_id = int(data.request_id)
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

    entry = {
        "seq": seq,
        "ts": now_ms,
        "from": sender,
        "to": destination,
        "id": packet.get("id"),
        # ID pakietu, na który ten odpowiada (0 = to nie odpowiedź) — odróżnia odpowiedź traceroute od zapytania
        "request_id": request_id,
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
    return entry, payload


def build_entry(
    packet: Mapping[str, Any],
    seq: int,
    now_ms: int,
    local_node: int | None,
    *,
    source: str = "radio",
    keys: list[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Pełny słownik wpisu (kształt jak zawsze) — patrz `_build`."""
    return _build(packet, seq, now_ms, local_node, source=source, keys=keys)[0]




# ── lekki wpis w buforze ──────────────────────────────────────────────────

F_ENCRYPTED = 1
F_WANT_ACK = 2
F_VIA_MQTT = 4
F_SIGNED = 8
F_PKI = 16
F_FROM_US = 32
F_TO_US = 64
F_PKI_LIKELY = 128
F_DECODED = 256  # pakiet jawny (albo odszyfrowany) z treścią — payload da się zdekodować
F_FIELDS = 512  # dekoder oddał niepustą listę pól (potrzebne do wyboru „głównego” odbioru grupy)

_FLAG_KEYS = (
    ("encrypted", F_ENCRYPTED),
    ("want_ack", F_WANT_ACK),
    ("via_mqtt", F_VIA_MQTT),
    ("signed", F_SIGNED),
    ("pki", F_PKI),
    ("from_us", F_FROM_US),
    ("to_us", F_TO_US),
    ("pki_likely", F_PKI_LIKELY),
)

MAX_MORE = 400
GROUP_WINDOW_MS = 10 * 60 * 1000  # ten sam (nadawca, ID) po tylu ms to już inny pakiet
MAX_RECEPTIONS_OUT = 100
MAX_FILTER_NODES = 5000
INDEX_CACHE_SIZE = 3
INDEX_IDLE_SECONDS = 180

_SHARED: dict[Any, Any] = {}  # współdzielone, niezmienne obiekty (krotki nazw kanałów itp.)


def _shared(value: Any) -> Any:
    """Jeden egzemplarz równych krotek — setki tysięcy wpisów nie niosą własnych kopii."""
    if value is None:
        return None
    return _SHARED.setdefault(value, value)


_LOWER: dict[str, str] = {}
_BROADCAST_WORDS = "broadcast wszyscy everyone"


def _lower(value: str) -> str:
    """Małe litery z pamięci podręcznej — nazw portów, bram i kanałów jest garstka, a wpisów tysiące."""
    lowered = _LOWER.get(value)
    if lowered is None:
        lowered = _LOWER[value] = value.lower()
    return lowered


def _intern(value: Any) -> Any:
    return sys.intern(value) if isinstance(value, str) else value


class _Rec:
    """Wpis bufora: tylko to, czego nie da się policzyć z reszty (patrz `unpack`)."""

    __slots__ = (
        "channel",
        "dec_with",
        "flags",
        "frm",
        "gateway",
        "hash_matches",
        "hop_limit",
        "hop_start",
        "info",
        "more",
        "mqtt_channel",
        "payload",
        "pid",
        "port",
        "port_num",
        "relay",
        "request_id",
        "rssi",
        "seq",
        "size",
        "snr",
        "source",
        "to",
        "ts",
    )


def _search_extra(fields: list[dict[str, Any]], info: str) -> str | None:
    """Tekst do wyszukiwania spoza `info`: pełna treść, nazwy i numery węzłów z tras / sąsiadów."""
    parts: list[str] = []
    for item in fields:
        value = item.get("v")
        kind = item.get("t")
        if kind == "nodes":
            parts.extend(f"!{node & 0xFFFFFFFF:08x}" for node in value or [])
        elif kind == "neighbors":
            parts.extend(f"!{entry['node'] & 0xFFFFFFFF:08x}" for entry in value or [])
        elif kind == "node" and isinstance(value, int):
            parts.append(f"!{value & 0xFFFFFFFF:08x}")
        elif isinstance(value, str) and value and value not in info:
            parts.append(value)
    text = " ".join(parts)[:MAX_MORE].lower()
    return text or None


def pack(entry: Mapping[str, Any], decode_bytes: bytes) -> _Rec:
    """Słownik z `build_entry` → lekki wpis. Pola i `payload_hex` powstają dopiero przy `unpack`."""
    rec = _Rec()
    rec.seq = entry["seq"]
    rec.ts = entry["ts"]
    rec.frm = entry["from"]
    rec.to = BROADCAST if entry["to"] == BROADCAST else entry["to"]
    rec.pid = entry["id"]
    rec.request_id = entry.get("request_id") or 0
    rec.channel = entry["channel"]
    rec.port = _intern(entry["port"])
    rec.port_num = entry["port_num"]
    # `info` w buforze służy już tylko do wyszukiwania (przy pokazaniu liczymy go z treści), więc małymi literami
    rec.info = (entry["info"] or "").lower()
    fields = entry["fields"]
    rec.more = _search_extra(fields, entry["info"] or "") if fields else None
    flags = 0
    for key, bit in _FLAG_KEYS:
        if entry[key]:
            flags |= bit
    if entry["port"] not in ("ENCRYPTED", "PKI") and not flags & F_ENCRYPTED and decode_bytes:
        flags |= F_DECODED
    if fields:
        flags |= F_FIELDS
    rec.flags = flags
    rec.source = _intern(entry["source"])
    rec.gateway = _intern(entry["gateway"])
    rec.mqtt_channel = _intern(entry["mqtt_channel_name"])
    dec = entry["decrypted_with"]
    rec.dec_with = _shared((dec["name"], dec["source"], bool(dec["plain"]))) if dec else None
    rec.hash_matches = _shared(tuple(entry["channel_hash_matches"])) if entry["channel_hash_matches"] else None
    # Bajty trzymamy raz. Dla pakietu odczytanego to treść do ponownego zdekodowania, dla
    # nieodczytanego — zaszyfrowane bajty; hex i podgląd ASCII liczymy dopiero przy pokazaniu.
    raw = decode_bytes if flags & F_DECODED else bytes.fromhex(entry["payload_hex"])
    rec.payload = raw[:STORED_PAYLOAD_BYTES]
    rec.size = entry["payload_size"]
    rec.snr = entry["rx_snr"]
    rec.rssi = entry["rx_rssi"]
    rec.hop_limit = entry["hop_limit"]
    rec.hop_start = entry["hop_start"]
    rec.relay = entry["relay_node"]
    return rec


def _hops_away(rec: _Rec) -> int | None:
    if isinstance(rec.hop_start, int) and rec.hop_start > 0 and isinstance(rec.hop_limit, int):
        return rec.hop_start - rec.hop_limit
    return None


def unpack(rec: _Rec, *, detail: bool = True) -> dict[str, Any]:
    """Lekki wpis → pełny słownik w kształcie `build_entry` (+ `detail` z danymi strukturalnymi)."""
    flags = rec.flags
    info, fields = "", []
    structured = None
    if flags & F_DECODED and rec.port_num is not None and rec.payload:
        info, fields = decode_payload(rec.port_num, rec.payload)
        if detail:
            structured = decode_structured(
                rec.port_num, rec.payload, sender=rec.frm, dest=rec.to, reply=bool(rec.request_id)
            )
    raw = rec.payload
    still_encrypted = bool(flags & F_ENCRYPTED)
    dec = rec.dec_with
    entry: dict[str, Any] = {
        "seq": rec.seq,
        "ts": rec.ts,
        "from": rec.frm,
        "to": rec.to,
        "id": rec.pid,
        "request_id": rec.request_id,
        "channel": rec.channel,
        "port": rec.port,
        "port_num": rec.port_num,
        "info": info or rec.info,
        "fields": fields,
        "encrypted": still_encrypted,
        "decrypted_with": {"name": dec[0], "source": dec[1], "plain": dec[2]} if dec else None,
        "channel_hash_matches": list(rec.hash_matches) if rec.hash_matches else [],
        "pki_likely": bool(flags & F_PKI_LIKELY),
        "payload_hex": raw[:MAX_PAYLOAD_BYTES].hex(),
        "payload_ascii": printable_preview(raw) if (still_encrypted or not fields) and raw else "",
        "payload_size": rec.size,
        "rx_snr": rec.snr,
        "rx_rssi": rec.rssi,
        "hop_limit": rec.hop_limit,
        "hop_start": rec.hop_start,
        "hops_away": _hops_away(rec),
        "relay_node": rec.relay,
        "want_ack": bool(flags & F_WANT_ACK),
        "via_mqtt": bool(flags & F_VIA_MQTT),
        "signed": bool(flags & F_SIGNED),
        "pki": bool(flags & F_PKI),
        "broadcast": rec.to == BROADCAST,
        "from_us": bool(flags & F_FROM_US),
        "to_us": bool(flags & F_TO_US),
        "source": rec.source,
        "mqtt_channel_name": rec.mqtt_channel,
        "gateway": rec.gateway,
    }
    if detail:
        entry["detail"] = structured
    return entry


def reception(rec: _Rec) -> dict[str, Any]:
    """Odbiór w grupie: tylko to, co różni kolejne odbiory tego samego pakietu."""
    return {
        "seq": rec.seq,
        "ts": rec.ts,
        "from": rec.frm,
        "source": rec.source,
        "gateway": rec.gateway,
        "relay_node": rec.relay,
        "hop_limit": rec.hop_limit,
        "hop_start": rec.hop_start,
        "hops_away": _hops_away(rec),
        "rx_snr": rec.snr,
        "rx_rssi": rec.rssi,
        "encrypted": bool(rec.flags & F_ENCRYPTED),
        "via_mqtt": bool(rec.flags & F_VIA_MQTT),
        "mqtt_channel_name": rec.mqtt_channel,
    }


# ── filtr i grupowanie ────────────────────────────────────────────────────


@dataclass(frozen=True)
class SnifferFilter:
    """Filtr z panelu: tekst + węzły i porty, których nazwy pasują do tekstu (nazwy zna tylko panel)."""

    text: str = ""
    node_ids: frozenset[int] = field(default_factory=frozenset)
    ports: frozenset[str] = field(default_factory=frozenset)
    source: str = "all"
    # czy tekst może być (fragmentem) numeru węzła w zapisie szesnastkowym — tylko wtedy liczymy "!%08x"
    hexish: bool = field(init=False, compare=False, default=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "hexish", bool(self.text.lstrip("!")) and all(ch in "0123456789abcdef" for ch in self.text.lstrip("!")))

    @classmethod
    def make(
        cls, text: str = "", node_ids: Iterable[int] = (), ports: Iterable[str] = (), source: str = "all"
    ) -> SnifferFilter:
        return cls(
            (text or "").strip().lower(),
            frozenset(int(n) & 0xFFFFFFFF for n in list(node_ids)[:MAX_FILTER_NODES]),
            frozenset(str(p) for p in list(ports)[:200]),
            source if source in ("radio", "mqtt") else "all",
        )

    def matches(self, rec: _Rec) -> bool:
        if self.source != "all" and (rec.source or "radio") != self.source:
            return False
        needle = self.text
        if not needle:
            return True
        if rec.port in self.ports:
            return True
        frm = rec.frm & 0xFFFFFFFF if isinstance(rec.frm, int) else None
        to = rec.to & 0xFFFFFFFF if isinstance(rec.to, int) else None
        if (frm is not None and frm in self.node_ids) or (to is not None and to in self.node_ids):
            return True
        if needle in rec.info or (rec.more is not None and needle in rec.more):
            return True
        if rec.port and needle in _lower(rec.port):
            return True
        if rec.gateway and needle in _lower(rec.gateway):
            return True
        if rec.mqtt_channel and needle in _lower(rec.mqtt_channel):
            return True
        if rec.pid is not None and needle.isdigit() and needle in str(rec.pid):
            return True
        if rec.to == BROADCAST and needle in _BROADCAST_WORDS:
            return True
        if self.hexish:
            # "!a1b2c3d4" albo jego fragment — numer węzła nadawcy lub odbiorcy
            return (frm is not None and needle.lstrip("!") in f"{frm:08x}") or (
                to is not None and needle.lstrip("!") in f"{to:08x}"
            )
        return False


def _better(current: _Rec | None, candidate: _Rec) -> _Rec:
    """Lepszy odbiór do pokazania na karcie: odczytany wygrywa z zaszyfrowanym (jak w panelu)."""
    if current is None:
        return candidate
    cur_enc = bool(current.flags & F_ENCRYPTED)
    cand_enc = bool(candidate.flags & F_ENCRYPTED)
    if cur_enc and not cand_enc:
        return candidate
    if not current.flags & F_FIELDS and candidate.flags & F_FIELDS and not cand_enc:
        return candidate
    if not current.info and candidate.info and cur_enc == cand_enc:
        return candidate
    return current


def _packet_key(rec: _Rec) -> tuple[int, int] | None:
    if rec.pid and rec.frm is not None:
        return (rec.frm & 0xFFFFFFFF, rec.pid & 0xFFFFFFFF)
    return None


class _GroupIndex:
    """
    Grupy pakietów dla jednego filtra, uzupełniane przyrostowo.

    Grupa = odbiory tego samego pakietu (nadawca + ID w oknie 10 min); bez
    grupowania każdy odbiór to osobna grupa. Indeks trzyma tylko wskaźniki na
    wpisy i dopisuje nowe — pełne przeliczenie następuje przy zmianie filtra,
    czyszczeniu albo zmianie rozmiaru bufora.
    """

    def __init__(self, flt: SnifferFilter, *, grouped: bool, epoch: int) -> None:
        self.flt = flt
        self.grouped = grouped
        self.epoch = epoch
        self.groups: list[list[_Rec]] = []
        self.first_seqs: list[int] = []
        self.by_key: dict[tuple[int, int], list[_Rec]] = {}
        self.scanned = 0
        self.start = 0
        self.compacted_at = 0
        self.used = time.monotonic()

    def update(self, log: SnifferLog) -> None:
        self.used = time.monotonic()
        flt, grouped = self.flt, self.grouped
        seq_before = log.last_seq  # czytamy przed migawką: nic spoza migawki nie zostanie „przeskoczone”
        snapshot = log.snapshot()
        if not snapshot:
            self.scanned = max(self.scanned, seq_before)
            self._evict(seq_before + 1)
            return
        fresh = snapshot[max(0, self.scanned + 1 - snapshot[0].seq) :] if self.scanned < snapshot[-1].seq else ()
        for rec in fresh:
            self.scanned = rec.seq
            if not flt.matches(rec):
                continue
            key = _packet_key(rec) if grouped else None
            group = self.by_key.get(key) if key is not None else None
            if group is not None and rec.ts - group[-1].ts <= GROUP_WINDOW_MS:
                group.append(rec)
                continue
            group = [rec]
            self.groups.append(group)
            self.first_seqs.append(rec.seq)
            if key is not None:
                self.by_key[key] = group
        self._evict(snapshot[0].seq)

    def _evict(self, first_seq: int) -> None:
        groups = self.groups
        while self.start < len(groups) and groups[self.start][-1].seq < first_seq:
            self.start += 1
        # co jakiś czas przepisz grupy bez wpisów, które bufor już wypchnął
        if first_seq - self.compacted_at > 2500 or self.start > 5000:
            self.compacted_at = first_seq
            kept: list[list[_Rec]] = []
            for group in groups[self.start :]:
                if group[-1].seq < first_seq:
                    continue
                if group[0].seq < first_seq:
                    group = [rec for rec in group if rec.seq >= first_seq]  # noqa: PLW2901
                kept.append(group)
            self.groups = kept
            self.first_seqs = [group[0].seq for group in kept]
            self.start = 0
            self.by_key = {}
            if self.grouped:
                for group in kept:
                    key = _packet_key(group[0])
                    if key is not None:
                        self.by_key[key] = group


def _group_out(members: list[_Rec], upto: int) -> dict[str, Any]:
    if members[-1].seq > upto:
        members = [rec for rec in members if rec.seq <= upto]
    main: _Rec | None = None
    for rec in members:
        main = _better(main, rec)
    assert main is not None  # noqa: S101
    first = members[0]
    pkey = _packet_key(first)
    radio = sum(1 for rec in members if (rec.source or "radio") == "radio")
    gateways = {rec.gateway or "?" for rec in members if rec.source == "mqtt"}
    return {
        "key": f"{pkey[0]}:{pkey[1]}:{first.seq}" if pkey else f"seq:{first.seq}",
        "first_seq": first.seq,
        "last_seq": members[-1].seq,
        "first_ts": first.ts,
        "last_ts": members[-1].ts,
        "n": len(members),
        "radio": radio,
        "gateways": len(gateways),
        "main": unpack(main),
        "receptions": [reception(rec) for rec in members[:MAX_RECEPTIONS_OUT]],
    }


# ── bufor ─────────────────────────────────────────────────────────────────


class SnifferLog:
    """Bufor pierścieniowy wpisów i to, co wiemy o stanie sniffera na radiu."""

    def __init__(self, capacity: int = DEFAULT_CAPACITY) -> None:
        # None = nie wiemy: stan sniffera jest tylko w RAM radia, więc po
        # restarcie integracji trzeba go zapytać, zanim zaczniemy zbierać.
        self.enabled: bool | None = None
        self.fw_plus_version: int | None = None
        # brak odpowiedzi na pytanie o FW+ pamiętamy przez jakiś czas (patrz websocket_api)
        self.fw_plus_error: str | None = None
        self.fw_plus_checked_at = 0.0
        self.capacity = capacity
        self._entries: deque[_Rec] = deque(maxlen=capacity)
        self._seq = 0
        # zmienia się, gdy indeksy grup trzeba przeliczyć od zera (czyszczenie, zmiana rozmiaru)
        self._epoch = 0
        self._indexes: OrderedDict[tuple[Any, ...], _GroupIndex] = OrderedDict()
        # zapytania panelu wolno liczyć w wątku roboczego (patrz sniffer_ws); ten zamek je szereguje
        self._query_lock = threading.RLock()
        self.mqtt_enabled = False
        # klucze do odszyfrowania pakietów z obcych kanałów (ustawiane przez magazyn)
        self.channel_keys: ChannelKeys | None = None

    def _keys(self) -> list[Mapping[str, Any]] | None:
        return self.channel_keys.keys() if self.channel_keys is not None else None

    @property
    def last_seq(self) -> int:
        return self._seq

    @property
    def first_seq(self) -> int:
        """Numer najstarszego wpisu w buforze (last_seq + 1, gdy bufor jest pusty)."""
        return self._entries[0].seq if self._entries else self._seq + 1

    @property
    def count(self) -> int:
        return len(self._entries)

    def _append(self, packet: Mapping[str, Any], now_ms: int, local_node: int | None, source: str) -> None:
        # numer rośnie dopiero po udanym zbudowaniu wpisu — numeracja w buforze musi być ciągła
        seq = self._seq + 1
        entry, decode_bytes = _build(packet, seq, now_ms, local_node, source=source, keys=self._keys())
        self._entries.append(pack(entry, decode_bytes))
        self._seq = seq

    def add_packet(self, packet: Mapping[str, Any], now_ms: int, local_node: int | None) -> None:
        if not self.enabled:
            return
        self._append(packet, now_ms, local_node, "radio")

    def add_mqtt_packet(self, packet: Mapping[str, Any], now_ms: int, local_node: int | None) -> None:
        if not self.mqtt_enabled:
            return
        self._append(packet, now_ms, local_node, "mqtt")

    def set_capacity(self, capacity: int) -> int:
        """Zmień rozmiar bufora; zmniejszenie usuwa najstarsze wpisy. Zwraca liczbę usuniętych."""
        capacity = int(capacity)
        if capacity == self.capacity:
            return 0
        before = len(self._entries)
        keep = list(self._entries)[-capacity:]
        self.capacity = capacity
        self._entries = deque(keep, maxlen=capacity)
        self._reset_indexes()
        return before - len(keep)

    # ── odczyt ──

    def snapshot(self) -> list[_Rec]:
        """Migawka bufora (jedno atomowe skopiowanie) — bezpieczna dla wątku roboczego."""
        return list(self._entries)

    def records_after(self, seq: int) -> list[_Rec]:
        """Wpisy o numerze większym niż seq (od najstarszego); numeracja w buforze jest ciągła."""
        snapshot = self.snapshot()
        if not snapshot or seq >= snapshot[-1].seq:
            return []
        return snapshot[max(0, seq + 1 - snapshot[0].seq) :]

    def entries_since(self, seq: int = 0, limit: int = DEFAULT_CAPACITY) -> list[dict[str, Any]]:
        """Wpisy nowsze niż seq (od najstarszego); przy nadmiarze — najnowsze limit wpisów."""
        if limit <= 0:
            return []
        recs = self.records_after(seq)
        if limit < len(recs):
            recs = recs[-limit:]
        return [unpack(rec) for rec in recs]

    def _reset_indexes(self) -> None:
        # nowy słownik zamiast czyszczenia: trwające zapytanie dokończy na starym
        self._epoch += 1
        self._indexes = OrderedDict()

    def _index(self, flt: SnifferFilter, *, grouped: bool) -> _GroupIndex:
        now = time.monotonic()
        for key in [k for k, idx in self._indexes.items() if now - idx.used > INDEX_IDLE_SECONDS]:
            del self._indexes[key]
        key = (flt, grouped, self._epoch)
        index = self._indexes.get(key)
        if index is None:
            index = _GroupIndex(flt, grouped=grouped, epoch=self._epoch)
            self._indexes[key] = index
            while len(self._indexes) > INDEX_CACHE_SIZE:
                self._indexes.popitem(last=False)
        else:
            self._indexes.move_to_end(key)
        index.update(self)
        return index

    def query(
        self,
        flt: SnifferFilter,
        *,
        grouped: bool = True,
        upto: int | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> dict[str, Any]:
        """
        Strona grup pakietów, od najnowszej. `upto` zamraża widok na numerze wpisu
        (przewijanie wstecz bez przesuwania się listy); None = najnowszy stan.
        """
        with self._query_lock:
            index = self._index(flt, grouped=grouped)
            latest = index.scanned
            effective = latest if upto is None else min(max(upto, 0), latest)
            cut = bisect_right(index.first_seqs, effective, lo=index.start)
            total = cut - index.start
            offset = max(0, offset)
            page = [
                _group_out(index.groups[cut - 1 - position], effective)
                for position in range(offset, min(total, offset + max(0, limit)))
            ]
            receptions = sum(map(len, index.groups[index.start : cut])) if total else 0
        return {
            "groups": page,
            "total": total,
            "receptions": receptions,
            "upto": effective,
            "last_seq": latest,
            "offset": offset,
        }

    def export_page(self, flt: SnifferFilter, after_seq: int = 0, limit: int = 1000) -> dict[str, Any]:
        """
        Kolejna porcja surowych wpisów (każdy odbiór osobno, od najstarszego) do eksportu.
        `next` to numer, od którego kontynuować; `done` — czy to koniec bufora.
        """
        out: list[dict[str, Any]] = []
        position = after_seq
        done = True
        for rec in self.records_after(after_seq):  # migawka — nie potrzeba zamka
            if len(out) >= limit:
                done = False
                break
            position = rec.seq
            if flt.matches(rec):
                out.append(unpack(rec, detail=False))
        return {"entries": out, "next": position, "done": done, "last_seq": self._seq}

    def clear(self) -> None:
        # numeracja idzie dalej, żeby odpytujący panel nie pomylił wpisów
        self._entries.clear()
        self._reset_indexes()
