"""Dzielenie długich wiadomości na pakiety — ten sam format co w aplikacji MT_SW (MessageSplitter.kt).

Tekst dłuższy niż jeden pakiet (200 bajtów UTF-8) idzie jako kilka wiadomości, z których każda zaczyna się
widocznym znacznikiem ``[k9 2/4] `` (losowy 2-znakowy identyfikator grupy, numer części, liczba części).
Odbiorca z tym samym mechanizmem składa je z powrotem w jedną wiadomość; zwykły klient widzi tylko dziwny prefiks.

Czysty moduł (bez zależności od Home Assistanta) — łatwy do przetestowania.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass

PER_PACKET_BUDGET_BYTES = 200
COMPOSER_MAX_BYTES = 1400
CHUNK_SEND_SPACING_SECONDS = 2.5

_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
_ID_LENGTH = 2
_TAG_RESERVE_BYTES = 11  # najgorszy przypadek: "[xx 99/99] "
_MIN_BODY_BUDGET_BYTES = 20
_MIN_SPLIT_TOTAL = 2
_TAG_RE = re.compile(r"^\[([a-z0-9]{2}) (\d{1,2})/(\d{1,2})\] ([\s\S]*)$")
_WHITESPACE_RE = re.compile(r"[ \t\n\x0b\f\r]+")  # jak \s w Javie/Kotlinie


@dataclass(frozen=True)
class SplitTag:
    group_id: str
    index: int
    total: int
    body: str


def _size(text: str) -> int:
    return len(text.encode("utf-8"))


def split_for_mesh(
    text: str, per_packet_budget: int = PER_PACKET_BUDGET_BYTES, rng: random.Random | None = None
) -> list[str]:
    """Lista tekstów gotowych do wysłania; krótki tekst wraca bez zmian (bez znacznika)."""
    if _size(text) <= per_packet_budget:
        return [text]

    body_budget = max(per_packet_budget - _TAG_RESERVE_BYTES, _MIN_BODY_BUDGET_BYTES)
    bodies = _split_into_bodies(text, body_budget)
    picker = rng or random
    group_id = "".join(picker.choice(_ID_ALPHABET) for _ in range(_ID_LENGTH))
    total = len(bodies)
    return [f"[{group_id} {i + 1}/{total}] {body}" for i, body in enumerate(bodies)]


def parse_split_tag(text: str) -> SplitTag | None:
    """Znacznik pojedynczej części albo None, gdy to zwykła wiadomość."""
    match = _TAG_RE.match(text or "")
    if not match:
        return None
    index, total = int(match.group(2)), int(match.group(3))
    if total >= _MIN_SPLIT_TOTAL and 1 <= index <= total:
        return SplitTag(match.group(1), index, total, match.group(4))
    return None


def _take_max_utf8_bytes(text: str, max_bytes: int) -> str:
    end = 0
    used = 0
    for ch in text:
        size = _size(ch)
        if used + size > max_bytes:
            break
        used += size
        end += 1
    return text[: max(end, 1)] if text else ""


def _split_into_bodies(text: str, body_budget: int) -> list[str]:
    words = [w for w in _WHITESPACE_RE.split(text) if w]
    bodies: list[str] = []
    current = ""
    current_bytes = 0

    def flush() -> None:
        nonlocal current, current_bytes
        if current:
            bodies.append(current)
            current = ""
            current_bytes = 0

    for word in words:
        word_bytes = _size(word)
        if word_bytes > body_budget:
            flush()
            rest = word
            while _size(rest) > body_budget:
                piece = _take_max_utf8_bytes(rest, body_budget)
                bodies.append(piece)
                rest = rest[len(piece) :]
            current = rest
            current_bytes = _size(rest)
            continue
        with_space = word_bytes if not current else current_bytes + 1 + word_bytes
        if with_space > body_budget:
            flush()
            current = word
            current_bytes = word_bytes
        else:
            if current:
                current += " "
                current_bytes += 1
            current += word
            current_bytes += word_bytes
    flush()
    return bodies
