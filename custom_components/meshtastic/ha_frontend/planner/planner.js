// Potok obliczeń plannera: teren -> (pogoda) -> (przeszkody OSM) -> ITM -> bilans łącza; oraz prognoza zasięgu.
// Port PlannerComputer.kt. Wejście to zwykły obiekt (patrz API.md i defaults.js: createDefaultInput).
import { distanceM, interpolate } from './geodesy.js';
import { makeProfile } from './profile.js';
import { analyzeLink, profileSeries } from './linkbudget.js';
import { gasAttenuationDbPerKm, rainAttenuationDbPerKm } from './atmosphere.js';
import { computeFeeder } from './feeder.js';
import { PlannerElevation, PlannerElevationError, PlannerElevationFailure } from './elevation.js';
import { PlannerWeather } from './weather.js';
import { PlannerOverpass, PlannerClutterError, PlannerClutterFailure, PlannerClutter, withClutter } from './clutter.js';
import { computeCoverageAsync } from './coverage.js';
import { normalizePlannerInput, DEFAULT_K, DEFAULT_N0, noiseFloorDbm } from './defaults.js';
import { isAbortError, abortError, throwIfAborted, clamp } from './util.js';

/** Minimalna odległość punktów (m). */
export const MIN_DISTANCE_M = 10.0;
const WEATHER_CACHE_MS = 15 * 60 * 1000;
const STD_TEMP_C = 15.0;
const STD_PRESSURE_HPA = 1013.0;
const STD_RH_PCT = 60.0;

/** Kody błędów wyniku (nigdy tekst). */
export const PlannerError = Object.freeze({
  ELEVATION_OFFLINE: 'ELEVATION_OFFLINE', ELEVATION_DECODE: 'ELEVATION_DECODE', POINTS_TOO_CLOSE: 'POINTS_TOO_CLOSE',
  COMPUTE_FAILED: 'COMPUTE_FAILED', COVERAGE_NEEDS_POINT: 'COVERAGE_NEEDS_POINT',
});

const idleStatus = () => ({ kind: 'idle' });

/** Stan „nie udało się” dla przeszkód OSM: kod + szczegóły techniczne (status HTTP, komunikat błędu, uwaga serwera). */
function clutterFailureStatus(e) {
  if (e instanceof PlannerClutterError) return { kind: 'failed', failure: e.failure, detail: e.detail || {} };
  return { kind: 'failed', failure: PlannerClutterFailure.BAD_RESPONSE, detail: { errorName: e && e.name, errorMessage: String((e && e.message) || e).slice(0, 300) } };
}

/** Strata feedera końca (dB): tryb dokładny (złącza+kable) albo wartość ręczna. */
export function feederLossOf(end, fMHz) {
  return end.feederPrecise ? computeFeeder(end.feederConfig, fMHz).totalDb : end.feederManualDb;
}

const isComplete = (e) => typeof e.lat === 'number' && typeof e.lon === 'number';

function linkEnd(end, point, groundM, fMHz) {
  return {
    point, groundAltM: groundM, antennaHeightM: end.antennaHeightM, txPowerDbm: end.txPowerDbm,
    antennaGainDbi: end.antennaGainDbi, feederLossDb: feederLossOf(end, fMHz),
  };
}

function atmosphericLossDb(fMHz, c, distKm) {
  if (fMHz < 1000.0) return 0.0;
  const t = c ? c.tempC : STD_TEMP_C;
  const p = c ? c.pressureHpa : STD_PRESSURE_HPA;
  const rh = c ? c.rhPct : STD_RH_PCT;
  const rain = c ? c.rainMmH : 0.0;
  const perKm = gasAttenuationDbPerKm(fMHz, t, p, rh) + rainAttenuationDbPerKm(fMHz, rain);
  return Math.max(0.0, perKm * distKm);
}

/** Wysokości przeszkód z wejścia plannera. */
const heightsOf = (inp) => ({ forestM: inp.forestHeightM, buildingM: inp.buildingHeightM });

