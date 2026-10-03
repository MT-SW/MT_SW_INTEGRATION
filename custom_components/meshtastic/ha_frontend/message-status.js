/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Status doręczenia wiadomości wychodzącej — te same stany i teksty co w aplikacji MT_SW.
 */

import { t } from "./i18n.js";

/* Jak w aplikacji (SEND_ACK_TIMEOUT): po tylu milisekundach bez potwierdzenia wiadomość to błąd „limit czasu”. */
export const ACK_TIMEOUT_MS = 5 * 60 * 1000;

/* Błędy, przy których ponowna wysyłka nie ma sensu (jak w aplikacji). */
const NOT_RETRYABLE = new Set(["NO_CHANNEL", "TOO_LARGE"]);

function hasText(hass, key) {
  return t(hass, key) !== key;
}

/**
 * Stan jednej wiadomości wychodzącej.
 * Zwraca { kind: "pending" | "sent" | "ok" | "error", icon, text, detail, retryable }.
 *  - brak potwierdzenia      → „Wysyłanie...”, a po 5 minutach błąd „Upłynął limit czasu”
 *  - SENT (ktoś powtórzył)   → rozmowa: „Przekazane, niepotwierdzone przez odbiorcę”, kanał: „Dostarczono do sieci mesh”
 *  - ACK od adresata         → rozmowa: „Dostarczono do odbiorcy”, kanał: „Dostarczono do sieci mesh”
 *  - NAK                     → tekst błędu routingu z aplikacji
 */
export function outgoingStatus(hass, message, now = Date.now()) {
  const status = baseStatus(hass, message, now);
  // Firmware 2.8+: ACK z błędnym dowodem to prawdopodobna podróbka — nie liczymy go jako dostarczenia.
  if (message.ack_forged && status.kind !== "ok") {
    return { ...status, detail: t(hass, "msgstatus.forged") };
  }
  return status;
}

function baseStatus(hass, message, now) {
  const isDm = message.to_node !== null && message.to_node !== undefined;
  const ack = message.ack;

  if (!ack) {
    if (typeof message.ts === "number" && now - message.ts >= ACK_TIMEOUT_MS) {
      return errorStatus(hass, "TIMEOUT");
    }
    return { kind: "pending", icon: "○", text: t(hass, "msgstatus.enroute"), detail: "", retryable: false };
  }
  if (ack === "SENT") {
    return {
      kind: "sent",
      icon: "✓",
      text: t(hass, isDm ? "msgstatus.relayed" : "msgstatus.delivered"),
      detail: "",
      retryable: isDm,
    };
  }
  if (ack === "ACK") {
    return {
      kind: "ok",
      icon: "✓✓",
      text: t(hass, isDm ? "msgstatus.recipient" : "msgstatus.delivered"),
      detail: "",
      retryable: false,
    };
  }
  return errorStatus(hass, message.ack_error);
}

function errorStatus(hass, errorName) {
  const name = errorName || "";
  const titleKey = `msgstatus.err.${name}`;
  const text = name && hasText(hass, titleKey) ? t(hass, titleKey) : name || t(hass, "msgstatus.unknown");
  const detailKey = `${titleKey}.detail`;
  return {
    kind: "error",
    icon: "✗",
    text,
    detail: name && hasText(hass, detailKey) ? t(hass, detailKey) : "",
    retryable: !NOT_RETRYABLE.has(name),
  };
}

/**
 * Wspólny stan wiadomości złożonej z kilku części (wychodzących): najgorszy wygrywa —
 * błąd > oczekiwanie > przekazane > potwierdzone.
 */
export function combineStatuses(statuses) {
  const order = { error: 0, pending: 1, sent: 2, ok: 3 };
  return statuses.reduce((worst, s) => (order[s.kind] < order[worst.kind] ? s : worst), statuses[0]);
}
