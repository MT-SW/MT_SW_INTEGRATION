# SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
#
# SPDX-License-Identifier: MIT

from .protobuf import mesh_pb2


class MeshtasticError(Exception):
    pass


class MeshInterfaceError(MeshtasticError):
    pass


class MeshInterfaceRequestError(MeshtasticError):
    """Request got no ACK / no response in time. ``reason``: "no_ack" | "no_response" | None."""

    def __init__(self, message: str = "", reason: str | None = None) -> None:
        super().__init__(message)
        self.reason = reason


class MeshRoutingError(MeshtasticError):
    def __init__(self, error: mesh_pb2.Routing.Error) -> None:
        self._error = error
        super().__init__(f"Routing error: {error}")

    @property
    def error(self) -> int:
        return int(self._error)
