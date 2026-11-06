# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

from __future__ import annotations

import socket
from copy import deepcopy
from typing import TYPE_CHECKING

import homeassistant.helpers.config_validation as cv
import voluptuous as vol
from homeassistant import config_entries, data_entry_flow
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, IntegrationError
from homeassistant.helpers.selector import (
    AreaSelector,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from . import CONF_OPTION_WEB_CLIENT, CURRENT_CONFIG_VERSION_MINOR
from .aiomeshtastic import TcpConnection
from .api import (
    MeshtasticApiClient,
)
from .const import (
    CONF_CONNECTION_BLUETOOTH_ADDRESS,
    CONF_CONNECTION_SERIAL_PORT,
    CONF_CONNECTION_TCP_HOST,
    CONF_CONNECTION_TCP_PORT,
    CONF_CONNECTION_TYPE,
    CONF_OPTION_ADD_ANOTHER_NODE,
    CONF_OPTION_FILTER_NODES,
    CONF_OPTION_NODE_GROUPS,
    CONF_OPTION_NODE,
    CONF_OPTION_NOTIFY_PLATFORM,
    CONF_OPTION_NOTIFY_PLATFORM_CHANNELS,
    CONF_OPTION_NOTIFY_PLATFORM_CHANNELS_DEFAULT,
    CONF_OPTION_NOTIFY_PLATFORM_NODES,
    CONF_OPTION_NOTIFY_PLATFORM_NODES_DEFAULT,
    CONF_OPTION_TCP_PROXY,
    CONF_OPTION_TCP_PROXY_ENABLE,
    CONF_OPTION_TCP_PROXY_ENABLE_DEFAULT,
    CONF_OPTION_TCP_PROXY_PORT,
    CONF_OPTION_TCP_PROXY_PORT_DEFAULT,
    CONF_OPTION_WEB_CLIENT_ENABLE,
    CONF_OPTION_WEB_CLIENT_ENABLE_DEFAULT,
    CONF_OPTION_WEB_CLIENT_PORT,
    CONF_OPTION_WEB_CLIENT_PORT_DEFAULT,
    CONF_OPTION_FEATURES,
    CONF_OPTION_FEATURES_PANEL,
    CONF_OPTION_FEATURES_PANEL_DEFAULT,
    CONF_OPTION_FEATURES_STATS,
    CONF_OPTION_FEATURES_STATS_DEFAULT,
    CONF_OPTION_FEATURES_MODE,
    FEATURES_MODE_PANEL_AND_STATS,
    FEATURES_MODE_PANEL_ONLY,
    FEATURES_MODE_STATS_ONLY,
    FEATURES_MODES,
    CURRENT_CONFIG_VERSION_MAJOR,
    DOMAIN,
    LOGGER,
    ConfigOptionNotifyPlatformNodes,
    ConnectionType,
)
from .helpers import device_config_entry_ids, node_identity_key
from .identity import node_signature

if TYPE_CHECKING:
    import asyncio
    from collections.abc import Mapping
    from typing import Any

    from habluetooth import BluetoothServiceInfo
    from homeassistant.components import zeroconf
    from homeassistant.components.usb import UsbServiceInfo
    from homeassistant.components.zeroconf import ZeroconfServiceInfo
    from homeassistant.config_entries import ConfigEntry, ConfigFlowResult
    from homeassistant.core import HomeAssistant
    from homeassistant.data_entry_flow import FlowResult

_LOGGER = LOGGER.getChild(__name__.removeprefix(f"{LOGGER.name}."))


def _step_user_data_connection_tcp_schema_factory(host: str = "", port: int | None = None) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_CONNECTION_TCP_HOST, default=host): cv.string,
            vol.Required(CONF_CONNECTION_TCP_PORT, default=port or TcpConnection.DEFAULT_TCP_PORT): cv.positive_int,
        }
    )


def _step_user_data_connection_bluetooth_schema_factory(address: str = "") -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_CONNECTION_BLUETOOTH_ADDRESS, default=address): cv.string,
        }
    )


def _step_user_data_connection_serial_schema_factory(device: str = "") -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_CONNECTION_SERIAL_PORT, default=device): cv.string,
        }
    )


NODE_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_OPTION_NODE): cv.string,
        vol.Optional(CONF_OPTION_ADD_ANOTHER_NODE): cv.boolean,
    }
)


def _build_add_node_schema(
    options: dict[str, Any],
    nodes: dict[int, Any],
    node_selection_required: bool = True,  # noqa: FBT001, FBT002
) -> vol.Schema:
    already_selected_node_nums = [el["id"] for el in options[CONF_OPTION_FILTER_NODES]]
    selectable_nodes = {
        node_id: node_info for node_id, node_info in nodes.items() if node_id not in already_selected_node_nums
    }
    if not selectable_nodes:
        return vol.Schema({})

    selector_options = [
        SelectOptionDict(
            value=str(node_id),
            label=f"{node_info['user']['longName']} ({node_info['user']['id']})",
        )
        for node_id, node_info in sorted(
            selectable_nodes.items(),
            key=lambda el: el[1].get("isFavorite", False),
            reverse=True,
        )
    ]

    return vol.Schema(
        {
            vol.Required(CONF_OPTION_NODE)
            if node_selection_required
            else vol.Optional(CONF_OPTION_NODE): SelectSelector(SelectSelectorConfig(options=selector_options)),
            vol.Optional(CONF_OPTION_ADD_ANOTHER_NODE): cv.boolean,
        }
    )


def _signature_fields(node: Mapping[str, Any]) -> dict[str, str]:
    """Krótka nazwa i model zapamiętane we wpisie filtra — pozwalają rozpoznać węzeł po zmianie numeru bez klucza."""
    sig = node_signature(node)
    return {"short_name": sig[1], "hw_model": sig[2]} if sig else {}


