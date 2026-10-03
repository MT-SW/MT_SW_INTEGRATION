"""Pozycja własnego węzła (bramki) — rozwiązywanie z wielu źródeł.

Czysty moduł (bez zależności od Home Assistanta) — łatwy do przetestowania.

Radio nie odsyła nam własnych rozgłoszeń, a jego wpis NodeInfo w zrzucie
konfiguracji bywa bez pozycji (jeszcze nie ma fixu GPS) albo ma ją pod
innym kluczem. Dlatego pozycję bramki szukamy w kolejności:

1. ``node_db``        — wpis bramki w bazie węzłów (latitudeI/longitudeI albo latitude/longitude),
2. ``own_packet``     — ostatni pakiet POSITION_APP od własnego węzła widziany na łączu
                        (także from=0 = „od nas” i kopia z proxy MQTT),
3. ``fixed_position`` — pozycja stała ustawiona na radiu (przez tę integrację),
4. ``persisted``      — ostatnia dobra pozycja zapisana na dysku (przeżywa restart).

Dobrej pozycji nigdy nie nadpisujemy pustą.
"""

from __future__ import annotations

import base64
from typing import Any

SOURCE_NODE_DB = "node_db"
SOURCE_OWN_PACKET = "own_packet"
SOURCE_FIXED = "fixed_position"
SOURCE_PERSISTED = "persisted"
SOURCE_ORDER = (SOURCE_NODE_DB, SOURCE_OWN_PACKET, SOURCE_FIXED, SOURCE_PERSISTED)


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return number


def valid_coordinates(lat: Any, lon: Any) -> bool:
    """Poprawna para: skończona, w zakresie, nie 0/0 (tak samo jak w panelu)."""
    la, lo = _num(lat), _num(lon)
    if la is None or lo is None:
        return False
    return abs(la) <= 90 and abs(lo) <= 180 and not (la == 0 and lo == 0)


def _coordinate(position: Any, name: str) -> float | None:
    """Stopnie z latitude/longitude albo latitudeI/longitudeI (*1e-7); obsługuje też snake_case."""
    if not isinstance(position, dict):
        return None
    direct = _num(position.get(name))
    if direct is not None:
        # niektóre ścieżki podają całkowite *1e7 pod kluczem bez „I”
        if abs(direct) > 180 and float(direct).is_integer():
            return round(direct * 1e-7, 7)
        return direct
    for key in (f"{name}I", f"{name}_i", f"{name}_I"):
        scaled = _num(position.get(key))
        if scaled is not None:
            return round(scaled * 1e-7, 7)
    return None


def normalize_position(position: Any) -> dict[str, Any] | None:
    """Znormalizowana pozycja {latitude, longitude, altitude?, time?} albo None, gdy niepoprawna."""
    if not isinstance(position, dict):
        return None
    lat = _coordinate(position, "latitude")
    lon = _coordinate(position, "longitude")
    if not valid_coordinates(lat, lon):
        return None
    result: dict[str, Any] = {"latitude": lat, "longitude": lon}
    altitude = _num(position.get("altitude"))
    if altitude is not None:
        result["altitude"] = int(round(altitude))
    stamp = _num(position.get("time"))
    if stamp:
        result["time"] = int(stamp)
    return result


def merge_position(old: Any, new: Any) -> dict[str, Any]:
    """Złącz pozycję z bazy węzłów z nową — dobrej pozycji nie nadpisujemy pustą.

    Nowa pozycja z poprawnymi współrzędnymi zastępuje starą w całości.
    Nowa bez współrzędnych (np. sam znacznik czasu) zachowuje stare współrzędne.
    """
    old_d = old if isinstance(old, dict) else {}
    new_d = new if isinstance(new, dict) else {}
    if normalize_position(new_d) is not None:
        return dict(new_d)
    if normalize_position(old_d) is None:
        return dict(new_d) if new_d else dict(old_d)
    merged = dict(old_d)
    for key, value in new_d.items():
        if key in ("latitude", "longitude", "latitudeI", "longitudeI"):
            continue  # puste/zerowe współrzędne nie kasują dobrych
        merged[key] = value
    return merged


def position_from_packet_dict(packet: Any) -> dict[str, Any] | None:
    """Pozycja z pakietu (MessageToDict MeshPacket) o porcie POSITION_APP — albo None."""
    if not isinstance(packet, dict):
        return None
    decoded = packet.get("decoded")
    if not isinstance(decoded, dict):
        return None
    if decoded.get("portnum") not in ("POSITION_APP", 3):
        return None
    inline = decoded.get("position")
    if isinstance(inline, dict):
        return normalize_position(inline)
    payload = decoded.get("payload")
    if not isinstance(payload, (str, bytes)):
        return None
    try:
        raw = base64.b64decode(payload) if isinstance(payload, str) else payload
        from .protobuf import mesh_pb2  # noqa: PLC0415 - leniwie, moduł testowalny bez protobufów
        from google.protobuf.json_format import MessageToDict  # noqa: PLC0415

        message = mesh_pb2.Position()
        message.ParseFromString(raw)
        return normalize_position(MessageToDict(message))
    except Exception:  # noqa: BLE001 - zły pakiet nie może nic zepsuć
        return None


def resolve_gateway_position(
    node: Any = None,
    own_packet: Any = None,
    fixed_position: Any = None,
    persisted: Any = None,
) -> tuple[dict[str, Any] | None, str | None]:
    """Zwróć (pozycja, źródło) według kolejności SOURCE_ORDER; (None, None) gdy nic nie ma."""
    node_position = node.get("position") if isinstance(node, dict) or hasattr(node, "get") else None
    candidates = (
        (SOURCE_NODE_DB, node_position),
        (SOURCE_OWN_PACKET, own_packet),
        (SOURCE_FIXED, fixed_position),
        (SOURCE_PERSISTED, persisted),
    )
    for source, candidate in candidates:
        normalized = normalize_position(dict(candidate) if hasattr(candidate, "keys") else candidate)
        if normalized is not None:
            return normalized, source
    return None, None
