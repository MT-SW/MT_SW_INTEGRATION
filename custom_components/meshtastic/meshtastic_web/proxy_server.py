"""
Per-gateway HTTP proxy server for the bundled meshtastic web client.

meshtastic/web's "Connections" page (since v2.7.1) validates its "URL or IP"
field against a bare `host[:port]` pattern only - no path component is
accepted, so the previous approach of proxying multiple gateways under
distinct paths on Home Assistant's own port is unreachable from the client
entirely. Each gateway that enables the web client instead gets its own
dedicated port here, mirroring how meshtastic_tcp's raw TCP proxy already
does the same thing for the same underlying reason.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime
from typing import TYPE_CHECKING

from aiohttp import web
from google.protobuf import message

from ..aiomeshtastic.protobuf import mesh_pb2, portnums_pb2  # noqa: TID252
from ..api import (  # noqa: TID252
    ATTR_EVENT_MESHTASTIC_API_CONFIG_ENTRY_ID,
    ATTR_EVENT_MESHTASTIC_API_DATA,
    ATTR_EVENT_MESHTASTIC_API_NODE,
    EVENT_MESHTASTIC_API_TEXT_MESSAGE_OUT,
)
from ..const import LOGGER  # noqa: TID252

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from ..aiomeshtastic.connection import ClientApiConnection  # noqa: TID252
    from ..aiomeshtastic.interface import MeshInterface  # noqa: TID252
    from ..data import MeshtasticConfigEntry  # noqa: TID252

_LOGGER = LOGGER.getChild(__name__.removeprefix(f"{LOGGER.name}."))

_SESSION_IDLE_TIMEOUT = datetime.timedelta(minutes=1)
_SESSION_SWEEP_INTERVAL_SECONDS = 30


def _add_protobuf_headers(response: web.Response) -> None:
    response.headers.add("Content-Type", "application/x-protobuf")
    response.headers.add(
        "X-Protobuf-Schema", "https://raw.githubusercontent.com/meshtastic/protobufs/master/meshtastic/mesh.proto"
    )


@web.middleware
async def _cors_middleware(request: web.Request, handler: web.Handler) -> web.StreamResponse:
    try:
        response = await handler(request)
    except web.HTTPException as exc:
        response = exc
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, PUT, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


class GatewayWebProxyServer:
    """Serves the meshtastic HTTP device API for exactly one gateway config entry."""

    def __init__(self, hass: HomeAssistant, entry: MeshtasticConfigEntry, port: int) -> None:
        self._hass = hass
        self._entry = entry
        self._port = port
        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None
        self._session_queues: dict[str, asyncio.Queue[mesh_pb2.FromRadio]] = {}
        self._session_consumers: dict[str, asyncio.Task] = {}
        self._session_last_active: dict[str, datetime.datetime] = {}
        self._sweep_task: asyncio.Task | None = None

    async def start(self) -> None:
        app = web.Application(middlewares=[_cors_middleware])
        app.router.add_route("OPTIONS", "/api/v1/toradio", self._handle_options)
        app.router.add_put("/api/v1/toradio", self._handle_to_radio)
        app.router.add_get("/api/v1/fromradio", self._handle_from_radio)
        app.router.add_get("/hotspot-detect.html", self._handle_hotspot)
        app.router.add_get("/json/report", self._handle_json_report)

        self._runner = web.AppRunner(app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, "0.0.0.0", self._port)  # noqa: S104
        await self._site.start()

        self._sweep_task = asyncio.create_task(
            self._sweep_idle_sessions(), name=f"meshtastic_web_proxy_sweep_{self._entry.entry_id}"
        )

    async def stop(self) -> None:
        if self._sweep_task is not None:
            self._sweep_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._sweep_task
            self._sweep_task = None

        for task in self._session_consumers.values():
            task.cancel()
        self._session_consumers.clear()
        self._session_queues.clear()
        self._session_last_active.clear()

        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
            self._site = None

    def _publish_text_message_out_event(self, to_radio: mesh_pb2.ToRadio) -> None:
        packet = to_radio.packet
        if packet.decoded.portnum != portnums_pb2.TEXT_MESSAGE_APP:
            return

        interface = self._get_interface()
        if interface is None:
            return
        own_node = interface.connected_node()
        if not own_node:
            return
        gateway_id = own_node["num"]

        to_channel = packet.channel if packet.to == 0xFFFFFFFF else None  # noqa: PLR2004
        to_node = None if to_channel is not None else packet.to

        self._hass.bus.async_fire(
            EVENT_MESHTASTIC_API_TEXT_MESSAGE_OUT,
            {
                ATTR_EVENT_MESHTASTIC_API_CONFIG_ENTRY_ID: self._entry.entry_id,
                ATTR_EVENT_MESHTASTIC_API_NODE: gateway_id,
                ATTR_EVENT_MESHTASTIC_API_DATA: {
                    "from": gateway_id,
                    "to": {"node": to_node, "channel": to_channel},
                    "gateway": gateway_id,
                    "message": packet.decoded.payload.decode("utf-8", errors="replace"),
                },
                "message_id": packet.id,
            },
        )

    def _get_interface(self) -> MeshInterface | None:
        runtime_data = self._entry.runtime_data
        if runtime_data is None:
            return None
        return runtime_data.client._interface  # noqa: SLF001

    def _get_connection(self) -> ClientApiConnection | None:
        interface = self._get_interface()
        if interface is None:
            return None
        return interface._connection  # noqa: SLF001

    async def _wait_for_reconnect_idle(self) -> None:
        # Same one-shot-latch problem as meshtastic_tcp's proxy (fix-3.25) — a
        # write here mid-handshake races the reconnect and can wedge the read
        # loop, so hold off on every send while a reconnect is in flight.
        interface = self._get_interface()
        if interface is None:
            return
        while interface._reconnect_lock.locked():  # noqa: SLF001
            await asyncio.sleep(0.05)

    async def _sweep_idle_sessions(self) -> None:
        while True:
            await asyncio.sleep(_SESSION_SWEEP_INTERVAL_SECONDS)
            now = datetime.datetime.now(tz=datetime.UTC)
            idle_remotes = [
                remote
                for remote, last_active in self._session_last_active.items()
                if now - last_active > _SESSION_IDLE_TIMEOUT
            ]
            for remote in idle_remotes:
                self._remove_session(remote)

    def _add_session(self, remote: str) -> asyncio.Queue[mesh_pb2.FromRadio]:
        self._remove_session(remote)

        queue: asyncio.Queue[mesh_pb2.FromRadio] = asyncio.Queue()
        self._session_queues[remote] = queue
        self._session_last_active[remote] = datetime.datetime.now(tz=datetime.UTC)

        async def consume() -> None:
            try:
                while True:
                    interface = self._get_interface()
                    if interface is None:
                        await asyncio.sleep(10)
                        continue
                    try:
                        async for packet in interface.from_radio_stream():
                            await queue.put(packet)
                    except asyncio.CancelledError:
                        break
            except Exception:  # noqa: BLE001
                _LOGGER.info("Consume from_radio for session %s stopped unexpectedly", remote, exc_info=True)
            else:
                _LOGGER.info("Consume from_radio for session %s stopped", remote)

        self._session_consumers[remote] = asyncio.create_task(consume(), name=f"meshtastic_web_proxy_consume_{remote}")
        return queue

    def _remove_session(self, remote: str) -> None:
        self._session_queues.pop(remote, None)
        self._session_last_active.pop(remote, None)
        consumer = self._session_consumers.pop(remote, None)
        if consumer is not None:
            consumer.cancel()

    async def _handle_options(self, request: web.Request) -> web.Response:  # noqa: ARG002
        return web.Response()

    async def _handle_to_radio(self, request: web.Request) -> web.Response:
        connection = self._get_connection()
        if connection is None:
            await asyncio.sleep(1)
            raise web.HTTPNotFound(reason="No connection")

        if request.content_type != "application/x-protobuf":
            await asyncio.sleep(1)
            return web.HTTPNotAcceptable()

        body = await request.read()
        to_radio = mesh_pb2.ToRadio()
        try:
            to_radio.ParseFromString(body)
        except message.DecodeError:
            return web.HTTPBadRequest()

        response = web.Response()
        if to_radio.HasField("want_config_id"):
            self._add_session(request.remote)
        if to_radio.HasField("packet"):
            self._publish_text_message_out_event(to_radio)

        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._wait_for_reconnect_idle(), timeout=5)

        await connection._send_packet(body)  # noqa: SLF001
        _add_protobuf_headers(response)
        return response

    async def _handle_from_radio(self, request: web.Request) -> web.Response:
        queue = self._session_queues.get(request.remote)
        if queue is None:
            await asyncio.sleep(1)
            response = web.HTTPGone()
            response.headers.add("Cache-Control", "no-cache")
            return response

        self._session_last_active[request.remote] = datetime.datetime.now(tz=datetime.UTC)
        try:
            from_radio = await asyncio.wait_for(queue.get(), timeout=10.0)
            binary = from_radio.SerializeToString()
        except TimeoutError:
            binary = b""

        response = web.Response(body=binary)
        response.headers.add("Cache-Control", "no-cache")
        _add_protobuf_headers(response)
        return response

    async def _handle_hotspot(self, request: web.Request) -> web.Response:  # noqa: ARG002
        return web.HTTPOk()

    async def _handle_json_report(self, request: web.Request) -> web.Response:  # noqa: ARG002
        return web.json_response(data={"status": "ok", "data": {}})
