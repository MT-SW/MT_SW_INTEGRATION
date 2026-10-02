// Baza kabli i złączy — port CableDb.kt (dane z kart katalogowych producentów).

export const MIN_F = 20.0;
export const MAX_F = 20000.0;
const DB100FT_TO_DB100M = 100.0 / 30.48;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const ft = (fMHz, dbPer100ft) => ({ fMHz, dbPer100m: dbPer100ft * DB100FT_TO_DB100M });
const pts = (...fv) => {
  const out = [];
  for (let i = 0; i < fv.length; i += 2) out.push({ fMHz: fv[i], dbPer100m: fv[i + 1] });
  return out;
};
const rg213Points = () =>
  [50.0, 100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 700.0, 800.0, 900.0, 1000.0].map((f) => {
    const g = f / 1000.0;
    return { fMHz: f, dbPer100m: (0.1679 * Math.sqrt(g) + 0.0585 * g) * 100.0 };
  });

function extrapolateUp(p, f) {
  const last = p[p.length - 1];
  const sqrtScaled = last.dbPer100m * Math.sqrt(f / last.fMHz);
  if (f === last.fMHz || p.length < 2) return sqrtScaled;
  const prev = p[p.length - 2];
  const s1 = Math.sqrt(prev.fMHz);
  const s2 = Math.sqrt(last.fMHz);
  const det = s1 * last.fMHz - s2 * prev.fMHz;
  if (det === 0.0) return sqrtScaled;
  const a = (prev.dbPer100m * last.fMHz - last.dbPer100m * prev.fMHz) / det;
  const b = (s1 * last.dbPer100m - s2 * prev.dbPer100m) / det;
  if (a < 0.0 || b < 0.0) return sqrtScaled;
  const fit = a * Math.sqrt(f) + b * f;
  const linear = (last.dbPer100m * f) / last.fMHz;
  return clamp(fit, sqrtScaled, linear);
}

/**
 * Tłumienność kabla w dB/m przy fMHz (20 MHz..20 GHz). W zakresie danych: interpolacja log-log; poniżej:
 * skalowanie sqrt(f); powyżej: dopasowanie a*sqrt(f)+b*f ograniczone sqrt(f)..liniowo.
 */
export function cableLossDbPerM(cable, fMHz) {
  const p = [...cable.points].sort((x, y) => x.fMHz - y.fMHz);
  if (p.length === 0) return 0.0;
  const f = clamp(Number.isNaN(fMHz) ? MIN_F : fMHz, MIN_F, MAX_F);
  const first = p[0];
  const last = p[p.length - 1];
  let per100;
  if (f <= first.fMHz) per100 = first.dbPer100m * Math.sqrt(f / first.fMHz);
  else if (f >= last.fMHz) per100 = extrapolateUp(p, f);
  else {
    let i = 0;
    while (i < p.length - 2 && p[i + 1].fMHz <= f) i++;
    const p0 = p[i];
    const p1 = p[i + 1];
    const t = Math.log(f / p0.fMHz) / Math.log(p1.fMHz / p0.fMHz);
    per100 = Math.exp(Math.log(p0.dbPer100m) + t * (Math.log(p1.dbPer100m) - Math.log(p0.dbPer100m)));
  }
  return per100 / 100.0;
}

/** Strata złącza (dB): potęgowa przez punkty 900 MHz i 2.4 GHz, wykładnik 0..1.5. */
export function connectorLossDb(conn, fMHz) {
  const f = clamp(Number.isNaN(fMHz) ? MIN_F : fMHz, MIN_F, MAX_F);
  const l9 = Math.max(conn.lossDb900, 0.0);
  const l24 = Math.max(conn.lossDb2400, 0.0);
  if (l9 <= 0.0 || l24 <= 0.0) {
    const k = l24 > 0.0 ? l24 / 2400.0 : l9 / 900.0;
    return Math.max(k * f, 0.0);
  }
  const exponent = clamp(Math.log(l24 / l9) / Math.log(2400.0 / 900.0), 0.0, 1.5);
  return Math.max(l9 * Math.exp(exponent * Math.log(f / 900.0)), 0.0);
}

const C = (id, name, diameterMm, points, approximate, source, velocityFactor) =>
  Object.freeze({ id, name, diameterMm, points, approximate, source, velocityFactor });

