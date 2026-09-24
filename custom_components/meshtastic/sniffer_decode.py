# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Odszyfrowywanie i dekodowanie pakietów dla logu Sniffera.

Radio oddaje przez API odszyfrowane tylko te pakiety, które samo umie
odczytać. Sniffer pokazuje też pakiety z obcych kanałów — przychodzą jako
surowe `encrypted`. Tutaj:

1. **Odszyfrowanie** — dokładnie tak jak firmware: numer kanału w
   zaszyfrowanym pakiecie to 1-bajtowy hash (XOR bajtów nazwy kanału i
   bajtów klucza). Próbujemy tylko kluczy, których hash pasuje: kanały
   skonfigurowane w bramce oraz publiczne kanały domyślne (każdy preset
   modemu z domyślnym kluczem AQ==). Wynik musi się sparsować jako `Data`
   ze znanym portem — inaczej traktujemy go jak nieodszyfrowany (AES-CTR
   nie ma integralności, zły klucz daje po prostu śmieci).
2. **Dekodowanie treści** — jak Panel Debugowania / Sniffer Log w aplikacji:
   tekst, pozycja, NodeInfo, telemetria z wartościami, trasa traceroute z
   węzłami i SNR, sąsiedzi, routing, admin, waypoint, OnDemand itd. Wynik to
   krótki opis (`info`) i lista pól (`fields`) do rozwinięcia w panelu.
3. **Gdy się nie da** — zostaje to, co widać: hash kanału z nazwami znanych
   kanałów, do których pasuje (np. „MediumFast — inny klucz”), informacja o
   szyfrowaniu PKI (wiadomość prywatna — nie da się jej odczytać bez klucza
   prywatnego odbiorcy), rozmiar i zrzut bajtów z podglądem ASCII.
