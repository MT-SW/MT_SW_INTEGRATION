# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Sniffer MQTT — niezależne źródło logu, obok istniejącego sniffera radiowego.

Radiowy sniffer (sniffer.py) widzi tylko to, co własne radio odebrało w eterze
i przekazało po API. Ten moduł podłącza się bezpośrednio do brokera MQTT,
którego używa moduł MQTT bramki (ta sama konfiguracja co istniejący proxy w
aiomeshtastic/interface.py — `_init_mqtt_client`/`_maintain_mqtt_connection`),
i subskrybuje WSZYSTKO na `{root}/2/e/#`, czyli cały ruch protobuf innych
bram publikujących na ten sam broker/temat — nie tylko własne radio.

Pakiety w MQTT są zaszyfrowane per-kanał (ServiceEnvelope.packet.encrypted).
Odszyfrowanie (mesh_crypto.py) wymaga PSK kanału, którego nazwa jest w
ServiceEnvelope.channel_id. Dopasowanie do lokalnie skonfigurowanego kanału:
  1. kanał z taką samą, jawnie ustawioną nazwą (settings.name) — pewne,
  2. jeśli żaden nie pasuje, a dokładnie jeden lokalny kanał nie ma ustawionej
     własnej nazwy (typowy pojedynczy kanał domyślny) — przyjmujemy, że to on.
Gdy dopasowanie się nie uda, wpis i tak trafia do logu — jako nieodczytany
("encrypted": True), tak samo jak dziś każdy nieznany pakiet w sniffer.py.

Włącz/wyłącz tego sniffera jest w pełni po stronie integracji (nie firmware),
więc stan — w przeciwieństwie do sniffera radiowego — jest zwykłą opcją
konfiguracyjną (const.CONF_OPTION_MQTT_SNIFFER), a nie czymś, co trzeba
odpytywać z radia po każdym starcie.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import TYPE_CHECKING, Any

from google.protobuf.message import DecodeError

from .aiomeshtastic import mesh_crypto
from .aiomeshtastic.protobuf import mesh_pb2, mqtt_pb2, portnums_pb2
from .const import LOGGER

try:
    import aiomqtt
    from aiomqtt import MqttError

    _HAS_AIOMQTT = True
except ImportError:  # pragma: no cover - aiomqtt jest w manifest.json requirements
    _HAS_AIOMQTT = False

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from homeassistant.core import HomeAssistant

    from .store import PanelStore

RECONNECT_DELAY_SECONDS = 5


def _base64_bytes(data: bytes) -> str:
    import base64

    return base64.b64encode(data).decode()


