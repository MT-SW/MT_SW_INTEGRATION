// Prognoza zasięgu na siatce biegunowej (promienie x pierścienie) — port Coverage.kt.
// Rdzeń obliczeń nie zależy od DOM, więc działa tak samo w głównym wątku i w Web Workerze (coverage-worker.js).
import { destination, distanceM, bearingDeg } from './geodesy.js';
import { itmPointToPoint } from './itm.js';
import { sensitivityDbm } from './sensitivity.js';
import { PlannerClutter } from './clutter.js';
import { abortError, yieldToEventLoop } from './util.js';

const MAX_PROFILE_SAMPLES = 600;
const DEFAULT_RINGS = 40;
export const ERROR_MARGIN_DB = -200;

/**
 * @typedef {Object} CoverageInput
 * @property {{lat:number,lon:number}} center
 * @property {number} [groundAltM]            informacyjnie (teren i tak pochodzi z samplera)
 * @property {number} antennaHeightM          wysokość anteny nadawczej nad gruntem (m)
 * @property {number} txPowerDbm
 * @property {number} antennaGainDbi
 * @property {number} feederLossDb
 * @property {number} [rxAntennaHeightM=2]
 * @property {number} [rxGainDbi=0]
 * @property {number} frequencyMHz
 * @property {number} bandwidthKhz
 * @property {number} spreadingFactor
 * @property {number} [noiseFigureDb=6]
 * @property {number} kFactor                 (informacyjnie; ITM liczy własny promień efektywny z N0)
 * @property {number} surfaceRefractivity     N0 (jedn. N), 250..400
 * @property {number} [extraLossDb=0]
 * @property {number} maxRangeKm
 * @property {number} [radials=72]
 * @property {number} [stepM=200]
 * @property {number|null} [rangeSteps]       liczba pierścieni (domyślnie 40)
 */

export const COVERAGE_INPUT_DEFAULTS = Object.freeze({
  rxAntennaHeightM: 2.0, rxGainDbi: 0.0, noiseFigureDb: 6.0, extraLossDb: 0.0, radials: 72, stepM: 200.0, rangeSteps: null,
});

/** Plan siatki (stałe wartości pochodne wejścia). */
export function planCoverageGrid(inputIn) {
  const input = { ...COVERAGE_INPUT_DEFAULTS, ...inputIn };
  const radials = Math.max(1, Math.trunc(input.radials));
  const maxRangeM = Math.max(1.0, input.maxRangeKm * 1000.0);
  const n = Math.min(MAX_PROFILE_SAMPLES, Math.max(3, Math.trunc(Math.ceil(maxRangeM / Math.max(1.0, input.stepM)))));
  const step = maxRangeM / n;
  const rings = Math.min(Math.max(1, Math.trunc(input.rangeSteps ?? DEFAULT_RINGS)), n - 1);
  const ringIdx = new Int32Array(rings);
  for (let j = 0; j < rings; j++) ringIdx[j] = Math.max(2, Math.round(((j + 1) * n) / rings));
  const ringsM = new Float64Array(rings);
  for (let j = 0; j < rings; j++) ringsM[j] = ringIdx[j] * step;
  const sens = sensitivityDbm(input.bandwidthKhz, input.spreadingFactor, input.noiseFigureDb);
  const eirpMinusLosses = input.txPowerDbm + input.antennaGainDbi - input.feederLossDb + input.rxGainDbi - input.extraLossDb;
  return { input, radials, n, step, rings, ringIdx, ringsM, sens, eirpMinusLosses };
}

/** Jeden promień: wypełnia margin (Float32Array[rings]) i zwraca zasięg (m) najdalszego pierścienia z marginesem >= 0. */
function computeRadial(plan, r, elevationAt, clutterAt, margin, buf) {
  const { input, radials, n, step, rings, ringIdx, ringsM, sens, eirpMinusLosses } = plan;
  const { ground, comb } = buf;
  const bearing = (360.0 * r) / radials;
  for (let i = 0; i <= n; i++) {
    const p = i === 0 ? input.center : destination(input.center, bearing, i * step);
    ground[i] = elevationAt(p.lat, p.lon);
    let obstacle = 0.0;
    if (clutterAt && i > 0 && i * step >= PlannerClutter.CLEAR_AROUND_ANTENNA_M) obstacle = clutterAt(p.lat, p.lon);
    comb[i] = ground[i] + obstacle;
  }
  comb[0] = ground[0];
  let reach = 0.0;
  for (let j = 0; j < rings; j++) {
    const idx = ringIdx[j];
    const saved = comb[idx];
    comb[idx] = ground[idx]; // punkt odbiorczy zostaje na gruncie
    const res = itmPointToPoint(comb.subarray(0, idx + 1), step, input.antennaHeightM, input.rxAntennaHeightM,
      input.frequencyMHz, { surfaceRefractivityNUnits: input.surfaceRefractivity });
    comb[idx] = saved;
    const m = res.returnCode <= 1 && !Number.isNaN(res.lossDb) ? Math.fround(eirpMinusLosses - res.lossDb - sens) : ERROR_MARGIN_DB;
    margin[j] = m;
    if (m >= 0) reach = ringsM[j];
  }
  return reach;
}

