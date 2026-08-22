from __future__ import annotations

import typing
from typing import TYPE_CHECKING, Any

from homeassistant.components.button import (
    DOMAIN as BUTTON_DOMAIN,
)
from homeassistant.components.button import (
    ButtonEntity,
    ButtonEntityDescription,
)

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

    async def async_press(self) -> None:
        await self._client.reboot(self._node_id)