/** Dodatkowa strata po uwzględnieniu przeszkód OSM: gdy włączone i pobrane -> 0 (zastępują preset), przy błędzie preset wraca. */
export function effectiveExtraLossDb(inp, clutterStatus) {
  const replaced = inp.preciseTerrain && !(clutterStatus && clutterStatus.kind === 'failed');
  return replaced ? 0.0 : inp.extraLossDb;
}

/**
 * Porównanie predykcji z ostatnim pomiarem węzła (jeśli jeden koniec to węzeł mesh, a drugi nasza stacja).
 * nodes: [{num, displayName, rssiDbm, snrDb, hopsAway, isOurs}]
 */
export function compareMeasured(inp, link, nodes = []) {
  const ours = nodes.find((n) => n.isOurs);
  const ourNum = ours ? ours.num : undefined;
  const isOursEnd = (end) => {
    const s = end.pointSource || { type: 'none' };
    return s.type === 'station' || (s.type === 'node' && s.num === ourNum);
  };
  for (const side of ['A', 'B']) {
    const tx = side === 'A' ? inp.a : inp.b;
    const rx = side === 'A' ? inp.b : inp.a;
    const src = tx.pointSource || { type: 'none' };
    if (src.type !== 'node' || src.num === ourNum || !isOursEnd(rx)) continue;
    const node = nodes.find((n) => n.num === src.num);
    if (!node) continue;
    const dir = side === 'A' ? link.aToB : link.bToA;
    const floor = noiseFloorDbm(inp.bandwidthKhz, inp.noiseFigureDb);
    const predSnr = dir.rxPowerDbm - floor;
    const rssi = node.rssiDbm ?? null;
    const snr = node.snrDb ?? null;
    return {
      nodeNum: node.num, nodeName: node.displayName, nodeSide: side, direct: node.hopsAway === 0,
      predictedRssiDbm: dir.rxPowerDbm, predictedSnrDb: predSnr, noiseFloorDbm: floor,
      measuredRssiDbm: rssi, measuredSnrDb: snr,
      rssiDeltaDb: rssi !== null ? rssi - dir.rxPowerDbm : null,
      snrDeltaDb: snr !== null ? snr - predSnr : null,
    };
  }
  return null;
}

const round2 = (v) => Math.round(v * 100.0);

/**
 * Silnik plannera. Używa wstrzykiwanych źródeł (do testów: atrapy), domyślnie prawdziwych.
 * Zwykle wystarczą funkcje planLink / planCoverage z index.js, które używają współdzielonej instancji.
 */
export class PlannerComputer {
  /**
   * @param {Object} [o]
   * @param {{profile:Function,prepareArea:Function,altitudeAt:Function}} [o.elevation]
   * @param {{fetch:Function}} [o.weather]
   * @param {{forLink:Function,forArea:Function}} [o.clutter]
   * @param {() => number} [o.clockMs]
   * @param {boolean} [o.useWorker=true] liczyć zasięg w Web Workerze, jeśli dostępny
   * @param {string|URL} [o.workerUrl] adres coverage-worker.js (domyślnie obok tego modułu)
   */
  constructor({ elevation, weather, clutter, clockMs = () => Date.now(), useWorker = true, workerUrl } = {}) {
    this.elevation = elevation || new PlannerElevation();
    this.weather = weather || new PlannerWeather();
    this.clutter = clutter || new PlannerOverpass();
    this._clockMs = clockMs;
    this._useWorker = useWorker;
    this._workerUrl = workerUrl;
    this._wKey = null; this._wAt = 0; this._wResult = null;
    this._coverageSeq = 0;
  }

  /** Porzuca zapamiętaną pogodę ("odśwież pogodę"). */
  invalidateWeather() { this._wResult = null; this._wKey = null; }

  async _fetchWeather(p, signal) {
    const key = `${round2(p.lat)},${round2(p.lon)}`;
    const now = this._clockMs();
    if (this._wResult && this._wKey === key && now - this._wAt < WEATHER_CACHE_MS) return this._wResult;
    const r = await this.weather.fetch(p.lat, p.lon, { signal });
    if (r.ok) { this._wKey = key; this._wAt = now; this._wResult = r; }
    return r;
  }

