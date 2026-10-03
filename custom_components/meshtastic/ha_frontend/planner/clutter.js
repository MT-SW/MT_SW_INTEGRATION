// Przeszkody terenowe z OpenStreetMap (budynki, lasy, zabudowa) przez Overpass API.
// Port: PlannerClutter.kt (ClutterMap, ClutterPolygon, stałe), OsmClutterParser.kt, OsmQueries.kt, PlannerOverpass.kt.
// Dane © współtwórcy OpenStreetMap (ODbL).
import { distanceM, interpolate } from './geodesy.js';
import { fmt, clamp, Mutex, abortError, isAbortError, throwIfAborted } from './util.js';
import { plannerFetch, hostOf } from './net.js';

export const ClutterKind = Object.freeze({ BUILDING: 'BUILDING', FOREST: 'FOREST', RESIDENTIAL: 'RESIDENTIAL', COMMERCIAL: 'COMMERCIAL' });

/** Powód braku danych o przeszkodach (UI tłumaczy na komunikat; przy TOO_LARGE: zmniejsz zasięg). */
export const PlannerClutterFailure = Object.freeze({
  NETWORK: 'NETWORK', BAD_RESPONSE: 'BAD_RESPONSE', TOO_LARGE: 'TOO_LARGE',
  /** Serwer odmówił albo nie dał rady (przeciążony, limit czasu, „out of memory” po jego stronie) - to nie pamięć urządzenia. */
  SERVER_LIMIT: 'SERVER_LIMIT',
});

export class PlannerClutterError extends Error {
  /**
   * @param {'NETWORK'|'BAD_RESPONSE'|'TOO_LARGE'|'SERVER_LIMIT'} failure
   * @param {*} [cause]
   * @param {Object} [detail]  dane diagnostyczne (JSON-owe): status HTTP, nazwa/komunikat błędu, uwaga serwera,
   *   lista prób po kolejnych serwerach; UI pokazuje je w „Szczegóły techniczne”
   */
  constructor(failure, cause, detail) {
    super(`Planner clutter unavailable: ${failure}`);
    this.name = 'PlannerClutterError';
    this.failure = failure;
    if (cause !== undefined) this.cause = cause;
    this.detail = detail || (cause !== undefined ? { errorName: cause && cause.name, errorMessage: shorten(cause && cause.message) } : {});
  }
}

