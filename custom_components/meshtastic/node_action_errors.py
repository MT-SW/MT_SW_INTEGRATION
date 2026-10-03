"""Przyjazne, polskie komunikaty błędów akcji na węźle (request_position, traceroute...).

Czysty moduł (bez zależności od Home Assistanta) — łatwy do przetestowania.
Słownictwo za aplikacją Android (values-pl/strings.xml).
"""

from __future__ import annotations

# Meshtastic Routing.Error: wartość -> (kod maszynowy, komunikat PL, oczekiwany?)
# "oczekiwany" = zwykła porażka po stronie radia/sieci (nie błąd integracji):
# logujemy na DEBUG, bez stosu i bez wpisu w dzienniku HA jako błąd.
ROUTING_ERRORS: dict[int, tuple[str, str, bool]] = {
    1: ("routing_no_route", "Brak trasy do węzła docelowego w sieci mesh. Spróbuj ponownie, gdy więcej węzłów będzie dostępnych.", True),
    2: ("routing_got_nak", "Węzeł odrzucił tę wiadomość (NAK). Spróbuj ponownie.", True),
    3: ("routing_timeout", "Upłynął limit czasu — nie otrzymano potwierdzenia. Spróbuj ponownie, gdy będzie lepszy sygnał lub większy zasięg sieci mesh.", True),
    4: ("routing_no_interface", "Radio nie ma dostępnego interfejsu do wysłania tej wiadomości.", False),
    5: ("routing_max_retransmit", "Nie udało się dostarczyć do sieci mesh — żaden węzeł nie potwierdził wiadomości (przekroczono liczbę retransmisji). Spróbuj ponownie przy lepszym sygnale.", True),
    6: ("routing_no_channel", "Brak pasującego kanału/klucza do wysłania tej wiadomości (nadawca lub odbiorca nie ma wspólnego kanału).", False),
    7: ("routing_too_large", "Pakiet jest zbyt duży, aby go wysłać.", False),
    8: ("routing_no_response", "Węzeł nie odpowiedział (brak odpowiedzi w wyznaczonym czasie). Spróbuj ponownie, gdy będzie w zasięgu.", True),
    9: ("routing_duty_cycle_limit", "Osiągnięto okresowy limit nadawania dla tego regionu. Poczekaj przed ponowną próbą.", True),
    32: ("routing_bad_request", "Węzeł docelowy odrzucił żądanie jako nieprawidłowe.", False),
    33: ("routing_not_authorized", "Węzeł docelowy odrzucił żądanie — brak autoryzacji (np. żądanie nie przyszło wymaganym kanałem).", False),
    34: ("routing_pki_failed", "Nie udało się wysłać zaszyfrowanej wiadomości (PKI). Poczekaj na synchronizację informacji o węźle lub kluczy i spróbuj ponownie.", True),
    35: ("routing_pki_unknown_pubkey", "Odbiorca nie zna jeszcze klucza publicznego tego radia. Poczekaj na synchronizację informacji o węźle i spróbuj ponownie.", True),
    36: ("routing_admin_bad_session_key", "Sesja administratora wygasła lub klucz sesji jest nieprawidłowy. Zażądaj nowej sesji przed ponowną próbą.", False),
    37: ("routing_admin_public_key_unauthorized", "Zdalny węzeł nie rozpoznaje klucza administratora (klucz nieautoryzowany).", False),
    38: ("routing_rate_limit_exceeded", "Przekroczono limit wysyłania — wiadomości są wysyłane zbyt szybko. Poczekaj przed ponowną próbą.", True),
    39: ("routing_pki_send_fail_public_key", "Radio nie ma jeszcze klucza publicznego odbiorcy. Poczekaj na synchronizację informacji o węźle i spróbuj ponownie.", True),
}

_NO_ACK = ("request_no_ack", "Radio nie potwierdziło wysłania żądania w wyznaczonym czasie. Sprawdź połączenie z radiem i spróbuj ponownie.", True)
_NO_RESPONSE = ("request_no_response", "Węzeł nie odpowiedział w wyznaczonym czasie. Spróbuj ponownie, gdy będzie w zasięgu.", True)
_TIMEOUT = ("timeout", "Przekroczono czas oczekiwania na radio. Spróbuj ponownie.", True)
_NOT_CONNECTED = ("not_connected", "Brak połączenia z radiem. Poczekaj na ponowne połączenie i spróbuj ponownie.", True)


def classify_node_action_error(err: BaseException) -> tuple[str, str, bool]:
    """Zwróć (kod, komunikat PL, oczekiwany) dla wyjątku akcji na węźle.

    Nieznane wyjątki: ("action_failed", str(err), False) — logowane jako WARNING.
    """
    # Import leniwy: moduł działa też w testach bez pełnego pakietu.
    name_chain = [c.__name__ for c in type(err).__mro__]
    if "MeshRoutingError" in name_chain:
        value = getattr(err, "error", None)
        if value is None:
            value = getattr(err, "_error", None)
        try:
            value = int(value)
        except (TypeError, ValueError):
            value = -1
        if value in ROUTING_ERRORS:
            return ROUTING_ERRORS[value]
        return ("routing_unknown", f"Radio zgłosiło błąd routingu (kod {value}).", False)
    if "MeshInterfaceRequestError" in name_chain:
        reason = getattr(err, "reason", None)
        text = str(err)
        if reason == "no_ack" or text.startswith("No acknowledgement"):
            return _NO_ACK
        return _NO_RESPONSE
    if "ClientApiNotConnectedError" in name_chain:
        return _NOT_CONNECTED
    if isinstance(err, TimeoutError):
        return _TIMEOUT
    return ("action_failed", str(err) or type(err).__name__, False)