  async _altitudeOrNull(p, signal) {
    try { return await this.elevation.altitudeAt(p.lat, p.lon, { signal }); } catch (e) {
      if (isAbortError(e)) throw e;
      return null;
    }
  }

  _empty(error, weather = idleStatus(), k = DEFAULT_K, n0 = DEFAULT_N0) {
    return {
      link: null, series: null, groundAltA: null, groundAltB: null, weather, kFactor: k, surfaceRefractivity: n0,
      atmosphericLossDb: 0.0, comparison: null, error, clutter: idleStatus(), effectiveExtraLossDb: 0.0,
    };
  }

  /**
   * Oblicza łącze A-B. Nie rzuca (poza anulowaniem przez signal): błędy trafiają do result.error.
   * @returns {Promise<PlannerResults>} patrz API.md
   */
  async compute(rawInput, { nodes = [], signal } = {}) {
    const inp = normalizePlannerInput(rawInput);
    const { a, b } = inp;
    throwIfAborted(signal);
    if (!isComplete(a) || !isComplete(b)) {
      const pa0 = isComplete(a) ? { lat: a.lat, lon: a.lon } : null;
      const pb0 = isComplete(b) ? { lat: b.lat, lon: b.lon } : null;
      const ga = pa0 ? await this._altitudeOrNull(pa0, signal) : null;
      const gb = pb0 ? await this._altitudeOrNull(pb0, signal) : null;
      return { ...this._empty(null), groundAltA: ga, groundAltB: gb, effectiveExtraLossDb: inp.extraLossDb };
    }
    const pa = { lat: a.lat, lon: a.lon };
    const pb = { lat: b.lat, lon: b.lon };
    if (distanceM(pa, pb) < MIN_DISTANCE_M) return this._empty(PlannerError.POINTS_TOO_CLOSE);

    // pogoda najpierw: błąd = cicha atmosfera standardowa
    let status = idleStatus();
    let k = DEFAULT_K;
    let n0 = DEFAULT_N0;
    let conditions = null;
    if (inp.useWeather) {
      const mid = interpolate(pa, pb, 0.5);
      const r = await this._fetchWeather(mid, signal);
      if (r.ok) {
        conditions = r.conditions;
        status = { kind: 'ready', conditions };
        k = conditions.analysis.kFactor;
        n0 = conditions.analysis.seaLevelN;
      } else status = { kind: 'failed', error: r.error };
    }

    let profile;
    try {
      profile = await this.elevation.profile(pa, pb, { signal });
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (e instanceof PlannerElevationError) {
        return this._empty(e.failure === PlannerElevationFailure.NETWORK ? PlannerError.ELEVATION_OFFLINE : PlannerError.ELEVATION_DECODE, status, k, n0);
      }
      return this._empty(PlannerError.COMPUTE_FAILED, status, k, n0);
    }

    const n = profile.intervals;
    const autoA = profile.groundM[0];
    const autoB = profile.groundM[n];
    let ground = Float64Array.from(profile.groundM);
    if (a.groundAltManual && a.groundAltM !== null) ground[0] = a.groundAltM;
    if (b.groundAltManual && b.groundAltM !== null) ground[n] = b.groundAltM;

    // opcjonalne prawdziwe przeszkody (OSM); błąd = powrót do presetu, jak pogoda
    let clutterStatus = idleStatus();
    if (inp.preciseTerrain) {
      try {
        const map = await this.clutter.forLink(pa, pb, { signal });
        const heights = heightsOf(inp);
        const totalM = profile.stepM * n;
        const clearM = PlannerClutter.CLEAR_AROUND_ANTENNA_M;
        ground = withClutter(ground, profile.stepM, (i) => {
          const p = interpolate(pa, pb, totalM > 0.0 ? (i * profile.stepM) / totalM : 0.0);
          return map.heightAt(p.lat, p.lon, heights);
        }, clearM, clearM);
        clutterStatus = { kind: 'ready', stats: map.stats };
      } catch (e) {
        if (isAbortError(e)) throw e;
        clutterStatus = clutterFailureStatus(e);
      }
    }
    const used = makeProfile(profile.stepM, ground);
    const extraDb = effectiveExtraLossDb(inp, clutterStatus);
    const distKm = used.distanceM / 1000.0;
    const atmo = atmosphericLossDb(inp.frequencyMHz, conditions, distKm);

    const linkInput = {
      a: linkEnd(a, pa, ground[0], inp.frequencyMHz),
      b: linkEnd(b, pb, ground[n], inp.frequencyMHz),
      frequencyMHz: inp.frequencyMHz, bandwidthKhz: inp.bandwidthKhz, spreadingFactor: inp.spreadingFactor,
      noiseFigureDb: inp.noiseFigureDb, kFactor: k, surfaceRefractivity: n0, extraLossDb: extraDb + atmo,
    };
    try {
      const link = analyzeLink(linkInput, used);
      const series = profileSeries(linkInput, used);
      return {
        link, series, groundAltA: autoA, groundAltB: autoB, weather: status, kFactor: k, surfaceRefractivity: n0,
        atmosphericLossDb: atmo, comparison: compareMeasured(inp, link, nodes), error: null, clutter: clutterStatus,
        effectiveExtraLossDb: extraDb,
      };
    } catch (e) {
      if (isAbortError(e)) throw e;
      return this._empty(PlannerError.COMPUTE_FAILED, status, k, n0);
    }
  }

