// Geodezja sferyczna (promień średni Ziemi) — port Geodesy.kt.
// Punkt = { lat, lon } w stopniach WGS-84.

export const EARTH_RADIUS_M = 6371008.8;

const rad = (d) => (d * Math.PI) / 180.0;
const deg = (r) => (r * 180.0) / Math.PI;

/** Odległość wielkokołowa (haversine), metry. */
export function distanceM(a, b) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = p2 - p1;
  const dl = rad(b.lon - a.lon);
  const s1 = Math.sin(dp / 2);
  const s2 = Math.sin(dl / 2);
  const h = s1 * s1 + Math.cos(p1) * Math.cos(p2) * s2 * s2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1.0, Math.sqrt(h)));
}

/** Azymut początkowy z `from` do `to`, stopnie od północy, 0..360. */
export function bearingDeg(from, to) {
  const p1 = rad(from.lat);
  const p2 = rad(to.lat);
  const dl = rad(to.lon - from.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const b = deg(Math.atan2(y, x));
  return ((b % 360.0) + 360.0) % 360.0;
}

/** Punkt osiągnięty z `from` po przebyciu `distM` metrów pod azymutem `bearing`. */
export function destination(from, bearing, distM) {
  const d = distM / EARTH_RADIUS_M;
  const br = rad(bearing);
  const p1 = rad(from.lat);
  const l1 = rad(from.lon);
  const sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br);
  const p2 = Math.asin(Math.max(-1.0, Math.min(1.0, sinP2)));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sinP2);
  const lon = ((deg(l2) + 540.0) % 360.0) - 180.0;
  return { lat: deg(p2), lon };
}

/** Punkt w ułamku `fraction` (0..1) łuku koła wielkiego a→b. */
export function interpolate(a, b, fraction) {
  const delta = distanceM(a, b) / EARTH_RADIUS_M;
  if (delta < 1e-12) return a;
  const p1 = rad(a.lat);
  const l1 = rad(a.lon);
  const p2 = rad(b.lat);
  const l2 = rad(b.lon);
  const sd = Math.sin(delta);
  const ka = Math.sin((1 - fraction) * delta) / sd;
  const kb = Math.sin(fraction * delta) / sd;
  const x = ka * Math.cos(p1) * Math.cos(l1) + kb * Math.cos(p2) * Math.cos(l2);
  const y = ka * Math.cos(p1) * Math.sin(l1) + kb * Math.cos(p2) * Math.sin(l2);
  const z = ka * Math.sin(p1) + kb * Math.sin(p2);
  return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
}

/**
 * Kąt elewacji anteny (stopnie, + = w górę) na stacji o wysokości fromAltM celującej w stację toAltM
 * oddaloną o distM, z uwzględnieniem spadku krzywizny d²/(2kR); teren ignorowany.
 */
export function elevationAngleDeg(fromAltM, toAltM, distM, k) {
  if (distM <= 0.0) return 0.0;
  const drop = (distM * distM) / (2.0 * k * EARTH_RADIUS_M);
  return deg(Math.atan2(toAltM - fromAltM - drop, distM));
}