"""

from __future__ import annotations

import base64
import binascii
import time
from typing import TYPE_CHECKING, Any

from google.protobuf.json_format import MessageToDict
from google.protobuf.message import DecodeError

from .aiomeshtastic import mesh_crypto
from .aiomeshtastic.protobuf import (
    admin_pb2,
    mesh_pb2,
    mqtt_pb2,
    ondemand_pb2,
    paxcount_pb2,
    portnums_pb2,
    storeforward_pb2,
    telemetry_pb2,
)
from .const import LOGGER, MODEM_PRESET_CHANNEL_NAMES

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping

ON_DEMAND_PORT = 354
MAX_TEXT = 500
MAX_INFO = 160
KEYS_REFRESH_SECONDS = 60

# publiczne nazwy kanałów domyślnych — także te ze starszych firmware
_PUBLIC_CHANNEL_NAMES = sorted({*MODEM_PRESET_CHANNEL_NAMES.values(), "VeryLongSlow", "LongModerate"})
_DEFAULT_KEY_PSK = b"\x01"  # AQ== — domyślny, publicznie znany klucz


# ── klucze ────────────────────────────────────────────────────────────────


def channel_hash(name: str, key: bytes) -> int:
    """Hash kanału jak w firmware (Channels::generateHash): XOR bajtów nazwy i klucza."""
    value = 0
    for byte in name.encode("utf-8"):
        value ^= byte
    for byte in key:
        value ^= byte
    return value & 0xFF


class ChannelKeys:
    """
    Znane klucze do odszyfrowania: kanały bramki + publiczne kanały domyślne.

    Lista jest odświeżana co minutę z konfiguracji radia (synchronicznie, z
    pamięci połączenia — bez pytania radia), więc zmiana kanałów w panelu
    wchodzi do sniffera bez restartu.
    """

    def __init__(self, get_interface: Callable[[], Any]) -> None:
        self._get_interface = get_interface
        self._keys: list[dict[str, Any]] = []
        self._loaded_at = 0.0

    def keys(self) -> list[dict[str, Any]]:
        now = time.monotonic()
        if not self._keys or now - self._loaded_at > KEYS_REFRESH_SECONDS:
            try:
                self._keys = self._build()
            except Exception:  # noqa: BLE001 - brak konfiguracji nie może zepsuć sniffera
                LOGGER.debug("Sniffer: nie udało się zbudować listy kluczy", exc_info=True)
                self._keys = self._public_keys()
            self._loaded_at = now
        return self._keys

    def _preset_name(self, interface: Any) -> str:
        try:
            lora = interface.connected_node_local_config().lora
            if not lora.use_preset:
                return "Custom"
            from .aiomeshtastic.protobuf import config_pb2  # noqa: PLC0415

            preset = config_pb2.Config.LoRaConfig.ModemPreset.Name(lora.modem_preset)
            return MODEM_PRESET_CHANNEL_NAMES.get(preset, "LongFast")
        except Exception:  # noqa: BLE001
            return "LongFast"

    def _build(self) -> list[dict[str, Any]]:
        keys: list[dict[str, Any]] = []
        seen: set[tuple[str, bytes]] = set()
        interface = self._get_interface()
        channels = interface.connected_node_channels() if interface is not None else None
        if channels:
            preset_name = self._preset_name(interface)
            for channel in channels:
                if channel.role == 0:  # DISABLED
                    continue
                name = channel.settings.name or preset_name
                key = mesh_crypto.expand_psk(bytes(channel.settings.psk))
                if key is None or (name, key) in seen:
                    continue
                seen.add((name, key))
                keys.append(
                    {"name": name, "key": key, "hash": channel_hash(name, key), "source": "gateway", "index": channel.index}
                )
        for public in self._public_keys():
            if (public["name"], public["key"]) not in seen:
                seen.add((public["name"], public["key"]))
                keys.append(public)
        return keys

    @staticmethod
    def _public_keys() -> list[dict[str, Any]]:
        key = mesh_crypto.expand_psk(_DEFAULT_KEY_PSK)
        return [
            {"name": name, "key": key, "hash": channel_hash(name, key), "source": "public", "index": None}
            for name in _PUBLIC_CHANNEL_NAMES
        ]


def _valid_data(raw: bytes) -> mesh_pb2.Data | None:
    """Odszyfrowany bufor jest wiarygodny tylko, gdy to poprawne Data ze znanym portem."""
    data = mesh_pb2.Data()
    try:
        data.ParseFromString(raw)
    except (DecodeError, ValueError):
        return None
    port = data.portnum
    if port == 0:
        return None
    if port != ON_DEMAND_PORT and port not in portnums_pb2.PortNum.values():
        return None
    return data


def try_decrypt(
    encrypted: bytes,
    packet_id: int | None,
    sender: int | None,
    channel: int | None,
    keys: Iterable[Mapping[str, Any]],
    *,
    name_hint: str | None = None,
) -> tuple[mesh_pb2.Data | None, Mapping[str, Any] | None]:
    """Spróbuj odszyfrować pakiet kluczami pasującymi do hasha kanału (albo nazwy z MQTT)."""
    if not encrypted or packet_id is None or sender is None:
        return None, None
    candidates = [
        key
        for key in keys
        if (channel is not None and key["hash"] == channel) or (name_hint and key["name"] == name_hint)
    ]
    for key in candidates:
        try:
            # klucz jest już rozwinięty (16/32 B), więc decrypt_payload użyje go wprost
            raw = mesh_crypto.decrypt_payload(encrypted, key["key"], packet_id, sender)
        except ValueError:
            continue
        data = _valid_data(raw)
        if data is not None:
            return data, key
    return None, None


def hash_matches(channel: int | None, keys: Iterable[Mapping[str, Any]]) -> list[str]:
    """Nazwy znanych kanałów, których hash zgadza się z numerem kanału pakietu."""
    if channel is None:
        return []
    return sorted({key["name"] for key in keys if key["hash"] == channel})


# ── dekodowanie treści ────────────────────────────────────────────────────


def _field(key: str, value: Any, kind: str | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {"k": key, "v": value}
    if kind:
        entry["t"] = kind
    return entry


def _dict_fields(message: Any, *, skip: Iterable[str] = ()) -> list[dict[str, Any]]:
    data = MessageToDict(message, preserving_proto_field_name=False)
    skipped = set(skip)
    fields = []
    for key, value in data.items():
        if key in skipped:
            continue
        if isinstance(value, float):
            value = round(value, 3)
        if isinstance(value, (dict, list)):
            value = str(value)
        fields.append(_field(key, value))
    return fields


def _coordinate(value_i: int) -> float:
    return round(value_i * 1e-7, 6)


def _decode_text(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    text = payload.decode("utf-8", errors="replace")[:MAX_TEXT]
    return text[:MAX_INFO], [_field("text", text)]


def _decode_position(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    position = mesh_pb2.Position()
    position.ParseFromString(payload)
    fields = []
    summary = ""
    if position.latitude_i or position.longitude_i:
        lat, lon = _coordinate(position.latitude_i), _coordinate(position.longitude_i)
        summary = f"{lat:.5f}, {lon:.5f}"
        fields += [_field("latitude", lat), _field("longitude", lon)]
    if position.altitude:
        summary += f" ({position.altitude} m)"
        fields.append(_field("altitude", f"{position.altitude} m"))
    for name in ("sats_in_view", "precision_bits", "ground_speed", "ground_track", "PDOP"):
        value = getattr(position, name, 0)
        if value:
            fields.append(_field(name, value))
    if position.time:
        fields.append(_field("time", position.time, "time"))
    return summary, fields


def _decode_nodeinfo(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    user = mesh_pb2.User()
    user.ParseFromString(payload)
    fields = [
        _field("id", user.id),
        _field("longName", user.long_name),
        _field("shortName", user.short_name),
        _field("hwModel", mesh_pb2.HardwareModel.Name(user.hw_model) if user.hw_model else "UNSET"),
    ]
    try:
        from .aiomeshtastic.protobuf import config_pb2  # noqa: PLC0415

        fields.append(_field("role", config_pb2.Config.DeviceConfig.Role.Name(user.role)))
    except ValueError:
        pass
    fields.append(_field("publicKey", "✓" if user.public_key else "—"))
    if user.is_licensed:
        fields.append(_field("isLicensed", "✓"))
    summary = f"{user.long_name} ({user.short_name})" if user.long_name else user.id
    return summary, fields


def _decode_telemetry(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    telemetry = telemetry_pb2.Telemetry()
    telemetry.ParseFromString(payload)
    variant = telemetry.WhichOneof("variant") or ""
    fields = [_field("variant", variant)]
    summary_parts = []
    if variant:
        sub = getattr(telemetry, variant)
        sub_fields = _dict_fields(sub)
        fields += sub_fields
        # krótki, niezależny od języka opis najważniejszych wartości
        for item in sub_fields:
            template = _TELEMETRY_SUMMARY.get(item["k"])
            if template:
                summary_parts.append(template.format(item["v"]))
        if not summary_parts:
            summary_parts = [f"{item['k']} {item['v']}" for item in sub_fields[:3]]
    if telemetry.time:
        fields.append(_field("time", telemetry.time, "time"))
    return " · ".join(summary_parts[:5]) if summary_parts else variant, fields


_TELEMETRY_SUMMARY = {
    "batteryLevel": "🔋 {}%",
    "voltage": "{} V",
    "channelUtilization": "ChUtil {}%",
    "airUtilTx": "AirTx {}%",
    "temperature": "{} °C",
    "relativeHumidity": "{} %RH",
    "barometricPressure": "{} hPa",
    "iaq": "IAQ {}",
    "numPacketsRx": "RX {}",
    "numPacketsTx": "TX {}",
    "numOnlineNodes": "online {}",
}


def _decode_routing(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    routing = mesh_pb2.Routing()
    routing.ParseFromString(payload)
    variant = routing.WhichOneof("variant")
    if variant == "error_reason":
        name = mesh_pb2.Routing.Error.Name(routing.error_reason)
        return name, [_field("errorReason", name, "routing_error")]
    if variant in ("route_request", "route_reply"):
        route = getattr(routing, variant)
        return variant, [_field("route", list(route.route), "nodes")]
    return variant or "", []


def _decode_traceroute(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    route = mesh_pb2.RouteDiscovery()
    route.ParseFromString(payload)
    fields = [_field("route", list(route.route), "nodes")]
    if route.snr_towards:
        fields.append(_field("snrTowards", [round(value / 4, 2) for value in route.snr_towards]))
    if route.route_back:
        fields.append(_field("routeBack", list(route.route_back), "nodes"))
    if route.snr_back:
        fields.append(_field("snrBack", [round(value / 4, 2) for value in route.snr_back]))
    return f"→ {len(route.route)} / ← {len(route.route_back)}", fields


def _decode_neighborinfo(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    info = mesh_pb2.NeighborInfo()
    info.ParseFromString(payload)
    neighbors = [{"node": neighbor.node_id, "snr": round(neighbor.snr, 2)} for neighbor in info.neighbors]
    fields = [_field("nodeId", info.node_id, "node"), _field("neighbors", neighbors, "neighbors")]
    if info.node_broadcast_interval_secs:
        fields.append(_field("broadcastInterval", f"{info.node_broadcast_interval_secs} s"))
    return f"{len(neighbors)} neighbors", fields


def _decode_admin(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    admin = admin_pb2.AdminMessage()
    admin.ParseFromString(payload)
    variant = admin.WhichOneof("payload_variant") or ""
    return variant, [_field("variant", variant)]


def _decode_waypoint(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    waypoint = mesh_pb2.Waypoint()
    waypoint.ParseFromString(payload)
    fields = [_field("name", waypoint.name)]
    if waypoint.description:
        fields.append(_field("description", waypoint.description))
    if waypoint.latitude_i or waypoint.longitude_i:
        fields += [
            _field("latitude", _coordinate(waypoint.latitude_i)),
            _field("longitude", _coordinate(waypoint.longitude_i)),
        ]
    if waypoint.expire:
        fields.append(_field("expire", waypoint.expire, "time"))
    return waypoint.name, fields


def _decode_ondemand(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    message = ondemand_pb2.OnDemand()
    message.ParseFromString(payload)
    variant = message.WhichOneof("variant")
    if variant == "request":
        name = ondemand_pb2.OnDemandType.Name(message.request.request_type)
        return name, [_field("request", name)]
    if variant == "response":
        name = ondemand_pb2.OnDemandType.Name(message.response.response_type)
        return name, [_field("response", name)]
    return "", []


def _proto_decoder(message_cls: Any) -> Callable[[bytes], tuple[str, list[dict[str, Any]]]]:
    def decode(payload: bytes) -> tuple[str, list[dict[str, Any]]]:
        message = message_cls()
        message.ParseFromString(payload)
        fields = _dict_fields(message)
        return ", ".join(f"{f['k']} {f['v']}" for f in fields[:3]), fields

    return decode


_DECODERS: dict[int, Callable[[bytes], tuple[str, list[dict[str, Any]]]]] = {
    portnums_pb2.PortNum.TEXT_MESSAGE_APP: _decode_text,
    portnums_pb2.PortNum.DETECTION_SENSOR_APP: _decode_text,
    portnums_pb2.PortNum.RANGE_TEST_APP: _decode_text,
    portnums_pb2.PortNum.ALERT_APP: _decode_text,
    portnums_pb2.PortNum.POSITION_APP: _decode_position,
    portnums_pb2.PortNum.NODEINFO_APP: _decode_nodeinfo,
    portnums_pb2.PortNum.TELEMETRY_APP: _decode_telemetry,
    portnums_pb2.PortNum.ROUTING_APP: _decode_routing,
    portnums_pb2.PortNum.TRACEROUTE_APP: _decode_traceroute,
    portnums_pb2.PortNum.NEIGHBORINFO_APP: _decode_neighborinfo,
    portnums_pb2.PortNum.ADMIN_APP: _decode_admin,
    portnums_pb2.PortNum.WAYPOINT_APP: _decode_waypoint,
    portnums_pb2.PortNum.MAP_REPORT_APP: _proto_decoder(mqtt_pb2.MapReport),
    portnums_pb2.PortNum.PAXCOUNTER_APP: _proto_decoder(paxcount_pb2.Paxcount),
    portnums_pb2.PortNum.STORE_FORWARD_APP: _proto_decoder(storeforward_pb2.StoreAndForward),
    ON_DEMAND_PORT: _decode_ondemand,
}


def printable_preview(payload: bytes) -> str:
    """Podgląd ASCII — znaki drukowalne, reszta jako kropki (jak w edytorach hex)."""
    return "".join(chr(byte) if 32 <= byte < 127 else "." for byte in payload[:128])


def decode_payload(port: int | None, payload: bytes) -> tuple[str, list[dict[str, Any]]]:
    """
    Krótki opis i pola treści pakietu. Nieznany port albo uszkodzona treść
    dają to, co da się wyczytać: tekst, jeśli wygląda na tekst, albo nic
    (wtedy panel pokazuje zrzut bajtów z podglądem ASCII).
    """
    if port is None or not payload:
        return "", []
    decoder = _DECODERS.get(port)
    if decoder is not None:
        try:
            return decoder(payload)
        except Exception:  # noqa: BLE001 - uszkodzony albo obcy pakiet nie może zepsuć logu
            LOGGER.debug("Sniffer: nie udało się zdekodować portu %s", port, exc_info=True)
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        return "", []
    if text and all(ch.isprintable() or ch in "\r\n\t" for ch in text):
        return text[:MAX_INFO], [_field("text", text[:MAX_TEXT])]
    return "", []


def b64_bytes(value: Any) -> bytes:
    if not isinstance(value, str):
        return b""
    try:
        return base64.b64decode(value)
    except (binascii.Error, ValueError):
        return b""
