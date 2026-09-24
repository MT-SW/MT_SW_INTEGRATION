# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

import asyncio
import contextlib
from collections.abc import AsyncIterable
from types import TracebackType
from typing import Self

from ..protobuf import mesh_pb2  # noqa: TID252


class ClientApiConnectionPacketStreamListener:
    """
    Kolejka pakietów dla jednego konsumenta strumienia z radia.

    Dostarczanie jest nieblokujące: czytnik gniazda nigdy nie czeka na
    wolnego konsumenta. Wcześniej kolejka miała 16 miejsc i blokujące put(),
    więc jeden wolny konsument (np. obsługa zdarzeń HA przy dużej bazie
    węzłów) wstrzymywał odczyt z gniazda — bufor nadawczy radia się zapychał,
    a firmware zrywało połączenie. Przy przepełnieniu wypada najstarszy
    pakiet, nie cały strumień.
    """

    def __init__(self, queue_size: int = 2048) -> None:
        self._failure: Exception | None = None
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=queue_size)
        self._closed = asyncio.Event()
        self._signal = asyncio.Event()
        self.dropped = 0

    def notify_nowait(self, packet: mesh_pb2.FromRadio) -> None:
        if self._closed.is_set():
            return
        try:
            self._queue.put_nowait(packet)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                self._queue.get_nowait()
            self.dropped += 1
            self._queue.put_nowait(packet)
        self._signal.set()

    async def notify(self, packet: mesh_pb2.FromRadio) -> None:
        self.notify_nowait(packet)

    def __aiter__(self) -> Self:
        return self

    async def __anext__(self) -> mesh_pb2.FromRadio:
        while True:
            if not self._queue.empty():
                return self._queue.get_nowait()
            self._stop_if_needed()
            self._signal.clear()
            if not self._queue.empty() or self._closed.is_set():
                continue
            await self._signal.wait()

    def _stop_if_needed(self) -> None:
        if self._closed.is_set():
            if self._failure is not None:
                raise self._failure

            raise StopAsyncIteration

    def packets(self) -> AsyncIterable[mesh_pb2.FromRadio]:
        return self

    def close(self) -> None:
        if self._closed.is_set():
            return

        self._closed.set()
        self._signal.set()

    def set_failure(self, e: Exception) -> None:
        self._failure = e
        self._closed.set()
        self._signal.set()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None
    ) -> None:
        self.close()