/** Skraca tekst do jednej linii (do podglądu błędów serwera: HTML bez tagów, białe znaki zwinięte). */
export function shorten(text, max = 300) {
  if (text === undefined || text === null) return '';
  const s = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Domyślne wysokości przeszkód (m nad gruntem). */
export const CLUTTER_HEIGHT_DEFAULTS = Object.freeze({
  forestM: 15.0, buildingM: 8.0, residentialM: 8.0, commercialM: 12.0,
});
export const MAX_CLUTTER_HEIGHT_M = 200.0;

/** Stałe plannera dotyczące przeszkód (PlannerClutter). */
export const PlannerClutter = Object.freeze({
  MAX_AREA_RADIUS_KM: 100.0,
  DEFAULT_AREA_RADIUS_KM: 30.0,
  AREA_RADIUS_OPTIONS_KM: Object.freeze([5, 10, 15, 30, 50, 100]),
  CLEAR_AROUND_ANTENNA_M: 100.0,
  LONG_LINK_M: 20000.0,
  BUILDINGS_NEAR_END_M: 8000.0,
});

const heightsOf = (h) => ({ ...CLUTTER_HEIGHT_DEFAULTS, ...(h || {}) });

/** Parzystość nieparzysta promienia (even-odd), x = długość, y = szerokość. ring: płaska tablica lat0,lon0,lat1,lon1,... */
export function ringContains(ring, lat, lon) {
  const n = ring.length >> 1;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const yi = ring[2 * i], xi = ring[2 * i + 1], yj = ring[2 * j], xj = ring[2 * j + 1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

/** Jeden zamknięty kontur (z otworami). */
export class ClutterPolygon {
  /**
   * @param {string} kind ClutterKind
   * @param {number|null} explicitHeightM wysokość ze źródła (tylko budynki) lub null
   * @param {Float64Array|number[]} outer lat0,lon0,lat1,lon1,...
   * @param {Array<Float64Array|number[]>} holes
   */
  constructor(kind, explicitHeightM, outer, holes = []) {
    this.kind = kind;
    this.explicitHeightM = explicitHeightM;
    this.outer = outer;
    this.holes = holes;
    let a = Number.MAX_VALUE, b = -Number.MAX_VALUE, c = Number.MAX_VALUE, d = -Number.MAX_VALUE;
    for (let i = 0; i + 1 < outer.length; i += 2) {
      a = Math.min(a, outer[i]); b = Math.max(b, outer[i]);
      c = Math.min(c, outer[i + 1]); d = Math.max(d, outer[i + 1]);
    }
    this.minLat = a; this.maxLat = b; this.minLon = c; this.maxLon = d;
  }

  contains(lat, lon) {
    if (lat < this.minLat || lat > this.maxLat || lon < this.minLon || lon > this.maxLon) return false;
    if (!ringContains(this.outer, lat, lon)) return false;
    for (const h of this.holes) if (ringContains(h, lat, lon)) return false;
    return true;
  }

  heightM(heights) {
    const hs = heightsOf(heights);
    let h;
    switch (this.kind) {
      case ClutterKind.BUILDING: h = this.explicitHeightM ?? hs.buildingM; break;
      case ClutterKind.FOREST: h = hs.forestM; break;
      case ClutterKind.RESIDENTIAL: h = hs.residentialM; break;
      default: h = hs.commercialM;
    }
    return clamp(h, 0.0, MAX_CLUTTER_HEIGHT_M);
  }
}

const CELL_DEG = 0.01; // ok. 1.1 km szerokości geograficznej
const MAX_CELLS_PER_POLYGON = 2500;
const cellKey = (ix, iy) => (ix + 1048576) * 4194304 + (iy + 1048576);

/** Przeszkody wokół trasy/obszaru, indeksowane siatką. */
export class ClutterMap {
  /** @param {ClutterPolygon[]} polygons */
  constructor(polygons) {
    this.polygons = polygons;
    this._cells = new Map();
    this._large = [];
    let buildings = 0, forests = 0, areas = 0;
    polygons.forEach((p, i) => {
      if (p.kind === ClutterKind.BUILDING) buildings++;
      else if (p.kind === ClutterKind.FOREST) forests++;
      else areas++;
      const ix0 = Math.floor(p.minLon / CELL_DEG), ix1 = Math.floor(p.maxLon / CELL_DEG);
      const iy0 = Math.floor(p.minLat / CELL_DEG), iy1 = Math.floor(p.maxLat / CELL_DEG);
      const count = (ix1 - ix0 + 1) * (iy1 - iy0 + 1);
      if (count > MAX_CELLS_PER_POLYGON) this._large.push(i);
      else {
        for (let ix = ix0; ix <= ix1; ix++) {
          for (let iy = iy0; iy <= iy1; iy++) {
            const k = cellKey(ix, iy);
            let list = this._cells.get(k);
            if (!list) { list = []; this._cells.set(k, list); }
            list.push(i);
          }
        }
      }
    });
    /** @type {{buildings:number,forests:number,areas:number,total:number}} */
    this.stats = { buildings, forests, areas, total: buildings + forests + areas };
  }

  isEmpty() { return this.polygons.length === 0; }

  /** Wysokość (m nad gruntem) najwyższej przeszkody w punkcie; 0 na otwartym terenie. */
  heightAt(lat, lon, heights) {
    let best = 0.0;
    const list = this._cells.get(cellKey(Math.floor(lon / CELL_DEG), Math.floor(lat / CELL_DEG)));
    if (list) {
      for (const i of list) {
        const p = this.polygons[i];
        if (p.contains(lat, lon)) best = Math.max(best, p.heightM(heights));
      }
    }
    for (const i of this._large) {
      const p = this.polygons[i];
      if (p.contains(lat, lon)) best = Math.max(best, p.heightM(heights));
    }
    return best;
  }

  /** Postać do przesłania do workera (structured clone). */
  toTransferable() {
    return this.polygons.map((p) => ({
      kind: p.kind, explicitHeightM: p.explicitHeightM, outer: p.outer, holes: p.holes,
    }));
  }

  static fromTransferable(list) {
    return new ClutterMap(list.map((p) => new ClutterPolygon(p.kind, p.explicitHeightM, p.outer, p.holes)));
  }
}

export const EMPTY_CLUTTER_MAP = new ClutterMap([]);

/** Źródło bez przeszkód (domyślne w testach). */
export const NoClutterSource = Object.freeze({
  async forLink() { return EMPTY_CLUTTER_MAP; },
  async forArea() { return EMPTY_CLUTTER_MAP; },
});

/**
 * Wysokości terenu z doliczonymi przeszkodami. clutterAt(index) -> wysokość przeszkody próbki.
 * Próbki bliżej niż clearStartM/clearEndM od końców oraz same końce zostają na gruncie.
 */
export function withClutter(ground, stepM, clutterAt, clearStartM = PlannerClutter.CLEAR_AROUND_ANTENNA_M, clearEndM = PlannerClutter.CLEAR_AROUND_ANTENNA_M) {
  const last = ground.length - 1;
  const out = Float64Array.from(ground);
  const totalM = stepM * last;
  for (let i = 1; i < last; i++) {
    const d = stepM * i;
    if (d < clearStartM || totalM - d < clearEndM) continue;
    out[i] = ground[i] + clutterAt(i);
  }
  return out;
}

const sampleCount = (lengthM, spacingM, maxCount) => clamp(Math.trunc(Math.ceil(lengthM / spacingM)) || 0, 2, maxCount);

// ---------------------------------------------------------------- prostokąty i kafelki

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_AT_EQUATOR = 111.320;
const MIN_COS = 0.05;

/** Prostokąt szerokości/długości geograficznej (stopnie), dla którego dane przeszkód pobiera się jednym zapytaniem. */
export class ClutterBox {
  constructor(south, west, north, east) {
    this.south = south; this.west = west; this.north = north; this.east = east;
  }

  get heightKm() { return (this.north - this.south) * KM_PER_DEG_LAT; }

  get widthKm() {
    return (this.east - this.west) * KM_PER_DEG_LON_AT_EQUATOR * Math.max(MIN_COS, Math.cos((((this.north + this.south) / 2.0) * Math.PI) / 180.0));
  }

  get maxSideKm() { return Math.max(this.heightKm, this.widthKm); }

  /** Cztery ćwiartki (do podziału kafelka, który serwer uznał za zbyt ciężki). */
  quarters() {
    const midLat = (this.south + this.north) / 2.0;
    const midLon = (this.west + this.east) / 2.0;
    return [
      new ClutterBox(this.south, this.west, midLat, midLon),
      new ClutterBox(this.south, midLon, midLat, this.east),
      new ClutterBox(midLat, this.west, this.north, midLon),
      new ClutterBox(midLat, midLon, this.north, this.east),
    ];
  }

  /** `south,west,north,east` tak, jak chce Overpass. */
  asQueryBox() {
    return `${fmt(this.south, 5)},${fmt(this.west, 5)},${fmt(this.north, 5)},${fmt(this.east, 5)}`;
  }

  /** Kwadrat o połowie boku radiusKm wokół punktu. */
  static around(lat, lon, radiusKm) {
    const dLat = radiusKm / KM_PER_DEG_LAT;
    const dLon = radiusKm / (KM_PER_DEG_LON_AT_EQUATOR * Math.max(MIN_COS, Math.cos((lat * Math.PI) / 180.0)));
    return new ClutterBox(lat - dLat, lon - dLon, lat + dLat, lon + dLon);
  }
}

/** `box` pocięty na równą siatkę kafelków o boku najwyżej ok. maxSideKm (co najmniej jeden kafelek). */
export function clutterGrid(box, maxSideKm) {
  const rows = Math.max(1, Math.ceil(box.heightKm / maxSideKm));
  const cols = Math.max(1, Math.ceil(box.widthKm / maxSideKm));
  const dLat = (box.north - box.south) / rows;
  const dLon = (box.east - box.west) / cols;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(new ClutterBox(box.south + dLat * r, box.west + dLon * c, box.south + dLat * (r + 1), box.west + dLon * (c + 1)));
    }
  }
  return out;
}

// ---------------------------------------------------------------- zapytania Overpass

export const OsmQueries = (() => {
  const CORRIDOR_M = 30;
  // Limit czasu i pamięci zapisywane w każdym zapytaniu. SERVER_MAX_BYTES to RAM SERWERA Overpass (jego własny
  // domyślny limit to 512 MiB), nie pamięć przeglądarki; zbyt niski (kiedyś 16 MiB) daje „out of memory” nawet
  // dla małego obszaru. Rozmiar pobieranej odpowiedzi ogranicza osobno MAX_BODY_BYTES klienta.
  const SERVER_TIMEOUT_S = 40;
  // Zapytanie wzdłuż trasy sięga kilkadziesiąt kilometrów i może trwać dłużej niż kawałek obszaru zasięgu.
  const LINK_SERVER_TIMEOUT_S = 60;
  const SERVER_MAX_BYTES = 268435456;
  const POLYLINE_SPACING_M = 1500.0;
  const MAX_POLYLINE_POINTS = 40;
  const AREA_LANDUSE = ['forest', 'residential', 'commercial', 'industrial', 'retail'];
  const header = (timeoutS = SERVER_TIMEOUT_S) => `[out:json][timeout:${timeoutS}][maxsize:${SERVER_MAX_BYTES}];`;

  /** lat,lon,lat,lon,... punktów wzdłuż trasy między ułamkami f0 i f1 (oba końce włącznie). */
  function polyline(a, b, f0, f1) {
    const lengthM = distanceM(a, b) * (f1 - f0);
    const count = sampleCount(lengthM, POLYLINE_SPACING_M, MAX_POLYLINE_POINTS);
    const parts = [];
    for (let i = 0; i < count; i++) {
      const f = f0 + ((f1 - f0) * i) / (count - 1);
      const p = interpolate(a, b, f);
      parts.push(fmt(p.lat, 5), fmt(p.lon, 5));
    }
    return parts.join(',');
  }

  function forestStatements(whole) {
    return `way["natural"="wood"](around:${CORRIDOR_M},${whole});`
      + `way["landuse"="forest"](around:${CORRIDOR_M},${whole});`
      + `relation["natural"="wood"]["type"="multipolygon"](around:${CORRIDOR_M},${whole});`
      + `relation["landuse"="forest"]["type"="multipolygon"](around:${CORRIDOR_M},${whole});`;
  }

  function buildingStatements(line) {
    return `way["building"](around:${CORRIDOR_M},${line});`
      + `relation["building"]["type"="multipolygon"](around:${CORRIDOR_M},${line});`;
  }

  /** Ułamki trasy, wzdłuż których szuka się budynków: cała albo tylko okolice obu końców na długim łączu. */
  function buildingStretches(a, b) {
    const d = distanceM(a, b);
    if (d > PlannerClutter.LONG_LINK_M) {
      const f = PlannerClutter.BUILDINGS_NEAR_END_M / d;
      return [[0.0, f], [1.0 - f, 1.0]];
    }
    return [[0.0, 1.0]];
  }

  /** Lasy wzdłuż całej trasy i budynki; na łączu dłuższym niż LONG_LINK_M budynki tylko przy końcach. Jedno zapytanie. */
  function link(a, b) {
    let s = `${header()}(${forestStatements(polyline(a, b, 0.0, 1.0))}`;
    for (const [f0, f1] of buildingStretches(a, b)) s += buildingStatements(polyline(a, b, f0, f1));
    return `${s});out tags geom;`;
  }

  /**
   * Te same przeszkody co link(), jako kilka lżejszych zapytań: lasy całej trasy, potem budynki każdego odcinka osobno.
   * Jedno ciężkie zapytanie wpadało w limit czasu serwera na długim łączu; części są odpowiadane po kolei,
   * każda z dłuższym limitem LINK_SERVER_TIMEOUT_S.
   */
  function linkParts(a, b) {
    const parts = [`${header(LINK_SERVER_TIMEOUT_S)}(${forestStatements(polyline(a, b, 0.0, 1.0))});out tags geom;`];
    for (const [f0, f1] of buildingStretches(a, b)) {
      parts.push(`${header(LINK_SERVER_TIMEOUT_S)}(${buildingStatements(polyline(a, b, f0, f1))});out tags geom;`);
    }
    return parts;
  }

  /** Lasy i zabudowa w prostokącie wokół center (promień obcięty do 0.1..100 km). */
  function area(center, radiusKm) {
    const r = clamp(radiusKm, 0.1, PlannerClutter.MAX_AREA_RADIUS_KM);
    return box(ClutterBox.around(center.lat, center.lon, r));
  }

  /** Lasy i zabudowa w prostokącie: kawałek dużego obszaru zasięgu, o który pyta się osobno. */
  function box(b) {
    const q = b.asQueryBox();
    // Dokładne dopasowania klucz=wartość, nie wyrażenie regularne: serwer odpowiada na nie z indeksu i patrzy
    // tylko na lasy i zabudowę, a wzorzec zmusza go do przeczytania każdego landuse (wszystkich pól i łąk).
    let s = `${header()}(way["natural"="wood"](${q});`;
    for (const v of AREA_LANDUSE) s += `way["landuse"="${v}"](${q});`;
    s += `relation["natural"="wood"]["type"="multipolygon"](${q});`;
    for (const v of AREA_LANDUSE) s += `relation["landuse"="${v}"]["type"="multipolygon"](${q});`;
    return `${s});out tags geom;`;
  }

  return Object.freeze({ CORRIDOR_M, SERVER_TIMEOUT_S, LINK_SERVER_TIMEOUT_S, SERVER_MAX_BYTES, link, linkParts, area, box, polyline });
})();

// ---------------------------------------------------------------- parser odpowiedzi Overpass

const LEVEL_M = 3.0;
const ROOF_M = 1.0;
const MIN_RING_POINTS = 4;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const primContent = (x) => (typeof x === 'string' ? x : typeof x === 'number' || typeof x === 'boolean' ? String(x) : null);
const primNumber = (x) => {
  if (typeof x === 'number') return x;
  if (typeof x === 'string') { const n = Number(x); return x.trim() !== '' && !Number.isNaN(n) ? n : null; }
  return null;
};

function looksLikeFailure(remark) {
  const r = remark.toLowerCase();
  return r.includes('error') || r.includes('timed out') || r.includes('out of memory');
}

/** Klasa przeszkody wg tagów OSM albo null. */
export function classifyTags(tags) {
  const building = tags.building;
  if (building !== undefined && building !== 'no') return ClutterKind.BUILDING;
  if (tags.natural === 'wood' || tags.landuse === 'forest') return ClutterKind.FOREST;
  switch (tags.landuse) {
    case 'residential': return ClutterKind.RESIDENTIAL;
    case 'commercial': case 'industrial': case 'retail': return ClutterKind.COMMERCIAL;
    default: return null;
  }
}

/** Wiodąca liczba dziesiętna z tekstu ("12,5 m" -> 12.5) albo null. */
export function parseNumber(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/,/g, '.');
  let end = 0;
  while (end < t.length && ((t[end] >= '0' && t[end] <= '9') || t[end] === '.')) end++;
  if (end === 0) return null;
  const sub = t.substring(0, end);
  if (!/^(\d+\.?\d*|\.\d+)$/.test(sub)) return null;
  return Number(sub);
}

