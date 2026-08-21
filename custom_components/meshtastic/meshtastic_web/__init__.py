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

_LOGGER = LOGGER.getChild(__name__)

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


def _render_connect_instructions_html(*, connection_value: str, client_url: str) -> str:
    # connection_value is derived from the request's Host header, which a
    # client fully controls - escape it before embedding in HTML.
    safe_value = html.escape(connection_value)
    safe_client_url = html.escape(client_url)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Connect Meshtastic Web Client</title>
<style>
  body {{ font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; }}
  code {{
    background: #eee; padding: 0.5rem 0.75rem; border-radius: 4px;
    font-size: 1rem; user-select: all; word-break: break-all;
  }}
  .row {{ display: flex; align-items: center; gap: 0.5rem; margin: 1rem 0; }}
  button {{ padding: 0.4rem 0.8rem; cursor: pointer; }}
  a.button {{
    display: inline-block; margin-top: 1.5rem; padding: 0.6rem 1.2rem;
    background: #03a9f4; color: #fff; text-decoration: none; border-radius: 4px;
  }}
</style>
</head>
<body>
<h1>Connect the Meshtastic Web Client</h1>
<p>The web client's "Connections" page needs this address entered manually - it does not auto-fill.</p>
<ol>
  <li>Open the web client (button below), then <strong>Add connection</strong> &rarr; <strong>Network</strong>.</li>
  <li>Paste this into the <strong>URL or IP</strong> field:
    <div class="row"><code id="value">{safe_value}</code><button type="button" onclick="copyValue()">Copy</button></div>
    <p id="copy-hint" style="display:none;color:#555;font-size:0.9rem;">
      Copied (or selected - press Ctrl+C / Cmd+C if it didn't copy automatically).
    </p>
  </li>
  <li>Leave <strong>Use HTTPS</strong> off - this proxy only speaks plain HTTP. If you're accessing
    Home Assistant itself over HTTPS, your browser will likely block this as mixed content;
    open the web client via <code>http://</code> (not <code>https://</code>) instead.</li>
  <li>Save the connection.</li>
</ol>
<a class="button" href="{safe_client_url}">Open Meshtastic Web Client</a>
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
            ),
            content_type="text/html",
            headers={"Cache-Control": "no-cache"},
        )
