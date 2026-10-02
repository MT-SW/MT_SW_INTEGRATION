// Bilans łącza — port LinkBudget.kt.
import { bearingDeg, elevationAngleDeg } from './geodesy.js';
import { itmPointToPoint } from './itm.js';
import { distanceAt, losHeightM, bulgeM, fresnelRadiusM } from './profile.js';
import { sensitivityDbm } from './sensitivity.js';

export const LinkVerdict = Object.freeze({ EXCELLENT: 'EXCELLENT', GOOD: 'GOOD', MARGINAL: 'MARGINAL', WEAK: 'WEAK', NO_LINK: 'NO_LINK' });

/** Margines >=20 dB EXCELLENT, >=10 GOOD, >=3 MARGINAL, >=0 WEAK, inaczej NO_LINK. */
export function verdictFromMargin(marginDb) {
  if (Number.isNaN(marginDb)) return LinkVerdict.NO_LINK;
  if (marginDb >= 20.0) return LinkVerdict.EXCELLENT;
  if (marginDb >= 10.0) return LinkVerdict.GOOD;
  if (marginDb >= 3.0) return LinkVerdict.MARGINAL;
  if (marginDb >= 0.0) return LinkVerdict.WEAK;
  return LinkVerdict.NO_LINK;
}

/** Strata zwracana, gdy ITM zwróci błąd. */
export const ITM_ERROR_LOSS_DB = 999.0;

/** Strata w wolnej przestrzeni (dB), distance w metrach, f w MHz. */
export function freeSpaceLossDb(distanceM, fMHz) {
  if (distanceM <= 0.0) return 0.0;
  return 32.44 + 20.0 * Math.log10(distanceM / 1000.0) + 20.0 * Math.log10(fMHz);
}

/**
 * Domyślne parametry LinkInput (uzupełniane przez analyzeLink).
 * LinkEnd: {point:{lat,lon}, groundAltM, antennaHeightM, txPowerDbm, antennaGainDbi, feederLossDb}
 */
export const LINK_INPUT_DEFAULTS = Object.freeze({
  noiseFigureDb: 6.0, kFactor: 4.0 / 3.0, surfaceRefractivity: 301.0, extraLossDb: 0.0,
  timePct: 50.0, locationPct: 50.0, situationPct: 50.0, fadeMarginDb: 0.0,
});

/**
 * Analiza łącza na profilu terenu. Wysokości anten liczone nad terenem z profilu (groundAltM tylko informacyjnie).
 * @returns LinkResult {distanceM, bearingAToBDeg, bearingBToADeg, elevationAAngleDeg, elevationBAngleDeg,
 *  freeSpaceLossDb, itmLossDb, totalPathLossDb, sensitivityDbm, aToB:{rxPowerDbm,marginDb,verdict}, bToA,
 *  itmMode, itmWarnings, lineOfSightClear, worstFresnelClearanceM, worstFresnelRatio, profile}
 */
export function analyzeLink(inputIn, profile) {
  const input = { ...LINK_INPUT_DEFAULTS, ...inputIn };
  const a = input.a;
  const b = input.b;
  const dist = profile.distanceM;
  const fsl = freeSpaceLossDb(dist, input.frequencyMHz);

  const itm = itmPointToPoint(profile.groundM, profile.stepM, a.antennaHeightM, b.antennaHeightM, input.frequencyMHz, {
    surfaceRefractivityNUnits: input.surfaceRefractivity,
    timePct: input.timePct, locationPct: input.locationPct, situationPct: input.situationPct,
  });
  const itmOk = itm.returnCode <= 1 && !Number.isNaN(itm.lossDb);
  const itmLoss = itmOk ? itm.lossDb : ITM_ERROR_LOSS_DB;
  const total = itmLoss + input.extraLossDb;
  const sens = sensitivityDbm(input.bandwidthKhz, input.spreadingFactor, input.noiseFigureDb);

  const dir = (tx, rx) => {
    const rxP = tx.txPowerDbm + tx.antennaGainDbi - tx.feederLossDb - total + rx.antennaGainDbi - rx.feederLossDb;
    const margin = rxP - sens - input.fadeMarginDb;
    return { rxPowerDbm: rxP, marginDb: margin, verdict: itmOk ? verdictFromMargin(margin) : LinkVerdict.NO_LINK };
  };

  const g = profile.groundM;
  const n = profile.intervals;
  const zA = g[0] + a.antennaHeightM;
  const zB = g[n] + b.antennaHeightM;
  let worstClear = Math.min(a.antennaHeightM, b.antennaHeightM);
  let worstRatio = 99.0;
  let minClear = Number.MAX_VALUE;
  for (let i = 1; i < n; i++) {
    const d1 = distanceAt(profile, i);
    const d2 = dist - d1;
    const los = losHeightM(profile, i, zA, zB);
    const clear = los - (g[i] + bulgeM(profile, i, input.kFactor));
    const r1 = fresnelRadiusM(1, d1, d2, input.frequencyMHz);
    const ratio = r1 > 0 ? clear / r1 : 99.0;
    if (clear < minClear) minClear = clear;
    if (ratio < worstRatio) { worstRatio = ratio; worstClear = clear; }
  }
  const clearLos = n < 2 || minClear > 0.0;

  return {
    distanceM: dist,
    bearingAToBDeg: bearingDeg(a.point, b.point),
    bearingBToADeg: bearingDeg(b.point, a.point),
    elevationAAngleDeg: elevationAngleDeg(zA, zB, dist, input.kFactor),
    elevationBAngleDeg: elevationAngleDeg(zB, zA, dist, input.kFactor),
    freeSpaceLossDb: fsl,
    itmLossDb: itmLoss,
    totalPathLossDb: total,
    sensitivityDbm: sens,
    aToB: dir(a, b),
    bToA: dir(b, a),
    itmMode: itm.mode,
    itmWarnings: itm.warnings,
    lineOfSightClear: clearLos,
    worstFresnelClearanceM: worstClear,
    worstFresnelRatio: worstRatio,
    profile,
  };
}

/** Serie do wykresu profilu: teren z wybrzuszeniem Ziemi, LOS i pierwsza strefa Fresnela. */
export function profileSeries(input, profile) {
  const inp = { ...LINK_INPUT_DEFAULTS, ...input };
  const n = profile.intervals;
  const g = profile.groundM;
  const zA = g[0] + inp.a.antennaHeightM;
  const zB = g[n] + inp.b.antennaHeightM;
  const dist = profile.distanceM;
  const ground = new Float64Array(n + 1);
  const los = new Float64Array(n + 1);
  const up = new Float64Array(n + 1);
  const lo = new Float64Array(n + 1);
  const d = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    d[i] = distanceAt(profile, i);
    ground[i] = g[i] + bulgeM(profile, i, inp.kFactor);
    los[i] = losHeightM(profile, i, zA, zB);
    const r = fresnelRadiusM(1, d[i], dist - d[i], inp.frequencyMHz);
    up[i] = los[i] + r;
    lo[i] = los[i] - r;
  }
  return { distancesM: d, groundM: ground, losM: los, fresnelUpperM: up, fresnelLowerM: lo };
}