/** `height`, w przeciwnym razie `building:levels` x 3 m + 1 m dachu; null gdy brak użytecznych danych. */
export function buildingHeight(tags) {
  const h = parseNumber(tags.height);
  if (h !== null && h > 0.0) return Math.min(h, MAX_CLUTTER_HEIGHT_M);
  const lv = parseNumber(tags['building:levels']);
  if (lv !== null && lv > 0.0) return Math.min(lv * LEVEL_M + ROOF_M, MAX_CLUTTER_HEIGHT_M);
  return null;
}

function tagsOf(o) {
  const tags = o.tags;
  if (!isObj(tags)) return Object.create(null);
  const m = Object.create(null);
  for (const k of Object.keys(tags)) {
    const c = primContent(tags[k]);
    if (c !== null) m[k] = c;
  }
  return m;
}

function geometryOf(el) {
  if (!Array.isArray(el)) return null;
  const out = new Float64Array(el.length * 2);
  let n = 0;
  for (const p of el) {
    if (!isObj(p)) continue;
    const lat = primNumber(p.lat);
    const lon = primNumber(p.lon);
    if (lat === null || lon === null) continue;
    out[2 * n] = lat;
    out[2 * n + 1] = lon;
    n++;
  }
  return n === el.length ? out : out.slice(0, 2 * n);
}

function isClosed(ring) {
  const n = ring.length >> 1;
  return n >= MIN_RING_POINTS && ring[0] === ring[2 * n - 2] && ring[1] === ring[2 * n - 1];
}

function append(a, b) {
  const out = new Float64Array(a.length + b.length - 2);
  out.set(a, 0);
  out.set(b.subarray(2), a.length);
  return out;
}

function reverseRing(p) {
  const n = p.length >> 1;
  const out = new Float64Array(p.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = p[2 * (n - 1 - i)];
    out[2 * i + 1] = p[2 * (n - 1 - i) + 1];
  }
  return out;
}

/** Łączy kawałki dróg o wspólnych końcach w zamknięte pierścienie; niedomykające się odpadają. */
export function assembleRings(pieces) {
  const open = pieces.filter((p) => p.length >= 4).map((p) => (p instanceof Float64Array ? p : Float64Array.from(p)));
  const rings = [];
  while (open.length > 0) {
    let cur = open.pop();
    let stuck = false;
    while (!isClosed(cur) && !stuck) {
      const endLat = cur[cur.length - 2];
      const endLon = cur[cur.length - 1];
      let found = -1;
      let reversed = false;
      for (let k = 0; k < open.length; k++) {
        const p = open[k];
        if (p[0] === endLat && p[1] === endLon) { found = k; break; }
        if (p[p.length - 2] === endLat && p[p.length - 1] === endLon) { found = k; reversed = true; break; }
      }
      if (found < 0) stuck = true;
      else {
        const p = open.splice(found, 1)[0];
        cur = append(cur, reversed ? reverseRing(p) : p);
      }
    }
    if (isClosed(cur)) rings.push(cur);
  }
  return rings;
}

const METERS_PER_DEG = 111320.0;

/** true, gdy cały obrys mieści się w kwadracie thinM metrów: przy takiej skali jest niewidoczny. */
function isNegligible(p, thinM) {
  if (!(thinM > 0.0)) return false;
  const heightM = (p.maxLat - p.minLat) * METERS_PER_DEG;
  const widthM = (p.maxLon - p.minLon) * METERS_PER_DEG * Math.cos((p.minLat * Math.PI) / 180.0);
  return heightM < thinM && widthM < thinM;
}

/**
 * Obrys bez punktów leżących bliżej niż tolM metrów od ostatnio zachowanego; pierwszy punkt (będący też ostatnim
 * zamkniętego obrysu) zawsze zostaje. Obrys, który zostałby z mniej niż czterema punktami, wraca bez zmian.
 */
export function thinRing(ring, tolM) {
  const n = ring.length >> 1;
  if (!(tolM > 0.0) || n <= MIN_RING_POINTS) return ring;
  const tolDeg = tolM / METERS_PER_DEG;
  const tol2 = tolDeg * tolDeg;
  const cosLat = Math.cos((ring[0] * Math.PI) / 180.0);
  const out = new Float64Array(ring.length);
  out[0] = ring[0];
  out[1] = ring[1];
  let kept = 1;
  for (let i = 1; i < n - 1; i++) {
    const dy = ring[2 * i] - out[2 * (kept - 1)];
    const dx = (ring[2 * i + 1] - out[2 * (kept - 1) + 1]) * cosLat;
    if (dx * dx + dy * dy >= tol2) {
      out[2 * kept] = ring[2 * i];
      out[2 * kept + 1] = ring[2 * i + 1];
      kept++;
    }
  }
  out[2 * kept] = ring[2 * (n - 1)];
  out[2 * kept + 1] = ring[2 * (n - 1) + 1];
  kept++;
  return kept < MIN_RING_POINTS ? ring : out.slice(0, 2 * kept);
}

function wayPolygon(o, thinM) {
  const tags = tagsOf(o);
  const kind = classifyTags(tags);
  if (kind === null) return null;
  const ring = geometryOf(o.geometry);
  if (!ring || !isClosed(ring)) return null;
  const explicit = kind === ClutterKind.BUILDING ? buildingHeight(tags) : null;
  return new ClutterPolygon(kind, explicit, thinRing(ring, thinM));
}

