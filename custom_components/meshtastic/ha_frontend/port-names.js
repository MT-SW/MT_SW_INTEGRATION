/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Czytelne nazwy portów aplikacji i błędów routingu — te same, których używa
 * aplikacja na Androida, żeby diagnostyka w panelu i w telefonie mówiła tym
 * samym językiem. Backend zwraca surowe nazwy z protobufów (TEXT_MESSAGE_APP),
 * a tutaj zamieniamy je na opisy; nieznana nazwa wraca bez zmian.
 */

/* [polski, angielski] */
const PORTS = {
  TEXT_MESSAGE_APP: ["Wiadomość tekstowa", "Text message"],
  REMOTE_HARDWARE_APP: ["Zdalny sprzęt (GPIO)", "Remote hardware (GPIO)"],
  POSITION_APP: ["Pozycja", "Position"],
  NODEINFO_APP: ["Info o węźle", "Node info"],
  ROUTING_APP: ["Trasowanie", "Routing"],
  ADMIN_APP: ["Administracja", "Admin"],
  TEXT_MESSAGE_COMPRESSED_APP: ["Wiadomość tekstowa (skompresowana)", "Text message (compressed)"],
  WAYPOINT_APP: ["Punkt na mapie", "Waypoint"],
  DETECTION_SENSOR_APP: ["Czujnik detekcji", "Detection sensor"],
  ALERT_APP: ["Alert", "Alert"],
  PAXCOUNTER_APP: ["Licznik osób", "Paxcounter"],
  STORE_FORWARD_PLUS_APP: ["Przechowaj i prześlij++", "Store & Forward++"],
  NODE_STATUS_APP: ["Status węzła", "Node status"],
  SERIAL_APP: ["Port szeregowy", "Serial"],
  STORE_FORWARD_APP: ["Przechowaj i prześlij", "Store & Forward"],
  RANGE_TEST_APP: ["Test zasięgu", "Range test"],
  TELEMETRY_APP: ["Telemetria", "Telemetry"],
  ZPS_APP: ["ZPS", "ZPS"],
  SIMULATOR_APP: ["Symulator", "Simulator"],
  TRACEROUTE_APP: ["Śledzenie trasy", "Traceroute"],
  NEIGHBORINFO_APP: ["Info o sąsiadach", "Neighbor info"],
  MAP_REPORT_APP: ["Raport dla mapy", "Map report"],
  ON_DEMAND_APP: ["OnDemand", "OnDemand"],
};

const ROUTING_ERRORS = {
  NONE: ["Potwierdzone", "Acknowledged"],
  NO_ROUTE: ["Brak trasy", "No route"],
  GOT_NAK: ["Otrzymano NAK", "Got NAK"],
  TIMEOUT: ["Upłynął limit czasu", "Timeout"],
  NO_INTERFACE: ["Brak interfejsu", "No interface"],
  MAX_RETRANSMIT: ["Przekroczono czas lub liczbę retransmisji", "Max retransmissions reached"],
  NO_CHANNEL: ["Brak kanału", "No channel"],
  TOO_LARGE: ["Pakiet jest zbyt duży", "Packet too large"],
  NO_RESPONSE: ["Brak odpowiedzi", "No response"],
  DUTY_CYCLE_LIMIT: ["Osiągnięto okresowy limit nadawania dla tego regionu", "Duty cycle limit reached for this region"],
  BAD_REQUEST: ["Błędne żądanie", "Bad request"],
  NOT_AUTHORIZED: ["Brak autoryzacji", "Not authorized"],
  PKI_FAILED: ["Zaszyfrowane wysyłanie nie powiodło się", "Encrypted send failed"],
  PKI_UNKNOWN_PUBKEY: ["Nieznany klucz publiczny", "Unknown public key"],
  ADMIN_BAD_SESSION_KEY: ["Nieprawidłowy klucz sesji", "Bad session key"],
  ADMIN_PUBLIC_KEY_UNAUTHORIZED: ["Nieautoryzowany klucz publiczny", "Unauthorized public key"],
  RATE_LIMIT_EXCEEDED: ["Przekroczono limit szybkości. Spróbuj ponownie później.", "Rate limit exceeded. Try again later."],
  PKI_SEND_FAIL_PUBLIC_KEY: ["Nie wysłano PKI, brak klucza publicznego", "PKI send failed, missing public key"],
};

function pick(table, language, name) {
  const entry = table[name];
  if (!entry) {
    return name;
  }
  return String(language || "pl").toLowerCase().startsWith("pl") ? entry[0] : entry[1];
}

export function portLabel(language, name) {
  return pick(PORTS, language, name);
}

export function routingErrorLabel(language, name) {
  return pick(ROUTING_ERRORS, language, name);
}
