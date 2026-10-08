/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Listy wyboru wspólne dla kilku paneli Ustawień: regiony i presety modemu
 * (LoRa oraz Mesh Beacon) i kroki dokładności pozycji (kanały oraz raportowanie
 * mapy w MQTT). Jedno miejsce, żeby każdy panel oferował to samo i tak samo to
 * nazywał — nazwy presetów są takie jak w aplikacji na Androida.
 */

import { PL } from "./pl-settings.js";

/* Kody regionów z protobufu (LoRaConfig.RegionCode). Etykieta to kod z odstępem. */
const REGION_CODES = [
  "UNSET", "US", "EU_433", "EU_868", "CN", "JP", "ANZ", "KR", "TW", "RU", "IN", "NZ_865", "TH", "LORA_24",
  "UA_433", "UA_868", "MY_433", "MY_919", "SG_923", "PH_433", "PH_868", "PH_915", "ANZ_433", "KZ_433",
  "KZ_863", "NP_865", "BR_902", "ITU1_2M", "ITU2_2M", "EU_866", "EU_874", "EU_917", "EU_N_868", "ITU3_2M",
  "ITU1_70CM", "ITU2_70CM", "ITU3_70CM", "ITU2_125CM",
];

export const REGIONS = REGION_CODES.map((value) => ({ value, label: value.replace(/_/g, " ") }));

/* Preset modemu: nazwa z protobufu, angielski opis jak w aplikacji i nazwa kanału,
   którą firmware nadaje kanałowi bez własnej nazwy (DisplayFormatters). Kolejność z protobufu. */
const PRESET_NAMES = [
  ["LONG_FAST", "Long Range - Fast", "LongFast"],
  ["LONG_SLOW", "Long Range - Slow", "LongSlow"],
  ["VERY_LONG_SLOW", "Very Long Range - Slow", "VLongSlow"],
  ["MEDIUM_SLOW", "Medium Range - Slow", "MediumSlow"],
  ["MEDIUM_FAST", "Medium Range - Fast", "MediumFast"],
  ["SHORT_SLOW", "Short Range - Slow", "ShortSlow"],
  ["SHORT_FAST", "Short Range - Fast", "ShortFast"],
  ["LONG_MODERATE", "Long Range - Moderate", "LongMod"],
  ["SHORT_TURBO", "Short Range - Turbo", "ShortTurbo"],
  ["LONG_TURBO", "Long Range - Turbo", "LongTurbo"],
  ["LITE_FAST", "Lite - Fast", "LiteFast"],
  ["LITE_SLOW", "Lite - Slow", "LiteSlow"],
  ["NARROW_FAST", "Narrow - Fast", "NarrowFast"],
  ["NARROW_SLOW", "Narrow - Slow", "NarrowSlow"],
  ["TINY_FAST", "Tiny - Fast", "TinyFast"],
  ["TINY_SLOW", "Tiny - Slow", "TinySlow"],
  ["MEDIUM_TURBO", "Medium Range - Turbo", "MediumTurbo"],
];

/* Nazwy presetów zostają po angielsku — tak nazywa je aplikacja i cała społeczność. */
export const MODEM_PRESETS = PRESET_NAMES.map(([value, name, channelName]) => ({
  value,
  label: `${name} (${channelName})`,
}));

/* Dokładność pozycji to liczba bitów współrzędnych, które zostają w pakiecie: im mniej, tym większy
   kwadrat niepewności. 32 = pełna dokładność. Odległości to promień niepewności. */
export const APPROX_PRECISION_BITS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
export const PRECISE_BITS = 32;
export const DEFAULT_APPROX_BITS = 13;

const PRECISION_LABELS = {
  10: "±23 km",
  11: "±12 km",
  12: "±5.8 km",
  13: "±2.9 km",
  14: "±1.5 km",
  15: "±730 m",
  16: "±360 m",
  17: "±180 m",
  18: "±90 m",
  19: "±45 m",
};

export function precisionLabel(bits) {
  if (bits === PRECISE_BITS) {
    return PL("Precise location");
  }
  return PRECISION_LABELS[bits] ? PL(PRECISION_LABELS[bits]) : `${bits}`;
}

/* Szybkość kodowania (mianownik 4/N), jaką preset ma z założenia — tak jak w tabeli firmware
   i aplikacji na Androida. */
const PRESET_CODING_RATE = {
  VERY_LONG_SLOW: 8, LONG_TURBO: 8, LONG_FAST: 5, LONG_MODERATE: 8, LONG_SLOW: 8,
  MEDIUM_FAST: 5, MEDIUM_SLOW: 5, MEDIUM_TURBO: 5, SHORT_FAST: 5, SHORT_SLOW: 5, SHORT_TURBO: 5,
  LITE_FAST: 5, LITE_SLOW: 5, NARROW_FAST: 6, NARROW_SLOW: 6, TINY_FAST: 5, TINY_SLOW: 6,
};
/* Te presety (domyślnie 4/6) w firmware MT_SW mogą zejść też do 4/5. */
const LOWER_RATE_ALLOWED = new Set(["NARROW_FAST", "NARROW_SLOW", "TINY_SLOW"]);

export function presetCodingRate(preset) {
  return PRESET_CODING_RATE[preset] || 0;
}

/* Wartości, które można ustawić ponad presetem (bez „domyślnej”). Pusta lista = preset ma już 4/8. */
export function codingRateOverrides(preset) {
  const own = presetCodingRate(preset);
  if (!own) {
    return [];
  }
  const lowest = LOWER_RATE_ALLOWED.has(preset) ? 5 : own + 1;
  const rates = [];
  for (let rate = lowest; rate <= 8; rate += 1) {
    if (rate !== own) {
      rates.push(rate);
    }
  }
  return rates;
}

/* Wartość zapisana w konfiguracji tak, jak zastosuje ją firmware: nadpisanie albo 0. */
export function codingRateOverride(preset, stored) {
  return codingRateOverrides(preset).includes(Number(stored)) ? Number(stored) : 0;
}
