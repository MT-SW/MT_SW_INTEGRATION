// Pogoda dla propagacji (Open-Meteo, CC BY 4.0) — port PlannerWeather.kt.
// Przy błędzie planner wraca do atmosfery standardowej (k = 4/3, N0 = 301).
import { analyzeProfile } from './atmosphere.js';
import { fmt, abortError, throwIfAborted } from './util.js';
import { plannerFetch } from './net.js';

export const WEATHER_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
export const WEATHER_TIMEOUT_MS = 15000;
/** Poziomy ciśnienia (hPa) pobierane oprócz wartości przy gruncie. */
export const PRESSURE_LEVELS = Object.freeze([925, 850, 700]);
const MIN_LEVEL_ABOVE_GROUND_M = 20.0;

/** Powód braku pogody: brak połączenia/limit czasu/błąd HTTP -> OFFLINE; nieczytelna odpowiedź -> BAD_RESPONSE. */
export const PlannerWeatherError = Object.freeze({ OFFLINE: 'OFFLINE', HTTP_ERROR: 'HTTP_ERROR', BAD_RESPONSE: 'BAD_RESPONSE' });

export function buildWeatherUrl(baseUrl, lat, lon) {
  let s = `${baseUrl}?latitude=${fmt(lat, 4)}&longitude=${fmt(lon, 4)}`;
  s += '&current=temperature_2m,relative_humidity_2m,surface_pressure,precipitation';
  s += '&hourly=precipitation';
  for (const l of PRESSURE_LEVELS) {
    s += `,temperature_${l}hPa,relative_humidity_${l}hPa,geopotential_height_${l}hPa`;
  }
  s += '&timezone=GMT&forecast_days=1';
  return s;
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string') { const n = Number(x); return x.trim() !== '' && Number.isFinite(n) ? n : null; }
  return null;
};
const hourly = (obj, key, index) => {
  const arr = obj[key];
  if (!Array.isArray(arr) || index < 0 || index >= arr.length) return null;
  return num(arr[index]);
};

/**
 * Parsuje odpowiedź Open-Meteo (zapytanie z timezone=GMT, current=..., poziomy 925/850/700 hPa).
 * @returns {{fetchedAtIso:string, source:string, analysis:Object, tempC:number, pressureHpa:number,
 *   rhPct:number, rainMmH:number, level:string}|null} null przy braku wartości przy gruncie albo złym JSON
 */
export function parseOpenMeteo(json) {
  let root;
  try { root = JSON.parse(json); } catch { return null; }
  if (!isObj(root)) return null;
  const current = root.current;
  if (!isObj(current)) return null;
  const temp = num(current.temperature_2m);
  if (temp === null) return null;
  const pressure = num(current.surface_pressure);
  if (pressure === null) return null;
  const rh = num(current.relative_humidity_2m);
  if (rh === null) return null;
  const timeRaw = typeof current.time === 'string' ? current.time : null;
  if (timeRaw === null || timeRaw.length < 16) return null;
  const timeIso = timeRaw.substring(0, 16).replace('T', ' ');
  const hourKey = timeRaw.substring(0, 13) + ':00';
  const station = num(root.elevation) ?? 0.0;

  const hourlyObj = isObj(root.hourly) ? root.hourly : null;
  let index = -1;
  if (hourlyObj && Array.isArray(hourlyObj.time)) {
    for (let i = 0; i < hourlyObj.time.length; i++) {
      if (hourlyObj.time[i] === hourKey) { index = i; break; }
    }
  }
  const rain = (hourlyObj && index >= 0 ? hourly(hourlyObj, 'precipitation', index) : null) ?? num(current.precipitation) ?? 0.0;

  const samples = [{ heightM: station, tempC: temp, pressureHpa: pressure, rhPct: rh }];
  if (hourlyObj && index >= 0) {
    for (const level of PRESSURE_LEVELS) {
      const t = hourly(hourlyObj, `temperature_${level}hPa`, index);
      const r = hourly(hourlyObj, `relative_humidity_${level}hPa`, index);
      const z = hourly(hourlyObj, `geopotential_height_${level}hPa`, index);
      if (t === null || r === null || z === null) continue;
      if (z < station + MIN_LEVEL_ABOVE_GROUND_M) continue;
      samples.push({ heightM: z, tempC: t, pressureHpa: level, rhPct: r });
    }
  }
  const analysis = analyzeProfile(samples);
  return {
    fetchedAtIso: timeIso, source: 'Open-Meteo', analysis, tempC: temp, pressureHpa: pressure, rhPct: rh,
    rainMmH: rain, level: analysis.level,
  };
}

/** Klient Open-Meteo. fetch(lat, lon) -> {ok:true, conditions} | {ok:false, error}. Nie rzuca (poza anulowaniem). */
export class PlannerWeather {
  /** @param {{fetch?:typeof fetch, baseUrl?:string, timeoutMs?:number}} [o] */
  constructor({ fetch: fetchFn, baseUrl = WEATHER_BASE_URL, timeoutMs = WEATHER_TIMEOUT_MS } = {}) {
    this._fetch = fetchFn || ((...a) => globalThis.fetch(...a));
    this._baseUrl = baseUrl;
    this._timeoutMs = timeoutMs;
  }

  async fetch(lat, lon, { signal } = {}) {
    throwIfAborted(signal);
    const url = buildWeatherUrl(this._baseUrl, lat, lon);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this._timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let body = null;
    try {
      const res = await plannerFetch(this._fetch, url, { signal: ctrl.signal });
      if (res.ok) body = await res.text();
    } catch (e) {
      if (signal && signal.aborted) throw e.name === 'AbortError' ? e : abortError();
      body = null;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    if (body === null) return { ok: false, error: PlannerWeatherError.OFFLINE };
    let parsed = null;
    try { parsed = parseOpenMeteo(body); } catch { parsed = null; }
    return parsed === null ? { ok: false, error: PlannerWeatherError.BAD_RESPONSE } : { ok: true, conditions: parsed };
  }
}