function newResult(plan) {
  return {
    radials: plan.radials,
    ringsM: plan.ringsM,
    marginDb: Array.from({ length: plan.radials }, () => new Float32Array(plan.rings)),
    center: plan.input.center,
    maxReachM: new Float64Array(plan.radials),
  };
}

const newBuf = (plan) => ({ ground: new Float64Array(plan.n + 1), comb: new Float64Array(plan.n + 1) });

/**
 * Synchroniczne obliczenie (bez oddawania sterowania) — do testów i krótkich zadań.
 * @param {CoverageInput} input
 * @param {(lat:number,lon:number)=>number} elevationAt  m n.p.m.
 * @param {((lat:number,lon:number)=>number)|null} [clutterAt]  wysokość przeszkody (m) albo null dla gołego terenu;
 *   dodawana tylko do próbek pośrednich (okolice anteny <100 m i punkt odbiorczy zostają na gruncie)
 * @param {{onProgress?:(fraction:number)=>void}} [o]
 * @returns {CoverageResult}
 */
export function computeCoverageSync(input, elevationAt, clutterAt = null, { onProgress } = {}) {
  const plan = planCoverageGrid(input);
  const res = newResult(plan);
  const buf = newBuf(plan);
  for (let r = 0; r < plan.radials; r++) {
    res.maxReachM[r] = computeRadial(plan, r, elevationAt, clutterAt, res.marginDb[r], buf);
    if (onProgress) onProgress((r + 1) / plan.radials);
  }
  return res;
}

/**
 * Asynchroniczne obliczenie z kooperacyjnym oddawaniem sterowania (co ~yieldMs), postępem i anulowaniem.
 * Rzuca AbortError, gdy signal został przerwany. Ten sam kod działa w workerze i w głównym wątku.
 * @param {CoverageInput} input
 * @param {(lat:number,lon:number)=>number} elevationAt
 * @param {((lat:number,lon:number)=>number)|null} clutterAt
 * @param {{onProgress?:(fraction:number)=>void, signal?:AbortSignal, shouldCancel?:()=>boolean, yieldMs?:number}} [o]
 */
export async function computeCoverageAsync(input, elevationAt, clutterAt = null, { onProgress, signal, shouldCancel, yieldMs = 25 } = {}) {
  const plan = planCoverageGrid(input);
  const res = newResult(plan);
  const buf = newBuf(plan);
  let last = Date.now();
  const cancelled = () => (signal && signal.aborted) || (shouldCancel && shouldCancel());
  for (let r = 0; r < plan.radials; r++) {
    if (cancelled()) throw abortError();
    res.maxReachM[r] = computeRadial(plan, r, elevationAt, clutterAt, res.marginDb[r], buf);
    if (onProgress) onProgress((r + 1) / plan.radials);
    if (Date.now() - last >= yieldMs) {
      await yieldToEventLoop();
      last = Date.now();
    }
  }
  if (cancelled()) throw abortError();
  return res;
}

/**
 * Margines (dB) w punkcie, interpolacja dwuliniowa między promieniami i pierścieniami; null poza zasięgiem.
 * Wewnątrz pierwszego pierścienia zwracana jest wartość pierwszego pierścienia.
 */
export function marginAt(result, lat, lon) {
  const { ringsM, radials, marginDb, center } = result;
  if (!ringsM.length || radials <= 0) return null;
  const p = { lat, lon };
  const d = distanceM(center, p);
  if (d > ringsM[ringsM.length - 1]) return null;
  const bearing = bearingDeg(center, p);
  const rf = (bearing / 360.0) * radials;
  const r0 = Math.floor(rf);
  const tr = Math.fround(rf - r0);
  const ra = ((r0 % radials) + radials) % radials;
  const rb = (ra + 1) % radials;

  let j1 = -1;
  for (let i = 0; i < ringsM.length; i++) if (ringsM[i] >= d) { j1 = i; break; }
  if (j1 < 0) j1 = ringsM.length - 1;
  const j0 = Math.max(0, j1 - 1);
  const td = j1 === j0 || d <= ringsM[j0] ? 0 : Math.fround((d - ringsM[j0]) / (ringsM[j1] - ringsM[j0]));
  const jj0 = d < ringsM[0] ? 0 : j0;
  const jj1 = d < ringsM[0] ? 0 : j1;
  const at = (r) => Math.fround(Math.fround(marginDb[r][jj0] * Math.fround(1 - td)) + Math.fround(marginDb[r][jj1] * td));
  return Math.fround(Math.fround(at(ra) * Math.fround(1 - tr)) + Math.fround(at(rb) * tr));
}
