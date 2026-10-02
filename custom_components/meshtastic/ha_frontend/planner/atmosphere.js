// Radiometeorologia (ITU-R P.453, P.676, P.838) — port Atmosphere.kt.

const EARTH_RADIUS_KM = 6371.0;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const DuctingLevel = Object.freeze({ NORMAL: 'NORMAL', ELEVATED: 'ELEVATED', POSSIBLE_DUCT: 'POSSIBLE_DUCT' });

/** Współczynnik refrakcji radiowej N (jednostki N), ITU-R P.453. */
export function refractivityN(tempC, pressureHpa, relHumidityPct) {
  const t = tempC + 273.15;
  const e = vapourPressureHpa(tempC, relHumidityPct);
  return (77.6 / t) * (pressureHpa + (4810.0 * e) / t);
}

/** Ciśnienie cząstkowe pary wodnej (hPa) z wilgotności względnej (Magnus). */
export function vapourPressureHpa(tempC, rhPct) {
  const es = 6.1121 * Math.exp(((18.678 - tempC / 234.5) * tempC) / (257.14 + tempC));
  return (clamp(rhPct, 0.0, 100.0) / 100.0) * es;
}

/** Gradient (N/km) między dwoma poziomami. */
export function gradientNPerKm(n1, h1M, n2, h2M) {
  const dh = (h2M - h1M) / 1000.0;
  if (dh === 0.0) return 0.0;
  return (n2 - n1) / dh;
}

/** Współczynnik efektywnego promienia Ziemi k = 1/(1+R*dN/dh*1e-6), zakres 0.5..20. */
export function kFactorFromGradient(dnDhPerKm) {
  const denom = 1.0 + EARTH_RADIUS_KM * dnDhPerKm * 1e-6;
  if (denom <= 0.05) return 20.0;
  return clamp(1.0 / denom, 0.5, 20.0);
}

/** Redukcja N stacji do poziomu morza i obcięcie do 250..400 (zakres ITM). */
export function surfaceRefractivityForItm(stationN, stationHeightM = 0.0) {
  return clamp(stationN * Math.exp(stationHeightM / 1000.0 / 7.35), 250.0, 400.0);
}

/** Klasyfikacja ducting wg gradientu dN/dh (N/km). */
export function classifyDucting(dnDhPerKm) {
  if (dnDhPerKm < -157.0) return DuctingLevel.POSSIBLE_DUCT;
  if (dnDhPerKm < -79.0) return DuctingLevel.ELEVATED;
  return DuctingLevel.NORMAL;
}

/**
 * Analiza profilu pionowego. samples: [{heightM,tempC,pressureHpa,rhPct}].
 * @returns {{surfaceN:number, seaLevelN:number, gradientNPerKm:number, kFactor:number, level:string}}
 */
export function analyzeProfile(samples) {
  if (!samples || samples.length === 0) {
    return { surfaceN: 315.0, seaLevelN: 315.0, gradientNPerKm: -39.2, kFactor: kFactorFromGradient(-39.2), level: DuctingLevel.NORMAL };
  }
  let low = samples[0];
  for (const s of samples) if (s.heightM < low.heightM) low = s;
  const n1 = refractivityN(low.tempC, low.pressureHpa, low.rhPct);
  const sea = surfaceRefractivityForItm(n1, low.heightM);
  const upper = samples.filter((s) => s.heightM - low.heightM >= 100.0);
  let grad;
  if (upper.length === 0) grad = -39.2;
  else {
    let hi = upper[0];
    let best = Math.abs(hi.heightM - low.heightM - 1000.0);
    for (const s of upper) {
      const v = Math.abs(s.heightM - low.heightM - 1000.0);
      if (v < best) { best = v; hi = s; }
    }
    grad = gradientNPerKm(n1, low.heightM, refractivityN(hi.tempC, hi.pressureHpa, hi.rhPct), hi.heightM);
  }
  return { surfaceN: n1, seaLevelN: sea, gradientNPerKm: grad, kFactor: kFactorFromGradient(grad), level: classifyDucting(grad) };
}

const phi = (rp, rt, a, b, c, d) => Math.pow(rp, a) * Math.pow(rt, b) * Math.exp(c * (1 - rp) + d * (1 - rt));

const oxyF = [54.0, 56.0, 58.0, 60.0, 62.0, 64.0, 66.0, 68.0, 70.0, 80.0, 100.0];
const oxyA = [4.5, 13.0, 15.5, 15.0, 14.0, 9.0, 2.7, 1.1, 0.5, 0.1, 0.1];

