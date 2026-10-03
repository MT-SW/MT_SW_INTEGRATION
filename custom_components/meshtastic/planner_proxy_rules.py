"""Reguły proxy plannera (czysty moduł, bez Home Assistanta — łatwy do przetestowania).

Proxy służy tylko jako awaryjna droga, gdy przeglądarka nie może sama pobrać danych z zewnętrznych serwerów
(CORS, CSP, mixed content). Dopuszczone są wyłącznie trzy rodziny hostów i ściśle określone ścieżki.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

MAX_RESPONSE_BYTES = 16 * 1024 * 1024
MAX_REQUEST_BODY_CHARS = 200_000
# Overpass nic nie wysyła, dopóki nie policzy całej odpowiedzi (zapytania ma limit 40-60 s po stronie serwera)
UPSTREAM_TIMEOUT_SECONDS = 100
OVERPASS_PATH = "/api/interpreter"
OVERPASS_HOSTS = ("overpass-api.de", "overpass.private.coffee", "overpass.kumi.systems")
OPEN_METEO_HOST = "api.open-meteo.com"
MAPTERHORN_HOST = "download.mapterhorn.com"
ALLOWED_HOSTS = (*OVERPASS_HOSTS, OPEN_METEO_HOST, MAPTERHORN_HOST)

_RANGE_RE = re.compile(r"^bytes=\d{1,12}-\d{1,12}$")
_PMTILES_PATH_RE = re.compile(r"^/[A-Za-z0-9_.\-]{1,100}\.pmtiles$")
_SAFE_CONTENT_TYPE_RE = re.compile(r"^[A-Za-z0-9.+\-/]+(;\s*charset=[A-Za-z0-9\-_]+)?$")


class ProxyRequestError(ValueError):
    """Żądanie odrzucone przez reguły proxy; `code` to stabilny kod maszynowy."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def validate_proxy_request(payload: Any) -> tuple[str, str, dict[str, str], str | None]:
    """Sprawdź żądanie JSON i zwróć (metoda, url, nagłówki do wysłania dalej, treść)."""
    if not isinstance(payload, dict):
        raise ProxyRequestError("bad_request", "Oczekiwano obiektu JSON")
    url = payload.get("url")
    method = str(payload.get("method") or "GET").upper()
    if not isinstance(url, str) or len(url) > 4096:
        raise ProxyRequestError("bad_url", "Brak adresu url")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as err:
        raise ProxyRequestError("bad_url", "Nieprawidłowy adres url") from err
    if parts.scheme != "https" or parts.username or parts.password or parts.fragment or port not in (None, 443):
        raise ProxyRequestError("bad_url", "Dozwolone tylko https bez danych logowania")
    host = (parts.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise ProxyRequestError("host_not_allowed", f"Host {host or '?'} nie jest dozwolony")

    body = payload.get("body")
    if body is not None and not isinstance(body, str):
        raise ProxyRequestError("bad_request", "Treść musi być tekstem")

    headers: dict[str, str] = {}
    if host in OVERPASS_HOSTS:
        if parts.path != OVERPASS_PATH or parts.query:
            raise ProxyRequestError("path_not_allowed", "Niedozwolona ścieżka Overpass")
        if method != "POST":
            raise ProxyRequestError("method_not_allowed", "Overpass: tylko POST")
        if not body or not body.startswith("data=") or len(body) > MAX_REQUEST_BODY_CHARS:
            raise ProxyRequestError("bad_body", "Overpass: oczekiwano treści data=... (do 200 kB)")
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    else:
        if method != "GET" or body is not None:
            raise ProxyRequestError("method_not_allowed", "Dozwolony tylko GET bez treści")
        if host == OPEN_METEO_HOST:
            if parts.path != "/v1/forecast":
                raise ProxyRequestError("path_not_allowed", "Niedozwolona ścieżka Open-Meteo")
            if len(parts.query) > 2000:
                raise ProxyRequestError("bad_url", "Zapytanie zbyt długie")
        else:  # Mapterhorn: archiwa PMTiles, bez parametrów
            if not _PMTILES_PATH_RE.match(parts.path) or parts.query:
                raise ProxyRequestError("path_not_allowed", "Mapterhorn: tylko pliki .pmtiles")

    raw_headers = payload.get("headers")
    if raw_headers is not None:
        if not isinstance(raw_headers, dict):
            raise ProxyRequestError("bad_request", "Nagłówki muszą być obiektem")
        range_value = raw_headers.get("Range") or raw_headers.get("range")
        if range_value:
            if not isinstance(range_value, str) or not _RANGE_RE.match(range_value):
                raise ProxyRequestError("bad_range", "Dozwolony tylko nagłówek Range: bytes=a-b")
            headers["Range"] = range_value
    return method, url, headers, body


def safe_content_type(value: str | None) -> str:
    """Typ treści z odpowiedzi serwera albo application/octet-stream, gdy wygląda podejrzanie."""
    if value and _SAFE_CONTENT_TYPE_RE.match(value.strip()):
        return value.strip()
    return "application/octet-stream"