function relationPolygons(o, thinM) {
  const tags = tagsOf(o);
  const kind = classifyTags(tags);
  if (kind === null) return [];
  if (!Array.isArray(o.members)) return [];
  const outers = [];
  const inners = [];
  for (const mo of o.members) {
    if (!isObj(mo)) continue;
    if (primContent(mo.type) !== 'way') continue;
    const geom = geometryOf(mo.geometry);
    if (!geom) continue;
    const role = primContent(mo.role);
    if (role === 'outer' || role === '') outers.push(geom);
    else if (role === 'inner') inners.push(geom);
  }
  const outerRings = assembleRings(outers).map((r) => thinRing(r, thinM));
  const innerRings = assembleRings(inners).map((r) => thinRing(r, thinM));
  if (outerRings.length === 0) return [];
  const holesFor = outerRings.map(() => []);
  for (const h of innerRings) {
    const idx = outerRings.findIndex((r) => ringContains(r, h[0], h[1]));
    if (idx >= 0) holesFor[idx].push(h);
  }
  const explicit = kind === ClutterKind.BUILDING ? buildingHeight(tags) : null;
  return outerRings.map((ring, i) => new ClutterPolygon(kind, explicit, ring, holesFor[i]));
}

/**
 * Zamienia odpowiedź Overpass (`[out:json]`, `out tags geom`) w ClutterMap.
 * Rzuca wyjątek, gdy tekst nie jest odpowiedzią Overpass albo serwer się poddał (`remark`).
 * @param {string} text
 * @param {Set<number>|null} [seen]  klucze (`id*2+1` relacji, `id*2` drogi) elementów z wcześniejszych kawałków dużego
 *   obszaru: element na granicy dwóch kawałków odpowiada każdy z nich i ma być policzony raz. Klucze tej odpowiedzi
 *   trafiają do zbioru dopiero po przeczytaniu całości.
 * @param {number} [thinM]  gdy > 0, punkty obrysu bliższe niż thinM metrów od poprzednio zachowanego są pomijane,
 *   a obiekty mieszczące się w kwadracie thinM metrów odpadają (przy dużym obszarze są niewidoczne, a punkty zajmują pamięć)
 */
export function parseOverpass(text, seen = null, thinM = 0.0) {
  const root = JSON.parse(text);
  if (!isObj(root)) throw new Error('not an object');
  const remark = primContent(root.remark);
  const elements = root.elements;
  if (!Array.isArray(elements)) throw new Error('no elements');
  if (remark !== null && elements.length === 0 && looksLikeFailure(remark)) {
    throw new Error(`overpass: ${remark}`);
  }
  const out = [];
  const fresh = seen ? [] : null;
  for (const o of elements) {
    if (!isObj(o)) continue;
    const t = primContent(o.type);
    if (seen && (t === 'way' || t === 'relation')) {
      const id = primNumber(o.id);
      if (id !== null) {
        const key = id * 2 + (t === 'relation' ? 1 : 0);
        if (seen.has(key)) continue;
        fresh.push(key);
      }
    }
    if (t === 'way') { const p = wayPolygon(o, thinM); if (p && !isNegligible(p, thinM)) out.push(p); }
    else if (t === 'relation') for (const p of relationPolygons(o, thinM)) if (!isNegligible(p, thinM)) out.push(p);
  }
  if (seen && fresh) for (const k of fresh) seen.add(k);
  return new ClutterMap(out);
}

// ---------------------------------------------------------------- klient Overpass

/** Serwery Overpass po kolei: przy błędzie sieci / HTTP 429, 502, 503, 504 / przekroczeniu czasu idziemy do następnego. */
const MIRRORS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]);
const BASE_URL = MIRRORS[0];
// Overpass nic nie wysyła, dopóki nie policzy całej odpowiedzi, więc limit musi przewyższać limit serwera
// (40 s dla kafelka, 60 s dla części trasy) z zapasem na sieć.
const TIMEOUT_MS = 95000;
const RETRY_DELAY_MS = 2000;
const CACHE_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 12000000;
const CACHE_ENTRIES = 3;
const MIN_RADIUS_KM = 0.5;
const MAX_ATTEMPTS_LOGGED = 8;

// Duży zasięg to wiele zapytań, po jednym naraz (publiczny serwer ogranicza równoległe użycie).
/** Do tego promienia obszar to jedno zapytanie. */
const SINGLE_REQUEST_KM = 10.0;
/** Rozmiar pierwszych kafelków dużego obszaru i najmniejszy kafelek, do którego dzieli się ciężki (km boku). */
const TILE_START_KM = 30.0;
const MIN_TILE_KM = 4.0;
/** Punkty obrysu bliższe niż tyle metrów są pomijane w obszarach kafelkowanych - tym mocniej, im większy promień. */
const THIN_M = 25.0;
const THIN_M_PER_KM = 0.8;
/** Punkty obrysów trzymane w pamięci dla dużego obszaru (każdy to dwie liczby), zanim uzna się go za za duży. */
const MAX_POINTS = 6000000;
/** Cały duży obszar musi dotrzeć w tym czasie. */
const TILED_BUDGET_MS = 12 * 60 * 1000;
const PAUSE_BETWEEN_TILES_MS = 250;
const BUSY_WAIT_MS = 5000;
const BUSY_RETRIES = 4;
const NETWORK_RETRIES = 2;
const NETWORK_RETRY_WAIT_MS = 2000;
const OVERLOAD_RETRIES = 2;
const OVERLOAD_WAIT_MS = 8000;
const LINK_RETRY_WAIT_MS = 3000;

const pointKey = (p) => `${fmt(p.lat, 5)},${fmt(p.lon, 5)}`;
const sleepMs = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) { reject(abortError()); return; }
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
});
const errInfo = (e) => ({ errorName: (e && e.name) || typeof e, errorMessage: shorten(e && e.message !== undefined ? e.message : e) });
/** Odpowiedzi, po których warto spróbować innego serwera. */
const isNextMirrorStatus = (s) => s === 403 || s === 408 || s === 429 || s >= 500;
/** Statusy znaczące „serwer zajęty / poddał się”. */
const isBusyStatus = (s) => s === 429 || s === 502 || s === 503 || s === 504;
/** Uwagi serwera przy HTTP 200 znaczące „zajęty, spróbuj gdzie indziej” (przeciążenie, limit zapytań). */
const isBusyRemark = (msg) => /rate_limit|too busy|too many|slot|dispatcher|overload/i.test(msg);

/**
 * Źródło przeszkód z serwerów Overpass. Odpowiedzi trzymane w pamięci przez 30 min (maks. 3 wpisy),
 * jedno zapytanie naraz (blokada obejmuje pojedyncze żądanie, nigdy cały obszar). Rzuca PlannerClutterError
 * (NETWORK / BAD_RESPONSE / TOO_LARGE / SERVER_LIMIT) z polem `detail`.
 * Zapytanie idzie POST-em (`data=` w treści, application/x-www-form-urlencoded - bez preflight CORS).
 */