/** Tłumienie gazowe (tlen + para wodna) w dB/km; 0 poniżej 1 GHz. */
export function gasAttenuationDbPerKm(fMHz, tempC, pressureHpa, rhPct) {
  if (fMHz < 1000.0) return 0.0;
  const f = Math.min(fMHz / 1000.0, 100.0);
  const rp = pressureHpa / 1013.0;
  const rt = 288.0 / (273.0 + tempC);
  const e = vapourPressureHpa(tempC, rhPct);
  const rho = (216.7 * e) / (273.15 + tempC);

  let oxygen;
  if (f <= 54.0) {
    const x1 = phi(rp, rt, 0.0717, -1.8132, 0.0156, -1.6515);
    const x2 = phi(rp, rt, 0.5146, -4.6368, -0.1921, -5.7416);
    const x3 = phi(rp, rt, 0.3414, -6.5851, 0.2130, -8.5854);
    oxygen = ((7.2 * Math.pow(rt, 2.8)) / (f * f + 0.34 * rp * rp * Math.pow(rt, 1.6)) +
      (0.62 * x3) / (Math.pow(54.0 - f, 1.16 * x1) + 0.83 * x2)) * f * f * rp * rp * 1e-3;
  } else {
    let i = 0;
    while (i < oxyF.length - 2 && f > oxyF[i + 1]) i++;
    const t = clamp((f - oxyF[i]) / (oxyF[i + 1] - oxyF[i]), 0.0, 1.0);
    oxygen = (oxyA[i] + t * (oxyA[i + 1] - oxyA[i])) * rp * rp;
  }

  const eta1 = 0.955 * rp * Math.pow(rt, 0.68) + 0.006 * rho;
  const q = (f - 22.0) / (f + 22.0);
  const g22 = 1.0 + q * q;
  const wTerms =
    ((3.98 * eta1 * Math.exp(2.23 * (1 - rt))) / (Math.pow(f - 22.235, 2) + 9.42 * eta1 * eta1)) * g22 +
    (11.96 * eta1 * Math.exp(0.7 * (1 - rt))) / (Math.pow(f - 183.31, 2) + 11.14 * eta1 * eta1) +
    (0.081 * eta1 * Math.exp(6.44 * (1 - rt))) / (Math.pow(f - 321.226, 2) + 6.29 * eta1 * eta1);
  const water = wTerms * f * f * Math.pow(rt, 2.5) * rho * 1e-4;
  return Math.max(0.0, oxygen) + Math.max(0.0, water);
}

const rainF = [1.0, 2.0, 4.0, 6.0, 7.0, 8.0, 10.0, 12.0, 15.0, 20.0, 25.0, 30.0, 40.0, 50.0];
const kH = [0.0000259, 0.0000847, 0.0001071, 0.0007056, 0.001915, 0.004115, 0.01217, 0.02386, 0.04481, 0.09164, 0.1571, 0.2403, 0.4431, 0.5911];
const aH = [0.9691, 1.0664, 1.6009, 1.5900, 1.4810, 1.3905, 1.2571, 1.1825, 1.1233, 1.0568, 0.9991, 0.9485, 0.8673, 0.8355];
const kV = [0.0000308, 0.0000998, 0.0002461, 0.0004878, 0.001425, 0.003450, 0.01129, 0.02455, 0.05008, 0.09611, 0.1533, 0.2291, 0.4274, 0.5796];
const aV = [0.8592, 0.9490, 1.2476, 1.5728, 1.4745, 1.3797, 1.2156, 1.1216, 1.0440, 0.9847, 0.9491, 0.9129, 0.8421, 0.8130];

/** Tłumienie deszczu dB/km (ITU-R P.838) dla natężenia rainRateMmH; domyślnie polaryzacja pionowa. */
export function rainAttenuationDbPerKm(fMHz, rainRateMmH, vertical = true) {
  if (fMHz < 1000.0 || rainRateMmH <= 0.0) return 0.0;
  const f = clamp(fMHz / 1000.0, rainF[0], rainF[rainF.length - 1]);
  let i = 0;
  while (i < rainF.length - 2 && f > rainF[i + 1]) i++;
  const t = (Math.log(f) - Math.log(rainF[i])) / (Math.log(rainF[i + 1]) - Math.log(rainF[i]));
  const ks = vertical ? kV : kH;
  const al = vertical ? aV : aH;
  const k = Math.exp(Math.log(ks[i]) + t * (Math.log(ks[i + 1]) - Math.log(ks[i])));
  const a = al[i] + t * (al[i + 1] - al[i]);
  return k * Math.pow(rainRateMmH, a);
}
