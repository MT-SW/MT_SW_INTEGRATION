# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""
Rozszerzenia telemetrii spoza oryginalnych protobufów Meshtastic.

Firmware MT_SW wysyła w Telemetry dodatkowy wariant ``local_stats_extended``
(pole nr 20: CPU, flash, pamięć, PSRAM). Oryginalne protobufy go nie znają, ale
protobuf zachowuje nieznane pola przy parsowaniu i serializacji, więc dekodujemy
je ręcznie z formatu drutowego i dokładamy do słownika w takiej samej postaci,
jaką dawał MessageToDict przy protobufach z forka (klucze camelCase, pominięte
wartości zerowe). Dzięki temu reszta integracji nie wymaga zmian.
"""

from typing import Any

from google.protobuf import json_format
from google.protobuf.message import Message

from .protobuf import telemetry_pb2

LOCAL_STATS_EXTENDED_FIELD = 20

_LOCAL_STATS_EXTENDED_KEYS = {
    1: "memoryFreeCheap",
    2: "memoryTotal",
    3: "cpuUsagePercent",
    4: "flashUsedBytes",
    5: "flashTotalBytes",
    6: "memoryPsramFree",
    7: "memoryPsramTotal",
}

_WIRE_VARINT = 0
_WIRE_64BIT = 1
_WIRE_LENGTH_DELIMITED = 2
_WIRE_32BIT = 5


def _read_varint(data: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if pos >= len(data) or shift > 63:  # noqa: PLR2004
            msg = "truncated varint"
            raise ValueError(msg)
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def _iter_wire_fields(data: bytes):  # noqa: ANN202
    """Iteruj po polach w formacie drutowym: (numer pola, typ, wartość)."""
    pos = 0
    while pos < len(data):
        key, pos = _read_varint(data, pos)
        number, wire_type = key >> 3, key & 0x07
        if wire_type == _WIRE_VARINT:
            value, pos = _read_varint(data, pos)
        elif wire_type == _WIRE_64BIT:
            value, pos = data[pos : pos + 8], pos + 8
        elif wire_type == _WIRE_LENGTH_DELIMITED:
            length, pos = _read_varint(data, pos)
            value, pos = data[pos : pos + length], pos + length
        elif wire_type == _WIRE_32BIT:
            value, pos = data[pos : pos + 4], pos + 4
        else:
            msg = f"unsupported wire type {wire_type}"
            raise ValueError(msg)
        if pos > len(data):
            msg = "truncated field"
            raise ValueError(msg)
        yield number, wire_type, value


def decode_local_stats_extended(telemetry: Message) -> dict[str, int] | None:
    """Wyciągnij LocalStatsExtended z nieznanych pól Telemetry (None, gdy pakiet go nie zawiera)."""
    try:
        payload = None
        for number, wire_type, value in _iter_wire_fields(telemetry.SerializeToString()):
            if number == LOCAL_STATS_EXTENDED_FIELD and wire_type == _WIRE_LENGTH_DELIMITED:
                payload = value
        if payload is None:
            return None

        result: dict[str, int] = {}
        for number, wire_type, value in _iter_wire_fields(payload):
            key = _LOCAL_STATS_EXTENDED_KEYS.get(number)
            if key is not None and wire_type == _WIRE_VARINT and value:
                result[key] = value & 0xFFFFFFFF  # uint32
    except (ValueError, IndexError):
        return None
    return result


def telemetry_to_dict(telemetry: Message) -> dict[str, Any]:
    """MessageToDict dla Telemetry razem z rozszerzeniem MT_SW (localStatsExtended)."""
    result = json_format.MessageToDict(telemetry)
    extended = decode_local_stats_extended(telemetry)
    if extended is not None:
        result["localStatsExtended"] = extended
    return result


def message_to_dict(message: Message) -> dict[str, Any]:
    """MessageToDict, który dla Telemetry uwzględnia rozszerzenia MT_SW."""
    if isinstance(message, telemetry_pb2.Telemetry):
        return telemetry_to_dict(message)
    return json_format.MessageToDict(message)