/** @type {ReadonlyArray<{id:string,name:string,diameterMm:number,points:{fMHz:number,dbPer100m:number}[],approximate:boolean,source:string,velocityFactor:number}>} */
export const CABLES = Object.freeze([
  C('rg174', 'RG174', 2.55, pts(100.0, 28.4, 200.0, 40.4, 300.0, 49.7, 400.0, 57.5, 600.0, 70.8, 800.0, 82.1, 1000.0, 92.2),
    true, 'Huber+Suhner RG_174/U data sheet (data to 1 GHz, 2.4 GHz extrapolated)', 0.66),
  C('rg178', 'RG178', 1.8, pts(200.0, 66.7, 400.0, 96.3, 600.0, 119.9, 800.0, 140.3, 1000.0, 158.7, 1400.0, 191.5, 2000.0, 234.6, 3000.0, 296.8),
    false, 'Huber+Suhner RG_178_B/U data sheet', 0.69),
  C('rg316', 'RG316', 2.5, pts(200.0, 36.5, 400.0, 52.8, 600.0, 65.7, 800.0, 76.9, 1000.0, 87.0, 1400.0, 105.0, 2000.0, 128.7, 3000.0, 163.0),
    false, 'Huber+Suhner RG_316/U data sheet', 0.69),
  C('rg58', 'RG58', 4.95, pts(50.0, 9.0, 100.0, 13.0, 200.0, 20.0, 300.0, 26.0, 400.0, 31.0, 500.0, 36.0, 700.0, 46.0, 1000.0, 58.0),
    true, 'Huber+Suhner RG_58_C/U data sheet (rounded to 0.01 dB/m, data to 1 GHz, 2.4 GHz extrapolated)', 0.66),
  C('rg59', 'RG59 (75 ohm)', 6.1, [ft(100.0, 3.4), ft(200.0, 4.9), ft(400.0, 7.0), ft(700.0, 9.7), ft(900.0, 11.1), ft(1000.0, 12.0)],
    true, 'Belden 8241 (RG-59/U type, 75 ohm) data sheet, per 100 ft converted (data to 1 GHz)', 0.66),
  C('rg8x', 'RG8X', 6.15, [ft(50.0, 2.1), ft(100.0, 3.1), ft(200.0, 4.5), ft(400.0, 6.6), ft(700.0, 9.1), ft(900.0, 10.7), ft(1000.0, 11.2)],
    true, 'Belden 9258 (RG-8X type) data sheet, per 100 ft converted (data to 1 GHz)', 0.82),
  C('rg213', 'RG213', 10.3, rg213Points(), true,
    'Huber+Suhner RG_213/U data sheet formula a*sqrt(f)+b*f (valid to 1 GHz, 2.4 GHz extrapolated)', 0.66),
  C('lmr100', 'LMR-100A', 2.79, pts(30.0, 12.9, 50.0, 16.7, 150.0, 29.4, 220.0, 35.8, 450.0, 51.9, 900.0, 74.9, 1500.0, 98.7, 1800.0, 109.0, 2000.0, 115.5, 2500.0, 130.6, 5800.0, 210.3),
    false, 'Times Microwave LMR-100A data sheet', 0.66),
  C('lmr195', 'LMR-195', 4.95, pts(30.0, 6.5, 50.0, 8.4, 150.0, 14.6, 220.0, 17.7, 450.0, 25.5, 900.0, 36.5, 1500.0, 47.7, 1800.0, 52.5, 2000.0, 55.4, 2500.0, 62.4, 5800.0, 98.1),
    false, 'Times Microwave LMR-195 data sheet', 0.80),
  C('lmr200', 'LMR-200', 4.95, pts(30.0, 5.8, 50.0, 7.5, 150.0, 13.1, 220.0, 15.9, 450.0, 22.8, 900.0, 32.6, 1500.0, 42.4, 1800.0, 46.6, 2000.0, 49.3, 2500.0, 55.4, 5800.0, 86.5, 8000.0, 102.8),
    false, 'Times Microwave LMR-200 data sheet', 0.83),
  C('lmr240', 'LMR-240', 6.10, pts(30.0, 4.4, 50.0, 5.7, 150.0, 9.9, 220.0, 12.0, 450.0, 17.3, 900.0, 24.8, 1500.0, 32.4, 1800.0, 35.6, 2000.0, 37.7, 2500.0, 42.4, 5800.0, 66.8, 8000.0, 79.7),
    false, 'Times Microwave LMR-240 data sheet', 0.83),
  C('lmr400', 'LMR-400', 10.29, pts(50.0, 2.95, 150.0, 4.92, 220.0, 6.23, 450.0, 8.86, 900.0, 12.8, 1500.0, 16.73, 1800.0, 18.7, 2000.0, 19.69, 2500.0, 22.31, 6000.0, 35.43),
    false, 'Times Microwave LMR-400 data sheet', 0.85),
  C('lmr600', 'LMR-600', 14.99, pts(30.0, 1.4, 50.0, 1.8, 150.0, 3.2, 220.0, 3.9, 450.0, 5.6, 900.0, 8.2, 1500.0, 10.9, 1800.0, 12.1, 2000.0, 12.8, 2500.0, 14.5, 5800.0, 23.8),
    false, 'Times Microwave LMR-600 data sheet', 0.87),
  C('h155', 'H155', 5.4, pts(50.0, 6.5, 100.0, 9.3, 230.0, 14.2, 300.0, 16.3, 400.0, 19.0, 470.0, 20.7, 860.0, 28.5, 1000.0, 30.9, 1350.0, 36.4, 1750.0, 41.9, 2050.0, 45.8),
    false, 'Belden H155 PE data sheet (data to 2.05 GHz)', 0.81),
  C('h1000', 'H1000', 10.3, pts(50.0, 3.0, 100.0, 4.3, 230.0, 6.8, 300.0, 7.7, 400.0, 9.1, 470.0, 10.0, 860.0, 14.1, 1000.0, 15.3, 1350.0, 18.3, 1750.0, 21.3, 2050.0, 23.4),
    false, 'Belden H1000 PE data sheet (data to 2.05 GHz)', 0.83),
  C('aircell5', 'Aircell 5', 5.0, pts(50.0, 6.61, 100.0, 9.40, 144.0, 11.33, 200.0, 13.41, 300.0, 16.53, 432.0, 19.99, 500.0, 21.57, 800.0, 27.62, 1000.0, 31.09, 1296.0, 35.71, 1500.0, 38.63, 1800.0, 42.63, 2000.0, 45.14, 2400.0, 49.87, 3000.0, 56.39, 4000.0, 66.19, 5000.0, 75.05, 10000.0, 112.0),
    false, 'SSB-Electronic Aircell 5 data sheet', 0.82),
  C('aircell7', 'Aircell 7', 7.3, pts(50.0, 4.52, 100.0, 6.28, 144.0, 7.6, 200.0, 9.04, 300.0, 11.2, 432.0, 13.6, 500.0, 14.72, 800.0, 19.0, 1000.0, 21.52, 1296.0, 24.84, 1500.0, 27.08, 1800.0, 30.0, 2000.0, 31.88, 2400.0, 35.6, 3000.0, 40.88, 4000.0, 49.12, 5000.0, 57.04, 6000.0, 64.9),
    false, 'SSB-Electronic Aircell 7 data sheet', 0.83),
  C('ecoflex10', 'Ecoflex 10', 10.2, pts(50.0, 2.8, 100.0, 4.0, 144.0, 4.9, 200.0, 5.8, 300.0, 7.3, 432.0, 8.9, 500.0, 9.6, 800.0, 12.5, 1000.0, 14.2, 1296.0, 16.5, 1500.0, 17.9, 1800.0, 19.9, 2000.0, 21.2, 2400.0, 23.6, 3000.0, 27.0, 4000.0, 32.2, 5000.0, 37.0, 6000.0, 41.5),
    false, 'SSB-Electronic Ecoflex 10 data sheet', 0.85),
  C('ecoflex15', 'Ecoflex 15', 14.6, pts(50.0, 1.96, 100.0, 2.81, 144.0, 3.4, 200.0, 4.05, 300.0, 5.0, 432.0, 6.1, 500.0, 6.7, 800.0, 8.6, 1000.0, 9.8, 1296.0, 11.4, 1500.0, 12.4, 1800.0, 13.8, 2000.0, 14.7, 2400.0, 16.3, 3000.0, 18.7, 4000.0, 22.3, 5000.0, 25.7, 6000.0, 28.8),
    false, 'SSB-Electronic Ecoflex 15 data sheet', 0.86),
  C('semirigid085', 'Semi-rigid .085', 2.2, [ft(1000.0, 22.0), ft(10000.0, 80.0), ft(20000.0, 120.0)],
    true, 'RG405 type .086 semi-rigid (Pasternack/Fairview data sheet), only 3 points: 1, 10, 20 GHz', 0.70),
  C('semirigid141', 'Semi-rigid .141', 3.58, [ft(1000.0, 12.0), ft(10000.0, 45.0), ft(20000.0, 70.0)],
    true, 'Fairview Microwave FM-SR141CU (RG402 type .141) data sheet, only 3 points: 1, 10, 20 GHz', 0.70),
  C('ldf4_50a', 'LDF4-50A 1/2" Heliax', 15.875, pts(50.0, 1.521, 100.0, 2.169, 500.0, 5.021, 1000.0, 7.284, 2000.0, 10.666, 5000.0, 18.01, 8800.0, 25.244),
    false, 'CommScope/Andrew HELIAX LDF4-50A product specification', 0.88),
]);

const K = (id, name, lossDb900, lossDb2400, approximate) => Object.freeze({ id, name, lossDb900, lossDb2400, approximate });

/** Złącza RF: typowa strata pary złączy przy 900 MHz i 2.4 GHz. */
export const CONNECTORS = Object.freeze([
  K('ufl', 'U.FL', 0.10, 0.20, true), K('mhf4', 'MHF4', 0.12, 0.25, true), K('mmcx', 'MMCX', 0.05, 0.10, true),
  K('sma', 'SMA', 0.03, 0.05, false), K('rpsma', 'RP-SMA', 0.03, 0.05, false), K('n', 'N', 0.03, 0.05, false),
  K('bnc', 'BNC', 0.05, 0.10, false), K('tnc', 'TNC', 0.04, 0.08, false), K('uhf', 'UHF (PL-259)', 0.10, 0.40, true),
  K('din716', '7/16 DIN', 0.02, 0.04, false), K('adapter', 'Adapter', 0.10, 0.20, true),
]);

export const cableById = (id) => CABLES.find((c) => c.id === id) || null;
export const connectorById = (id) => CONNECTORS.find((c) => c.id === id) || null;
