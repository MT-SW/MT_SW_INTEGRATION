# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Czyszczenie bazy węzłów radia — ręczne (z podglądem) i automatyczne.

Odpowiednik czyszczenia bazy węzłów z aplikacji na Androida: wybieramy, jak długo węzły
mają być nieaktywne (czas od ostatniego odezwania się) i czy usuwać znane, czy nieznane,
widzimy, ile ich zostanie usuniętych, i dopiero wtedy kasujemy. Do usuwania służy to samo polecenie co przy ręcznym
usuwaniu węzła (client.async_remove_node): potwierdzone przez radio, więc każdy
węzeł to jedna wiadomość administracyjna i chwila oczekiwania na ACK.

Nigdy nie usuwamy: własnej bramki, ulubionych, ignorowanych ani węzłów śledzonych
przez Home Assistanta (mają encje) — ich usunięcie z radia niczego by nie
oczyściło, a psułoby to, co użytkownik świadomie zostawił.
"""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping

DAY_SECONDS = 86400
REMOVE_TIMEOUT_SECONDS = 20
PREVIEW_LIMIT = 100
KINDS = ("all", "unknown", "known")

AUTO_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "inactivity_days": 30,
    "interval_days": 7,
    "last_run": None,  # sekundy epoki, kiedy ostatnio sprawdzono
    "last_removed": 0,  # ile węzłów usunęło ostatnie automatyczne czyszczenie
}


class NoCriteriaError(ValueError):
    """Nie wybrano ani nieaktywności, ani rodzaju — to byłoby wyczyszczenie całej bazy."""


def node_is_unknown(node: Mapping[str, Any]) -> bool:
    """Nieznany = radio nie dostało jeszcze od węzła jego danych użytkownika (nazwy)."""
    user = node.get("user") or {}
    return not (user.get("longName") or user.get("shortName"))


def _last_heard(node: Mapping[str, Any]) -> int | None:
    value = node.get("lastHeard")
    return int(value) if isinstance(value, int | float) and value > 0 else None


def select_candidates(  # noqa: PLR0913
    nodes: Mapping[int, Mapping[str, Any]],
    *,
    own_node: int | None,
    protected: Iterable[int] = (),
    inactive_days: int = 0,
    kind: str = "all",
    now: float | None = None,
) -> list[dict[str, Any]]:
    """Węzły do usunięcia, od najdłużej nieaktywnych; węzeł musi spełnić wszystkie wybrane warunki.

    inactive_days to czas od ostatniego odezwania się węzła (lastHeard). Węzeł, którego
    radio nigdy nie słyszało (brak lastHeard), jest nieaktywny od zawsze — przy filtrze
    nieaktywności wpada do wyniku.
    """
    if kind not in KINDS:
        msg = f"kind must be one of {KINDS}"
        raise ValueError(msg)
    if not inactive_days and kind == "all":
        raise NoCriteriaError
    now = time.time() if now is None else now
    cutoff = now - inactive_days * DAY_SECONDS if inactive_days else None
    skip = set(protected)

    found: list[dict[str, Any]] = []
    for node_id, node in nodes.items():
        if node_id == own_node or node_id in skip or node.get("isFavorite") or node.get("isIgnored"):
            continue
        unknown = node_is_unknown(node)
        if (kind == "unknown" and not unknown) or (kind == "known" and unknown):
            continue
        heard = _last_heard(node)
        if cutoff is not None and heard is not None and heard >= cutoff:
            continue
        user = node.get("user") or {}
        found.append(
            {
                "node_id": node_id,
                "node_hex": f"!{node_id:08x}" if isinstance(node_id, int) else None,
                "long_name": user.get("longName"),
                "short_name": user.get("shortName"),
                "known": not unknown,
                "last_heard": heard,
            }
        )
    found.sort(key=lambda item: item["last_heard"] or 0)
    return found


def normalize_auto(raw: Mapping[str, Any] | None) -> dict[str, Any]:
    """Ustawienia automatycznego czyszczenia z dysku albo z żądania — zawsze w dozwolonych granicach."""
    settings = dict(AUTO_DEFAULTS)
    if not isinstance(raw, dict):
        return settings
    settings["enabled"] = bool(raw.get("enabled", False))
    for key, low, high in (("inactivity_days", 1, 365), ("interval_days", 1, 90)):
        value = raw.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            settings[key] = max(low, min(high, value))
    last_run = raw.get("last_run")
    settings["last_run"] = last_run if isinstance(last_run, int | float) else None
    removed = raw.get("last_removed")
    settings["last_removed"] = removed if isinstance(removed, int) and removed >= 0 else 0
    return settings


class CleanupJob:
    """Stan jednego zadania usuwania, do odczytu przez panel (postęp)."""

    def __init__(self) -> None:
        self.state = "idle"  # idle | running | done
        self.source = "manual"  # manual | auto
        self.total = 0
        self.processed = 0
        self.removed = 0
        self.failed = 0
        self.started_at: int | None = None
        self.finished_at: int | None = None

    @property
    def running(self) -> bool:
        return self.state == "running"

    def begin(self, total: int, source: str) -> None:
        self.state = "running"
        self.source = source
        self.total = total
        self.processed = self.removed = self.failed = 0
        self.started_at = int(time.time() * 1000)
        self.finished_at = None

    def finish(self) -> None:
        self.state = "done"
        self.finished_at = int(time.time() * 1000)

    async def run(self, client: Any, node_ids: Iterable[int]) -> None:
        """Usuwaj po kolei; błąd jednego węzła (brak ACK, przekroczenie czasu) nie przerywa reszty."""
        for node_id in node_ids:
            try:
                removed = await asyncio.wait_for(client.async_remove_node(node_id), timeout=REMOVE_TIMEOUT_SECONDS)
            except Exception:  # noqa: BLE001 - jeden nieodpowiadający węzeł nie może zatrzymać czyszczenia
                removed = False
            if removed:
                self.removed += 1
            else:
                self.failed += 1
            self.processed += 1

    def status(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "source": self.source,
            "total": self.total,
            "processed": self.processed,
            "removed": self.removed,
            "failed": self.failed,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }
