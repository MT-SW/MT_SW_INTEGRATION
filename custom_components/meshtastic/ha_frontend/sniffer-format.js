/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Czyste funkcje widoku Sniffera (bez DOM-u i bez lit — testowane w node):
 * formatowanie liczb, współrzędnych, czasu, model czytelnych szczegółów
 * pakietu (sąsiedzi, skoki traceroute, pozycja, telemetria…) oraz pomocniki
 * eksportu. Dane strukturalne (`entry.detail`) dostarcza sniffer_decode.py;
 * wpis bez nich (starszy backend) spada na płaską listę `entry.fields`.
 *
 * Model szczegółów to lista sekcji:
 *   { kind: "kv",        title, rows: [{ k, v }] }
 *   { kind: "neighbors", title, rows: [{ id, name, short, snr }] }
 *   { kind: "hops",      title, summary, hops: [{ index, role, id, name, short, snr }] }
 *   { kind: "text",      title, text }
 * gdzie v / snr to „span”: { t: tekst, s?: styl CSS, href?: odnośnik, mono?: true }.
 */

import { portLabel, routingErrorLabel } from "./port-names.js";
import { enumLabel } from "./enum-labels.js";
import { signalStyle } from "./signal-quality.js";

export const BROADCAST = 0xffffffff;

/* ── ogólne ───────────────────────────────────────────────── */

const pad = (value) => String(value).padStart(2, "0");

export function stamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function csvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function hexId(id) {
  return `!${(id >>> 0).toString(16).padStart(8, "0")}`;
}

/* "!a1b2c3d4" z koperty MQTT → liczba (do szukania nazwy) */
export function gatewayNum(gateway) {
  if (typeof gateway !== "string" || !gateway.startsWith("!")) {
    return null;
  }
  const value = parseInt(gateway.slice(1), 16);
  return Number.isFinite(value) ? value >>> 0 : null;
}

/* Polska odmiana: plural(5, "skok", "skoki", "skoków") */
export function plural(n, one, few, many) {
  const abs = Math.abs(n);
  if (abs === 1) {
    return one;
  }
  const last = abs % 10;
  const tens = abs % 100;
  return last >= 2 && last <= 4 && !(tens >= 12 && tens <= 14) ? few : many;
}

export function fmtNumber(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(digits)));
}

export function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) {
    return `${days} d ${hours} h`;
  }
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  if (minutes > 0) {
    return total % 60 ? `${minutes} min ${total % 60} s` : `${minutes} min`;
  }
  return `${total} s`;
}

export function fmtBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return bytes < 1048576 ? `${fmtNumber(bytes / 1024, 1)} KB` : `${fmtNumber(bytes / 1048576, 1)} MB`;
}

export function fmtCoord(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lon).toFixed(5)}° ${ew}`;
}

export function mapLink(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
}

export function fmtPrecision(meters) {
  return meters >= 1000 ? `${fmtNumber(meters / 1000, 1)} km` : `${meters} m`;
}

export function fmtEpoch(seconds) {
  if (!seconds) {
    return "—";
  }
  return new Date(seconds * 1000).toLocaleString();
}

/* ── etykiety ─────────────────────────────────────────────── */

export const LABELS = {
  content: "Treść",
  text: "Wiadomość",
  position: "Pozycja",
  coords: "Współrzędne",
  altitude: "Wysokość",
  precision: "Dokładność",
  satellites: "Satelity",
  speed: "Prędkość",
  heading: "Kierunek",
  pdop: "PDOP",
  time: "Czas",
  gpsTime: "Czas GPS",
  nodeinfo: "Informacje o węźle",
  longName: "Nazwa",
  shortName: "Skrót",
  nodeId: "ID węzła",
  hardware: "Sprzęt",
  role: "Rola",
  publicKey: "Klucz publiczny",
  keyPresent: "jest",
  keyMissing: "brak",
  licensed: "Licencja krótkofalarska",
  yes: "tak",
  no: "nie",
  neighbors: "Sąsiedzi",
  noNeighbors: "Brak sąsiadów w pakiecie",
  node: "Węzeł",
  interval: "Interwał rozgłaszania",
  towards: "Trasa do celu",
  back: "Trasa powrotna",
  origin: "start",
  destination: "cel",
  unknownNode: "nieznany węzeł",
  noRoute: "Brak pośrednich węzłów (połączenie bezpośrednie)",
  request: "zapytanie",
  reply: "odpowiedź",
  kind: "Rodzaj",
  result: "Wynik",
  admin: "Administracja",
  command: "Polecenie",
  adminNote: "Treść polecenia nie jest pokazywana (może zawierać klucze i hasła).",
  waypoint: "Punkt na mapie",
  name: "Nazwa",
  description: "Opis",
  icon: "Ikona",
  expires: "Wygasa",
  lockedTo: "Zablokowany dla",
  mapReport: "Raport dla mapy",
  paxcounter: "Licznik osób",
  storeForward: "Przechowaj i prześlij",
  onDemand: "OnDemand",
  telemetry: "Telemetria",
  external: "zasilanie zewnętrzne",
};

const VARIANT_TITLES = {
  device_metrics: "Metryki urządzenia",
  environment_metrics: "Środowisko",
  air_quality_metrics: "Jakość powietrza",
  power_metrics: "Zasilanie",
  local_stats: "Statystyki lokalne",
  health_metrics: "Zdrowie",
  host_metrics: "Host",
  traffic_management_stats: "Zarządzanie ruchem",
};

const ITEM_LABELS = {
  batteryLevel: "Bateria",
  voltage: "Napięcie",
  channelUtilization: "Zajętość kanału",
  airUtilTx: "Czas nadawania (TX)",
  uptimeSeconds: "Czas pracy",
  temperature: "Temperatura",
  relativeHumidity: "Wilgotność",
  barometricPressure: "Ciśnienie",
  gasResistance: "Rezystancja gazu",
  iaq: "Jakość powietrza (IAQ)",
  current: "Prąd",
  distance: "Odległość",
  lux: "Natężenie światła",
  whiteLux: "Światło białe",
  irLux: "Podczerwień",
  uvLux: "Ultrafiolet",
  windDirection: "Kierunek wiatru",
  windSpeed: "Prędkość wiatru",
  windGust: "Poryw wiatru",
  windLull: "Min. prędkość wiatru",
  weight: "Waga",
  radiation: "Promieniowanie",
  rainfall1H: "Opad (1 h)",
  rainfall24H: "Opad (24 h)",
  soilMoisture: "Wilgotność gleby",
  soilTemperature: "Temperatura gleby",
  numPacketsTx: "Pakiety wysłane",
  numPacketsRx: "Pakiety odebrane",
  numPacketsRxBad: "Pakiety błędne",
  numOnlineNodes: "Węzły online",
  numTotalNodes: "Węzły łącznie",
  numRxDupe: "Duplikaty odbioru",
  numTxRelay: "Retransmisje",
  numTxRelayCanceled: "Anulowane retransmisje",
  heapTotalBytes: "Pamięć sterty (razem)",
  heapFreeBytes: "Pamięć sterty (wolna)",
  freememBytes: "Wolna pamięć",
  diskfree1: "Wolne miejsce 1",
  diskfree2: "Wolne miejsce 2",
  diskfree3: "Wolne miejsce 3",
  load1: "Obciążenie 1 min",
  load5: "Obciążenie 5 min",
  load15: "Obciążenie 15 min",
  wifi: "Wi-Fi",
  ble: "Bluetooth (BLE)",
  uptime: "Czas pracy",
  longName: "Nazwa",
  shortName: "Skrót",
  role: "Rola",
  hwModel: "Sprzęt",
  firmwareVersion: "Wersja firmware",
  region: "Region",
  modemPreset: "Preset modemu",
  hasDefaultChannel: "Kanał domyślny",
  latitude: "Szerokość geogr.",
  longitude: "Długość geogr.",
  altitude: "Wysokość",
  positionPrecision: "Dokładność pozycji",
  numOnlineLocalNodes: "Węzły online w pobliżu",
  hasOptedReportLocation: "Zgoda na raportowanie pozycji",
  variant: "Rodzaj",
  rr: "Rodzaj",
  heartbeat: "Heartbeat",
  stats: "Statystyki",
  history: "Historia",
  text: "Tekst",
};

const ADMIN_NAMES = {
  get_channel_request: "Odczyt kanału",
  get_channel_response: "Odpowiedź: kanał",
  get_owner_request: "Odczyt właściciela",
  get_owner_response: "Odpowiedź: właściciel",
  get_config_request: "Odczyt konfiguracji",
  get_config_response: "Odpowiedź: konfiguracja",
  get_module_config_request: "Odczyt konfiguracji modułu",
  get_module_config_response: "Odpowiedź: konfiguracja modułu",
  get_canned_message_module_messages_request: "Odczyt gotowych wiadomości",
  get_device_metadata_request: "Odczyt metadanych urządzenia",
  get_device_metadata_response: "Odpowiedź: metadane urządzenia",
  get_ringtone_request: "Odczyt dzwonka",
  get_device_connection_status_request: "Odczyt stanu połączeń",
  set_owner: "Ustawienie właściciela",
  set_channel: "Ustawienie kanału",
  set_config: "Ustawienie konfiguracji",
  set_module_config: "Ustawienie konfiguracji modułu",
  set_fixed_position: "Ustawienie stałej pozycji",
  remove_fixed_position: "Usunięcie stałej pozycji",
  set_time_only: "Ustawienie czasu",
  begin_edit_settings: "Początek edycji ustawień",
  commit_edit_settings: "Zatwierdzenie ustawień",
  reboot_seconds: "Restart",
  reboot_ota_seconds: "Restart (OTA)",
  shutdown_seconds: "Wyłączenie",
  factory_reset_config: "Reset ustawień",
  factory_reset_device: "Reset do ustawień fabrycznych",
  nodedb_reset: "Wyczyszczenie bazy węzłów",
  remove_by_nodenum: "Usunięcie węzła z bazy",
  set_favorite_node: "Dodanie do ulubionych",
  remove_favorite_node: "Usunięcie z ulubionych",
  set_ignored_node: "Ignorowanie węzła",
  remove_ignored_node: "Cofnięcie ignorowania",
  session_passkey: "Klucz sesji",
};

export function humanizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

export function itemLabel(key) {
  return ITEM_LABELS[key] || humanizeKey(key);
}

/* ── „spany” i węzły ──────────────────────────────────────── */

const span = (t, extra = {}) => ({ t: String(t), ...extra });

export function snrSpan(snr, rssi, preset) {
  const parts = [];
  if (typeof snr === "number") {
    parts.push(`${snr.toFixed(1)} dB`);
  }
  if (typeof rssi === "number" && rssi !== 0) {
    parts.push(`${rssi} dBm`);
  }
  if (!parts.length) {
    return null;
  }
  return span(parts.join(" • "), { s: signalStyle(typeof snr === "number" ? snr : undefined, typeof rssi === "number" && rssi !== 0 ? rssi : undefined, preset) });
}

/* ctx.nodeOf(id) → { short, long } | null */
export function nodeRef(id, ctx) {
  if (id === null || id === undefined) {
    return { id: null, name: LABELS.unknownNode, short: null, hex: null, unknown: true };
  }
  const info = (ctx && ctx.nodeOf && ctx.nodeOf(id)) || {};
  return {
    id: id >>> 0,
    hex: hexId(id),
    name: info.long || info.short || null,
    short: info.short || null,
    unknown: false,
  };
}

function nodeSpan(id, ctx) {
  const ref = nodeRef(id, ctx);
  if (ref.unknown) {
    return span(ref.name);
  }
  const name = ref.name ? `${ref.name} (${ref.hex})` : ref.hex;
  return span(name, ref.name ? {} : { mono: true });
}

/* ── sekcje szczegółów ────────────────────────────────────── */

function kv(title, rows) {
  return { kind: "kv", title, rows: rows.filter((row) => row && row.v !== undefined && row.v !== null) };
}

const row = (k, v) => ({ k, v: typeof v === "object" && v !== null ? v : span(v) });

function positionSections(d, ctx) {
  const rows = [];
  if (typeof d.lat === "number" && typeof d.lon === "number") {
    rows.push(row(LABELS.coords, span(fmtCoord(d.lat, d.lon), { href: mapLink(d.lat, d.lon) })));
  }
  if (d.alt !== undefined) {
    rows.push(row(LABELS.altitude, `${d.alt} m`));
  }
  if (d.precision_bits) {
    const meters = d.precision_m ? ` (≈ ${fmtPrecision(d.precision_m)})` : "";
    rows.push(row(LABELS.precision, `${d.precision_bits} ${plural(d.precision_bits, "bit", "bity", "bitów")}${meters}`));
  }
  if (d.sats) {
    rows.push(row(LABELS.satellites, d.sats));
  }
  if (d.speed) {
    rows.push(row(LABELS.speed, `${d.speed} m/s (${fmtNumber(d.speed * 3.6, 1)} km/h)`));
  }
  if (d.track) {
    rows.push(row(LABELS.heading, `${fmtNumber(d.track / 100000, 0)}°`));
  }
  if (d.pdop) {
    rows.push(row(LABELS.pdop, fmtNumber(d.pdop / 100, 2)));
  }
  if (d.time) {
    rows.push(row(LABELS.time, fmtEpoch(d.time)));
  }
  return [kv(LABELS.position, rows)];
}

function nodeinfoSections(d, ctx) {
  const rows = [
    row(LABELS.longName, d.long_name || "—"),
    row(LABELS.shortName, d.short_name ? span(d.short_name, { chip: true }) : "—"),
    row(LABELS.nodeId, span(d.id || "—", { mono: true })),
    row(LABELS.hardware, d.hw && d.hw !== "UNSET" ? d.hw : "—"),
    row(LABELS.role, d.role ? enumLabel("Role", d.role) : "—"),
    row(LABELS.publicKey, d.has_key ? span(LABELS.keyPresent, { s: "color:var(--success-color,#4caf50);" }) : span(LABELS.keyMissing)),
  ];
  if (d.licensed) {
    rows.push(row(LABELS.licensed, LABELS.yes));
  }
  return [kv(LABELS.nodeinfo, rows)];
}

export function itemValue(item) {
  const { k, v, u } = item;
  if (typeof v === "boolean") {
    return v ? LABELS.yes : LABELS.no;
  }
  if (Array.isArray(v)) {
    return v.join(", ");
  }
  if (k === "uptimeSeconds" || k === "uptime") {
    return fmtDuration(v);
  }
  if (k === "batteryLevel") {
    return v > 100 ? LABELS.external : `${fmtNumber(v, 0)} %`;
  }
  if (k === "heapTotalBytes" || k === "heapFreeBytes" || k === "freememBytes" || /^diskfree/.test(k)) {
    return fmtBytes(v);
  }
  if (typeof v === "number") {
    return u ? `${fmtNumber(v)} ${u}` : fmtNumber(v);
  }
  return v === "" ? "—" : String(v);
}

function itemsSection(title, items, skip = []) {
  return kv(
    title,
    items
      .filter((item) => !skip.includes(item.k))
      .map((item) => row(itemLabel(item.k), item.k === "role" ? enumLabel("Role", item.v) : itemValue(item)))
  );
}

function telemetrySections(d) {
  const title = VARIANT_TITLES[d.variant] || humanizeKey(d.variant || LABELS.telemetry);
  const sections = [itemsSection(title, d.items || [])];
  if (d.time) {
    sections[0].rows.push(row(LABELS.time, fmtEpoch(d.time)));
  }
  return sections;
}

export function routingText(error) {
  return routingErrorLabel("pl", error);
}

function routingSections(d, ctx) {
  if (d.error) {
    const ok = d.error === "NONE";
    return [
      kv(LABELS.result, [
        row(LABELS.result, span(routingText(d.error), { s: `color:${ok ? "var(--success-color,#4caf50)" : "var(--error-color,#f44336)"};` })),
        row("Kod", span(d.error, { mono: true })),
      ]),
    ];
  }
  const sections = [kv(LABELS.kind, [row(LABELS.kind, humanizeKey(d.variant || "—"))])];
  if (d.route && d.route.length) {
    sections.push(hopsSection(LABELS.towards, chainFromRoute(d.route, d.snr_towards), ctx));
  }
  if (d.route_back && d.route_back.length) {
    sections.push(hopsSection(LABELS.back, chainFromRoute(d.route_back, d.snr_back), ctx));
  }
  return sections;
}

function chainFromRoute(route, snr) {
  return route.map((node, index) => ({ node, snr: snr && snr[index] !== undefined ? snr[index] : null }));
}

/* chain: [{ node: id|null, snr: dB|null }] — snr = łącze PROWADZĄCE do tego węzła */
export function hopsSection(title, chain, ctx) {
  const last = chain.length - 1;
  const hops = chain.map((hop, index) => {
    const ref = nodeRef(hop.node, ctx);
    return {
      index,
      role: index === 0 ? "origin" : index === last ? "destination" : ref.unknown ? "unknown" : "hop",
      id: ref.hex,
      name: ref.name,
      short: ref.short,
      unknown: ref.unknown,
      snr: typeof hop.snr === "number" ? snrSpan(hop.snr, undefined, ctx && ctx.preset) : null,
    };
  });
  const between = Math.max(0, chain.length - 2);
  const summary = between === 0 ? LABELS.noRoute : `${between} ${plural(between, "węzeł pośredni", "węzły pośrednie", "węzłów pośrednich")}`;
  return { kind: "hops", title, summary, hops };
}

function tracerouteSections(d, ctx) {
  const kind = d.reply ? LABELS.reply : LABELS.request;
  const sections = [hopsSection(`${LABELS.towards} (${kind})`, d.towards || [], ctx)];
  if (d.back && d.back.length) {
    sections.push(hopsSection(LABELS.back, d.back, ctx));
  }
  return sections;
}

function neighborSections(d, ctx) {
  const head = kv(LABELS.neighbors, [
    d.node ? row(LABELS.node, nodeSpan(d.node, ctx)) : null,
    d.interval ? row(LABELS.interval, fmtDuration(d.interval)) : null,
    row("Liczba sąsiadów", (d.neighbors || []).length),
  ]);
  const list = {
    kind: "neighbors",
    title: LABELS.neighbors,
    empty: LABELS.noNeighbors,
    rows: (d.neighbors || []).map((n) => {
      const ref = nodeRef(n.node, ctx);
      return { id: ref.hex, name: ref.name, short: ref.short, snr: snrSpan(n.snr, undefined, ctx && ctx.preset) };
    }),
  };
  return [head, list];
}

function adminSections(d) {
  return [
    kv(LABELS.admin, [
      row(LABELS.command, ADMIN_NAMES[d.variant] || humanizeKey(d.variant || "—")),
      d.variant ? row("Kod", span(d.variant, { mono: true })) : null,
      row("", span(LABELS.adminNote, { note: true })),
    ]),
  ];
}

function waypointSections(d, ctx) {
  return [
    kv(LABELS.waypoint, [
      row(LABELS.name, d.name || "—"),
      d.icon ? row(LABELS.icon, d.icon) : null,
      d.description ? row(LABELS.description, d.description) : null,
      typeof d.lat === "number" ? row(LABELS.coords, span(fmtCoord(d.lat, d.lon), { href: mapLink(d.lat, d.lon) })) : null,
      d.expire ? row(LABELS.expires, fmtEpoch(d.expire)) : null,
      d.locked_to ? row(LABELS.lockedTo, nodeSpan(d.locked_to, ctx)) : null,
    ]),
  ];
}

function mapReportSections(d) {
  const lat = d.items.find((i) => i.k === "latitude");
  const lon = d.items.find((i) => i.k === "longitude");
  const rest = d.items.filter((i) => i.k !== "latitude" && i.k !== "longitude");
  const section = itemsSection(LABELS.mapReport, rest);
  if (lat && lon) {
    section.rows.push(row(LABELS.coords, span(fmtCoord(lat.v, lon.v), { href: mapLink(lat.v, lon.v) })));
  }
  return [section];
}

function ondemandSections(d) {
  return [kv(LABELS.onDemand, [row(LABELS.kind, d.variant === "request" ? LABELS.request : d.variant === "response" ? LABELS.reply : "—"), d.name ? row(LABELS.command, span(d.name, { mono: true })) : null])];
}

/* Starszy backend (bez `detail`): płaska lista pól, jak dotąd. */
function legacyFieldSections(entry, ctx) {
  const fields = entry.fields || [];
  if (!fields.length) {
    return [];
  }
  return [
    kv(
      LABELS.content,
      fields.map((field) => {
        const value = field.v;
        let text;
        if (field.t === "nodes") {
          text = (value || []).map((id) => nodeSpan(id, ctx).t).join(" → ") || "—";
        } else if (field.t === "node") {
          text = nodeSpan(value, ctx).t;
        } else if (field.t === "neighbors") {
          text = (value || []).map((n) => `${nodeSpan(n.node, ctx).t} (SNR ${n.snr} dB)`).join(", ") || "—";
        } else if (field.t === "time") {
          text = fmtEpoch(value);
        } else if (field.t === "routing_error") {
          text = routingText(value);
        } else if (Array.isArray(value)) {
          text = value.join(", ");
        } else {
          text = value === null || value === undefined || value === "" ? "—" : String(value);
        }
        return row(itemLabel(field.k), text);
      })
    ),
  ];
}

const BUILDERS = {
  position: positionSections,
  nodeinfo: nodeinfoSections,
  telemetry: telemetrySections,
  routing: routingSections,
  traceroute: tracerouteSections,
  neighbors: neighborSections,
  admin: adminSections,
  waypoint: waypointSections,
  map_report: mapReportSections,
  ondemand: ondemandSections,
  paxcounter: (d) => [itemsSection(LABELS.paxcounter, d.items || [])],
  store_forward: (d) => [itemsSection(LABELS.storeForward, d.items || [])],
};

/* Sekcje „Treść” pakietu: czytelny widok wg typu albo płaska lista pól. */
export function buildDetailSections(entry, ctx) {
  const detail = entry.detail;
  if (detail && detail.type === "text") {
    return [{ kind: "text", title: LABELS.text, text: detail.text }];
  }
  const build = detail ? BUILDERS[detail.type] : null;
  if (build) {
    try {
      return build(detail, ctx);
    } catch (err) {
      // nietypowy kształt danych nie może zepsuć karty — wtedy płaska lista
      return legacyFieldSections(entry, ctx);
    }
  }
  const fields = entry.fields || [];
  if (fields.length === 1 && fields[0].k === "text") {
    return [{ kind: "text", title: LABELS.text, text: String(fields[0].v) }];
  }
  return legacyFieldSections(entry, ctx);
}

/* ── filtrowanie: węzły i porty o pasującej nazwie ─────────── */

/* names: { id: shortName }, longNames: { id: longName } → numery węzłów, których nazwa zawiera tekst */
export function matchingNodeIds(needle, names, longNames) {
  const text = (needle || "").trim().toLowerCase();
  if (!text) {
    return [];
  }
  const ids = new Set();
  for (const [id, short] of Object.entries(names || {})) {
    if (String(short).toLowerCase().includes(text)) {
      ids.add(Number(id) >>> 0);
    }
  }
  for (const [id, long] of Object.entries(longNames || {})) {
    if (String(long).toLowerCase().includes(text)) {
      ids.add(Number(id) >>> 0);
    }
  }
  return [...ids].slice(0, 5000);
}

export const KNOWN_PORTS = [
  "TEXT_MESSAGE_APP",
  "TEXT_MESSAGE_COMPRESSED_APP",
  "REMOTE_HARDWARE_APP",
  "POSITION_APP",
  "NODEINFO_APP",
  "ROUTING_APP",
  "ADMIN_APP",
  "WAYPOINT_APP",
  "DETECTION_SENSOR_APP",
  "ALERT_APP",
  "PAXCOUNTER_APP",
  "STORE_FORWARD_PLUS_APP",
  "NODE_STATUS_APP",
  "SERIAL_APP",
  "STORE_FORWARD_APP",
  "RANGE_TEST_APP",
  "TELEMETRY_APP",
  "ZPS_APP",
  "SIMULATOR_APP",
  "TRACEROUTE_APP",
  "NEIGHBORINFO_APP",
  "MAP_REPORT_APP",
  "ON_DEMAND_APP",
];

/* nazwy portów, których polska etykieta (albo sama nazwa) zawiera tekst; ENCRYPTED/PKI obsługuje wpis */
export function matchingPorts(needle) {
  const text = (needle || "").trim().toLowerCase();
  if (!text) {
    return [];
  }
  const out = KNOWN_PORTS.filter((port) => portLabel("pl", port).toLowerCase().includes(text));
  if ("zaszyfrowany".includes(text) || "encrypted".includes(text)) {
    out.push("ENCRYPTED");
  }
  if ("prywatna wiadomość (pki)".includes(text) || "pki".includes(text)) {
    out.push("PKI");
  }
  return out;
}

/* ── eksport ──────────────────────────────────────────────── */

export const CSV_COLUMNS = [
  "source",
  "gateway",
  "time",
  "seq",
  "from",
  "from_name",
  "to",
  "to_name",
  "channel",
  "id",
  "port",
  "info",
  "rx_snr",
  "rx_rssi",
  "hop_limit",
  "hop_start",
  "hops_away",
  "relay_node",
  "want_ack",
  "signed",
  "pki",
  "via_mqtt",
  "encrypted",
  "payload_size",
  "payload_hex",
];

/* ctx.name(id) → krótka nazwa | null */
export function exportRow(entry, ctx) {
  return {
    ...entry,
    time: new Date(entry.ts).toISOString(),
    from_name: (ctx && ctx.name(entry.from)) || "",
    to_name: entry.to >>> 0 === BROADCAST ? "broadcast" : (ctx && ctx.name(entry.to)) || "",
  };
}

export function csvLine(row) {
  return CSV_COLUMNS.map((column) => csvCell(row[column])).join(";");
}

/* Porcja wpisów jako fragment tablicy JSON (przecinki między porcjami). */
export function jsonChunk(rows, first) {
  const body = rows.map((row) => JSON.stringify(row, null, 2).replace(/^/gm, "    ")).join(",\n");
  return (first ? "\n" : ",\n") + body;
}

export const jsonHeader = (exportedAt) => `{\n  "exported_at": ${JSON.stringify(exportedAt)},\n  "entries": [`;
export const jsonFooter = (count) => `\n  ],\n  "count": ${count}\n}\n`;
