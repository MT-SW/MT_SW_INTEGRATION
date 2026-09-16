/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Polskie nazwy wartości wyliczeniowych konfiguracji.
 *
 * Tak samo jak field-labels.js, źródłem są tłumaczenia aplikacji MT_SW_APP —
 * żeby preset nazywał się „Daleki zasięg — Szybko" w obu miejscach, a nie
 * LONG_FAST w panelu.
 *
 * Klucz zewnętrzny to nazwa typu wyliczeniowego z protobufa, którą backend
 * dokłada do metadanych pola. Wartość bez wpisu spada na czytelną formę
 * wygenerowaną z jej nazwy, więc nowe stałe z firmware nie psują listy.
 */

export const ENUM_LABELS = {
  ModemPreset: {
    LONG_FAST: "Daleki zasięg — Szybko",
    LONG_SLOW: "Daleki zasięg — Wolno",
    LONG_MODERATE: "Daleki zasięg — Średnio",
    LONG_TURBO: "Daleki zasięg — Turbo",
    VERY_LONG_SLOW: "Bardzo daleki zasięg — Wolno",
    MEDIUM_FAST: "Średni zasięg — Szybko",
    MEDIUM_SLOW: "Średni zasięg — Wolno",
    MEDIUM_TURBO: "Średni zasięg — Turbo",
    SHORT_FAST: "Krótki zasięg — Szybko",
    SHORT_SLOW: "Bliski zasięg — Wolno",
    SHORT_TURBO: "Krótki zasięg — Turbo",
    NARROW_FAST: "Wąski — Szybki",
    NARROW_SLOW: "Wąski — Wolny",
    LITE_FAST: "Lite — Szybki",
    LITE_SLOW: "Lite — Wolny",
    TINY_FAST: "Mikro — Szybki",
    TINY_SLOW: "Mikro — Wolny",
  },

  Role: {
    CLIENT: "Klient",
    CLIENT_MUTE: "Klient pasywny",
    CLIENT_HIDDEN: "Klient ukryty",
    CLIENT_BASE: "Klient bazowy",
    ROUTER: "Router",
    ROUTER_LATE: "Router pomocniczy",
    ROUTER_CLIENT: "Router Klienta (porzucona)",
    REPEATER: "Repeater (porzucona)",
    TRACKER: "Tracker",
    SENSOR: "Czujnik",
    TAK: "TAK",
    TAK_TRACKER: "TAK Tracker",
    LOST_AND_FOUND: "Zgubiony i znaleziony",
  },

  RebroadcastMode: {
    ALL: "Wszystko",
    ALL_SKIP_DECODING: "Wszystko, bez dekodowania",
    LOCAL_ONLY: "Tylko lokalne kanały",
    KNOWN_ONLY: "Tylko znane węzły",
    CORE_PORTNUMS_ONLY: "Tylko pakiety standardowe",
    NONE: "Brak (wyłącz)",
  },

  DisplayUnits: { METRIC: "Metryczne", IMPERIAL: "Imperialne" },
  DisplayMode: { DEFAULT: "Domyślny", TWOCOLOR: "Dwukolorowy", INVERTED: "Odwrócony", COLOR: "Kolorowy" },
  Theme: { DARK: "Ciemny", LIGHT: "Jasny", RED: "Czerwony" },
  PairingMode: { RANDOM_PIN: "Losowy PIN", FIXED_PIN: "Stały PIN", NO_PIN: "Bez PIN-u" },
  AddressMode: { DHCP: "DHCP", STATIC: "Statyczny" },
  GpsMode: { DISABLED: "Wyłączony", ENABLED: "Włączony", NOT_PRESENT: "Brak sprzętu" },
  FEM_LNA_Mode: { DISABLED: "Wyłączony", ENABLED: "Włączony", NOT_PRESENT: "Brak sprzętu" },

  BuzzerMode: {
    ALL_ENABLED: "Wszystko włączone",
    DISABLED: "Wyłączony",
    NOTIFICATIONS_ONLY: "Tylko powiadomienia",
    SYSTEM_ONLY: "Tylko systemowe",
    DIRECT_MSG_ONLY: "Tylko wiadomości bezpośrednie",
  },

  PacketSignaturePolicy: {
    PACKET_SIGNATURE_POLICY_COMPATIBLE: "Kompatybilny — akceptuj niepodpisane",
    PACKET_SIGNATURE_POLICY_BALANCED: "Zrównoważony — preferuj uwierzytelnione",
    PACKET_SIGNATURE_POLICY_STRICT: "Ścisły — wymagaj uwierzytelnienia",
  },

  CompassMode: {
    DYNAMIC: "Dynamiczny",
    FIXED_RING: "Stały pierścień",
    FREEZE_HEADING: "Zamrożony kurs",
  },

  TriggerType: {
    LOGIC_LOW: "Stan niski",
    LOGIC_HIGH: "Stan wysoki",
    FALLING_EDGE: "Zbocze opadające",
    RISING_EDGE: "Zbocze narastające",
    EITHER_EDGE_ACTIVE_LOW: "Dowolne zbocze, aktywny niski",
    EITHER_EDGE_ACTIVE_HIGH: "Dowolne zbocze, aktywny wysoki",
  },

  MemberRole: {
    Unspecifed: "Nieokreślona",
    TeamMember: "Członek zespołu",
    TeamLead: "Lider zespołu",
    HQ: "Kwatera główna",
    Sniper: "Snajper",
    Medic: "Medyk",
    ForwardObserver: "Obserwator przedni",
    RTO: "Operator radiotelefonu",
    K9: "Piesek (K9)",
  },

  Team: {
    Unspecifed_Color: "Nieokreślony",
    White: "Biały",
    Yellow: "Żółty",
    Orange: "Pomarańczowy",
    Magenta: "Magenta",
    Red: "Czerwony",
    Maroon: "Bordowy",
    Purple: "Fioletowy",
    Dark_Blue: "Ciemnoniebieski",
    Blue: "Niebieski",
    Cyan: "Cyjan",
    Teal: "Morski",
    Green: "Zielony",
    Dark_Green: "Ciemnozielony",
    Brown: "Brązowy",
  },
};

/* Fallback dla wartości bez tłumaczenia.
   Kody i oznaczenia sprzętu (EU_868, OLED_SSD1306, BAUD_9600) zostawiamy
   wielkimi literami — "Eu 868" wyglądałoby na literówkę. Resztę zamieniamy
   na zdanie: SHORT_FAST -> "Short fast". */
function humanize(value) {
  const raw = String(value);
  const spaced = raw.replace(/_/g, " ").trim();
  if (/\d/.test(raw) || spaced.length <= 4) {
    return spaced;
  }
  if (spaced === spaced.toUpperCase()) {
    const lower = spaced.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return spaced;
}

/** Etykieta wartości wyliczeniowej — tłumaczenie albo czytelny fallback. */
export function enumLabel(enumName, value) {
  const table = enumName ? ENUM_LABELS[enumName] : null;
  if (table && table[value]) {
    return table[value];
  }
  return humanize(value);
}

/** Lista opcji gotowa dla <mesh-select>. */
export function enumOptions(enumName, values) {
  return (values || []).map((value) => ({ value, label: enumLabel(enumName, value) }));
}
