// Teren: kafelki wysokościowe Mapterhorn (Terrarium WebP w archiwach PMTiles v3, zakresowe żądania HTTP),
// pamięć podręczna zdekodowanych kafelków i samplery: punkt / profil trasy / obszar.
// Port: PlannerElevation.kt + MapterhornEndpoints.kt + TerrainTileMath.kt + ElevationTile.kt + czytnik PMTiles.
import { profileFromSampler } from './profile.js';
import { clamp, throwIfAborted } from './util.js';

// ---------------------------------------------------------------- Mapterhorn

export const GLOBAL_PMTILES_URL = 'https://download.mapterhorn.com/planet.pmtiles';
export const GLOBAL_MAX_ZOOM = 12;
export const REGIONAL_MIN_ZOOM = 13;
export const REGIONAL_MAX_ZOOM = 18;
const REGIONAL_ARCHIVE_ZOOM = 6;
export const TERRAIN_ATTRIBUTION = 'Terrain data © Mapterhorn';
export const TERRAIN_ATTRIBUTION_URL = 'https://mapterhorn.com/attribution/';

const MAX_LATITUDE = 85.05112878;
const asinh = (x) => Math.asinh(x);

/** Kafelek XYZ zawierający punkt (lat, lon) na poziomie zoom. */
export function tileAt(zoom, latitude, longitude) {
  const n = Math.pow(2.0, zoom);
  const latRad = (clamp(latitude, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180.0;
  const x = clamp(Math.trunc(((longitude + 180.0) / 360.0) * n), 0, n - 1);
  const y = clamp(Math.trunc(((1.0 - asinh(Math.tan(latRad)) / Math.PI) / 2.0) * n), 0, n - 1);
  return { zoom, x, y };
}

const xRangesAt = (zoom, nw, se) => (nw.x <= se.x ? [[nw.x, se.x]] : [[nw.x, Math.pow(2, zoom) - 1], [0, se.x]]);

/** Wszystkie kafelki w bounds {south,west,north,east} na poziomie zoom (z obsługą antypołudnika). */
export function tilesAt(zoom, bounds) {
  const nw = tileAt(zoom, bounds.north, bounds.west);
  const se = tileAt(zoom, bounds.south, bounds.east);
  const tiles = [];
  for (const [x0, x1] of xRangesAt(zoom, nw, se)) {
    for (let x = x0; x <= x1; x++) for (let y = nw.y; y <= se.y; y++) tiles.push({ zoom, x, y });
  }
  return tiles;
}

/** Liczba kafelków, które zwróciłoby tilesAt (O(1)). */
export function tileCountAt(zoom, bounds) {
  const nw = tileAt(zoom, bounds.north, bounds.west);
  const se = tileAt(zoom, bounds.south, bounds.east);
  const rows = Math.max(0, se.y - nw.y + 1);
  let cols = 0;
  for (const [x0, x1] of xRangesAt(zoom, nw, se)) cols += Math.max(0, x1 - x0 + 1);
  return cols * rows;
}

export function fitsInSingleTile(zoom, bounds) {
  const nw = tileAt(zoom, bounds.north, bounds.west);
  const se = tileAt(zoom, bounds.south, bounds.east);
  return nw.x === se.x && nw.y === se.y && nw.zoom === se.zoom;
}

/** Adres archiwum regionalnego (z6) dla bounds albo null, gdy bounds nie mieści się w jednym kafelku z6. */
export function regionalUrlFor(bounds) {
  if (!fitsInSingleTile(REGIONAL_ARCHIVE_ZOOM, bounds)) return null;
  const t = tileAt(REGIONAL_ARCHIVE_ZOOM, (bounds.north + bounds.south) / 2, (bounds.east + bounds.west) / 2);
  return `https://download.mapterhorn.com/${t.x}-${t.y}.pmtiles`;
}

const tileKey = (zoom, x, y) => `${zoom}/${x}/${y}`;

// ---------------------------------------------------------------- Terrarium

/** Terrarium: wysokość = R*256 + G + B/256 - 32768 (m). */
export const terrariumElevationMeters = (r, g, b) => r * 256 + g + b / 256 - 32768;

/**
 * Siatka wysokości (m n.p.m.), wiersz po wierszu od lewego górnego rogu.
 * @typedef {{width:number,height:number,elevations:Float32Array}} ElevationTile
 */
export function makeElevationTile(width, height, elevations) {
  if (!(width > 0 && height > 0)) throw new Error('width and height must be positive');
  if (elevations.length !== width * height) throw new Error('elevations.length must equal width*height');
  return { width, height, elevations };
}

/** Najbliższa próbka w pikselu (x, y), obcięta do krawędzi kafelka. */
export function elevationAtPixel(tile, x, y) {
  const cx = clamp(x, 0, tile.width - 1);
  const cy = clamp(y, 0, tile.height - 1);
  return tile.elevations[cy * tile.width + cx];
}

/** Dekoduje bajty RGB(A) (RGBA, wiersz po wierszu) kafelka Terrarium. */
export function terrariumFromRgba(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = rgba[j] * 256 + rgba[j + 1] + rgba[j + 2] / 256 - 32768;
  return makeElevationTile(width, height, out);
}

/**
 * Dekoduje kafelek WebP/PNG Terrarium przez createImageBitmap + OffscreenCanvas (działa w oknie i w workerze).
 * premultiplyAlpha:'none' i colorSpaceConversion:'none' — wysokość siedzi w kanałach RGB i nie wolno ich zmieniać.
 */
export async function decodeTerrariumTile(bytes) {
  const blob = new Blob([bytes], { type: 'image/webp' });
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const w = bmp.width, h = bmp.height;
    let ctx;
    if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    else {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      ctx = c.getContext('2d', { willReadFrequently: true });
    }
    ctx.drawImage(bmp, 0, 0);
    return terrariumFromRgba(ctx.getImageData(0, 0, w, h).data, w, h);
  } finally {
    if (bmp.close) bmp.close();
  }
}

// ---------------------------------------------------------------- PMTiles v3

/** Id kafelka PMTiles (krzywa Hilberta w obrębie poziomu + przesunięcie poziomów). */
export function zxyToTileId(z, x, y) {
  if (z > 26) throw new Error('tile zoom exceeds 64-bit limit');
  const n = Math.pow(2, z);
  if (x >= n || y >= n || x < 0 || y < 0) throw new Error('tile x/y outside zoom level bounds');
  let acc = 0;
  for (let t = 0; t < z; t++) acc += Math.pow(2, t) * Math.pow(2, t);
  let tx = x, ty = y, d = 0;
  for (let s = n / 2; s >= 1; s = Math.floor(s / 2)) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { tx = n - 1 - tx; ty = n - 1 - ty; }
      const t = tx; tx = ty; ty = t;
    }
  }
  return acc + d;
}

