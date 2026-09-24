# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

"""Starting setup task: Frontend."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import TYPE_CHECKING

from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig

from .const import DOMAIN, URL_BASE
from .ha_frontend import locate_dir

_INTEGRATION_VERSION = json.loads((Path(__file__).parent / "manifest.json").read_text())["version"]

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_DEBUG = False
_STATIC_REGISTERED_KEY = f"{DOMAIN}_panel_static_registered"


async def async_register_frontend(hass: HomeAssistant) -> None:
    # Add to sidepanel if needed
    if DOMAIN not in hass.data.get("frontend_panels", {}):
        # Ścieżki statycznej nie da się wyrejestrować, więc przy ponownym
        # włączeniu panelu (opcja integracji / przeładowanie) rejestrujemy ją
        # tylko raz na cały proces HA — sam wpis w pasku bocznym wraca normalnie.
        if not hass.data.get(_STATIC_REGISTERED_KEY):
            await hass.http.async_register_static_paths(
                [
                    StaticPathConfig(
                        f"{URL_BASE}/frontend/{_INTEGRATION_VERSION}", locate_dir(), cache_headers=True
                    )
                ]
            )
            hass.data[_STATIC_REGISTERED_KEY] = True

        async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title="MT_SW_INTEGRATION",
            sidebar_icon="mdi:radio-handheld",
            frontend_url_path=DOMAIN,
            config={
                "_panel_custom": {
                    "name": "meshtastic-frontend",
                    "embed_iframe": False,
                    "trust_external": False,
                    "module_url": f"{URL_BASE}/frontend/{_INTEGRATION_VERSION}/panel.js"
                    + (f"&t={time.time()}" if _DEBUG else ""),
                }
            },
            require_admin=True,
        )


async def async_unregister_frontend(hass: HomeAssistant) -> None:
    if DOMAIN in hass.data.get("frontend_panels", {}):
        async_remove_panel(
            hass,
            frontend_url_path=DOMAIN,
        )
