"""Awaryjne proxy dla plannera łączy: POST /api/meshtastic/planner/proxy (tylko administrator).

Przeglądarka najpierw pobiera dane (Overpass, Mapterhorn, Open-Meteo) sama; dopiero gdy to się nie uda
(TypeError: CORS, CSP, mixed content), panel prosi o to samo ten widok. Reguły: planner_proxy_rules.py.
Odpowiedź ma zawsze HTTP 200 + nagłówek X-Upstream-Status z prawdziwym kodem serwera zewnętrznego
(dzięki temu np. 429 z Overpass nie myli się z błędem samego Home Assistanta).
"""

from __future__ import annotations

import asyncio
import logging
from http import HTTPStatus
from typing import TYPE_CHECKING

import aiohttp
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN
from .planner_proxy_rules import (
    MAX_RESPONSE_BYTES,
    UPSTREAM_TIMEOUT_SECONDS,
    ProxyRequestError,
    safe_content_type,
    validate_proxy_request,
)

if TYPE_CHECKING:
    from aiohttp import web
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

PROXY_URL_PATH = "/api/meshtastic/planner/proxy"
_USER_AGENT = "MT_SW-HomeAssistant-planner-proxy (+https://meshtastic-swietokrzyskie.pl)"
_SEMAPHORE_KEY = f"{DOMAIN}_planner_proxy_semaphore"


class PlannerProxyView(HomeAssistantView):
    """POST {url, method, headers:{Range}, body} -> bajty odpowiedzi + X-Upstream-Status."""

    url = PROXY_URL_PATH
    name = "api:meshtastic:planner_proxy"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        from aiohttp import web  # noqa: PLC0415

        user = request.get("hass_user")
        if user is None or not user.is_admin:
            return self.json_message("Wymagane uprawnienia administratora", HTTPStatus.FORBIDDEN, "forbidden")
        try:
            payload = await request.json()
            method, url, headers, body = validate_proxy_request(payload)
        except ProxyRequestError as err:
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST, err.code)
        except ValueError:
            return self.json_message("Nieprawidłowy JSON", HTTPStatus.BAD_REQUEST, "bad_request")

        hass: HomeAssistant = request.app["hass"]
        semaphore = hass.data.setdefault(_SEMAPHORE_KEY, asyncio.Semaphore(4))
        headers = {**headers, "User-Agent": _USER_AGENT, "Accept-Encoding": "identity"}
        session = async_get_clientsession(hass)
        try:
            async with semaphore, session.request(
                method,
                url,
                headers=headers,
                data=body.encode("utf-8") if body is not None else None,
                allow_redirects=False,
                timeout=aiohttp.ClientTimeout(total=UPSTREAM_TIMEOUT_SECONDS),
            ) as upstream:
                chunks: list[bytes] = []
                size = 0
                async for chunk in upstream.content.iter_chunked(65536):
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        return self.json_message(
                            "Odpowiedź serwera jest zbyt duża", HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too_large"
                        )
                    chunks.append(chunk)
                return web.Response(
                    status=HTTPStatus.OK,
                    body=b"".join(chunks),
                    headers={
                        "X-Upstream-Status": str(upstream.status),
                        "Content-Type": safe_content_type(upstream.headers.get("Content-Type")),
                        "Cache-Control": "no-store",
                    },
                )
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.debug("Proxy plannera: %s nie odpowiedział: %s", url, err)
            return self.json_message(
                f"Serwer zewnętrzny nie odpowiedział: {err or 'przekroczono czas oczekiwania'}",
                HTTPStatus.BAD_GATEWAY,
                "upstream_failed",
            )


def async_register_planner_proxy(hass: HomeAssistant) -> None:
    """Zarejestruj widok proxy (widoku HTTP nie da się zarejestrować dwa razy — wołane raz)."""
    if getattr(hass, "http", None) is not None:
        hass.http.register_view(PlannerProxyView())
