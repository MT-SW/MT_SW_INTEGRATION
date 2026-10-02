// Skala jakości/kolorów i warstwa mapy dla prognozy zasięgu — port CoverageLayer.kt + pomocniki rastra i legendy.
import { marginAt } from './coverage.js';
import { fmt } from './util.js';

/** Margines (dB), przy którym skala osiąga najmocniejszy kolor. */
export const COVERAGE_MAX_DB = 30;
/** Liczba stopni koloru między 0 dB a MAX_DB. */
export const COVERAGE_CLASS_COUNT = 24;
export const COVERAGE_FILL_OPACITY = 0.62;
/** Docelowa liczba komórek siatki na średnicy zasięgu. */
export const COVERAGE_GRID_CELLS = 280;
const METERS_PER_DEG_LAT = 111320.0;

// od najsłabszego do najmocniejszego (wygląd zbliżony do MeshMap)
const stopPos = [0.0, 0.3, 0.55, 0.78, 1.0];
const stopRgb = [[0x7a, 0x3c, 0xb5], [0xb6, 0x4f, 0xa8], [0xee, 0x7f, 0x5c], [0xfb, 0xa7, 0x3a], [0xe9, 0xf0, 0x3b]];

/** Klasa koloru 0..23 dla marginesu (dB) albo -1 (brak zasięgu: margines < 0 lub NaN). */
export function coverageClassOf(marginDb) {
  if (marginDb === null || marginDb === undefined || Number.isNaN(marginDb) || marginDb < 0) return -1;
  const t = Math.min(1, Math.max(0, Math.fround(marginDb / COVERAGE_MAX_DB)));
  return Math.min(COVERAGE_CLASS_COUNT - 1, Math.max(0, Math.trunc(Math.fround(t * (COVERAGE_CLASS_COUNT - 1)) + 0.5)));
}

/** Kolor klasy jako [r,g,b] (0..255). */
export function coverageRgbOf(cls) {
  const t = Math.min(COVERAGE_CLASS_COUNT - 1, Math.max(0, cls)) / (COVERAGE_CLASS_COUNT - 1);
  let i = 0;
  while (i < stopPos.length - 2 && t > stopPos[i + 1]) i++;
  const f = Math.min(1, Math.max(0, (t - stopPos[i]) / (stopPos[i + 1] - stopPos[i])));
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] = Math.min(255, Math.max(0, Math.trunc(stopRgb[i][c] + (stopRgb[i + 1][c] - stopRgb[i][c]) * f + 0.5)));
  }
  return out;
}

/** `#rrggbb` klasy koloru. */
export function coverageColorOf(cls) {
  return '#' + coverageRgbOf(cls).map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Nazwa jakości sygnału (stabilny kod) dla marginesu: NONE (<0), WEAK (<3), FAIR (<10), GOOD (<20), EXCELLENT (>=20). */
export function coverageQuality(marginDb) {
  if (marginDb === null || marginDb === undefined || Number.isNaN(marginDb) || marginDb < 0) return 'NONE';
  if (marginDb < 3) return 'WEAK';
  if (marginDb < 10) return 'FAIR';
  if (marginDb < 20) return 'GOOD';
  return 'EXCELLENT';
}

/**
 * Legenda: tablica {cls, fromDb, toDb, color} od najsłabszego do najmocniejszego stopnia (24 stopnie).
 * toDb ostatniego stopnia to Infinity (">= 30 dB").
 */
export function coverageLegend() {
  const out = [];
  const step = COVERAGE_MAX_DB / (COVERAGE_CLASS_COUNT - 1);
  for (let c = 0; c < COVERAGE_CLASS_COUNT; c++) {
    out.push({
      cls: c,
      fromDb: c === 0 ? 0 : (c - 0.5) * step,
      toDb: c === COVERAGE_CLASS_COUNT - 1 ? Infinity : (c + 0.5) * step,
      color: coverageColorOf(c),
    });
  }
  return out;
}

/** Gradient CSS (linear-gradient) całej skali 0..30 dB do paska legendy. */
export function coverageLegendGradientCss(direction = 'to right') {
  const stops = [];
  for (let c = 0; c < COVERAGE_CLASS_COUNT; c++) stops.push(`${coverageColorOf(c)} ${((c / (COVERAGE_CLASS_COUNT - 1)) * 100).toFixed(1)}%`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

const mercY = (latDeg) => Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360));
const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);

/**
 * Raster RGBA prognozy do nakładki obrazu na mapie (np. L.imageOverlay z bounds).
 * @param {CoverageResult} coverage
 * @param {{gridCells?:number, opacity?:number, projection?:'mercator'|'equirectangular'}} [o]
 *   projection 'mercator' (domyślnie): wiersze równoodległe w rzucie Web Mercator — dokładne dla Leaflet/MapLibre;
 *   'equirectangular': siatka lat/lon jak w aplikacji Android.
 * @returns {{width:number,height:number,rgba:Uint8ClampedArray,classes:Int8Array,bounds:{south:number,west:number,north:number,east:number}}|null}
 *   piksel (0,0) = północny zachód; null gdy brak zasięgu/promieni.
 */