function readVarint(buf, posRef) {
  let result = 0;
  let mul = 1;
  for (;;) {
    const b = buf[posRef.p++];
    if (b === undefined) throw new Error('PMTiles: truncated varint');
    result += (b & 0x7f) * mul;
    if ((b & 0x80) === 0) return result;
    mul *= 128;
  }
}

/** Parsuje (już zdekompresowany) katalog PMTiles do tablicy wpisów {tileId, offset, length, runLength}. */
export function parsePmDirectory(buf) {
  const pos = { p: 0 };
  const n = readVarint(buf, pos);
  const entries = new Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) { last += readVarint(buf, pos); entries[i] = { tileId: last, offset: 0, length: 0, runLength: 0 }; }
  for (let i = 0; i < n; i++) entries[i].runLength = readVarint(buf, pos);
  for (let i = 0; i < n; i++) entries[i].length = readVarint(buf, pos);
  for (let i = 0; i < n; i++) {
    const tmp = readVarint(buf, pos);
    entries[i].offset = tmp === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : tmp - 1;
  }
  return entries;
}

/** Wyszukiwanie binarne wpisu dla tileId (zwraca też wskaźnik do katalogu liściowego, runLength == 0). */
export function findPmEntry(entries, tileId) {
  let m = 0, n = entries.length - 1;
  while (m <= n) {
    const k = (n + m) >> 1;
    const cmp = tileId - entries[k].tileId;
    if (cmp > 0) m = k + 1;
    else if (cmp < 0) n = k - 1;
    else return entries[k];
  }
  if (n >= 0) {
    if (entries[n].runLength === 0) return entries[n];
    if (tileId - entries[n].tileId < entries[n].runLength) return entries[n];
  }
  return null;
}