class MqttSniffer:
    """Utrzymuje jedno niezależne połączenie MQTT i karmi wspólny SnifferLog."""

    def __init__(self, hass: HomeAssistant, get_client: Callable[[], Any]) -> None:
        self._hass = hass
        self._get_client = get_client
        self._task: asyncio.Task | None = None
        self._client: aiomqtt.Client | None = None
        self._connected = False
        self._channels_cache: list[dict[str, Any]] = []
        self._channels_cache_at = 0.0
        self.last_error: str | None = None

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def connected(self) -> bool:
        return self._connected

    def start(self, on_entry: Callable[[dict[str, Any]], None]) -> None:
        """Synchroniczne, bo wywoływane z PanelStore.async_start (który sam nie jest coroutine)."""
        if not _HAS_AIOMQTT:
            self.last_error = "aiomqtt_missing"
            return
        if self.is_running:
            return
        self.last_error = None
        self._task = self._hass.async_create_background_task(
            self._run(on_entry), "meshtastic-mqtt-sniffer"
        )

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        self._connected = False

    async def _run(self, on_entry: Callable[[dict[str, Any]], None]) -> None:
        while True:
            try:
                mqtt_config = self._resolve_mqtt_config()
            except LookupError as err:
                self.last_error = str(err)
                LOGGER.debug("MQTT sniffer: %s", err)
                await asyncio.sleep(RECONNECT_DELAY_SECONDS)
                continue

            topic = f"{mqtt_config['root']}/2/e/#"
            try:
                self._client = aiomqtt.Client(**mqtt_config["client_kwargs"])
                async with self._client:
                    self._connected = True
                    self.last_error = None
                    LOGGER.debug("MQTT sniffer: connected, subscribing to %s", topic)
                    await self._client.subscribe(topic)
                    async for message in self._client.messages:
                        self._handle_message(message, on_entry)
            except MqttError as err:
                self.last_error = str(err)
                LOGGER.warning("MQTT sniffer connection error: %s", err)
            except asyncio.CancelledError:
                raise
            finally:
                self._connected = False

            await asyncio.sleep(RECONNECT_DELAY_SECONDS)

    def _resolve_mqtt_config(self) -> dict[str, Any]:
        """Ta sama konfiguracja co proxy MQTT bramki (adres/login/TLS z modułu MQTT radia)."""
        client = self._get_client()
        if client is None or client.interface is None:
            msg = "gateway_not_ready"
            raise LookupError(msg)

        module_config = client.interface.connected_node_module_config()
        if module_config is None or not module_config.mqtt.enabled:
            msg = "mqtt_module_disabled"
            raise LookupError(msg)

        mqtt = module_config.mqtt
        broker = mqtt.address or "mqtt.meshtastic.org"
        hostname, _, port_str = broker.partition(":")
        port = int(port_str) if port_str else 1883

        from homeassistant.util.ssl import get_default_context  # noqa: PLC0415

        return {
            "root": mqtt.root or "msh",
            "client_kwargs": {
                "hostname": hostname,
                "port": port,
                "username": mqtt.username or None,
                "password": mqtt.password or None,
                "tls_context": get_default_context() if mqtt.tls_enabled else None,
                "identifier": "ha-meshtastic-sniffer",
            },
        }

    async def _channels(self) -> list[dict[str, Any]]:
        """Kanały lokalnej bramki (nazwa + PSK) — odświeżane co minutę, nie przy każdym pakiecie."""
        import time  # noqa: PLC0415

        now = time.monotonic()
        if now - self._channels_cache_at < 60 and self._channels_cache:
            return self._channels_cache
        client = self._get_client()
        if client is None:
            return self._channels_cache
        try:
            raw_channels = await client.async_get_channels()
        except Exception as err:  # noqa: BLE001 - brak kanałów nie może zabić sniffera
            LOGGER.debug("MQTT sniffer: nie udało się pobrać kanałów: %s", err)
            return self._channels_cache
        self._channels_cache = list(raw_channels or [])
        self._channels_cache_at = now
        return self._channels_cache

    def _resolve_psk(self, channel_id: str, channels: list[dict[str, Any]]) -> bytes | None:
        import base64  # noqa: PLC0415

        unnamed_psks = []
        for channel in channels:
            settings = channel.get("settings", {}) or {}
            name = settings.get("name") or ""
            psk_b64 = settings.get("psk") or ""
            if not psk_b64:
                continue
            try:
                psk = base64.b64decode(psk_b64)
            except (ValueError, TypeError):
                continue
            if name == channel_id:
                return psk
            if not name:
                unnamed_psks.append(psk)
        # Jedyny kanał bez własnej nazwy w konfiguracji — najczęstszy przypadek
        # (domyślny kanał podstawowy, którego nazwa MQTT to nazwa presetu).
        if len(unnamed_psks) == 1:
            return unnamed_psks[0]
        return None

    def _handle_message(self, message: Any, on_entry: Callable[[dict[str, Any]], None]) -> None:
        try:
            envelope = mqtt_pb2.ServiceEnvelope()
            envelope.ParseFromString(bytes(message.payload))
        except DecodeError:
            return
        if not envelope.HasField("packet"):
            return

        self._hass.async_create_background_task(
            self._decode_and_emit(envelope, on_entry), "meshtastic-mqtt-sniffer-decode"
        )

    async def _decode_and_emit(self, envelope: Any, on_entry: Callable[[dict[str, Any]], None]) -> None:
        packet = envelope.packet
        entry_packet = self._packet_to_dict(packet, envelope.channel_id, envelope.gateway_id)

        if packet.HasField("encrypted") and len(packet.encrypted) > 0:
            channels = await self._channels()
            psk = self._resolve_psk(envelope.channel_id, channels)
            if psk is not None:
                try:
                    raw = mesh_crypto.decrypt_payload(
                        bytes(packet.encrypted), psk, packet.id, getattr(packet, "from")
                    )
                    data = mesh_pb2.Data()
                    data.ParseFromString(raw)
                except (ValueError, DecodeError):
                    pass
                else:
                    entry_packet["decoded"] = {
                        "portnum": portnums_pb2.PortNum.Name(data.portnum),
                        "payload": _base64_bytes(data.payload),
                    }

        on_entry(entry_packet)

    @staticmethod
    def _packet_to_dict(packet: mesh_pb2.MeshPacket, channel_id: str, gateway_id: str) -> dict[str, Any]:
        return {
            "from": getattr(packet, "from"),
            "to": packet.to,
            "id": packet.id,
            "channel": packet.channel,
            "encrypted": _base64_bytes(packet.encrypted) if packet.encrypted else "",
            "rxSnr": packet.rx_snr or None,
            "rxRssi": packet.rx_rssi or None,
            "hopLimit": packet.hop_limit,
            "hopStart": packet.hop_start,
            "relayNode": packet.relay_node or None,
            "wantAck": packet.want_ack,
            "viaMqtt": packet.via_mqtt,
            "xeddsaSigned": packet.xeddsa_signed,
            "pkiEncrypted": packet.pki_encrypted,
            # dodatkowe pola spoza sniffer.py.build_entry — panel może je pokazać osobno
            "mqtt_channel_name": channel_id,
            "mqtt_gateway_id": gateway_id,
        }