def _tracked_nodes_selector(
    nodes: Mapping[int, Any],
    tracked: list[Mapping[str, Any]],
    language: str,
) -> SelectSelector:
    """
    Jedna lista wielokrotnego wyboru z wszystkimi węzłami z bazy radia.

    Zastępuje dawny układ: osobna lista „Wybrane węzły" (same długie nazwy),
    osobne pole „Dodaj węzeł" i przełącznik „Dodaj kolejny węzeł", który
    przeładowywał formularz przy każdym dodawanym węźle. Etykieta zawiera
    długą i krótką nazwę oraz identyfikator, a kolejność to: śledzone,
    ulubione, reszta alfabetycznie.
    """
    polish = (language or "").lower().startswith("pl")
    missing_note = "nie ma go teraz w bazie radia" if polish else "not in the radio's node database right now"
    tracked_ids = {el["id"] for el in tracked}

    def label(node_id: int, node: Mapping[str, Any]) -> str:
        user = node.get("user", {}) or {}
        long_name = user.get("longName") or ""
        short_name = user.get("shortName") or ""
        node_hex = user.get("id") or f"!{node_id:08x}"
        details = ", ".join(part for part in (short_name, node_hex) if part)
        return f"{long_name} ({details})" if long_name else details

    entries = []
    for node_id, node in nodes.items():
        entries.append(
            (
                0 if node_id in tracked_ids else 1 if node.get("isFavorite") else 2,
                label(node_id, node).lower(),
                SelectOptionDict(value=str(node_id), label=label(node_id, node)),
            )
        )
    for el in tracked:
        if el["id"] not in nodes:
            name = el.get("name") or ""
            node_hex = f"!{el['id']:08x}"
            text = f"{name} ({node_hex}) — {missing_note}" if name else f"{node_hex} — {missing_note}"
            entries.append((0, text.lower(), SelectOptionDict(value=str(el["id"]), label=text)))
    entries.sort(key=lambda item: (item[0], item[1]))

    return SelectSelector(
        SelectSelectorConfig(
            options=[item[2] for item in entries],
            multiple=True,
            mode=SelectSelectorMode.DROPDOWN,
            sort=False,
        )
    )


def _build_notify_platform_schema(
    options: dict[str, Any],
) -> vol.Schema:
    node_selector = SelectSelector(
        SelectSelectorConfig(
            options=[str(v) for v in ConfigOptionNotifyPlatformNodes],
            translation_key="option_notify_platform_node_selector",
        )
    )

    return vol.Schema(
        {
            vol.Required(
                CONF_OPTION_NOTIFY_PLATFORM_CHANNELS,
                default=options.get(CONF_OPTION_NOTIFY_PLATFORM_CHANNELS, CONF_OPTION_NOTIFY_PLATFORM_CHANNELS_DEFAULT),
            ): cv.boolean,
            vol.Required(
                CONF_OPTION_NOTIFY_PLATFORM_NODES,
                default=options.get(CONF_OPTION_NOTIFY_PLATFORM_NODES, CONF_OPTION_NOTIFY_PLATFORM_NODES_DEFAULT),
            ): node_selector,
        }
    )


def _features_to_mode(features: Mapping[str, Any] | None) -> str:
    """Zapisane opcje (panel/stats) → wariant „Trybu pracy” pokazywany w formularzu."""
    features = features or {}
    panel = features.get(CONF_OPTION_FEATURES_PANEL, CONF_OPTION_FEATURES_PANEL_DEFAULT)
    stats = features.get(CONF_OPTION_FEATURES_STATS, CONF_OPTION_FEATURES_STATS_DEFAULT)
    if panel and not stats:
        return FEATURES_MODE_PANEL_ONLY
    if stats and not panel:
        return FEATURES_MODE_STATS_ONLY
    return FEATURES_MODE_PANEL_AND_STATS


def _mode_to_features(mode: str) -> dict[str, bool]:
    """Wariant „Trybu pracy” → zapisywane opcje panel/stats."""
    return {
        CONF_OPTION_FEATURES_PANEL: mode != FEATURES_MODE_STATS_ONLY,
        CONF_OPTION_FEATURES_STATS: mode != FEATURES_MODE_PANEL_ONLY,
    }


def _features_mode_selector() -> SelectSelector:
    """
    Wybór trybu jako lista opcji z opisami (przyciski radiowe).

    Wcześniej były to dwa gołe przełączniki bez wyjaśnienia, co każda część
    robi. Etykiety wariantów i szczegółowe opisy są w tłumaczeniach
    (selector.option_features_mode_selector oraz opis kroku).
    """
    return SelectSelector(
        SelectSelectorConfig(
            options=list(FEATURES_MODES),
            mode=SelectSelectorMode.LIST,
            translation_key="option_features_mode_selector",
            sort=False,
        )
    )


def _build_meshtastic_web_schema(
    options: dict[str, Any],
) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_OPTION_WEB_CLIENT_ENABLE,
                default=options.get(CONF_OPTION_WEB_CLIENT_ENABLE, CONF_OPTION_WEB_CLIENT_ENABLE_DEFAULT),
            ): cv.boolean,
            vol.Required(
                CONF_OPTION_WEB_CLIENT_PORT,
                default=options.get(CONF_OPTION_WEB_CLIENT_PORT, CONF_OPTION_WEB_CLIENT_PORT_DEFAULT),
            ): cv.positive_int,
        }
    )


def _build_meshtastic_tcp_schema(
    options: dict[str, Any],
) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_OPTION_TCP_PROXY_ENABLE,
                default=options.get(CONF_OPTION_TCP_PROXY_ENABLE, CONF_OPTION_TCP_PROXY_ENABLE_DEFAULT),
            ): cv.boolean,
            vol.Required(
                CONF_OPTION_TCP_PROXY_PORT,
                default=options.get(CONF_OPTION_TCP_PROXY_PORT, CONF_OPTION_TCP_PROXY_PORT_DEFAULT),
            ): cv.positive_int,
        }
    )

async def validate_web_client_port(hass: HomeAssistant, config_entry: ConfigEntry | None, data: dict[str, Any]) -> bool:
    if not data.get(CONF_OPTION_WEB_CLIENT, {}).get(CONF_OPTION_WEB_CLIENT_ENABLE, CONF_OPTION_WEB_CLIENT_ENABLE_DEFAULT):
        return True

    if config_entry is None:
        other_active_entries = hass.config_entries.async_entries(DOMAIN, include_ignore=False, include_disabled=False)
    else:
        other_active_entries = [
            e
            for e in hass.config_entries.async_entries(DOMAIN, include_ignore=False, include_disabled=False)
            if e.entry_id != config_entry.entry_id
        ]
    other_web_clients = [e.options.get(CONF_OPTION_WEB_CLIENT, {}) for e in other_active_entries]

    other_ports = {
        c.get(CONF_OPTION_WEB_CLIENT_PORT, CONF_OPTION_WEB_CLIENT_PORT_DEFAULT)
        for c in other_web_clients
        if c.get(CONF_OPTION_WEB_CLIENT_ENABLE, CONF_OPTION_WEB_CLIENT_ENABLE_DEFAULT)
    }

    port = data[CONF_OPTION_WEB_CLIENT].get(CONF_OPTION_WEB_CLIENT_PORT, CONF_OPTION_WEB_CLIENT_PORT_DEFAULT)
    if port in other_ports:
        return False

    port_changed = config_entry is None or port != config_entry.options.get(CONF_OPTION_WEB_CLIENT, {}).get(
        CONF_OPTION_WEB_CLIENT_PORT, CONF_OPTION_WEB_CLIENT_PORT_DEFAULT
    )
    if port_changed:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(("localhost", port)) == 0:
                    return False
        except:  # noqa: E722
            _LOGGER.debug("Failed to validate web client port", exc_info=True)

    return True


