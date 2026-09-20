# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Wysyłanie zdjęć z czatu na publiczny hosting obrazków — tak jak w aplikacji na Androida.

Przez sieć mesh nie da się przesłać zdjęcia (wiadomość ma około 200 znaków), więc panel wysyła je
na catbox.moe (anonimowy, bez konta i klucza), a w wiadomości leci sam link. Odbiorca widzi
podgląd, jeśli ma włączone ładowanie obrazków z linków.

Przeglądarka nie może wysłać pliku prosto na catbox.moe (serwer nie zezwala na żądania z innych
stron), dlatego zdjęcie przechodzi przez Home Assistanta. Robi to zwykłe żądanie HTTP z
uwierzytelnieniem, a nie WebSocket: zdjęcie z telefonu ma kilka MB, a wiadomość WebSocket ma
limit 4 MB.

Wysyłamy tylko obrazki, których podgląd panel umie pokazać, rozpoznane po zawartości, a nie po
nazwie czy deklarowanym typie. Nazwy pliku od użytkownika nie przekazujemy dalej — serwer dostaje
neutralne "image.<rozszerzenie>", żeby nie zdradzać nazw plików z komputera czy telefonu.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING, Any

import aiohttp
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import LOGGER

if TYPE_CHECKING:
    from aiohttp import web
    from homeassistant.core import HomeAssistant

CATBOX_API = "https://catbox.moe/user/api.php"
UPLOAD_URL_PATH = "/api/meshtastic/upload_image"
# Home Assistant przyjmuje żądania do 16 MiB; zostawiamy zapas na resztę formularza.
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
UPLOAD_TIMEOUT_SECONDS = 90
FORM_FIELD = "file"


class UploadError(Exception):
    """Serwer zdjęć odmówił albo nie odpowiedział — komunikat da się pokazać użytkownikowi."""


def sniff_image(data: bytes) -> tuple[str, str] | None:
    """(rozszerzenie, typ MIME) obrazka rozpoznanego po nagłówku; None, gdy to nie obsługiwany obraz.

    Lista jest taka jak w podglądzie w czacie (png, jpg, gif, webp, bmp, avif) — nie wysyłamy
    czegoś, czego odbiorca i tak by nie zobaczył (np. HEIC, którego przeglądarki nie wyświetlają).
    """
    if data[:3] == b"\xff\xd8\xff":
        return "jpg", "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", "image/png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif", "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    if data[:2] == b"BM":
        return "bmp", "image/bmp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"avif", b"avis"):
        return "avif", "image/avif"
    return None


async def upload_to_catbox(session: aiohttp.ClientSession, data: bytes, extension: str, mime: str) -> str:
    """Wyślij obraz na catbox.moe i zwróć jego adres (odpowiedź serwera to sam tekst z linkiem)."""
    form = aiohttp.FormData()
    form.add_field("reqtype", "fileupload")
    form.add_field("fileToUpload", data, filename=f"image.{extension}", content_type=mime)
    try:
        async with session.post(
            CATBOX_API, data=form, timeout=aiohttp.ClientTimeout(total=UPLOAD_TIMEOUT_SECONDS)
        ) as response:
            body = (await response.text()).strip()
            status = response.status
    except (aiohttp.ClientError, TimeoutError) as err:
        msg = f"Nie udało się połączyć z catbox.moe: {err or 'przekroczono czas oczekiwania'}"
        raise UploadError(msg) from err
    # Błędy serwer zwraca zwykłym tekstem (np. "No files given."), często z kodem 200.
    if status != HTTPStatus.OK or not body.startswith("https://"):
        msg = f"catbox.moe odrzucił zdjęcie: {body[:120] or status}"
        raise UploadError(msg)
    return body


class ImageUploadView(HomeAssistantView):
    """POST /api/meshtastic/upload_image (multipart, pole "file") -> {"url": ...}."""

    url = UPLOAD_URL_PATH
    name = "api:meshtastic:upload_image"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        user = request.get("hass_user")
        if user is None or not user.is_admin:
            return self.json_message("Wymagane uprawnienia administratora", HTTPStatus.FORBIDDEN, "forbidden")

        form = await request.post()
        field: Any = form.get(FORM_FIELD)
        if field is None or not hasattr(field, "file"):
            return self.json_message("Brak pliku w żądaniu", HTTPStatus.BAD_REQUEST, "no_file")
        data = field.file.read()
        if not data:
            return self.json_message("Plik jest pusty", HTTPStatus.BAD_REQUEST, "empty_file")
        if len(data) > MAX_UPLOAD_BYTES:
            return self.json_message("Zdjęcie jest za duże", HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too_large")
        kind = sniff_image(data)
        if kind is None:
            return self.json_message(
                "Obsługiwane są zdjęcia JPEG, PNG, GIF, WebP, BMP i AVIF", HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_type"
            )

        hass: HomeAssistant = request.app["hass"]
        try:
            link = await upload_to_catbox(async_get_clientsession(hass), data, *kind)
        except UploadError as err:
            LOGGER.warning("Wysyłanie zdjęcia nie powiodło się: %s", err)
            return self.json_message(str(err), HTTPStatus.BAD_GATEWAY, "upload_failed")
        return self.json({"url": link})


def async_register_upload_view(hass: HomeAssistant) -> None:
    """Zarejestruj widok wysyłania zdjęć. Widoku HTTP nie da się zarejestrować dwa razy — wołane raz."""
    hass.http.register_view(ImageUploadView())