  /**
   * Prognoza zasięgu wokół końca `coverageSide`. Rzuca PlannerElevationError (brak terenu), Error z
   * code PlannerError.COVERAGE_NEEDS_POINT (brak punktu) lub AbortError. Brak przeszkód OSM nie jest błędem:
   * wołany jest onClutterFailure(failure, detail) i obliczenie idzie dalej bez nich; gdy obszar był za duży i pobrano
   * połowę promienia - onClutterRadius({requestedKm, usedKm, failure}).
   * @param {Object} rawInput  jak w compute (+ kFactor, surfaceRefractivity, clutterStatus z ostatniego compute)
   * @param {{onProgress?:(f:number)=>void, signal?:AbortSignal, onClutterFailure?:(f:string)=>void}} [o]
   * @returns {Promise<CoverageResult>}
   */
  async computeCoverage(rawInput, { onProgress, signal, onClutterFailure, onClutterRadius } = {}) {
    const inp = normalizePlannerInput(rawInput);
    const end = inp.coverageSide === 'B' ? inp.b : inp.a;
    if (!isComplete(end)) {
      const e = new Error('coverage side has no point');
      e.code = PlannerError.COVERAGE_NEEDS_POINT;
      throw e;
    }
    throwIfAborted(signal);
    const center = { lat: end.lat, lon: end.lon };
    const sampler = await this.elevation.prepareArea(center, inp.coverageMaxRangeKm, { signal });
    let clutterMap = null;
    if (inp.preciseTerrain) {
      try {
        clutterMap = await this.clutter.forArea(center, Math.min(inp.coverageMaxRangeKm, inp.clutterRadiusKm), { signal, onRadiusReduced: onClutterRadius });
      } catch (e) {
        if (isAbortError(e)) throw e;
        if (onClutterFailure) { const st = clutterFailureStatus(e); onClutterFailure(st.failure, st.detail); }
        clutterMap = null;
      }
    }
    const heights = heightsOf(inp);
    const ground = end.groundAltManual && end.groundAltM !== null ? end.groundAltM : sampler(center.lat, center.lon);
    const k = typeof inp.kFactor === 'number' ? inp.kFactor : DEFAULT_K;
    const n0 = typeof inp.surfaceRefractivity === 'number' ? inp.surfaceRefractivity : DEFAULT_N0;
    const input = {
      center, groundAltM: ground, antennaHeightM: end.antennaHeightM, txPowerDbm: end.txPowerDbm,
      antennaGainDbi: end.antennaGainDbi, feederLossDb: feederLossOf(end, inp.frequencyMHz),
      rxAntennaHeightM: inp.coverageRxHeightM, rxGainDbi: inp.coverageRxGainDbi,
      frequencyMHz: inp.frequencyMHz, bandwidthKhz: inp.bandwidthKhz, spreadingFactor: inp.spreadingFactor,
      noiseFigureDb: inp.noiseFigureDb, kFactor: k, surfaceRefractivity: n0,
      extraLossDb: clutterMap ? effectiveExtraLossDb(inp, inp.clutterStatus) : inp.extraLossDb,
      maxRangeKm: inp.coverageMaxRangeKm, radials: inp.coverageRadials,
      rangeSteps: clamp(Math.trunc(inp.coverageMaxRangeKm * 2.0), 60, 150),
    };
    return this._runCoverage(input, sampler, clutterMap, heights, { onProgress, signal });
  }

