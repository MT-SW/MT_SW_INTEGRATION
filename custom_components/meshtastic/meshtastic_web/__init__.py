# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

"""Meshtastic web client: static bundle serving + per-gateway connect page."""

import html
from pathlib import Path
from typing import TYPE_CHECKING

import homeassistant.helpers.entity_registry as er
from aiohttp import web
from homeassistant.components.http import HomeAssistantRequest, HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant

from ..const import (  # noqa: TID252
    CONF_OPTION_WEB_CLIENT,
    CONF_OPTION_WEB_CLIENT_ENABLE,
    CONF_OPTION_WEB_CLIENT_ENABLE_DEFAULT,
    CONF_OPTION_WEB_CLIENT_PORT,
    CONF_OPTION_WEB_CLIENT_PORT_DEFAULT,
    DOMAIN,
    LOGGER,
    URL_BASE,
)
from .proxy_server import GatewayWebProxyServer

if TYPE_CHECKING:
    from ..data import MeshtasticConfigEntry  # noqa: TID252

_LOGGER = LOGGER.getChild(__name__.removeprefix(f"{LOGGER.name}."))

_proxy_servers: dict[str, GatewayWebProxyServer] = {}


async def async_setup(hass: HomeAssistant) -> bool:
    try:
        hass.http.register_view(MeshtasticWebConfigEntryView(hass))
        await hass.http.async_register_static_paths(
            [StaticPathConfig(f"{URL_BASE}/web", str(Path(__file__).parent / "static"))]
        )
    except Exception:  # noqa: BLE001
        _LOGGER.warning("Failed to setup meshtastic web", exc_info=True)
        return False
    else:
        return True


async def async_setup_web_proxy_server(
    hass: HomeAssistant,
    entry: "MeshtasticConfigEntry",
) -> bool:
    """Start this entry's dedicated-port HTTP proxy (see proxy_server.py for why)."""
    web_client_config = entry.options.get(CONF_OPTION_WEB_CLIENT, {})
    if not web_client_config.get(CONF_OPTION_WEB_CLIENT_ENABLE, CONF_OPTION_WEB_CLIENT_ENABLE_DEFAULT):
        return False

    port = web_client_config.get(CONF_OPTION_WEB_CLIENT_PORT, CONF_OPTION_WEB_CLIENT_PORT_DEFAULT)
    server = GatewayWebProxyServer(hass, entry, port)
    try:
        await server.start()
    except Exception:  # noqa: BLE001
        _LOGGER.warning("Failed to start web client proxy server on port %s", port, exc_info=True)
        return False
    _proxy_servers[entry.entry_id] = server
    return True


async def async_unload_web_proxy_server(
    hass: HomeAssistant,  # noqa: ARG001
    entry: "MeshtasticConfigEntry",
) -> bool:
    server = _proxy_servers.pop(entry.entry_id, None)
    if server is None:
        return False
    await server.stop()
    return True


_CONNECT_TEXTS = {
    "pl": {
        "title": "Połącz klienta webowego MT_SW",
        "lead": "Strona „Połączenia” w kliencie nie uzupełnia adresu sama — trzeba go wpisać raz, ręcznie.",
        "step1": "Otwórz klienta przyciskiem poniżej, potem <strong>Dodaj połączenie</strong> &rarr; <strong>Sieć</strong>.",
        "step2": "Wklej ten adres w pole <strong>URL lub IP</strong>:",
        "copy": "Kopiuj",
        "copied": "Skopiowano (albo zaznaczono — naciśnij Ctrl+C / Cmd+C, jeśli nie skopiowało się samo).",
        "step3": "Zostaw <strong>HTTPS</strong> wyłączone — to połączenie działa tylko po zwykłym HTTP. Jeśli "
        "otwierasz Home Assistanta przez HTTPS, przeglądarka może je zablokować jako treść mieszaną; wtedy "
        "otwórz klienta przez <code>http://</code>.",
        "step4": "Zapisz połączenie.",
        "open": "Otwórz klienta webowego MT_SW",
        "note": "Klient łączy się z radiem przez integrację, więc połączenie Home Assistanta z radiem nie jest zrywane.",
    },
    "en": {
        "title": "Connect the MT_SW web client",
        "lead": "The client's “Connections” page doesn't fill in the address by itself — enter it once, manually.",
        "step1": "Open the client with the button below, then <strong>Add connection</strong> &rarr; <strong>Network</strong>.",
        "step2": "Paste this address into the <strong>URL or IP</strong> field:",
        "copy": "Copy",
        "copied": "Copied (or selected — press Ctrl+C / Cmd+C if it didn't copy automatically).",
        "step3": "Leave <strong>HTTPS</strong> off — this connection only speaks plain HTTP. If you access Home "
        "Assistant over HTTPS, your browser may block it as mixed content; open the client via <code>http://</code> "
        "instead.",
        "step4": "Save the connection.",
        "open": "Open the MT_SW web client",
        "note": "The client talks to the radio through the integration, so Home Assistant's own connection is not dropped.",
    },
}


