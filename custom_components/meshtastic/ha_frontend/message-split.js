/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Długie wiadomości — ten sam mechanizm co w aplikacji MT_SW (MessageSplitter / MessageSplitReassembly):
 * tekst ponad jeden pakiet idzie jako części ze znacznikiem „[xx i/n] ”, a odbiorca składa je w jedną
 * wiadomość. Dzielenie przy wysyłce robi serwer (message_split.py); tutaj tylko składanie i liczniki.
 */

export const PER_PACKET_BUDGET_BYTES = 200;
export const COMPOSER_MAX_BYTES = 1400;
/* Po tylu milisekundach od pierwszej części uznajemy, że brakującej już nie będzie. */
export const REASSEMBLY_GIVE_UP_MS = 3 * 60 * 1000;

const TAG_RE = /^\[([a-z0-9]{2}) (\d{1,2})\/(\d{1,2})\] ([\s\S]*)$/;
const TAG_RESERVE_BYTES = 11;
const MIN_BODY_BUDGET_BYTES = 20;

const encoder = new TextEncoder();

export function byteLength(text) {
  return encoder.encode(text || "").length;
}

/* Znacznik części albo null, gdy to zwykła wiadomość. */
export function parseSplitTag(text) {
  const match = TAG_RE.exec(text || "");
  if (!match) {
    return null;
  }
  const index = Number(match[2]);
  const total = Number(match[3]);
  if (total >= 2 && index >= 1 && index <= total) {
    return { groupId: match[1], index, total, body: match[4] };
  }
  return null;
}

function takeMaxBytes(text, maxBytes) {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const size = byteLength(ch);
    if (used + size > maxBytes) {
      break;
    }
    used += size;
    out += ch;
  }
  return out || Array.from(text)[0] || "";
}

/* Liczba części, na jakie serwer podzieli tekst (1 = bez dzielenia) — do podpowiedzi pod polem. */
export function splitPartCount(text, perPacket = PER_PACKET_BUDGET_BYTES) {
  if (byteLength(text) <= perPacket) {
    return 1;
  }
  const budget = Math.max(perPacket - TAG_RESERVE_BYTES, MIN_BODY_BUDGET_BYTES);
  const words = (text || "").split(/\s+/).filter(Boolean);
  let count = 0;
  let currentBytes = 0;
  let open = false;
  for (const word of words) {
    let rest = word;
    if (byteLength(rest) > budget) {
      if (open) {
        count += 1;
        open = false;
        currentBytes = 0;
      }
      while (byteLength(rest) > budget) {
        rest = rest.slice(takeMaxBytes(rest, budget).length);
        count += 1;
      }
      currentBytes = byteLength(rest);
      open = rest.length > 0;
      continue;
    }
    const size = byteLength(rest);
    const withSpace = open ? currentBytes + 1 + size : size;
    if (open && withSpace > budget) {
      count += 1;
      currentBytes = size;
    } else {
      currentBytes = withSpace;
      open = true;
    }
  }
  if (open) {
    count += 1;
  }
  return Math.max(count, 1);
}

/**
 * Złóż części w pojedyncze wiadomości do wyświetlenia.
 *
 * Części jednej grupy (ten sam nadawca/adresat, rozmowa, identyfikator i liczba części, w oknie
 * REASSEMBLY_GIVE_UP_MS) łączą się w jedną wiadomość „hosta” — najwyższą z obecnych części, jak
 * w aplikacji. Pozostałe części znikają z listy. Wynik: lista wiadomości z opcjonalnym polem
 * `split` = { have, total, complete, giveUp, parts: [oryginalne wiadomości] }.
 */
export function reassemble(messages, conversationKey, now = Date.now()) {
  const list = messages || [];
  const groups = new Map(); // klucz grupy → [{tag, message}]
  const order = [];

  for (const message of list) {
    const tag = parseSplitTag(message.text);
    if (!tag) {
      order.push({ message });
      continue;
    }
    const base = `${message.direction}|${message.from}|${conversationKey(message)}|${tag.groupId}|${tag.total}`;
    let bucket = null;
    for (const candidate of groups.get(base) || []) {
      if (Math.abs(message.ts - candidate.firstTs) <= REASSEMBLY_GIVE_UP_MS && !candidate.byIndex.has(tag.index)) {
        bucket = candidate;
        break;
      }
    }
    if (!bucket) {
      bucket = { firstTs: message.ts, total: tag.total, byIndex: new Map(), entry: { bucket: null } };
      bucket.entry.bucket = bucket;
      groups.set(base, [...(groups.get(base) || []), bucket]);
      order.push(bucket.entry);
    }
    bucket.byIndex.set(tag.index, { tag, message });
  }

  const result = [];
  for (const item of order) {
    if (item.message) {
      result.push(item.message);
      continue;
    }
    const { byIndex, total, firstTs } = item.bucket;
    const indices = [...byIndex.keys()].sort((a, b) => a - b);
    const hostIndex = indices[indices.length - 1];
    const host = byIndex.get(hostIndex).message;
    const text = indices.map((i) => byIndex.get(i).tag.body).join(" ");
    const complete = indices.length === total;
    result.push({
      ...host,
      text,
      split: {
        have: indices.length,
        total,
        complete,
        giveUp: !complete && now - firstTs >= REASSEMBLY_GIVE_UP_MS,
        parts: indices.map((i) => byIndex.get(i).message),
      },
    });
  }
  return result;
}