  async _runCoverage(input, sampler, clutterMap, heights, { onProgress, signal }) {
    if (this._useWorker && typeof Worker !== 'undefined' && typeof sampler.exportTiles === 'function') {
      try {
        return await this._runInWorker(input, sampler, clutterMap, heights, { onProgress, signal });
      } catch (e) {
        if (isAbortError(e) || (e && e.fromCompute)) throw e;
        // nie udało się uruchomić workera (CSP, brak modułów w workerze...): liczymy w głównym wątku
      }
    }
    const clutterAt = clutterMap ? (lat, lon) => clutterMap.heightAt(lat, lon, heights) : null;
    return computeCoverageAsync(input, sampler, clutterAt, { onProgress, signal });
  }

  _runInWorker(input, sampler, clutterMap, heights, { onProgress, signal }) {
    return new Promise((resolve, reject) => {
      const url = this._workerUrl || new URL('./coverage-worker.js', import.meta.url);
      const worker = new Worker(url, { type: 'module' });
      const id = ++this._coverageSeq;
      let settled = false;
      const finish = (fn, v) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        worker.terminate();
        fn(v);
      };
      const onAbort = () => { try { worker.postMessage({ type: 'cancel', id }); } catch { /* ignore */ } finish(reject, abortError()); };
      if (signal) {
        if (signal.aborted) { worker.terminate(); reject(abortError()); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (!m || m.id !== id) return;
        if (m.type === 'progress') { if (onProgress) onProgress(m.value); }
        else if (m.type === 'done') finish(resolve, m.result);
        else if (m.type === 'error') {
          const e = new Error(m.message);
          e.name = m.name;
          e.fromCompute = true;
          finish(reject, e);
        }
      };
      worker.onerror = (ev) => finish(reject, new Error(ev && ev.message ? ev.message : 'worker failed'));
      worker.postMessage({
        type: 'run', id, input,
        elevation: { zoom: sampler.zoom, tiles: sampler.exportTiles() },
        clutter: clutterMap ? clutterMap.toTransferable() : null,
        heights,
      });
    });
  }
}

let shared = null;

/** Współdzielona instancja (prawdziwe źródła danych). Do testów: setSharedComputer(new PlannerComputer({...atrapy})). */
export function getSharedComputer() {
  if (!shared) shared = new PlannerComputer();
  return shared;
}

export function setSharedComputer(c) { shared = c; }

/**
 * Oblicza łącze A-B (teren, opcjonalnie pogoda i przeszkody OSM, ITM, bilans, Fresnel).
 * @param {Object} input stan plannera (createDefaultInput() pokazuje kształt)
 * @param {{nodes?:Array, signal?:AbortSignal, computer?:PlannerComputer}} [options]
 * @returns {Promise<PlannerResults>}
 */
export function planLink(input, options = {}) {
  return (options.computer || getSharedComputer()).compute(input, options);
}

/**
 * Prognoza zasięgu (raster polarny) wokół końca input.coverageSide.
 * @param {Object} input stan plannera; dla zgodności z ostatnim planLink dodaj kFactor, surfaceRefractivity, clutterStatus
 * @param {{onProgress?:(f:number)=>void, signal?:AbortSignal, onClutterFailure?:(f:string, detail?:Object)=>void,
 *   onClutterRadius?:(info:{requestedKm:number, usedKm:number, failure:string})=>void, computer?:PlannerComputer}} [options]
 * @returns {Promise<CoverageResult>}
 */
export function planCoverage(input, options = {}) {
  return (options.computer || getSharedComputer()).computeCoverage(input, options);
}