def _connect_language(accept_language: str | None) -> str:
    """Polski, gdy przeglądarka go woli — inaczej angielski."""
    for part in (accept_language or "").split(","):
        code = part.split(";")[0].strip().lower()
        if code.startswith("pl"):
            return "pl"
        if code.startswith("en"):
            return "en"
    return "pl"


def _render_connect_instructions_html(*, connection_value: str, client_url: str, language: str = "pl") -> str:
    # connection_value is derived from the request's Host header, which a
    # client fully controls - escape it before embedding in HTML.
    safe_value = html.escape(connection_value)
    safe_client_url = html.escape(client_url)
    t = _CONNECT_TEXTS.get(language, _CONNECT_TEXTS["en"])
    return f"""<!doctype html>
<html lang="{language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#F5C839">
<link rel="icon" type="image/svg+xml" href="{URL_BASE}/web/icon.svg">
<title>{t["title"]}</title>
<style>
  :root {{
    --gold: #f5c839; --gold-dark: #c99b14; --navy: #2c2d3c;
    --bg: #f6f6f8; --card: #ffffff; --text: #1f2029; --muted: #5b5d6b; --code: #f1f1f4; --border: #e2e2e8;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg: #16171f; --card: #22232e; --text: #ececf1; --muted: #a3a5b3; --code: #2c2d3c; --border: #34364a; }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--text);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.55;
    display: flex; align-items: flex-start; justify-content: center; padding: 3rem 1rem;
  }}
  .card {{
    width: 100%; max-width: 620px; background: var(--card); border: 1px solid var(--border);
    border-top: 6px solid var(--gold); border-radius: 16px; padding: 1.75rem 1.75rem 2rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
  }}
  header {{ display: flex; align-items: center; gap: 0.9rem; margin-bottom: 0.5rem; }}
  header img {{ width: 56px; height: 56px; border-radius: 14px; box-shadow: 0 0 0 1px rgba(44, 45, 60, 0.15); }}
  h1 {{ margin: 0; font-size: 1.35rem; }}
  .brand {{ font-size: 0.8rem; font-weight: 600; letter-spacing: 0.06em; color: var(--gold-dark); text-transform: uppercase; }}
  p.lead {{ color: var(--muted); margin: 0.75rem 0 1.25rem; }}
  ol {{ padding-left: 1.25rem; margin: 0; }}
  li {{ margin: 0.65rem 0; }}
  code {{ background: var(--code); padding: 0.15rem 0.4rem; border-radius: 6px; font-size: 0.95em; }}
  .row {{ display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0.6rem 0; }}
  .row code {{ font-size: 1.05rem; padding: 0.55rem 0.8rem; user-select: all; word-break: break-all; }}
  button {{
    padding: 0.5rem 0.9rem; border: 1px solid var(--border); border-radius: 8px; cursor: pointer;
    background: var(--card); color: var(--text); font: inherit;
  }}
  button:hover {{ border-color: var(--gold-dark); }}
  #copy-hint {{ display: none; color: var(--muted); font-size: 0.9rem; }}
  a.button {{
    display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.4rem; border-radius: 10px;
    background: var(--gold); color: var(--navy); font-weight: 600; text-decoration: none;
  }}
  a.button:hover {{ background: var(--gold-dark); }}
  .note {{ margin-top: 1.25rem; font-size: 0.85rem; color: var(--muted); }}
</style>
</head>
<body>
<main class="card">
<header>
  <img src="{URL_BASE}/web/logo.svg" alt="MT_SW">
  <div><div class="brand">MT_SW · Meshtastic Świętokrzyskie</div><h1>{t["title"]}</h1></div>
</header>
<p class="lead">{t["lead"]}</p>
<ol>
  <li>{t["step1"]}</li>
  <li>{t["step2"]}
    <div class="row"><code id="value">{safe_value}</code><button type="button" onclick="copyValue()">{t["copy"]}</button></div>
    <p id="copy-hint">{t["copied"]}</p>
  </li>
  <li>{t["step3"]}</li>
  <li>{t["step4"]}</li>
</ol>
<a class="button" href="{safe_client_url}">{t["open"]}</a>
<p class="note">{t["note"]}</p>
</main>
<script>
function copyValue() {{
  var el = document.getElementById("value");
  var hint = document.getElementById("copy-hint");
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {{
    navigator.clipboard.writeText(el.textContent).catch(function () {{ selectAndCopyFallback(el); }});
  }} else {{
    selectAndCopyFallback(el);
  }}
  hint.style.display = "block";
}}
function selectAndCopyFallback(el) {{
  var range = document.createRange();
  range.selectNodeContents(el);
  var selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  try {{
    document.execCommand("copy");
  }} catch (err) {{
  }}
}}
</script>
</body>
</html>
"""