export class PlannerOverpass {
  /**
   * @param {Object} [o]
   * @param {typeof fetch} [o.fetch]
   * @param {string} [o.baseUrl]   jeden serwer (zamiast listy mirrorów)
   * @param {string[]} [o.mirrors] lista serwerów po kolei (domyślnie 3 publiczne)
   * @param {number} [o.timeoutMs]  limit czasu jednej próby (pobranie), domyślnie 95 s
   * @param {number} [o.retryDelayMs]  przerwa przed jednym ponowieniem po HTTP 429/504 (domyślnie 2 s)
   * @param {(ms:number, signal?:AbortSignal)=>Promise<void>} [o.sleep]
   * @param {((...a:any[])=>void)|null} [o.log]  domyślnie console.warn; null wyłącza
   * @param {() => number} [o.clockMs]
   */
  constructor({ fetch: fetchFn, baseUrl, mirrors, timeoutMs = TIMEOUT_MS, retryDelayMs = RETRY_DELAY_MS, sleep = sleepMs,
    log, clockMs = () => Date.now() } = {}) {
    this._fetch = fetchFn || ((...a) => globalThis.fetch(...a));
    this._mirrors = mirrors && mirrors.length ? [...mirrors] : (baseUrl ? [baseUrl] : [...MIRRORS]);
    this._baseUrl = this._mirrors[0];
    this._timeoutMs = timeoutMs;
    this._retryDelayMs = retryDelayMs;
    this._sleep = sleep;
    this._log = log === undefined ? (...a) => { if (globalThis.console && console.warn) console.warn(...a); } : log;
    this._clockMs = clockMs;
    this._reqLock = new Mutex(); // jedno żądanie naraz; trzymana na czas żądania, nie całego obszaru
    this._cache = new Map();
    this._tooBig = new Map(); // klucz obszaru -> { at, usedKm }: promień, który wcześniej okazał się za duży
    this._lastGood = null;    // serwer, który odpowiedział ostatnio - pytany pierwszy
  }

  /** Przeszkody wzdłuż linii prostej a-b (lasy, potem budynki każdego odcinka - osobnymi, lżejszymi zapytaniami). */
  forLink(a, b, { signal } = {}) {
    return this._cached(`L:${pointKey(a)}:${pointKey(b)}`, () => this._fetchLink(a, b, signal), signal);
  }

  async _fetchLink(a, b, signal) {
    const seen = new Set();
    const polygons = [];
    for (const query of OsmQueries.linkParts(a, b)) {
      let map;
      try {
        map = await this._fetch1(query, signal, seen);
      } catch (e) {
        // Serwer, który raz przekroczył czas albo zerwał połączenie, często odpowiada za drugim razem.
        if (!(e instanceof PlannerClutterError) || (e.failure !== PlannerClutterFailure.SERVER_LIMIT && e.failure !== PlannerClutterFailure.NETWORK)) throw e;
        await this._sleep(LINK_RETRY_WAIT_MS, signal);
        map = await this._fetch1(query, signal, seen);
      }
      for (const poly of map.polygons) polygons.push(poly);
    }
    return new ClutterMap(polygons);
  }

  /**
   * Lasy i zabudowa w promieniu radiusKm (0.1..100) wokół center. Do 10 km to jedno zapytanie; większy obszar
   * (50 albo 100 km to prostokąt 100-200 km) jest pobierany kawałkami. Przy jednym zapytaniu, gdy serwer zgłosi błąd
   * po swojej stronie albo odpowiedź jest za duża (TOO_LARGE), jest JEDNA ponowna próba z połową promienia
   * i wywołanie `onRadiusReduced({requestedKm, usedKm, failure})`.
   * `onProgress({done, total})` informuje o postępie pobierania kawałkami (po zakończeniu: `onProgress(null)`).
   */
  async forArea(center, radiusKm, { signal, onRadiusReduced, onProgress } = {}) {
    const r = clamp(radiusKm, 0.1, PlannerClutter.MAX_AREA_RADIUS_KM);
    if (r > SINGLE_REQUEST_KM) {
      return this._cached(`A:${pointKey(center)}:${fmt(r, 1)}`,
        () => this._fetchTiled(ClutterBox.around(center.lat, center.lon, r), signal, onProgress), signal);
    }
    const load = (km) => this._cached(`A:${pointKey(center)}:${fmt(km, 1)}`, () => this._fetch1(OsmQueries.area(center, km), signal), signal);
    const areaKey = `${pointKey(center)}:${fmt(r, 1)}`;
    const known = this._tooBig.get(areaKey);
    if (known && this._clockMs() - known.at < CACHE_MS) {
      const map = await load(known.usedKm);
      if (onRadiusReduced) onRadiusReduced({ requestedKm: r, usedKm: known.usedKm, failure: known.failure });
      return map;
    }
    try {
      return await load(r);
    } catch (e) {
      const retryable = e instanceof PlannerClutterError && (e.failure === PlannerClutterFailure.TOO_LARGE || (e.detail && e.detail.serverSide));
      const half = Math.max(MIN_RADIUS_KM, Math.round((r / 2) * 10) / 10);
      if (!retryable || half >= r) throw e;
      let map;
      try {
        map = await load(half);
      } catch (e2) {
        if (e2 instanceof PlannerClutterError) e2.detail = { ...e2.detail, radiusKm: half, requestedRadiusKm: r, firstFailure: e.failure, firstDetail: e.detail };
        throw e2;
      }
      this._tooBig.set(areaKey, { at: this._clockMs(), usedKm: half, failure: e.failure });
      if (onRadiusReduced) onRadiusReduced({ requestedKm: r, usedKm: half, failure: e.failure });
      return map;
    }
  }

  /** Czyści pamięć podręczną ("odśwież"). */
  invalidate() { this._cache.clear(); this._tooBig.clear(); return Promise.resolve(); }

  async _cached(key, load, signal) {
    throwIfAborted(signal);
    const hit = this._cache.get(key);
    if (hit && this._clockMs() - hit.at < CACHE_MS) return hit.map;
    const map = await load();
    this._cache.delete(key);
    this._cache.set(key, { at: this._clockMs(), map });
    while (this._cache.size > CACHE_ENTRIES) this._cache.delete(this._cache.keys().next().value);
    return map;
  }

