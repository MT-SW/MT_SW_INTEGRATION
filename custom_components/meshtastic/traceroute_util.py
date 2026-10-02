"""
Wynik traceroute w postaci gotowej do narysowania na mapie.

RouteDiscovery niesie same przeskoki pośrednie (route / routeBack) oraz SNR
każdego odcinka (snrTowards / snrBack, w czwartych częściach decybela,
-128 = nieznany). Obu końców trasy w nim nie ma — pochodzą z nagłówka pakietu.
Tak samo jak aplikacja na Androida doklejamy je tutaj, w jednym miejscu,
żeby ŚWIEŻY wynik i wpis zapisany w historii miały dokładnie ten sam kształt
(trasa + SNR + oba końce) i panel nie musiał zgadywać.

Moduł nie importuje niczego z Home Assistanta ani z warstwy statystyk —
to czysta transformacja słownika.
"""

from __future__ import annotations

from typing import Any

UNKNOWN_SNR = -128


def _int_list(value: Any) -> list[int]:
    """Lista liczb całkowitych; wszystko inne (brak pola, None) to pusta lista."""
    if not isinstance(value, (list, tuple)):
        return []
    out: list[int] = []
    for item in value:
        try:
            out.append(int(item))
        except (TypeError, ValueError):
            out.append(UNKNOWN_SNR)
    return out


def modem_preset_name(local_config: Any) -> str | None:
    """
    Nazwa presetu modemu bramki (np. "LONG_FAST") albo None, gdy bramka nie
    używa presetu / konfiguracja jest niedostępna — wtedy panel liczy jakość
    sygnału dla domyślnego presetu, jak aplikacja przy `null`.
    """
    lora = getattr(local_config, "lora", None)
    if lora is None:
        return None
    try:
        if not lora.use_preset:
            return None
        preset = lora.modem_preset
        if isinstance(preset, int):
            from .aiomeshtastic.protobuf import config_pb2  # noqa: PLC0415

            return config_pb2.Config.LoRaConfig.ModemPreset.Name(preset)
        return str(preset)
    except Exception:  # noqa: BLE001 - konfiguracja jest best-effort, nie może zepsuć traceroute
        return None


def normalize_traceroute(
    raw: dict[str, Any],
    *,
    origin: int | None,
    destination: int | None,
    modem_preset: str | None = None,
) -> dict[str, Any]:
    """
    Zwróć kopię wyniku z gwarantowanymi polami trasy i SNR.

    Dodaje: origin, destination, fullRoute (origin + route + destination),
    fullRouteBack (destination + routeBack + origin; pusta, gdy odpowiedź nie
    niosła ani trasy, ani SNR powrotu) oraz modemPreset. Oryginalne pola
    (route, routeBack, snrTowards, snrBack) zostają, ale zawsze jako listy.
    """
    result: dict[str, Any] = dict(raw)
    route = _int_list(raw.get("route"))
    route_back = _int_list(raw.get("routeBack"))
    snr_towards = _int_list(raw.get("snrTowards"))
    snr_back = _int_list(raw.get("snrBack"))

    result["route"] = route
    result["routeBack"] = route_back
    result["snrTowards"] = snr_towards
    result["snrBack"] = snr_back
    result["origin"] = origin
    result["destination"] = destination
    result["modemPreset"] = modem_preset

    if origin is not None and destination is not None:
        result["fullRoute"] = [origin, *route, destination]
        has_back = bool(route_back or snr_back)
        result["fullRouteBack"] = [destination, *route_back, origin] if has_back else []
    else:
        result["fullRoute"] = []
        result["fullRouteBack"] = []
    return result