export function parsePmHeader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 7));
  if (magic !== 'PMTiles' || bytes[7] !== 3) throw new Error('not a PMTiles v3 archive');
  const u64 = (o) => Number(dv.getBigUint64(o, true));
  return {
    rootDirOffset: u64(8), rootDirLength: u64(16), metadataOffset: u64(24), metadataLength: u64(32),
    leafDirsOffset: u64(40), leafDirsLength: u64(48), tileDataOffset: u64(56), tileDataLength: u64(64),
    internalCompression: bytes[97], tileCompression: bytes[98], tileType: bytes[99], minZoom: bytes[100], maxZoom: bytes[101],
  };
}

async function decompress(bytes, compression) {
  if (compression === 0 || compression === 1) return bytes;
  if (compression === 2) {
    if (typeof DecompressionStream === 'undefined') throw new Error('gzip not supported (no DecompressionStream)');
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error(`PMTiles: unsupported compression ${compression}`);
}

/** Czytnik archiwum PMTiles v3 przez żądania zakresowe (jak ch.poole.geo.pmtiles.Reader w aplikacji). */
export class PmTilesReader {
  /** @param {string} url @param {{fetch?:typeof fetch, headerBytes?:number}} [o] */
  constructor(url, { fetch: fetchFn, headerBytes = 16384 } = {}) {
    this.url = url;
    this._fetch = fetchFn || ((...a) => globalThis.fetch(...a));
    this._headerBytes = headerBytes;
    this._header = null;
    this._init = null;
    this._dirs = new Map();
    this._initial = null;
  }

  async _range(offset, length) {
    const res = await this._fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (res.status === 200) {
      // serwer zignorował Range: odpowiedź to początek całego pliku
      if (offset === 0) return buf.subarray(0, length);
      throw new Error('server ignored the Range header');
    }
    return buf;
  }

  _ensureHeader() {
    if (!this._init) {
      this._init = (async () => {
        const first = await this._range(0, this._headerBytes);
        this._header = parsePmHeader(first);
        this._initial = first;
      })().catch((e) => { this._init = null; throw e; });
    }
    return this._init;
  }

  async _directory(offset, length) {
    const hit = this._dirs.get(offset);
    if (hit) { this._dirs.delete(offset); this._dirs.set(offset, hit); return hit; }
    let raw;
    if (offset + length <= this._initial.length) raw = this._initial.subarray(offset, offset + length);
    else raw = await this._range(offset, length);
    const entries = parsePmDirectory(await decompress(raw, this._header.internalCompression));
    this._dirs.set(offset, entries);
    while (this._dirs.size > 64) this._dirs.delete(this._dirs.keys().next().value);
    return entries;
  }

  /** Bajty kafelka (po ewentualnej dekompresji) albo null, gdy kafelka nie ma w archiwum. */
  async getTile(z, x, y) {
    await this._ensureHeader();
    const h = this._header;
    const tileId = zxyToTileId(z, x, y);
    let offset = h.rootDirOffset;
    let length = h.rootDirLength;
    for (let depth = 0; depth < 4; depth++) {
      const entries = await this._directory(offset, length);
      const e = findPmEntry(entries, tileId);
      if (!e) return null;
      if (e.runLength > 0) {
        const raw = await this._range(h.tileDataOffset + e.offset, e.length);
        return decompress(raw, h.tileCompression);
      }
      offset = h.leafDirsOffset + e.offset;
      length = e.length;
    }
    throw new Error('PMTiles: directory nesting too deep');
  }

  close() { this._dirs.clear(); }
}

/** Fabryka domyślnego pobierania kafelków: archiwum PMTiles pod adresem url. */
export function createPmTilesFetcher(url, o = {}) {
  const reader = new PmTilesReader(url, o);
  return { fetchTile: (z, x, y) => reader.getTile(z, x, y), close: () => reader.close() };
}

/** Alternatywa: zwykły serwer kafelków XYZ, np. 'https://host/{z}/{x}/{y}.webp' (404 -> brak kafelka). */
export function createXyzTileFetcher(template, { fetch: fetchFn } = {}) {
  const f = fetchFn || ((...a) => globalThis.fetch(...a));
  return {
    async fetchTile(z, x, y) {
      const res = await f(template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      if (res.status === 404 || res.status === 204) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    close() {},
  };
}

// ---------------------------------------------------------------- PlannerElevation

export const PlannerElevationFailure = Object.freeze({ NETWORK: 'NETWORK', DECODE: 'DECODE' });

export class PlannerElevationError extends Error {
  /** @param {'NETWORK'|'DECODE'} failure */
  constructor(failure, cause) {
    super(`Planner elevation unavailable: ${failure}`);
    this.name = 'PlannerElevationError';
    this.failure = failure;
    if (cause !== undefined) this.cause = cause;
  }
}

const DEFAULT_CACHE_TILES = 32;
const MIN_CACHE_TILES = 8;
export const MAX_TILES_HIGH_ZOOM = 40;
const MAX_AREA_TILES = 36;
const MIN_AREA_ZOOM = 7;
const SEA_THRESHOLD_M = -50.0;
const FETCH_CONCURRENCY = 6;

export function boundsOf(points, padDeg) {
  let south = Number.MAX_VALUE, north = -Number.MAX_VALUE, west = Number.MAX_VALUE, east = -Number.MAX_VALUE;
  for (const p of points) {
    south = Math.min(south, p.lat); north = Math.max(north, p.lat);
    west = Math.min(west, p.lon); east = Math.max(east, p.lon);
  }
  return { south: south - padDeg, west: west - padDeg, north: north + padDeg, east: east + padDeg };
}

export function areaBounds(center, radiusKm) {
  const dLat = radiusKm / 110.574;
  const cosLat = Math.max(0.05, Math.cos((center.lat * Math.PI) / 180.0));
  const dLon = radiusKm / (111.320 * cosLat);
  return {
    south: center.lat - dLat, west: Math.max(-180.0, center.lon - dLon),
    north: center.lat + dLat, east: Math.min(180.0, center.lon + dLon),
  };
}

const clean = (e) => (Number.isNaN(e) || e < SEA_THRESHOLD_M ? 0.0 : e);

/**
 * Wysokość bilinearna w (lat, lon) z kafelków (Map klucz "z/x/y" -> ElevationTile|null). Brak kafelka -> 0 m.
 * Wartości poniżej -50 m traktowane jako morze (0 m).
 */
export function sampleBilinear(zoom, lat, lon, tiles) {
  const n = Math.pow(2, zoom);
  const latC = clamp(lat, -MAX_LATITUDE, MAX_LATITUDE);
  const fx = ((lon + 180.0) / 360.0) * n;
  const fy = ((1.0 - asinh(Math.tan((latC * Math.PI) / 180.0)) / Math.PI) / 2.0) * n;
  const maxIdx = n - 1;
  const tx = clamp(Math.floor(fx), 0, maxIdx);
  const ty = clamp(Math.floor(fy), 0, maxIdx);
  const tile = tiles.get(tileKey(zoom, tx, ty));
  if (!tile) return 0.0;
  const px = (fx - tx) * tile.width - 0.5;
  const py = (fy - ty) * tile.height - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const wx = px - x0;
  const wy = py - y0;
  const e00 = clean(elevationAtPixel(tile, x0, y0));
  const e10 = clean(elevationAtPixel(tile, x0 + 1, y0));
  const e01 = clean(elevationAtPixel(tile, x0, y0 + 1));
  const e11 = clean(elevationAtPixel(tile, x0 + 1, y0 + 1));
  const top = e00 * (1.0 - wx) + e10 * wx;
  const bottom = e01 * (1.0 - wx) + e11 * wx;
  return top * (1.0 - wy) + bottom * wy;
}

/**
 * Sampler obszaru zbudowany z gotowych kafelków (używany też w workerze).
 * @param {number} zoom
 * @param {Array<{x:number,y:number,width:number,height:number,elevations:Float32Array}>} list
 * @returns {(lat:number, lon:number) => number}
 */
export function samplerFromTiles(zoom, list) {
  const tiles = new Map();
  for (const t of list) tiles.set(tileKey(zoom, t.x, t.y), t);
  const f = (lat, lon) => sampleBilinear(zoom, lat, lon, tiles);
  f.zoom = zoom;
  f.exportTiles = () => list;
  return f;
}

/**
 * Teren dla plannera: wysokości w metrach n.p.m. (morze i brak danych = 0). Rzuca PlannerElevationError.
 */
export class PlannerElevation {
  /**
   * @param {Object} [o]
   * @param {number} [o.preferredZoom=12]  12..18; wyższe tylko tam, gdzie jest archiwum regionalne i obszar mieści się w <=40 kafelkach
   * @param {(url:string)=>{fetchTile:(z:number,x:number,y:number)=>Promise<Uint8Array|null>, close:()=>void}} [o.fetcherFactory]
   * @param {(bytes:Uint8Array)=>Promise<ElevationTile>|ElevationTile} [o.tileDecoder]
   * @param {number} [o.cacheCapacity=32]
   * @param {typeof fetch} [o.fetch]  używane przez domyślną fabrykę PMTiles
   */
  constructor({ preferredZoom = GLOBAL_MAX_ZOOM, fetcherFactory, tileDecoder = decodeTerrariumTile, cacheCapacity = DEFAULT_CACHE_TILES, fetch: fetchFn } = {}) {
    this._preferredZoom = preferredZoom;
    this._fetcherFactory = fetcherFactory || ((url) => createPmTilesFetcher(url, { fetch: fetchFn }));
    this._decode = tileDecoder;
    this._cacheCapacity = cacheCapacity;
    this._fetchers = new Map();
    this._cache = new Map();
    this._inflight = new Map();
  }

  /** Profil terenu między a i b (PathProfile z profile.js). */
  async profile(a, b, { signal } = {}) {
    const bounds = boundsOf([a, b], 0.01);
    const zoom = this._zoomForBounds(bounds, MAX_TILES_HIGH_ZOOM);
    const needed = new Map();
    profileFromSampler(a, b, (lat, lon) => {
      const t = tileAt(zoom, lat, lon);
      needed.set(tileKey(t.zoom, t.x, t.y), t);
      return 0.0;
    });
    const tiles = await this._loadTiles([...needed.values()], bounds, zoom, signal);
    return profileFromSampler(a, b, (lat, lon) => sampleBilinear(zoom, lat, lon, tiles));
  }

  /**
   * Ładuje teren w promieniu radiusKm i zwraca synchroniczny sampler (lat, lon) -> m. Poza obszarem 0.
   * Sampler ma .zoom i .exportTiles() (do przekazania workerowi).
   */
  async prepareArea(center, radiusKm, { signal } = {}) {
    const bounds = areaBounds(center, radiusKm);
    let zoom = GLOBAL_MAX_ZOOM;
    while (zoom > MIN_AREA_ZOOM && tileCountAt(zoom, bounds) > MAX_AREA_TILES) zoom--;
    const needed = tilesAt(zoom, bounds);
    const tiles = await this._loadTiles(needed, bounds, zoom, signal);
    const list = [];
    for (const t of needed) {
      const tile = tiles.get(tileKey(t.zoom, t.x, t.y));
      if (tile) list.push({ x: t.x, y: t.y, width: tile.width, height: tile.height, elevations: tile.elevations });
    }
    return samplerFromTiles(zoom, list);
  }

  /** Wysokość w jednym punkcie albo null, gdy dla punktu nie ma kafelka. */
  async altitudeAt(lat, lon, { signal } = {}) {
    const zoom = GLOBAL_MAX_ZOOM;
    const idx = tileAt(zoom, lat, lon);
    const tiles = await this._loadTiles([idx], { south: lat, west: lon, north: lat, east: lon }, zoom, signal);
    if (!tiles.get(tileKey(idx.zoom, idx.x, idx.y))) return null;
    return sampleBilinear(zoom, lat, lon, tiles);
  }

  close() {
    for (const f of this._fetchers.values()) { try { f.close(); } catch { /* best effort */ } }
    this._fetchers.clear();
    this._cache.clear();
  }

  _zoomForBounds(bounds, maxTiles) {
    let zoom = clamp(this._preferredZoom, GLOBAL_MAX_ZOOM, REGIONAL_MAX_ZOOM);
    if (zoom <= GLOBAL_MAX_ZOOM) return GLOBAL_MAX_ZOOM;
    if (regionalUrlFor(bounds) === null) return GLOBAL_MAX_ZOOM;
    while (zoom > GLOBAL_MAX_ZOOM && tileCountAt(zoom, bounds) > maxTiles) zoom--;
    return zoom;
  }

  _fetcherFor(url) {
    let f = this._fetchers.get(url);
    if (f) return f;
    try { f = this._fetcherFactory(url); } catch (e) { throw new PlannerElevationError(PlannerElevationFailure.NETWORK, e); }
    this._fetchers.set(url, f);
    return f;
  }

  _dropFetcher(url) {
    const f = this._fetchers.get(url);
    if (!f) return;
    this._fetchers.delete(url);
    try { f.close(); } catch { /* best effort */ }
  }

  async _loadTiles(needed, bounds, zoom, signal) {
    const result = new Map();
    const missing = [];
    for (const t of needed) {
      const k = tileKey(t.zoom, t.x, t.y);
      if (this._cache.has(k)) {
        const v = this._cache.get(k);
        this._cache.delete(k);
        this._cache.set(k, v);
        result.set(k, v);
      } else missing.push(t);
    }
    if (missing.length === 0) return result;
    const url = zoom > GLOBAL_MAX_ZOOM ? (regionalUrlFor(bounds) || GLOBAL_PMTILES_URL) : GLOBAL_PMTILES_URL;
    const fetcher = this._fetcherFor(url);

    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        throwIfAborted(signal);
        const t = missing[next++];
        const k = tileKey(t.zoom, t.x, t.y);
        let p = this._inflight.get(k);
        if (!p) {
          p = this._fetchOne(fetcher, url, t).finally(() => this._inflight.delete(k));
          this._inflight.set(k, p);
        }
        const tile = await p;
        result.set(k, tile);
      }
    };
    const n = Math.min(FETCH_CONCURRENCY, missing.length);
    const results = await Promise.allSettled(Array.from({ length: n }, worker));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    throwIfAborted(signal);

    for (const t of missing) {
      const k = tileKey(t.zoom, t.x, t.y);
      this._cache.delete(k);
      this._cache.set(k, result.get(k) ?? null);
    }
    while (this._cache.size > Math.max(this._cacheCapacity, MIN_CACHE_TILES)) this._cache.delete(this._cache.keys().next().value);
    return result;
  }

  async _fetchOne(fetcher, url, t) {
    let bytes;
    try {
      bytes = await fetcher.fetchTile(t.zoom, t.x, t.y);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      this._dropFetcher(url);
      throw new PlannerElevationError(PlannerElevationFailure.NETWORK, e);
    }
    if (bytes === null || bytes === undefined) return null;
    try {
      return await this._decode(bytes);
    } catch (e) {
      throw new PlannerElevationError(PlannerElevationFailure.DECODE, e);
    }
  }
}