  /**
   * Duży obszar jako wiele zapytań, po jednym naraz: prostokąt jest cięty na kafelki ok. TILE_START_KM; kafelek, który
   * serwer uznał za zbyt ciężki (albo którego odpowiedź jest za duża), dzieli się na cztery i pyta ponownie, aż do
   * MIN_TILE_KM - gęste miejsca kończą w małych kawałkach, pustki w dużych. Element na granicy dwóch kafelków liczy
   * się raz, obrysy są rzedniejsze, żeby zmieścić się w pamięci, a serwer mówiący „za dużo zapytań” jest cierpliwie
   * czekany. Wszystko albo błąd: pół mapy wyglądałoby na otwarty teren tam, gdzie go nie ma.
   */
  async _fetchTiled(whole, signal, onProgress) {
    const report = (p) => { if (onProgress) { try { onProgress(p); } catch { /* UI nie może psuć pobierania */ } } };
    try {
      return await this._fetchTiledPieces(whole, signal, report);
    } finally {
      report(null);
    }
  }

  async _fetchTiledPieces(whole, signal, report) {
    const deadline = this._clockMs() + TILED_BUDGET_MS;
    const pending = clutterGrid(whole, TILE_START_KM).map((box) => ({ box, tries: 0 }));
    let done = 0;
    report({ done: 0, total: pending.length });
    const seen = new Set();
    const polygons = [];
    let points = 0;
    // Im dalej sięga obszar, tym grubszy może być obraz: raster zasięgu 100 km ma komórki setek metrów, więc obrysy są
    // rzedniejsze (a małe lasy odpadają) tym mocniej, im większy obszar.
    const thinM = Math.max(THIN_M, (whole.maxSideKm / 2.0) * THIN_M_PER_KM);
    const withPieces = (e) => {
      if (e instanceof PlannerClutterError) e.detail = { ...e.detail, piecesDone: done, piecesTotal: done + pending.length + 1 };
      return e;
    };
    while (pending.length > 0) {
      throwIfAborted(signal);
      if (this._clockMs() > deadline) {
        throw withPieces(new PlannerClutterError(PlannerClutterFailure.SERVER_LIMIT, undefined, { errorName: 'TimeLimit', errorMessage: 'time limit' }));
      }
      const work = pending.shift();
      let part;
      try {
        part = await this._fetch1(OsmQueries.box(work.box), signal, seen, thinM);
      } catch (e) {
        if (!(e instanceof PlannerClutterError)) throw e;
        const busy = !!(e.detail && e.detail.busy);
        const flaky = e.failure === PlannerClutterFailure.NETWORK;
        const splittable = (e.failure === PlannerClutterFailure.TOO_LARGE || e.failure === PlannerClutterFailure.SERVER_LIMIT)
          && !busy && work.box.maxSideKm > MIN_TILE_KM;
        if (busy && work.tries < BUSY_RETRIES) {
          await this._sleep(BUSY_WAIT_MS, signal);
          pending.unshift({ box: work.box, tries: work.tries + 1 });
        } else if (flaky && work.tries < NETWORK_RETRIES) {
          await this._sleep(NETWORK_RETRY_WAIT_MS, signal);
          pending.unshift({ box: work.box, tries: work.tries + 1 });
        } else if (splittable) {
          pending.unshift(...work.box.quarters().map((box) => ({ box, tries: 0 })));
        } else if (e.failure === PlannerClutterFailure.SERVER_LIMIT && work.tries < OVERLOAD_RETRIES) {
          // Najmniejszy kawałek przekroczył czas: serwer jest raczej przeciążony niż kawałek ciężki - czekamy i pytamy ponownie.
          await this._sleep(OVERLOAD_WAIT_MS, signal);
          pending.unshift({ box: work.box, tries: work.tries + 1 });
        } else {
          throw withPieces(e);
        }
        continue;
      }
      done++;
      report({ done, total: done + pending.length });
      for (const polygon of part.polygons) {
        polygons.push(polygon);
        points += polygon.outer.length >> 1;
        for (const hole of polygon.holes) points += hole.length >> 1;
      }
      if (points > MAX_POINTS) {
        throw withPieces(new PlannerClutterError(PlannerClutterFailure.TOO_LARGE, undefined, { errorName: 'TooManyPoints', errorMessage: 'too many points' }));
      }
      if (pending.length > 0) await this._sleep(PAUSE_BETWEEN_TILES_MS, signal);
    }
    return new ClutterMap(polygons);
  }

  /**
   * Pobiera i parsuje odpowiedź, przechodząc po serwerach (ostatnio sprawny pierwszy); rzuca PlannerClutterError z `detail`.
   * Odpowiedź zbyt duża albo odmowa z powodu samego zapytania („out of memory”, „timed out”) kończy od razu: inny
   * serwer powiedziałby to samo, a wołający może podzielić obszar.
   */
  _fetch1(query, signal, seen = null, thinM = 0.0) {
    return this._reqLock.run(async () => {
      const attempts = [];
      let last = null;
      const good = this._lastGood;
      const ordered = good && this._mirrors.includes(good) ? [good, ...this._mirrors.filter((m) => m !== good)] : this._mirrors;
      for (const mirror of ordered) {
        throwIfAborted(signal);
        const out = await this._tryMirror(mirror, query, signal, attempts, seen, thinM);
        if (out.map) { this._lastGood = mirror; return out.map; }
        last = out;
        if (out.stop) break;
      }
      const detail = { ...(last && last.detail), attempts: attempts.slice(-MAX_ATTEMPTS_LOGGED) };
      if (attempts.some((a) => a.status === 429 || a.status >= 500 || a.timedOut || a.busy)) detail.serverSide = true;
      // „Zajęty” (429/503) różni się od „nie dał rady” (przekroczony czas, 502/504): pierwszego warto poczekać, drugiego nie.
      if (attempts.some((a) => a.status === 429 || a.status === 503 || a.busy)) detail.busy = true;
      let failure = (last && last.failure) || PlannerClutterFailure.NETWORK;
      if (failure === PlannerClutterFailure.NETWORK
        && attempts.some((a) => a.timedOut || (a.status !== undefined && isBusyStatus(a.status)))) {
        failure = PlannerClutterFailure.SERVER_LIMIT;
      }
      const err = new PlannerClutterError(failure, last && last.cause, detail);
      if (this._log) this._log('MT_SW planner: pobieranie danych OSM nie powiodło się', err.failure, detail);
      throw err;
    });
  }

