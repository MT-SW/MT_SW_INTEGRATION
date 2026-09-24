# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from homeassistant.util.hass_dict import HassKey

from .const import DOMAIN

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.helpers.entity_component import EntityComponent
    from homeassistant.loader import Integration

    from .api import MeshtasticApiClient
    from .coordinator import MeshtasticDataUpdateCoordinator
    from .entity import MeshtasticEntity


type MeshtasticConfigEntry = ConfigEntry[MeshtasticData]


@dataclass
class StatsLayerState:
    """
    Stan warstwy statystyk (koordynator, urządzenia, encje HA).

    Warstwa statystyk jest celowo odseparowana od warstwy aplikacji (panel,
    wiadomości, proxy): jej błąd nie zatrzymuje startu wpisu, tylko jest
    zapisywany tutaj i ponawiany w tle.
    """

    # False = zbieranie statystyk wyłączone w opcjach (tylko panel)
    enabled: bool = True
    platforms_forwarded: bool = False
    gateway_entities_added: bool = False
    ready: bool = False
    error: str | None = None
    attempts: int = 0
    cancel_retry: Any = None
    unsubscribers: list = field(default_factory=list)


@dataclass
class MeshtasticData:
    client: MeshtasticApiClient
    coordinator: MeshtasticDataUpdateCoordinator
    integration: Integration
    gateway_node: dict
    stats: StatsLayerState = field(default_factory=StatsLayerState)
    app_unsubscribers: list = field(default_factory=list)


DATA_COMPONENT: HassKey[EntityComponent[MeshtasticEntity]] = HassKey(DOMAIN)
