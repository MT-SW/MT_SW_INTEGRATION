/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Jakość sygnału (SNR / RSSI) — jedno źródło prawdy dla całego panelu.
 * Odpowiednik aplikacji na Androida (LoraSignalIndicator.kt):
 *   Quality, SnrBands, ModemPreset?.snrBands(), determineSignalQuality,
 *   determineRssiQuality, StatusColors (CustomColors.kt).
 *
 * Moduł jest czysty (bez DOM-u poza opcjonalnym wykryciem ciemnego motywu),
 * więc da się go testować w Node.
 */

import { html } from "./vendor/lit/lit-element.js";
import { t } from "./i18n.js";

/* Kolejność jak w tablicy wyświetlanej użytkownikowi: od najlepszej. */
export const SIGNAL_QUALITIES = ["good", "fair", "bad", "none"];

/* Kolory z StatusColors (CustomColors.kt): good = StatusOnline (złoto:
   dark #EBB60C / light #AA8309), fair = StatusDisconnected #F4212E,
   bad = StatusPurple #B03CFF, none = StatusConnecting (biały na ciemnym,
   czarny na jasnym motywie). */
export const SIGNAL_HEX = {
  dark: { good: "#EBB60C", fair: "#F4212E", bad: "#B03CFF", none: "#FFFFFF" },
  light: { good: "#AA8309", fair: "#F4212E", bad: "#B03CFF", none: "#000000" },
};

const LABEL_KEYS = {
  good: "map.traceroute.q_good",
  fair: "map.traceroute.q_fair",
  bad: "map.traceroute.q_bad",
  none: "map.traceroute.q_none",
};

/* Spreading factor presetów — ChannelOption.kt (spreadingFactor = ...). */
export const PRESET_SF = {
  VERY_LONG_SLOW: 12,
  LONG_TURBO: 11,
  LONG_FAST: 11,
  LONG_MODERATE: 11,
  LONG_SLOW: 12,
  MEDIUM_FAST: 9,
  MEDIUM_SLOW: 10,
  MEDIUM_TURBO: 9,
  SHORT_FAST: 7,
  SHORT_SLOW: 8,
  SHORT_TURBO: 7,
  LITE_FAST: 9,
  LITE_SLOW: 10,
  NARROW_FAST: 7,
  NARROW_SLOW: 8,
  TINY_FAST: 7,
  TINY_SLOW: 8,
};
export const DEFAULT_PRESET = "LONG_FAST"; // ChannelOption.DEFAULT

/* LoraSignalIndicator.kt: SNR_FAIR_OFFSET / SNR_BAD_OFFSET, NARROW_BANDS, LITE_BANDS. */
const SNR_FAIR_OFFSET = 5.5;
const SNR_BAD_OFFSET = 7.5;
const NARROW_BANDS = { good: -3, fair: -7, bad: -12 };
const LITE_BANDS = { good: -5, fair: -10, bad: -15 };

/* LoraSignalIndicator.kt: RSSI_GOOD/FAIR/BAD_THRESHOLD (determineRssiQuality). */
export const RSSI_GOOD_THRESHOLD = -115;
export const RSSI_FAIR_THRESHOLD = -120;
export const RSSI_BAD_THRESHOLD = -126;

/* Preset bramki znany panelowi (np. z wyniku traceroute); użyty, gdy wywołanie
   nie poda własnego. Bez niego obowiązują progi domyślne (LongFast). */
let knownPreset = null;
export function setSignalPreset(preset) {
  knownPreset = normalizePreset(preset);
}
export function getSignalPreset() {
  return knownPreset;
}

/** Nazwa presetu ("LONG_FAST", "LongFast", "long fast") -> klucz PRESET_SF albo null. */
export function normalizePreset(preset) {
  if (typeof preset !== "string" || !preset) {
    return null;
  }
  const key = preset
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
  return key in PRESET_SF ? key : null;
}

/** ChannelOption.snrLimit: -7.5 dB dla SF7, o 2.5 dB niżej na każdy kolejny SF. */
export function snrLimit(preset) {
  const sf = PRESET_SF[normalizePreset(preset) ?? knownPreset ?? DEFAULT_PRESET];
  return -7.5 - 2.5 * (sf - 7);
}

