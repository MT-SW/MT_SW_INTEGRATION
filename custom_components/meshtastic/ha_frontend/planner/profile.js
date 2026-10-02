// Profil terenu wzdłuż koła wielkiego — port PathProfile.kt.
import { distanceM, interpolate, EARTH_RADIUS_M } from './geodesy.js';

/**
 * @typedef {Object} PathProfile
 * @property {number} stepM     krok próbkowania (m)
 * @property {Float64Array|number[]} groundM  wysokości terenu n+1 próbek (m n.p.m.)
 * @property {number} intervals liczba odcinków (próbki-1)
 * @property {number} distanceM długość trasy (m)
 */
export function makeProfile(stepM, groundM) {
  const intervals = groundM.length - 1;
  return { stepM, groundM, intervals, distanceM: stepM * intervals };
}

export function distanceAt(profile, i) {
  return profile.stepM * i;
}

/**
 * Próbkuje `elevationAt(lat, lon)` równomiernie między a i b: krok >= minStepM, próbek co najwyżej
 * maxSamples (zawsze min. 3 próbki).
 */
export function profileFromSampler(a, b, elevationAt, { maxSamples = 400, minStepM = 30.0 } = {}) {
  const d = distanceM(a, b);
  const n = Math.min(Math.max(2, maxSamples - 1), Math.max(2, Math.ceil(d / minStepM)));
  const step = d / n;
  const g = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const p = i === 0 ? a : i === n ? b : interpolate(a, b, i / n);
    g[i] = elevationAt(p.lat, p.lon);
  }
  return makeProfile(step, g);
}

/** Wypukłość Ziemi (m) w próbce i względem cięciwy, współczynnik k. */
export function bulgeM(profile, i, k) {
  const d1 = distanceAt(profile, i);
  const d2 = profile.distanceM - d1;
  return (d1 * d2) / (2.0 * k * EARTH_RADIUS_M);
}

/** Wysokość linii prostej (m n.p.m.) w próbce i między antenami startAslM i endAslM. */
export function losHeightM(profile, i, startAslM, endAslM) {
  const n = profile.intervals;
  if (n <= 0) return startAslM;
  return startAslM + ((endAslM - startAslM) * i) / n;
}

/** Promień n-tej strefy Fresnela (m); d1M/d2M odległości od końców, fMHz częstotliwość. */
export function fresnelRadiusM(n, d1M, d2M, fMHz) {
  const total = d1M + d2M;
  if (total <= 0.0 || d1M <= 0.0 || d2M <= 0.0) return 0.0;
  const lambda = 299.792458 / fMHz;
  return Math.sqrt((n * lambda * d1M * d2M) / total);
}
