# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

import asyncio
import contextlib
import socket
from asyncio import StreamReader, StreamWriter

from . import ClientApiConnectionError
from .streaming import StreamingClientTransport

# Po restarcie radio nie zamyka starego gniazda (po prostu znika), więc bez
# keepalive odczyt czekałby w nieskończoność. Z tymi wartościami jądro samo
# wykrywa martwe połączenie po ok. 60 s ciszy.
_KEEPALIVE_OPTIONS = (
    ("TCP_KEEPIDLE", 30),
    ("TCP_KEEPINTVL", 10),
    ("TCP_KEEPCNT", 3),
)
_CONNECT_TIMEOUT_SECONDS = 10


class TcpConnectionError(ClientApiConnectionError):
    pass


class TcpConnection(StreamingClientTransport):
    DEFAULT_TCP_PORT = 4403

    def __init__(self, host: str, port: int = DEFAULT_TCP_PORT) -> None:
        super().__init__()
        self._reader: StreamReader | None = None
        self._writer: StreamWriter | None = None
        self._host = host
        self._port = port

    def _can_read(self) -> bool:
        return self._reader is not None and not self._reader.at_eof()

    async def _read_bytes(self, n: int = -1, *, exactly: int | None = None) -> bytes | None:
        if not self._can_read():
            await self._disconnect()
            msg = "Can not read bytes"
            raise TcpConnectionError(msg)
        reader = self._reader
        try:
            if exactly is not None:
                return await reader.readexactly(n=exactly)
            return await reader.read(n=n)
        except (OSError, TimeoutError) as e:
            await self._disconnect()
            raise TcpConnectionError from e

    async def _write_bytes(self, data: bytes) -> bool:
        writer = self._writer
        if writer is None or writer.is_closing():
            return False

        try:
            writer.write(data)
        except (OSError, RuntimeError):
            await self._disconnect()
            return False
        return True

    async def _connect(self) -> None:
        self._logger.debug("Connecting to %s:%d", self._host, self._port)
        self._reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(self._host, self._port), timeout=_CONNECT_TIMEOUT_SECONDS
        )
        self._enable_keepalive()
        self._logger.debug("Connection successful")

    def _enable_keepalive(self) -> None:
        sock = self._writer.get_extra_info("socket") if self._writer is not None else None
        if sock is None:
            return
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            for name, value in _KEEPALIVE_OPTIONS:
                option = getattr(socket, name, None)
                if option is not None:
                    sock.setsockopt(socket.IPPROTO_TCP, option, value)
        except OSError:
            self._logger.debug("Could not enable TCP keepalive", exc_info=True)

    @property
    def is_connected(self) -> bool:
        return self._writer is not None and self._reader is not None and not self._reader.at_eof()

    async def _disconnect(self) -> None:
        writer = self._writer
        self._writer = None
        self._reader = None
        if writer is not None:
            with contextlib.suppress(Exception):
                writer.close()