/** ModemPreset?.snrBands(): powyżej good = dobry, powyżej fair = wystarczający, od bad w górę = słaby. */
export function snrBands(preset) {
  const key = normalizePreset(preset) ?? knownPreset;
  if (key === "NARROW_FAST" || key === "NARROW_SLOW") {
    return NARROW_BANDS;
  }
  if (key === "LITE_FAST" || key === "LITE_SLOW") {
    return LITE_BANDS;
  }
  const limit = snrLimit(key);
  return { good: limit, fair: limit - SNR_FAIR_OFFSET, bad: limit - SNR_BAD_OFFSET };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/* Jakość z jednej wartości względem progów (when{} z determineSignalQuality). */
function rateSnr(snr, preset) {
  const bands = snrBands(preset);
  if (snr > bands.good) return "good";
  if (snr > bands.fair) return "fair";
  if (snr >= bands.bad) return "bad";
  return "none";
}

/** determineRssiQuality z aplikacji (własne progi RSSI, niezależne od presetu). */
export function rssiQuality(rssi) {
  if (rssi > RSSI_GOOD_THRESHOLD) return "good";
  if (rssi > RSSI_FAIR_THRESHOLD) return "fair";
  if (rssi > RSSI_BAD_THRESHOLD) return "bad";
  return "none";
}

/**
 * Jakość łącza: 'good' | 'fair' | 'bad' | 'none'.
 * SNR jest oceniany względem presetu, RSSI własnymi progami i może ocenę tylko
 * OBNIŻYĆ (wygrywa gorsza z dwóch). Brak obu wartości = 'none'.
 * RSSI == 0 traktujemy jak brak pomiaru (tak robi cały panel).
 */
export function signalQuality(snr, rssi, preset) {
  const order = SIGNAL_QUALITIES;
  let worst = -1;
  if (isNum(snr)) {
    worst = Math.max(worst, order.indexOf(rateSnr(snr, preset)));
  }
  if (isNum(rssi) && rssi !== 0) {
    worst = Math.max(worst, order.indexOf(rssiQuality(rssi)));
  }
  return worst < 0 ? "none" : order[worst];
}

/* ---- kolory ---------------------------------------------------------- */

let darkCache = { at: 0, value: true };
function isDarkTheme() {
  const now = Date.now();
  if (now - darkCache.at < 1500) {
    return darkCache.value;
  }
  let dark = true;
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--primary-background-color").trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg);
    if (m) {
      const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
    } else if (typeof matchMedia === "function") {
      dark = matchMedia("(prefers-color-scheme: dark)").matches;
    }
  } catch (e) {
    dark = true;
  }
  darkCache = { at: now, value: dark };
  return dark;
}

/** CSS-owy kolor jakości: var(--mtsw-q-<q>, #hex) — motyw może go nadpisać. */
export function signalColor(quality) {
  const q = SIGNAL_QUALITIES.includes(quality) ? quality : "none";
  const hex = SIGNAL_HEX[isDarkTheme() ? "dark" : "light"][q];
  return `var(--mtsw-q-${q}, ${hex})`;
}

/** 'color:...;' dla pary SNR/RSSI; pusty napis, gdy nie ma żadnego pomiaru. */
export function signalStyle(snr, rssi, preset) {
  if (!isNum(snr) && !(isNum(rssi) && rssi !== 0)) {
    return "";
  }
  return `color:${signalColor(signalQuality(snr, rssi, preset))};`;
}

/** Polska etykieta (strings.xml values-pl: good / fair / bad / none_quality). */
export function signalLabel(hass, quality) {
  return t(hass, LABEL_KEYS[quality] || LABEL_KEYS.none);
}

/**
 * Pokolorowana wartość do szablonu lit: kind = "snr" (ocena SNR względem presetu)
 * albo "rssi" (własne progi RSSI) — tak jak Snr() i Rssi() w aplikacji. Brak
 * pomiaru -> zwykły tekst. Tytuł (tooltip) zawiera słowo jakości.
 */
export function signalValue(hass, kind, value, text, preset) {
  if (!isNum(value) || (kind === "rssi" && value === 0)) {
    return text;
  }
  const quality = kind === "rssi" ? rssiQuality(value) : rateSnr(value, preset);
  return html`<span class="mtsw-signal" style="color:${signalColor(quality)};" title="${signalLabel(hass, quality)}"
    >${text}</span
  >`;
}
