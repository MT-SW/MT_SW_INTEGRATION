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
  /* Presetów modemu nie tłumaczymy — aplikacja MT_SW_APP też ich nie
     tłumaczy, a LONG_FAST jest nazwą rozpoznawalną w całym ekosystemie. */

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

/* Wartość bez tłumaczenia pokazujemy dokładnie tak, jak podaje ją radio.
   Aplikacja MT_SW_APP robi to samo — LONG_FAST czy EU_868 to nazwy
   rozpoznawalne w całym ekosystemie i upiększanie ich na "Long fast"
   tylko utrudniało szukanie odpowiedzi w dokumentacji. */
function humanize(value) {
  return String(value);
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
