"""
Czysta (bez Home Assistanta) logika rozpoznawania tożsamości węzłów.

Ten moduł niczego nie importuje z HA, dzięki czemu planowanie scalania da się
testować zwykłym python3. Zasady rozpoznawania, w kolejności:

1. klucz publiczny PKI (``pk_<hex>``) — ten sam klucz = ten sam węzeł, nawet
   gdy zmienił się numer (kolizja w sieci, aktualizacja firmware);
2. gdy klucza nie ma: (długa nazwa, krótka nazwa, model sprzętu) + zgodny adres
   MAC, jeśli znany po obu stronach. Identyfikator użytkownika (``!hex``) jest
   wyprowadzany z numeru węzła, więc po zmianie numeru z natury się różni —
   nie można go wymagać, a jego zgodność oznacza po prostu ten sam numer;
3. nigdy nie scalamy dwóch węzłów, które w bazie radia są jednocześnie żywe
   i mają RÓŻNE klucze publiczne, ani gdy dopasowanie jest niejednoznaczne
   (więcej niż jeden kandydat po którejkolwiek stronie).
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

# Węzeł bez klucza uznajemy za „zastąpiony" przez nowszy dopiero, gdy milczy
# co najmniej tyle sekund dłużej niż jego następca (stary numer zostaje w bazie
# radia do czasu wygaśnięcia, więc „nieobecny w bazie" byłoby zbyt surowe).
STALE_SUPERSEDED_SECONDS = 1800

NODE_SCOPED_DOMAINS = ("sensor", "binary_sensor", "device_tracker", "button")


def node_identity_key(node_id: int, node_data: Mapping[str, Any] | None) -> str:
    """Stabilny klucz tożsamości: ``pk_<hex>`` gdy znany klucz publiczny, inaczej ``num_<numer>``."""
    public_key_b64 = ((node_data or {}).get("user") or {}).get("publicKey")
    if public_key_b64:
        try:
            public_key_hex = base64.b64decode(public_key_b64).hex()
        except (ValueError, TypeError):
            public_key_hex = ""
        if public_key_hex:
            return f"pk_{public_key_hex}"
    return f"num_{node_id}"


def _mac_of(user: Mapping[str, Any]) -> str | None:
    raw = user.get("macaddr")
    if not raw:
        return None
    try:
        return base64.b64decode(raw).hex(":")
    except (ValueError, TypeError):
        return None


def node_signature(node: Mapping[str, Any] | None) -> tuple[str, str, str] | None:
    """(długa nazwa, krótka nazwa, model) — albo None, gdy za mało danych do rozpoznania."""
    user = (node or {}).get("user") or {}
    long_name = (user.get("longName") or "").strip()
    hw_model = str(user.get("hwModel") or "")
    if not long_name or not hw_model or hw_model in ("UNSET", "0"):
        return None
    return long_name, (user.get("shortName") or "").strip(), hw_model


def _sig_matches(a: tuple[str, str, str], b: tuple[str, str, str]) -> bool:
    """Nazwa długa i model muszą być równe; krótka — gdy znana po obu stronach."""
    if a[0] != b[0] or a[2] != b[2]:
        return False
    return not (a[1] and b[1] and a[1] != b[1])


def _is_keyless(identity_key: str | None) -> bool:
    return not identity_key or identity_key.startswith("num_")


def find_filter_successors(
    entries: Iterable[Mapping[str, Any]],
    node_infos: Mapping[int, Mapping[str, Any]],
    protected_nums: Iterable[int] = (),
) -> dict[int, int]:
    """
    Dla wpisów filtra, które zniknęły z bazy radia i nie mają klucza publicznego,
    znajdź następcę po nazwach + modelu. Zwraca {stary_numer: nowy_numer}.

    Wpis z kluczem publicznym tu nie trafia (obsługuje go dopasowanie po
    kluczu). Dopasowanie musi być jednoznaczne po obu stronach.
    """
    protected = set(protected_nums)
    old_entries = []
    for el in entries:
        if el["id"] in node_infos or el["id"] in protected or not _is_keyless(el.get("identity_key")):
            continue
        name = (el.get("name") or "").strip()
        hw = str(el.get("hw_model") or "")
        if not name or not hw:
            continue
        old_entries.append((el["id"], (name, (el.get("short_name") or "").strip(), hw)))

    cand_sigs = {}
    for num, info in node_infos.items():
        sig = node_signature(info)
        if sig is not None:
            cand_sigs[num] = sig

    forward: dict[int, list[int]] = {}
    backward: dict[int, list[int]] = {}
    for old_num, sig in old_entries:
        for num, csig in cand_sigs.items():
            if num == old_num or num in protected:
                continue
            if _sig_matches(sig, csig):
                forward.setdefault(old_num, []).append(num)
                backward.setdefault(num, []).append(old_num)
    return {
        old: news[0]
        for old, news in forward.items()
        if len(news) == 1 and len(backward[news[0]]) == 1
    }


@dataclass(frozen=True)
class DeviceRecord:
    id: str
    nums: frozenset[int]
    keys: frozenset[str]
    name: str | None = None
    model_id: str | None = None
    short_name: str | None = None
    macs: frozenset[str] = frozenset()
    created: float | None = None


@dataclass
class MergePlan:
    survivor_id: str
    loser_ids: tuple[str, ...]
    nums: frozenset[int]
    keys: frozenset[str]
    target_key: str
    source_keys: frozenset[str]
    name: str | None
    reason: str


@dataclass
class MergeResult:
    plans: list[MergePlan] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def _pks(keys: Iterable[str]) -> set[str]:
    return {k for k in keys if k.startswith("pk_")}


def plan_device_merges(  # noqa: C901, PLR0912, PLR0915
    devices: Iterable[DeviceRecord],
    live_nodes: Mapping[int, Mapping[str, Any]],
    protected_nums: Iterable[int] = (),
    stale_seconds: int = STALE_SUPERSEDED_SECONDS,
) -> MergeResult:
    """Zaplanuj scalenie duplikatów urządzeń tego samego węzła (czysta funkcja)."""
    devs = {d.id: d for d in devices}
    protected = set(protected_nums)
    result = MergeResult()

    def live_nums(d: DeviceRecord) -> list[int]:
        return [n for n in d.nums if n in live_nodes]

    def last_heard(d: DeviceRecord) -> int:
        return max((live_nodes[n].get("lastHeard") or 0 for n in live_nums(d)), default=0)

    def live_pks(d: DeviceRecord) -> set[str]:
        out = set()
        for n in live_nums(d):
            key = node_identity_key(n, live_nodes[n])
            if key.startswith("pk_"):
                out.add(key)
        return out

    parent = {i: i for i in devs}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    reasons: dict[str, str] = {}
    ids = sorted(devs)

    # R1: wspólny klucz publiczny
    for i, a_id in enumerate(ids):
        for b_id in ids[i + 1 :]:
            if _pks(devs[a_id].keys) & _pks(devs[b_id].keys):
                parent[find(a_id)] = find(b_id)
                reasons[find(a_id)] = "public key"

    # R2: bez klucza — nazwy + model (+ MAC), jednoznacznie, stary nieaktywny
    fwd: dict[str, list[str]] = {}
    bwd: dict[str, list[str]] = {}
    for o_id in ids:
        old = devs[o_id]
        if _pks(old.keys) or live_pks(old) or old.nums & protected or not old.name or not old.model_id:
            continue
        for n_id in ids:
            if n_id == o_id:
                continue
            new = devs[n_id]
            if find(n_id) == find(o_id):
                continue
            new_live = live_nums(new)
            if not new_live:
                continue
            matched = False
            for n in new_live:
                sig = node_signature(live_nodes[n])
                if sig is None:
                    continue
                osig = (old.name.strip(), (old.short_name or "").strip(), str(old.model_id))
                if not _sig_matches(osig, sig):
                    continue
                user = live_nodes[n].get("user") or {}
                mac = _mac_of(user)
                if old.macs and mac and mac not in old.macs:
                    continue
                matched = True
                break
            if not matched:
                continue
            if live_nums(old) and not (last_heard(old) + stale_seconds < last_heard(new)):
                result.skipped.append(
                    f"device {old.id} ({old.name}) looks like a duplicate of {new.id} but is not silent long enough"
                )
                continue
            fwd.setdefault(o_id, []).append(n_id)
            bwd.setdefault(n_id, []).append(o_id)
    for o_id, news in fwd.items():
        if len(news) == 1 and len(bwd[news[0]]) == 1:
            parent[find(o_id)] = find(news[0])
            reasons[find(o_id)] = "names + hardware model"
        else:
            result.skipped.append(
                f"ambiguous match for device {o_id} ({devs[o_id].name}): candidates {sorted(news)} — not merged"
            )

    comps: dict[str, list[str]] = {}
    for i in ids:
        comps.setdefault(find(i), []).append(i)

    for root, members in comps.items():
        if len(members) < 2:  # noqa: PLR2004
            continue
        group = [devs[m] for m in members]
        all_live_pks = set().union(*(live_pks(d) for d in group))
        if len(all_live_pks) > 1:
            result.skipped.append(f"devices {sorted(members)} hold different live public keys — not merged")
            continue

        def sort_key(d: DeviceRecord) -> tuple:
            return (d.created if d.created is not None else float("inf"), 1 if live_nums(d) else 0, d.id)

        survivor = sorted(group, key=sort_key)[0]
        nums = frozenset().union(*(d.nums for d in group))
        keys = frozenset().union(*(d.keys for d in group))
        live_all = [(n, live_nodes[n]) for d in group for n in live_nums(d)]
        if live_all:
            num, info = max(live_all, key=lambda x: x[1].get("lastHeard") or 0)
            target = node_identity_key(num, info)
            name = ((info.get("user") or {}).get("longName")) or survivor.name
        else:
            pk = sorted(_pks(keys))
            target = pk[-1] if pk else sorted(keys)[-1] if keys else ""
            name = survivor.name
        if not target:
            continue
        result.plans.append(
            MergePlan(
                survivor_id=survivor.id,
                loser_ids=tuple(sorted(d.id for d in group if d.id != survivor.id)),
                nums=nums,
                keys=keys | {target},
                target_key=target,
                source_keys=frozenset((keys | {target}) - {target}),
                name=name,
                reason=reasons.get(root, "public key"),
            )
        )
    return result


def plan_key_canonicalisation(
    devices: Iterable[DeviceRecord],
    live_nodes: Mapping[int, Mapping[str, Any]],
) -> list[tuple[str, str, frozenset[str]]]:
    """
    Urządzenia z kilkoma kluczami tożsamości (np. num_… i pk_…, bo węzeł dopiero
    co zgłosił klucz) → [(device_id, klucz_docelowy, klucze_źródłowe)].
    """
    out = []
    for d in devices:
        if len(d.keys) < 2:  # noqa: PLR2004
            continue
        live = [(n, live_nodes[n]) for n in d.nums if n in live_nodes]
        if not live:
            continue
        num, info = max(live, key=lambda x: x[1].get("lastHeard") or 0)
        target = node_identity_key(num, info)
        if target in d.keys:
            out.append((d.id, target, frozenset(d.keys - {target})))
    return out


def plan_entity_migration(
    entities: Iterable[tuple[str, str]],
    entry_id: str,
    source_keys: Iterable[str],
    target_key: str,
    domains: Iterable[str] = NODE_SCOPED_DOMAINS,
) -> tuple[list[tuple[str, str]], list[str]]:
    """
    Przepisz unique_id encji ze starych kluczy na docelowy.

    ``entities`` = [(entity_id, unique_id)]. Zwraca (zmiany_nazw, usunięcia):
    przy kolizji zostaje encja STARA (ma historię), nowo utworzona o tym samym
    unique_id jest usuwana. Idempotentne — drugi przebieg nic nie zmienia.
    """
    ents = list(entities)
    uid_to_eid = {uid: eid for eid, uid in ents}
    renames: list[tuple[str, str]] = []
    removals: list[str] = []
    for source in sorted(set(source_keys) - {target_key}):
        for domain in domains:
            old_prefix = f"{entry_id}_{domain}_{source}_"
            new_prefix = f"{entry_id}_{domain}_{target_key}_"
            for eid, uid in ents:
                if not uid.startswith(old_prefix) or eid in removals:
                    continue
                new_uid = new_prefix + uid[len(old_prefix) :]
                holder = uid_to_eid.get(new_uid)
                if holder is not None and holder != eid:
                    if holder not in removals:
                        removals.append(holder)
                    uid_to_eid.pop(new_uid, None)
                renames.append((eid, new_uid))
                uid_to_eid[new_uid] = eid
    return renames, removals