class MeshtasticWebConfigEntryView(HomeAssistantView):
    url = URL_BASE + "/web/{entity_id}"
    name = "meshtastic:web_api_index"
    requires_auth = False

    def __init__(
        self,
        hass: HomeAssistant,
    ) -> None:
        self._hass = hass

    async def get(
        self,
        request: HomeAssistantRequest,
        entity_id: str,
    ) -> web.Response:
        if not entity_id.startswith("gateway_"):
            return web.FileResponse(Path(__file__).parent / "static" / entity_id, headers={"Cache-Control": "no-cache"})

        entity_registry = er.async_get(self._hass)
        entity_id = f"{DOMAIN}.{entity_id}"
        entity = entity_registry.async_get(entity_id)
        if entity is None:
            return web.HTTPNotFound()

        config_entry = self._hass.config_entries.async_get_entry(entity.config_entry_id)
        if config_entry.state != ConfigEntryState.LOADED:
            return web.HTTPBadGateway(
                body=f"Gateway is not ready (config entry state {config_entry.state.value})",
                content_type="text/plain",
                headers={"Cache-Control": "no-cache"},
            )

        web_client_config = config_entry.options.get(CONF_OPTION_WEB_CLIENT, {})
        if not web_client_config.get(CONF_OPTION_WEB_CLIENT_ENABLE, CONF_OPTION_WEB_CLIENT_ENABLE_DEFAULT):
            return web.HTTPForbidden(body="Web client not enabled for gateway", headers={"Cache-Control": "no-cache"})

        # meshtastic/web's "Connections" page (since v2.7.1) validates its "URL
        # or IP" field against a bare host[:port] pattern - no path component
        # is accepted - so show the exact value to paste in, on this entry's
        # dedicated web-client-proxy port, on the same hostname the browser
        # used to reach Home Assistant.
        port = web_client_config.get(CONF_OPTION_WEB_CLIENT_PORT, CONF_OPTION_WEB_CLIENT_PORT_DEFAULT)
        connection_value = f"{request.url.host}:{port}"
        return web.Response(
            text=_render_connect_instructions_html(
                connection_value=connection_value,
                client_url=f"{URL_BASE}/web/index.html",
                language=_connect_language(request.headers.get("Accept-Language")),
            ),
            content_type="text/html",
            headers={"Cache-Control": "no-cache"},
        )
