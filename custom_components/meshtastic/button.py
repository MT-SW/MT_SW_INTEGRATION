from __future__ import annotations

import asyncio
import typing
from typing import TYPE_CHECKING, Any

from homeassistant.components.button import (
    DOMAIN as BUTTON_DOMAIN,
)
from homeassistant.components.button import (
    ButtonEntity,
    ButtonEntityDescription,
)

from homeassistant.helpers import entity_registry as er

from . import helpers
from .entity import MeshtasticNodeEntity

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping

    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

    from .coordinator import MeshtasticDataUpdateCoordinator
    from .data import MeshtasticConfigEntry, MeshtasticData


def _build_buttons(
    nodes: Mapping[int, Mapping[str, Any]], runtime_data: MeshtasticData
) -> Iterable[MeshtasticRebootButton]:
    coordinator = runtime_data.coordinator
    gateway = runtime_data.client.get_own_node()
    gateway_node_id = gateway.get("num")
    # ograniczone tylko do lokalnie podłączonego węzła — reboot() wysyła
    # AdminMessage po mesh do wskazanego node_id, więc przycisk na cudzym
    # węźle próbowałby realnie zrestartować urządzenie kogoś innego w sieci
    if gateway_node_id not in nodes:
        return []
    return [
        MeshtasticRebootButton(
            coordinator=coordinator,
            entity_description=ButtonEntityDescription(key="reboot", name="Reboot", icon="mdi:restart"),
            gateway=gateway,
            node_id=gateway_node_id,
            client=runtime_data.client,
        )
    ]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: MeshtasticConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    await helpers.setup_platform_entry(hass, entry, async_add_entities, _build_buttons)

    # posprzątaj po starej wersji, która tworzyła przycisk reboot dla
    # każdego węzła — te węzły nadal są na liście filtrów (więc ogólny
    # mechanizm czyszczenia w helpers.py ich nie ruszy), ale przycisk
    # jest teraz budowany tylko dla bramy, więc wszystkie inne to sieroty
    gateway = entry.runtime_data.client.get_own_node()
    gateway_node_id = gateway.get("num")
    coordinator = entry.runtime_data.coordinator
    gateway_identity_key = coordinator.identity_key_for(gateway_node_id) if gateway_node_id is not None else None
    expected_unique_id = f"{entry.entry_id}_button_{gateway_identity_key}_reboot"

    registry = er.async_get(hass)
    for reg_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
        if reg_entry.domain == "button" and reg_entry.unique_id != expected_unique_id:
            registry.async_remove(reg_entry.entity_id)


async def async_unload_entry(
    hass: HomeAssistant,
    entry: MeshtasticConfigEntry,
) -> bool:
    return await helpers.async_unload_entry(hass, entry)


class MeshtasticRebootButton(MeshtasticNodeEntity, ButtonEntity):
    entity_description: ButtonEntityDescription

    def __init__(
        self,
        coordinator: MeshtasticDataUpdateCoordinator,
        entity_description: ButtonEntityDescription,
        gateway: typing.Mapping[str, typing.Any],
        node_id: int,
        client,
    ) -> None:
        super().__init__(coordinator, gateway, node_id, BUTTON_DOMAIN, entity_description)
        self._client = client

    def _async_update_attrs(self) -> None:
        pass

    @property
    def available(self) -> bool:
        # nie zależy od świeżej telemetrii w coordinator.data — to przycisk
        # akcji na własnej bramie, nie sensor; jeśli połączenie faktycznie
        # padło, naciśnięcie po prostu zwróci błąd zamiast fałszywie
        # pokazywać encję jako niedostępną
        return True

    async def async_press(self) -> None:
        await self._client.reboot(self._node_id)

        entry_id = self.coordinator.config_entry.entry_id

        async def _delayed_reload_after_reboot() -> None:
            # firmware potrzebuje chwili na WiFi + start serwera TCP po
            # restarcie; jeśli spróbujemy za wcześnie, ConfigEntryNotReady
            # (fix-3.16) i tak złapie to bezpiecznie i ponowi próbę sam
            await asyncio.sleep(45)
            await self.hass.config_entries.async_reload(entry_id)

        self.hass.async_create_task(_delayed_reload_after_reboot())