export function coverageRaster(coverage, { gridCells = COVERAGE_GRID_CELLS, opacity = COVERAGE_FILL_OPACITY, projection = 'mercator' } = {}) {
  const radiusM = coverage.ringsM.length ? coverage.ringsM[coverage.ringsM.length - 1] : 0.0;
  if (!(radiusM > 0.0) || coverage.radials < 3) return null;
  const cellM = (radiusM * 2.0) / gridCells;
  const dLat = cellM / METERS_PER_DEG_LAT;
  const cosLat = Math.max(0.05, Math.cos((coverage.center.lat * Math.PI) / 180.0));
  const dLon = cellM / (METERS_PER_DEG_LAT * cosLat);
  const rows = gridCells;
  const south = coverage.center.lat - (dLat * rows) / 2.0;
  const north = south + dLat * rows;
  const west = coverage.center.lon - (dLon * rows) / 2.0;
  const east = west + dLon * rows;
  const rgba = new Uint8ClampedArray(rows * rows * 4);
  const classes = new Int8Array(rows * rows);
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255);
  const yS = mercY(Math.max(-85, south)), yN = mercY(Math.min(85, north));
  for (let row = 0; row < rows; row++) {
    const lat = projection === 'mercator' ? invMercY(yS + ((row + 0.5) / rows) * (yN - yS)) : south + dLat * (row + 0.5);
    const imgY = rows - 1 - row;
    for (let col = 0; col < rows; col++) {
      const m = marginAt(coverage, lat, west + dLon * (col + 0.5));
      const cls = coverageClassOf(m);
      const o = imgY * rows + col;
      classes[o] = cls;
      if (cls >= 0) {
        const [r, g, b] = coverageRgbOf(cls);
        rgba[o * 4] = r; rgba[o * 4 + 1] = g; rgba[o * 4 + 2] = b; rgba[o * 4 + 3] = alpha;
      }
    }
  }
  return { width: rows, height: rows, rgba, classes, bounds: { south, west, north, east } };
}

const pos = (lat, lon) => `[${fmt(lon, 5)},${fmt(lat, 5)}]`;
const jsonStr = (s) => JSON.stringify(String(s));

/**
 * GeoJSON warstwy mapy (komórki jednego koloru sklejone w poziomie w jeden wielokąt), jak CoverageLayer.render:
 * kolory simplestyle `fill`/`fill-opacity`; rysowane tylko komórki z marginesem >= 0. Zwraca tekst JSON.
 */
export function renderCoverageGeoJson(coverage, name, opacity = COVERAGE_FILL_OPACITY) {
  const features = [];
  const radiusM = coverage.ringsM.length ? coverage.ringsM[coverage.ringsM.length - 1] : 0.0;
  if (radiusM > 0.0 && coverage.radials >= 3) {
    const cellM = (radiusM * 2.0) / COVERAGE_GRID_CELLS;
    const dLat = cellM / METERS_PER_DEG_LAT;
    const cosLat = Math.max(0.05, Math.cos((coverage.center.lat * Math.PI) / 180.0));
    const dLon = cellM / (METERS_PER_DEG_LAT * cosLat);
    const rows = COVERAGE_GRID_CELLS;
    const lat0 = coverage.center.lat - (dLat * rows) / 2.0;
    const lon0 = coverage.center.lon - (dLon * rows) / 2.0;
    for (let row = 0; row < rows; row++) {
      const latS = lat0 + dLat * row;
      const latC = latS + dLat / 2.0;
      let col = 0;
      while (col < rows) {
        const cls = coverageClassOf(marginAt(coverage, latC, lon0 + dLon * (col + 0.5)));
        if (cls < 0) { col++; continue; }
        let end = col;
        while (end + 1 < rows && coverageClassOf(marginAt(coverage, latC, lon0 + dLon * (end + 1.5))) === cls) end++;
        const w = lon0 + dLon * col, e = lon0 + dLon * (end + 1), s = latS, n = latS + dLat;
        const ring = [pos(s, w), pos(s, e), pos(n, e), pos(n, w), pos(s, w)].join(',');
        features.push(`{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[${ring}]]},"properties":{"fill":"${coverageColorOf(cls)}","fill-opacity":${opacity},"stroke-width":0,"stroke-opacity":0,"class":${cls}}}`);
        col = end + 1;
      }
    }
  }
  features.push(`{"type":"Feature","geometry":{"type":"Point","coordinates":${pos(coverage.center.lat, coverage.center.lon)}},"properties":{"name":${jsonStr(name)},"marker-color":"#1565c0"}}`);
  return `{"type":"FeatureCollection","name":${jsonStr(name)},"features":[\n${features.join(',\n')}\n]}\n`;
}