  /** Jedna runda dla jednego serwera (z jednym ponowieniem po 429/504). Zwraca {map} albo {failure, detail, stop?}. */
  async _tryMirror(mirror, query, signal, attempts, seen, thinM) {
    const mirrorHost = hostOf(mirror) || mirror;
    for (let pass = 0; pass < 2; pass++) {
      const t0 = Date.now();
      const r = await this._post(mirror, query, signal);
      const rec = { mirror: mirrorHost, ms: Date.now() - t0 };
      if (r.status !== undefined) rec.status = r.status;
      if (r.timedOut) rec.timedOut = true;
      if (r.viaProxy) rec.viaProxy = true;
      if (r.error) Object.assign(rec, errInfo(r.error));
      if (r.proxyError) rec.proxyError = shorten(r.proxyError.message);
      if (r.remark) rec.remark = r.remark;
      attempts.push(rec);

      if (r.tooLarge) throw this._tooLarge(r.error, attempts);
      if (r.body !== undefined) {
        try {
          return { map: parseOverpass(r.body, seen, thinM) };
        } catch (e) {
          const msg = String((e && e.message) || '');
          const low = msg.toLowerCase();
          rec.remark = shorten(msg);
          const fromServer = msg.startsWith('overpass:');
          // „out of memory” lub „timed out” w uwadze serwera to odmowa SERWERA, nie brak pamięci tego urządzenia.
          if (e instanceof RangeError || (!fromServer && (low.includes('memory') || low.includes('maxsize')))) throw this._tooLarge(e, attempts);
          if (fromServer) {
            const detail = { remark: rec.remark, ...errInfo(e) };
            if (isBusyRemark(msg)) {
              rec.busy = true; // przeciążenie - warto zapytać inny serwer
              return { failure: PlannerClutterFailure.SERVER_LIMIT, cause: e, detail };
            }
            return { failure: PlannerClutterFailure.SERVER_LIMIT, cause: e, stop: true, detail };
          }
          return { failure: PlannerClutterFailure.BAD_RESPONSE, cause: e, stop: true, detail: { remark: rec.remark, ...errInfo(e) } };
        }
      }
      if (r.status !== undefined) {
        if ((r.status === 429 || r.status === 504) && pass === 0) {
          await this._sleep(this._retryDelayMs, signal); // krótka przerwa i jedno ponowienie na tym samym serwerze
          continue;
        }
        const detail = { status: r.status, remark: r.remark || '', errorName: 'HttpError', errorMessage: `HTTP ${r.status}` };
        return { failure: isBusyStatus(r.status) ? PlannerClutterFailure.SERVER_LIMIT : PlannerClutterFailure.NETWORK, detail, stop: !isNextMirrorStatus(r.status) };
      }
      // błąd sieci / CORS / przekroczony czas
      const detail = r.timedOut ? { errorName: 'TimeoutError', errorMessage: `no answer within ${this._timeoutMs} ms` } : errInfo(r.error);
      if (r.timedOut) detail.timedOut = true;
      return { failure: r.timedOut ? PlannerClutterFailure.SERVER_LIMIT : PlannerClutterFailure.NETWORK, cause: r.error, detail };
    }
    return { failure: PlannerClutterFailure.NETWORK, detail: {} };
  }

  _tooLarge(cause, attempts) {
    const err = new PlannerClutterError(PlannerClutterFailure.TOO_LARGE, cause, { ...(cause ? errInfo(cause) : {}), attempts: attempts.slice(-MAX_ATTEMPTS_LOGGED) });
    if (this._log) this._log('MT_SW planner: odpowiedź OSM zbyt duża', err.detail);
    return err;
  }

  /**
   * Jedno żądanie POST. Zwraca {body} (HTTP 2xx), {status, remark} (inny status HTTP), {timedOut} albo {error}.
   * Czyta odpowiedź kawałkami i przerywa po przekroczeniu 12 000 000 bajtów ({tooLarge}). Anulowanie przez
   * wołającego rzuca AbortError.
   */
  async _post(url, query, signal) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, this._timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); throw abortError(); }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    let res = null;
    try {
      res = await plannerFetch(this._fetch, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      });
      const viaProxy = !!res.viaProxy;
      // 413 z proxy backendu: odpowiedź serwera przekroczyła limit proxy - tak samo za duża, jak ponad MAX_BODY_BYTES
      if (res.status === 413 && viaProxy) return { tooLarge: true, viaProxy };
      if (!res.ok) {
        let remark = '';
        try { if (typeof res.text === 'function') remark = shorten(await res.text()); } catch { /* brak treści */ }
        return { status: res.status, remark, viaProxy };
      }
      const chunks = [];
      let size = 0;
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (size + value.byteLength > MAX_BODY_BYTES) {
            try { await reader.cancel(); } catch { /* best effort */ }
            ctrl.abort();
            return { tooLarge: true, viaProxy };
          }
          chunks.push(value);
          size += value.byteLength;
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > MAX_BODY_BYTES) return { tooLarge: true, viaProxy };
        chunks.push(buf);
        size = buf.byteLength;
      }
      const all = new Uint8Array(size);
      let off = 0;
      for (const c of chunks) { all.set(c, off); off += c.byteLength; }
      return { body: new TextDecoder('utf-8').decode(all), status: res.status, viaProxy };
    } catch (e) {
      if (signal && signal.aborted) throw isAbortError(e) ? e : abortError(); // anulowanie przez wołającego
      if (timedOut && isAbortError(e)) return { timedOut: true };
      if (e instanceof RangeError) return { tooLarge: true, error: e };
      return { error: e, proxyError: e && e.proxyError, viaProxy: !!(res && res.viaProxy) };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
}

PlannerOverpass.BASE_URL = BASE_URL;
PlannerOverpass.MIRRORS = MIRRORS;
PlannerOverpass.TIMEOUT_MS = TIMEOUT_MS;
PlannerOverpass.RETRY_DELAY_MS = RETRY_DELAY_MS;
PlannerOverpass.CACHE_MS = CACHE_MS;
PlannerOverpass.MAX_BODY_BYTES = MAX_BODY_BYTES;
PlannerOverpass.CACHE_ENTRIES = CACHE_ENTRIES;
PlannerOverpass.SINGLE_REQUEST_KM = SINGLE_REQUEST_KM;
PlannerOverpass.TILE_START_KM = TILE_START_KM;
PlannerOverpass.MIN_TILE_KM = MIN_TILE_KM;