async def validate_input_for_connection(
    hass: HomeAssistant, data: dict[str, Any], *, no_nodes: bool = False
) -> tuple[Mapping[str, Any], Mapping[int, Mapping[str, Any]]]:
    try:
        async with MeshtasticApiClient(
            data,
            hass=hass,
            config_entry_id=None,
            no_nodes=no_nodes,
        ) as client:
            gateway_node = await client.async_get_own_node()
            nodes = await client.async_get_all_nodes()
            nodes = {
                node_id: node_info
                for node_id, node_info in nodes.items()
                if node_info.get("user", {}).get("hwModel") != "UNSET"
            }
            return gateway_node, nodes
    except IntegrationError as e:
        _LOGGER.warning("Failed to connect to meshtastic device", exc_info=True)
        raise CannotConnectError from e


async def validate_tcp_proxy_port(hass: HomeAssistant, config_entry: ConfigEntry | None, data: dict[str, Any]) -> bool:
    if not data.get(CONF_OPTION_TCP_PROXY, {}).get(CONF_OPTION_TCP_PROXY_ENABLE, CONF_OPTION_TCP_PROXY_ENABLE_DEFAULT):
        return True

    if config_entry is None:
        other_active_entries = hass.config_entries.async_entries(DOMAIN, include_ignore=False, include_disabled=False)
    else:
        other_active_entries = [
            e
            for e in hass.config_entries.async_entries(DOMAIN, include_ignore=False, include_disabled=False)
            if e.entry_id != config_entry.entry_id
        ]
    other_tcp_proxies = [e.options.get(CONF_OPTION_TCP_PROXY, {}) for e in other_active_entries]

    other_ports = {
        c.get(CONF_OPTION_TCP_PROXY_PORT, CONF_OPTION_TCP_PROXY_PORT_DEFAULT)
        for c in other_tcp_proxies
        if c.get(CONF_OPTION_TCP_PROXY_ENABLE, CONF_OPTION_TCP_PROXY_ENABLE_DEFAULT)
    }

    port = data[CONF_OPTION_TCP_PROXY].get(CONF_OPTION_TCP_PROXY_PORT, CONF_OPTION_TCP_PROXY_PORT_DEFAULT)
    if port in other_ports:
        return False

    port_changed = config_entry is None or port != config_entry.options.get(CONF_OPTION_TCP_PROXY, {}).get(
        CONF_OPTION_TCP_PROXY_PORT, CONF_OPTION_TCP_PROXY_PORT_DEFAULT
    )
    if port_changed:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(("localhost", port)) == 0:
                    return False
        except:  # noqa: E722
            _LOGGER.debug("Failed to validate tcp proxy port", exc_info=True)
            return False

    return True


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = CURRENT_CONFIG_VERSION_MAJOR
    MINOR_VERSION = CURRENT_CONFIG_VERSION_MINOR

    def __init__(self) -> None:
        self._bluetooth_discovery_info: BluetoothServiceInfo | None = None
        self._zeroconf_discovery_info: ZeroconfServiceInfo | None = None
        self._usb_discovery_info: UsbServiceInfo | None = None
        self.user_input_from_step_user: dict = None
        self.data = {}
        self.options = {}

        self._load_nodes_task: asyncio.Task | None = None
        # czy krok wyboru węzłów ma dociągnąć pełną bazę (połączenie bez węzłów)
        self._load_nodes_on_node_step = False

    async def _handle_connection_user_input(
        self, errors: dict[str, str], user_input: dict[str, Any] | None = None, *, no_full_load: bool = False
    ) -> ConfigFlowResult | None:
        try:
            data = dict(self.data)
            data.update(user_input)
            gateway_node, nodes = await validate_input_for_connection(self.hass, data, no_nodes=no_full_load)
        except CannotConnectError:
            errors["base"] = "cannot_connect"
        except:  # noqa: E722
            _LOGGER.warning("Unexpected exception", exc_info=True)
            errors["base"] = "unknown"
        else:
            # Checks that the device is actually unique, otherwise abort
            await self.async_set_unique_id(str(gateway_node["num"]))
            self._abort_if_unique_id_configured(updates=user_input)

            self.gateway_node = gateway_node
            self.nodes = nodes
            self.data.update(user_input)
            self.options = {CONF_OPTION_FILTER_NODES: []}
            self._load_nodes_on_node_step = no_full_load

            # Najpierw tryb pracy — od niego zależy, czy wybór węzłów ma sens.
            return await self.async_step_features()

        return None

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,  # noqa: ARG002
    ) -> FlowResult:
        return self.async_show_menu(step_id="user", menu_options=["manual_tcp", "manual_bluetooth", "manual_serial"])

    async def async_step_manual_tcp(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        self.data[CONF_CONNECTION_TYPE] = ConnectionType.TCP.value
        errors: dict[str, str] = {}
        if user_input is not None:
            res = await self._handle_connection_user_input(errors, user_input)
            if res is not None:
                return res

        # Show the form for step 1 with the user/host/pass as defined in STEP_USER_DATA_SCHEMA
        return self.async_show_form(
            step_id="manual_tcp",
            data_schema=_step_user_data_connection_tcp_schema_factory(
                self.data.get(CONF_CONNECTION_TCP_HOST), self.data.get(CONF_CONNECTION_TCP_PORT)
            ),
            errors=errors,
        )

    async def async_step_manual_bluetooth(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        self.data[CONF_CONNECTION_TYPE] = ConnectionType.BLUETOOTH.value
        errors: dict[str, str] = {}
        if user_input is not None:
            res = await self._handle_connection_user_input(errors, user_input)
            if res is not None:
                return res

        return self.async_show_form(
            step_id="manual_bluetooth",
            data_schema=_step_user_data_connection_bluetooth_schema_factory(
                self.data.get(CONF_CONNECTION_BLUETOOTH_ADDRESS)
            ),
            errors=errors,
        )

    async def async_step_manual_serial(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        self.data[CONF_CONNECTION_TYPE] = ConnectionType.SERIAL.value
        errors: dict[str, str] = {}
        if user_input is not None:
            res = await self._handle_connection_user_input(errors, user_input)
            if res is not None:
                return res

        return self.async_show_form(
            step_id="manual_serial",
            data_schema=_step_user_data_connection_serial_schema_factory(self.data.get(CONF_CONNECTION_SERIAL_PORT)),
            errors=errors,
        )

    async def async_step_bluetooth(self, discovery_info: BluetoothServiceInfo) -> ConfigFlowResult:
        self._bluetooth_discovery_info = discovery_info

        self.data = {
            CONF_CONNECTION_TYPE: ConnectionType.BLUETOOTH.value,
            CONF_CONNECTION_BLUETOOTH_ADDRESS: self._bluetooth_discovery_info.address,
        }

        all_entries = self.hass.config_entries.async_entries(DOMAIN, include_disabled=True, include_ignore=True)
        matching_entry = next(
            (
                c
                for c in all_entries
                if c.data.get(CONF_CONNECTION_TYPE) == self.data[CONF_CONNECTION_TYPE]
                and c.data.get(CONF_CONNECTION_BLUETOOTH_ADDRESS) == self.data[CONF_CONNECTION_BLUETOOTH_ADDRESS]
            ),
            None,
        )
        if matching_entry:
            # extract unique id from existing config entry (so that we don't need to connect to node to get node id
            # and might be interrupting the connection)
            await self.async_set_unique_id(matching_entry.unique_id)
        else:
            await self.async_set_unique_id(discovery_info.address)

        self._abort_if_unique_id_configured()

        return await self.async_step_discovery_bluetooth_confirm()

    async def async_step_discovery_bluetooth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        title = f"{self._bluetooth_discovery_info.name} ({self._bluetooth_discovery_info.address})"
        errors: dict[str, str] = {}

        self.context["title_placeholders"] = {
            "name": title,
        }

        if user_input is not None:
            res = await self._handle_connection_user_input(errors, user_input)
            if res is not None:
                return res

        return self.async_show_form(
            step_id="discovery_bluetooth_confirm",
            data_schema=_step_user_data_connection_bluetooth_schema_factory(
                self.data.get(CONF_CONNECTION_BLUETOOTH_ADDRESS)
            ),
            description_placeholders=self.context["title_placeholders"],
            errors=errors,
        )

    async def async_step_zeroconf(self, discovery_info: zeroconf.ZeroconfServiceInfo) -> ConfigFlowResult:
        self._zeroconf_discovery_info = discovery_info
        if discovery_info.type == "_http._tcp.local." and discovery_info.name != "Meshtastic._http._tcp.local.":
            return self.async_abort(reason="not_meshtastic_device")

        if discovery_info.type == "_meshtastic._tcp.local.":
            port = discovery_info.port or TcpConnection.DEFAULT_TCP_PORT
        else:
            port = TcpConnection.DEFAULT_TCP_PORT

        self.data = {
            CONF_CONNECTION_TYPE: ConnectionType.TCP.value,
            CONF_CONNECTION_TCP_HOST: discovery_info.host,
            CONF_CONNECTION_TCP_PORT: port,
        }

        all_entries = self.hass.config_entries.async_entries(DOMAIN, include_disabled=True, include_ignore=True)
        matching_entry = next(
            (
                c
                for c in all_entries
                if c.data.get(CONF_CONNECTION_TYPE) == self.data[CONF_CONNECTION_TYPE]
                and c.data.get(CONF_CONNECTION_TCP_HOST) == self.data[CONF_CONNECTION_TCP_HOST]
            ),
            None,
        )
        if matching_entry:
            # extract unique id from existing config entry (so that we don't need to connect to node to get node id
            # and might be interrupting the connection)
            await self.async_set_unique_id(matching_entry.unique_id)
        else:
            # Zmiana adresu IP: radio ogłasza się z innego hosta, ale w ogłoszeniu mDNS jest jego identyfikator
            # („!xxxxxxxx” = numer węzła). Jeśli pasuje do istniejącego wpisu, tylko aktualizujemy jego adres
            # zamiast proponować drugie, zdublowane urządzenie.
            known_entry = self._entry_for_announced_node(all_entries, discovery_info)
            if known_entry is not None:
                await self.async_set_unique_id(known_entry.unique_id)
                self._abort_if_unique_id_configured(updates={CONF_CONNECTION_TCP_HOST: discovery_info.host})
            await self.async_set_unique_id(discovery_info.host)

        self._abort_if_unique_id_configured()

        return await self.async_step_discovery_zeroconf_confirm()

    @staticmethod
    def _entry_for_announced_node(entries: list[Any], discovery_info: Any) -> Any | None:
        """Wpis TCP, którego numer węzła zgadza się z identyfikatorem w ogłoszeniu mDNS (albo None)."""
        try:
            raw = (discovery_info.properties or {}).get("id")
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", "ignore")
            raw = str(raw or "").strip().lstrip("!")
            if len(raw) != 8:
                return None
            num = str(int(raw, 16))
        except (TypeError, ValueError):
            return None
        return next(
            (
                entry
                for entry in entries
                if entry.unique_id == num and entry.data.get(CONF_CONNECTION_TYPE) == ConnectionType.TCP.value
            ),
            None,
        )

    async def async_step_discovery_zeroconf_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        title = self._zeroconf_discovery_info.host
        errors: dict[str, str] = {}

        self.context["title_placeholders"] = {
            "name": title,
        }

        if user_input is not None:
            res = await self._handle_connection_user_input(errors, user_input)
            if res is not None:
                return res

        return self.async_show_form(
            step_id="discovery_zeroconf_confirm",
            data_schema=_step_user_data_connection_tcp_schema_factory(
                host=self.data.get(CONF_CONNECTION_TCP_HOST, ""),
                port=self.data.get(CONF_CONNECTION_TCP_PORT, None),
            ),
            description_placeholders=self.context["title_placeholders"],
        )

    async def async_step_usb(self, discovery_info: UsbServiceInfo) -> ConfigFlowResult:
        self._usb_discovery_info = discovery_info

        self.data = {
            CONF_CONNECTION_TYPE: ConnectionType.SERIAL.value,
            CONF_CONNECTION_SERIAL_PORT: discovery_info.device,
        }

        all_entries = self.hass.config_entries.async_entries(DOMAIN, include_disabled=True, include_ignore=True)
        matching_entry = next(
            (
                c
                for c in all_entries
                if c.data.get(CONF_CONNECTION_TYPE) == self.data[CONF_CONNECTION_TYPE]
                and (c.data.get(CONF_CONNECTION_SERIAL_PORT) == self.data[CONF_CONNECTION_SERIAL_PORT])
            ),
            None,
        )
        if matching_entry:
            # extract unique id from existing config entry (so that we don't need to connect to node to get node id
            # and might be interrupting the connection)
            await self.async_set_unique_id(matching_entry.unique_id)
        else:
            await self.async_set_unique_id(discovery_info.device)

        self._abort_if_unique_id_configured()

        return await self.async_step_discovery_usb_confirm()

    async def async_step_discovery_usb_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        device_name = self._usb_discovery_info.manufacturer
        if self._usb_discovery_info.description:
            device_name += " " + self._usb_discovery_info.description
        title = f"{device_name} ({self._usb_discovery_info.device})"
        errors: dict[str, str] = {}

        self.context["title_placeholders"] = {
            "name": title,
        }

        if user_input is not None:
            res = await self._handle_connection_user_input(errors, user_input)
            if res is not None:
                return res

        return self.async_show_form(
            step_id="discovery_usb_confirm",
            data_schema=_step_user_data_connection_serial_schema_factory(
                device=self.data.get(CONF_CONNECTION_SERIAL_PORT, ""),
            ),
            description_placeholders=self.context["title_placeholders"],
        )

    async def async_step_features(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Tryb pracy: panel i/lub statystyki — z opisem, co każda część daje."""
        if user_input is not None:
            mode = user_input.get(CONF_OPTION_FEATURES_MODE, FEATURES_MODE_PANEL_AND_STATS)
            features = _mode_to_features(mode)
            self.options[CONF_OPTION_FEATURES] = features
            if features[CONF_OPTION_FEATURES_STATS]:
                return await self.async_step_node(
                    user_input=None, load_nodes=self._load_nodes_on_node_step
                )
            # bez statystyk nie ma encji, więc wybór węzłów i encji powiadomień odpada
            return await self.async_step_web_client()

        schema = vol.Schema(
            {
                vol.Required(
                    CONF_OPTION_FEATURES_MODE, default=FEATURES_MODE_PANEL_AND_STATS
                ): _features_mode_selector(),
            }
        )
        return self.async_show_form(step_id="features", data_schema=schema)

    async def async_step_node(
        self, user_input: dict[str, Any] | None = None, *, load_nodes: bool = False
    ) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            node_id = int(user_input[CONF_OPTION_NODE])
            if node_id not in self.nodes:
                errors["base"] = "invalid_node"

            if not errors:
                self.options[CONF_OPTION_FILTER_NODES].append(
                    {
                        "id": node_id,
                        "name": self.nodes[node_id]["user"]["longName"],
                        "identity_key": node_identity_key(node_id, self.nodes[node_id]),
                        **_signature_fields(self.nodes[node_id]),
                    }
                )
                if user_input.get(CONF_OPTION_ADD_ANOTHER_NODE, False):
                    return await self.async_step_node()

                return await self.async_step_notify_platform()
        elif load_nodes:
            _, self.nodes = await validate_input_for_connection(self.hass, self.data, no_nodes=False)

        schema = _build_add_node_schema(self.options, self.nodes)
        return self.async_show_form(step_id="node", data_schema=schema, errors=errors)

    async def async_step_notify_platform(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            self.options[CONF_OPTION_NOTIFY_PLATFORM] = user_input
            return await self.async_step_web_client()

        schema = _build_notify_platform_schema(user_input or {})
        return self.async_show_form(step_id="notify_platform", data_schema=schema, errors=errors)

    async def async_step_web_client(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            if not await validate_web_client_port(self.hass, None, {CONF_OPTION_WEB_CLIENT: user_input}):
                errors[CONF_OPTION_WEB_CLIENT_PORT] = "port_in_use"

            if not errors:
                self.options[CONF_OPTION_WEB_CLIENT] = user_input
                return await self.async_step_tcp_proxy()

        schema = _build_meshtastic_web_schema(user_input or {})
        return self.async_show_form(step_id="web_client", data_schema=schema, errors=errors)

    async def async_step_tcp_proxy(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            if not await validate_tcp_proxy_port(self.hass, None, {CONF_OPTION_TCP_PROXY: user_input}):
                errors[CONF_OPTION_TCP_PROXY_PORT] = "port_in_use"

            if not errors:
                self.options[CONF_OPTION_TCP_PROXY] = user_input
                return await self._finish_steps()

        schema = _build_meshtastic_tcp_schema(user_input or {})
        return self.async_show_form(step_id="tcp_proxy", data_schema=schema, errors=errors)

    async def _finish_steps(self) -> ConfigFlowResult:
        return self.async_create_entry(
            title=self.gateway_node["user"]["longName"], data=self.data, options=self.options
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlowHandler:
        return OptionsFlowHandler(config_entry)

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> FlowResult:  # noqa: ARG002
        config_entry = self.hass.config_entries.async_get_entry(self.context.get("entry_id"))

        self.data.update(config_entry.data)
        connection_type = config_entry.data[CONF_CONNECTION_TYPE]
        if connection_type == ConnectionType.TCP.value:
            return await self.async_step_manual_tcp()
        if connection_type == ConnectionType.BLUETOOTH.value:
            return await self.async_step_manual_bluetooth()
        if connection_type == ConnectionType.SERIAL.value:
            return await self.async_step_manual_serial()
        return self.async_abort(reason="invalid_connection_type")


class CannotConnectError(HomeAssistantError):
    pass


class OptionsFlowHandler(config_entries.OptionsFlow):
    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:  # noqa: ARG002
        self.options = {}
        self.nodes = None
        self._selected_node: int | None = None

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:  # noqa: ARG002
        """Menu główne: ustawienia, zarządzanie urządzeniami, zarządzanie obszarami."""
        return self.async_show_menu(step_id="init", menu_options=["settings", "devices", "areas"])

    def _is_polish(self) -> bool:
        return (self.hass.config.language or "").lower().startswith("pl")

    async def _load_radio(self) -> tuple[dict[int, Any], int | None] | None:
        """Węzły z bazy radia (bez nieznanych) i numer własnego węzła; None, gdy integracja jeszcze nie działa."""
        runtime = getattr(self.config_entry, "runtime_data", None)
        if runtime is None or not runtime.client:
            return None
        try:
            nodes = dict(await runtime.client.async_get_all_nodes())
        except Exception:  # noqa: BLE001
            nodes = dict(runtime.coordinator.data or {}) if runtime.coordinator else {}
        nodes = {n: i for n, i in nodes.items() if (i.get("user") or {}).get("hwModel") != "UNSET"}
        return nodes, (runtime.gateway_node or {}).get("num")

    def _area_name(self, num: int) -> str:
        from homeassistant.helpers import area_registry as ar  # noqa: PLC0415

        from .groups import device_for_node  # noqa: PLC0415

        device = device_for_node(self.hass, self.config_entry, num)
        area = ar.async_get(self.hass).async_get_area(device.area_id) if device is not None and device.area_id else None
        if area is not None:
            return area.name
        return "brak obszaru" if self._is_polish() else "no area"

    def _tracked_label(self, el: Mapping[str, Any]) -> str:
        return f"{el.get('name') or '!%08x' % el['id']} ({'!%08x' % el['id']}) — {self._area_name(el['id'])}"

    # --- Zarządzanie urządzeniami: osobne, jasno nazwane akcje ---

    # --- Zarządzanie obszarami: tworzenie, a po wejściu w obszar dodawanie, usuwanie urządzeń, zmiana nazwy, usunięcie ---

    def _area_devices(self, area_id: str) -> set[int]:
        """Numery zbieranych węzłów, których urządzenia są w tym obszarze."""
        from .groups import device_for_node  # noqa: PLC0415

        result: set[int] = set()
        for el in self.config_entry.options.get(CONF_OPTION_FILTER_NODES, []):
            device = device_for_node(self.hass, self.config_entry, el["id"])
            if device is not None and device.area_id == area_id:
                result.add(el["id"])
        return result

    # --- Zarządzanie urządzeniami: wszystko w jednym oknie ---

    @staticmethod
    def _radio_node_label(num: int, node: Mapping[str, Any]) -> str:
        user = node.get("user", {}) or {}
        details = ", ".join(part for part in (user.get("shortName") or "", user.get("id") or f"!{num:08x}") if part)
        return f"{user.get('longName')} ({details})" if user.get("longName") else details

    async def async_step_devices(self, user_input: dict[str, Any] | None = None) -> FlowResult:  # noqa: PLR0912, PLR0915
        """
        Jedno okno: lista zbieranych urządzeń (z akcją dla zaznaczonych), dodawanie nowych i scalanie duplikatów.

        Dodawanie pokazuje tylko urządzenia, których jeszcze nie zbierasz. Aplikacja sama podpowiada scalenia;
        po zaznaczeniu zostaje najświeższy węzeł, a stary znika z bazy, z listy urządzeń i z bazy radia,
        encje przechodzą na zostające urządzenie, więc zbieranie trwa dalej.
        """
        from .groups import assign_nodes_to_area  # noqa: PLC0415
        from .node_merge import find_merge_plans  # noqa: PLC0415

        loaded = await self._load_radio()
        if loaded is None:
            return self.async_abort(reason="not_loaded")
        polish = self._is_polish()
        tracked = [deepcopy(el) for el in self.config_entry.options.get(CONF_OPTION_FILTER_NODES, [])]
        tracked_ids = {el["id"] for el in tracked}
        if user_input is None:
            self._merge_nodes, self._merge_gateway = loaded
            self._merge_plans = find_merge_plans(self.hass, self.config_entry, *loaded)
        nodes = self._merge_live_nodes()
        own = getattr(self, "_merge_gateway", None)

        if user_input is not None:
            self._merge_options = deepcopy(dict(self.config_entry.options))
            self._merge_removals = []
            self._merge_changed = 0
            merged_any = False
            for index in (int(i) for i in user_input.get("merge", [])):
                if 0 <= index < len(self._merge_plans):
                    plan = self._merge_plans[index]
                    kept = max(plan.nums, key=lambda n: (nodes.get(n) or {}).get("lastHeard") or 0)
                    self._apply_merge_choice(plan, kept, remove_from_radio=True)
                    merged_any = True
            options = self._merge_options
            current = list(options.get(CONF_OPTION_FILTER_NODES, []))
            selected = {int(v) for v in user_input.get("selected", [])}
            action = user_input.get("action", "none")
            runtime = getattr(self.config_entry, "runtime_data", None)
            if action == "remove" and selected:
                if runtime is not None and runtime.coordinator:
                    for num in selected:
                        self.hass.async_create_task(runtime.coordinator.async_request_node_removal(num))
                current = [el for el in current if el["id"] not in selected]
            current_ids = {el["id"] for el in current}
            added: set[int] = set()
            for num in (int(v) for v in user_input.get("add_nodes", [])):
                info = nodes.get(num)
                if info is None or num == own or num in current_ids:
                    continue
                current.append(
                    {
                        "id": num,
                        "name": (info.get("user") or {}).get("longName") or f"!{num:08x}",
                        "identity_key": node_identity_key(num, info),
                        **_signature_fields(info),
                    }
                )
                added.add(num)
            options[CONF_OPTION_FILTER_NODES] = current
            area_id = user_input.get("area")
            targets = added | (selected if action == "area" else set())
            if area_id and targets:
                assign_nodes_to_area(self.hass, self.config_entry, targets, area_id)
            if merged_any:
                return await self._merge_finish()
            return self.async_create_entry(title="", data=options)

        fields: dict[Any, Any] = {}
        if tracked:
            fields[vol.Optional("selected", default=[])] = SelectSelector(
                SelectSelectorConfig(
                    options=[SelectOptionDict(value=str(el["id"]), label=self._tracked_label(el)) for el in tracked],
                    multiple=True,
                    mode=SelectSelectorMode.LIST,
                )
            )
            action_labels = (
                ("none", "Nic"),
                ("area", "Przypisz zaznaczone do obszaru"),
                ("remove", "Usuń zaznaczone ze zbierania"),
            ) if polish else (
                ("none", "Nothing"),
                ("area", "Assign ticked to the area"),
                ("remove", "Remove ticked from collection"),
            )
            fields[vol.Optional("action", default="none")] = SelectSelector(
                SelectSelectorConfig(
                    options=[SelectOptionDict(value=v, label=t) for v, t in action_labels],
                    mode=SelectSelectorMode.DROPDOWN,
                )
            )
        untracked = {n: i for n, i in nodes.items() if n not in tracked_ids and n != own}
        if untracked:
            ordered = sorted(
                untracked.items(),
                key=lambda kv: (0 if kv[1].get("isFavorite") else 1, self._radio_node_label(kv[0], kv[1]).lower()),
            )
            fields[vol.Optional("add_nodes", default=[])] = SelectSelector(
                SelectSelectorConfig(
                    options=[SelectOptionDict(value=str(n), label=self._radio_node_label(n, i)) for n, i in ordered],
                    multiple=True,
                    mode=SelectSelectorMode.DROPDOWN,
                )
            )
        fields[vol.Optional("area")] = AreaSelector()
        hint = "Nie ma nic do scalenia." if polish else "Nothing to merge."
        if self._merge_plans:
            fields[vol.Optional("merge", default=[])] = SelectSelector(
                SelectSelectorConfig(
                    options=[
                        SelectOptionDict(
                            value=str(index),
                            label=f"{plan.name or '?'} — {', '.join(f'!{n:08x}' for n in sorted(plan.nums))}",
                        )
                        for index, plan in enumerate(self._merge_plans)
                    ],
                    multiple=True,
                    mode=SelectSelectorMode.LIST,
                )
            )
            hint = (
                f"⚠️ Można scalić duplikaty: {len(self._merge_plans)} (pole „Scal duplikaty” niżej)."
                if polish
                else f"⚠️ Duplicates can be merged: {len(self._merge_plans)} (the “Merge duplicates” field below)."
            )
        return self.async_show_form(
            step_id="devices",
            data_schema=vol.Schema(fields),
            description_placeholders={"count": str(len(tracked)), "merge_hint": hint},
        )

    # --- Zarządzanie obszarami: wszystko w jednym oknie ---

    async def async_step_areas(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """
        Jedno okno: wybierz istniejący obszar (albo wpisz nazwę nowego) i dodaj, usuń urządzenia, zmień nazwę lub usuń obszar.

        W obszarze mogą być tylko urządzenia, które już zbierasz.
        """
        from homeassistant.helpers import area_registry as ar  # noqa: PLC0415
        from homeassistant.helpers import device_registry as dr  # noqa: PLC0415

        from .groups import assign_nodes_to_area, device_for_node, get_or_create_area  # noqa: PLC0415

        tracked = list(self.config_entry.options.get(CONF_OPTION_FILTER_NODES, []))
        if user_input is not None:
            registry = ar.async_get(self.hass)
            name = (user_input.get("new_name") or "").strip()
            area_id = user_input.get("area")
            add = {int(v) for v in user_input.get("add_nodes", [])}
            remove = {int(v) for v in user_input.get("remove_nodes", [])}
            if area_id:
                area = registry.async_get_area(area_id)
                if area is not None and user_input.get("delete_area"):
                    registry.async_delete(area_id)
                    return self.async_create_entry(title="", data=dict(self.config_entry.options))
                if area is not None and name and name != area.name:
                    registry.async_update(area_id, name=name)
            elif name:
                area_id = get_or_create_area(self.hass, name)
            if area_id:
                if add:
                    assign_nodes_to_area(self.hass, self.config_entry, add, area_id)
                device_registry = dr.async_get(self.hass)
                for num in remove & self._area_devices(area_id):
                    device = device_for_node(self.hass, self.config_entry, num)
                    if device is not None:
                        device_registry.async_update_device(device.id, area_id=None)
            return self.async_create_entry(title="", data=dict(self.config_entry.options))

        options = [SelectOptionDict(value=str(el["id"]), label=self._tracked_label(el)) for el in tracked]
        fields: dict[Any, Any] = {vol.Optional("area"): AreaSelector(), vol.Optional("new_name", default=""): str}
        if options:
            for key in ("add_nodes", "remove_nodes"):
                fields[vol.Optional(key, default=[])] = SelectSelector(
                    SelectSelectorConfig(options=options, multiple=True, mode=SelectSelectorMode.DROPDOWN)
                )
        fields[vol.Optional("delete_area", default=False)] = bool
        return self.async_show_form(step_id="areas", data_schema=vol.Schema(fields))

    # --- Scalanie duplikatów: lista znalezionych grup -> wybór, który węzeł zostaje -> potwierdzenie ---

    def _merge_live_nodes(self) -> dict[int, Any]:
        return dict(getattr(self, "_merge_nodes", {}) or {})

    def _apply_merge_choice(self, plan: Any, kept: int, remove_from_radio: bool) -> None:
        """Scal jedną grupę duplikatów: zostaje ``kept``, reszta znika z listy, a opcjonalnie z bazy radia."""
        from .node_merge import apply_merge_plan, plan_with_kept_node  # noqa: PLC0415

        nodes = self._merge_live_nodes()
        gateway = getattr(self, "_merge_gateway", None)
        plan = plan_with_kept_node(plan, kept, nodes)
        self._merge_changed += apply_merge_plan(self.hass, self.config_entry, plan)
        dropped = [n for n in plan.nums if n != kept and n != gateway]
        options = self._merge_options
        tracked = list(options.get(CONF_OPTION_FILTER_NODES, []))
        user = (nodes.get(kept) or {}).get("user") or {}
        was_tracked = any(e["id"] in plan.nums for e in tracked)
        new_tracked, seen_kept = [], False
        for entry_el in tracked:
            if entry_el["id"] == kept:
                seen_kept = True
                new_tracked.append({**entry_el, "identity_key": plan.target_key})
            elif entry_el["id"] in dropped:
                continue
            else:
                new_tracked.append(entry_el)
        if was_tracked and not seen_kept:
            template = next((e for e in tracked if e["id"] in dropped), {})
            new_tracked.append(
                {
                    **template,
                    "id": kept,
                    "name": user.get("longName") or template.get("name"),
                    "short_name": user.get("shortName") or template.get("short_name"),
                    "identity_key": plan.target_key,
                }
            )
        options[CONF_OPTION_FILTER_NODES] = new_tracked
        if remove_from_radio:
            self._merge_removals.extend(n for n in dropped if n in nodes)

    async def _merge_finish(self) -> FlowResult:
        from .node_merge import canonicalise_keys  # noqa: PLC0415

        runtime = getattr(self.config_entry, "runtime_data", None)
        if runtime is not None:
            canonicalise_keys(self.hass, self.config_entry, self._merge_live_nodes())
            for num in dict.fromkeys(self._merge_removals):
                self.hass.async_create_task(runtime.coordinator.async_request_node_removal(num))
        # zapis opcji przeładowuje wpis, więc encje dostaną nowe unique_id
        return self.async_create_entry(title="", data=self._merge_options)

    async def async_step_settings(self, user_input: dict[str, Any] | None = None) -> dict[str, Any]:  # noqa: PLR0912
        errors: dict[str, str] = {}

        if (
            hasattr(self.config_entry, "runtime_data")
            and self.config_entry.runtime_data
            and self.config_entry.runtime_data.client
        ):
            self.nodes = await self.config_entry.runtime_data.client.async_get_all_nodes()
            self.nodes = {
                node_id: node_info
                for node_id, node_info in self.nodes.items()
                if node_info.get("user", {}).get("hwModel") != "UNSET"
            }

        if self.nodes is None:
            try:
                _, self.nodes = await validate_input_for_connection(self.hass, self.config_entry.data)
            except CannotConnectError:
                errors["base"] = "cannot_connect"
            except:  # noqa: E722
                _LOGGER.warning("Unexpected exception", exc_info=True)
                errors["base"] = "unknown"

        if errors:
            return self.async_show_form(step_id="settings", errors=errors)

        current_filter_node_option = (
            self.options[CONF_OPTION_FILTER_NODES]
            if CONF_OPTION_FILTER_NODES in self.options
            else self.config_entry.options.get(CONF_OPTION_FILTER_NODES, [])
        )
        already_selected_node_ids = [el["id"] for el in current_filter_node_option]

        if user_input is not None:
            # zachowaj pozostałe opcje (np. sniffer MQTT), zmieniamy tylko to, co jest w tym formularzu
            new_data = dict(self.config_entry.options)
            selected_ids = {int(value) for value in user_input.get(CONF_OPTION_FILTER_NODES, [])}
            # kolejność i zapisane dane (identity_key) istniejących wpisów zostają
            updated_filter_node_option = [
                deepcopy(el) for el in current_filter_node_option if el["id"] in selected_ids
            ]
            removed_node_ids = [node_id for node_id in already_selected_node_ids if node_id not in selected_ids]
            for new_node_id in sorted(selected_ids - set(already_selected_node_ids)):
                node_info = self.nodes.get(new_node_id)
                if node_info is None:
                    continue
                updated_filter_node_option.append(
                    {
                        "id": new_node_id,
                        "name": node_info.get("user", {}).get("longName") or f"!{new_node_id:08x}",
                        "identity_key": node_identity_key(new_node_id, node_info),
                        **_signature_fields(node_info),
                    }
                )

            if (
                removed_node_ids
                and hasattr(self.config_entry, "runtime_data")
                and self.config_entry.runtime_data
                and self.config_entry.runtime_data.coordinator
            ):
                coordinator = self.config_entry.runtime_data.coordinator
                for node_id in removed_node_ids:
                    self.hass.async_create_task(coordinator.async_request_node_removal(node_id))

            new_data[CONF_OPTION_FILTER_NODES] = updated_filter_node_option

            if CONF_OPTION_FEATURES_MODE in user_input:
                new_data[CONF_OPTION_FEATURES] = _mode_to_features(user_input[CONF_OPTION_FEATURES_MODE])

            if CONF_OPTION_NOTIFY_PLATFORM in user_input:
                new_data[CONF_OPTION_NOTIFY_PLATFORM] = user_input[CONF_OPTION_NOTIFY_PLATFORM]

            if CONF_OPTION_WEB_CLIENT in user_input:
                if not await validate_web_client_port(self.hass, self.config_entry, user_input):
                    errors["base"] = "option_invalid"
                    errors["web_client"] = "port_in_use"
                else:
                    new_data[CONF_OPTION_WEB_CLIENT] = user_input[CONF_OPTION_WEB_CLIENT]

            if CONF_OPTION_TCP_PROXY in user_input:
                if not await validate_tcp_proxy_port(self.hass, self.config_entry, user_input):
                    errors["base"] = "option_invalid"
                    errors["tcp_proxy"] = "port_in_use"
                else:
                    new_data[CONF_OPTION_TCP_PROXY] = user_input[CONF_OPTION_TCP_PROXY]

            if not errors:
                return self.async_create_entry(
                    title="",
                    data=new_data,
                )

        features_options = (
            self.options[CONF_OPTION_FEATURES]
            if CONF_OPTION_FEATURES in self.options
            else self.config_entry.options.get(CONF_OPTION_FEATURES, {})
        )
        notify_options = (
            self.options[CONF_OPTION_NOTIFY_PLATFORM]
            if CONF_OPTION_NOTIFY_PLATFORM in self.options
            else self.config_entry.options.get(CONF_OPTION_NOTIFY_PLATFORM, {})
        )
        webclient_options = (
            self.options[CONF_OPTION_WEB_CLIENT]
            if CONF_OPTION_WEB_CLIENT in self.options
            else self.config_entry.options.get(CONF_OPTION_WEB_CLIENT, {})
        )
        tcp_proxy_options = (
            self.options[CONF_OPTION_TCP_PROXY]
            if CONF_OPTION_TCP_PROXY in self.options
            else self.config_entry.options.get(CONF_OPTION_TCP_PROXY, {})
        )
        options_schema = vol.Schema(
            {
                # najpierw co w ogóle działa, potem które węzły śledzić
                vol.Required(
                    CONF_OPTION_FEATURES_MODE, default=_features_to_mode(features_options)
                ): _features_mode_selector(),
                vol.Optional(
                    CONF_OPTION_FILTER_NODES,
                    default=[str(node_id) for node_id in already_selected_node_ids],
                ): _tracked_nodes_selector(self.nodes, current_filter_node_option, self.hass.config.language),
                vol.Required(CONF_OPTION_NOTIFY_PLATFORM): data_entry_flow.section(
                    _build_notify_platform_schema(notify_options), {"collapsed": True}
                ),
                vol.Required(CONF_OPTION_WEB_CLIENT): data_entry_flow.section(
                    _build_meshtastic_web_schema(webclient_options), {"collapsed": "web_client" not in errors}
                ),
                vol.Required(CONF_OPTION_TCP_PROXY): data_entry_flow.section(
                    # rozwinięta tylko wtedy, gdy jest w niej błąd do poprawienia
                    _build_meshtastic_tcp_schema(tcp_proxy_options), {"collapsed": "tcp_proxy" not in errors}
                ),
            }
        )
        return self.async_show_form(step_id="settings", data_schema=options_schema, errors=errors)
