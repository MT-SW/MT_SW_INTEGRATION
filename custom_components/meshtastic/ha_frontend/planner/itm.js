// Model Longley-Rice / ITM (punkt-punkt, zmienność czas/lokalizacja/sytuacja).
// Port Itm.kt, który wywodzi się z NTIA/ITS ITM (domena publiczna, https://github.com/NTIA/itm).
// Oryginalne oprogramowanie dostarczane "as is" przez rząd USA, bez gwarancji.

export const ItmPolarization = Object.freeze({ HORIZONTAL: 0, VERTICAL: 1 });
export const ItmMode = Object.freeze({
  NOT_SET: 'NOT_SET',
  LINE_OF_SIGHT: 'LINE_OF_SIGHT',
  DIFFRACTION: 'DIFFRACTION',
  TROPOSCATTER: 'TROPOSCATTER',
});

const ERROR_TX_TERMINAL_HEIGHT = 1000;
const ERROR_RX_TERMINAL_HEIGHT = 1001;
const ERROR_INVALID_RADIO_CLIMATE = 1002;
const ERROR_INVALID_TIME = 1003;
const ERROR_INVALID_LOCATION = 1004;
const ERROR_INVALID_SITUATION = 1005;
const ERROR_REFRACTIVITY = 1008;
const ERROR_FREQUENCY = 1009;
const ERROR_POLARIZATION = 1010;
const ERROR_EPSILON = 1011;
const ERROR_SIGMA = 1012;
const ERROR_MDVAR = 1014;
const ERROR_EFFECTIVE_EARTH = 1016;
const ERROR_PATH_DISTANCE = 1017;
const ERROR_SURFACE_REFRACTIVITY_SMALL = 1021;
const ERROR_SURFACE_REFRACTIVITY_LARGE = 1022;
const ERROR_GROUND_IMPEDANCE = 1013;

const WARN_TX_TERMINAL_HEIGHT = 0x0001;
const WARN_RX_TERMINAL_HEIGHT = 0x0002;
const WARN_FREQUENCY = 0x0004;
const WARN_PATH_DISTANCE_TOO_BIG_1 = 0x0008;
const WARN_PATH_DISTANCE_TOO_BIG_2 = 0x0010;
const WARN_PATH_DISTANCE_TOO_SMALL_1 = 0x0020;
const WARN_PATH_DISTANCE_TOO_SMALL_2 = 0x0040;
const WARN_TX_HORIZON_ANGLE = 0x0080;
const WARN_RX_HORIZON_ANGLE = 0x0100;
const WARN_TX_HORIZON_DISTANCE_1 = 0x0200;
const WARN_RX_HORIZON_DISTANCE_1 = 0x0400;
const WARN_TX_HORIZON_DISTANCE_2 = 0x0800;
const WARN_RX_HORIZON_DISTANCE_2 = 0x1000;
const WARN_EXTREME_VARIABILITIES = 0x2000;
const WARN_SURFACE_REFRACTIVITY = 0x4000;

export const ITM_WARNINGS = Object.freeze({
  TX_TERMINAL_HEIGHT: WARN_TX_TERMINAL_HEIGHT, RX_TERMINAL_HEIGHT: WARN_RX_TERMINAL_HEIGHT,
  FREQUENCY: WARN_FREQUENCY, PATH_DISTANCE_TOO_BIG_1: WARN_PATH_DISTANCE_TOO_BIG_1,
  PATH_DISTANCE_TOO_BIG_2: WARN_PATH_DISTANCE_TOO_BIG_2, PATH_DISTANCE_TOO_SMALL_1: WARN_PATH_DISTANCE_TOO_SMALL_1,
  PATH_DISTANCE_TOO_SMALL_2: WARN_PATH_DISTANCE_TOO_SMALL_2, TX_HORIZON_ANGLE: WARN_TX_HORIZON_ANGLE,
  RX_HORIZON_ANGLE: WARN_RX_HORIZON_ANGLE, TX_HORIZON_DISTANCE_1: WARN_TX_HORIZON_DISTANCE_1,
  RX_HORIZON_DISTANCE_1: WARN_RX_HORIZON_DISTANCE_1, TX_HORIZON_DISTANCE_2: WARN_TX_HORIZON_DISTANCE_2,
  RX_HORIZON_DISTANCE_2: WARN_RX_HORIZON_DISTANCE_2, EXTREME_VARIABILITIES: WARN_EXTREME_VARIABILITIES,
  SURFACE_REFRACTIVITY: WARN_SURFACE_REFRACTIVITY,
});

const A_0_METER = 6370e3;
const A_9000_METER = 9000e3;
const THIRD = 1.0 / 3.0;
const SQRT2 = Math.sqrt(2.0);
const MODE_P2P = 0;

const { abs, sqrt, exp, log, log10, min, max, pow, sin, cos, hypot, PI } = Math;
const ln = log;

// ---- minimalna arytmetyka zespolona ----
const cx = (re, im) => ({ re, im });
const cMinus = (a, b) => cx(a.re - b.re, a.im - b.im);
const cPlus = (a, b) => cx(a.re + b.re, a.im + b.im);
const cScale = (a, s) => cx(a.re * s, a.im * s);
const cDiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const cAbs = (a) => hypot(a.re, a.im);
function cSqrt(a) {
  if (a.re === 0.0 && a.im === 0.0) return cx(0.0, a.im);
  const m = hypot(a.re, a.im);
  const r = sqrt((m + abs(a.re)) / 2.0);
  if (a.re >= 0.0) return cx(r, a.im / (2.0 * r));
  const im = a.im < 0.0 || (a.im === 0.0 && 1.0 / a.im < 0.0) ? -r : r;
  return cx(abs(a.im) / (2.0 * r), im);
}

const fdim = (x, y) => (x > y ? x - y : 0.0);
const dim = fdim;
const toInt = (x) => Math.trunc(x);

/**
 * Predykcja ITM punkt-punkt (odpowiednik ITM_P2P_TLS_Ex).
 * @param {ArrayLike<number>} elevationsM próbki terenu włącznie z końcami (n+1), równe odstępy stepM
 * @param {number} stepM
 * @param {number} txHeightM
 * @param {number} rxHeightM
 * @param {number} frequencyMHz
 * @param {Object} [o]  surfaceRefractivityNUnits=301, climate=5, polarization=VERTICAL(1), epsilon=15,
 *                      sigma=0.005, mdvar=12, timePct=50, locationPct=50, situationPct=50
 * @returns {{returnCode:number, lossDb:number, mode:string, warnings:number, freeSpaceLossDb:number,
 *   referenceAttenuationDb:number, terrainIrregularityM:number, effectiveHeightsM:number[],
 *   horizonDistancesM:number[], horizonAnglesRad:number[]}}
 */
export function itmPointToPoint(elevationsM, stepM, txHeightM, rxHeightM, frequencyMHz, o = {}) {
  const {
    surfaceRefractivityNUnits = 301.0, climate = 5, polarization = ItmPolarization.VERTICAL,
    epsilon = 15.0, sigma = 0.005, mdvar = 12, timePct = 50.0, locationPct = 50.0, situationPct = 50.0,
  } = o;
  const warn = { flags: 0 };
  const error = (code) => ({
    returnCode: code, lossDb: NaN, mode: ItmMode.NOT_SET, warnings: warn.flags, freeSpaceLossDb: NaN,
    referenceAttenuationDb: NaN, terrainIrregularityM: NaN, effectiveHeightsM: [NaN, NaN],
    horizonDistancesM: [NaN, NaN], horizonAnglesRad: [NaN, NaN],
  });

  let rtn = validateInputs(txHeightM, rxHeightM, climate, timePct, locationPct, situationPct,
    surfaceRefractivityNUnits, frequencyMHz, polarization, epsilon, sigma, mdvar, warn);
  if (rtn !== 0) return error(rtn);
  if (elevationsM.length < 2 || !(stepM > 0.0)) return error(ERROR_PATH_DISTANCE);

  const np = elevationsM.length - 1;
  const pfl = new Float64Array(np + 3);
  pfl[0] = np;
  pfl[1] = stepM;
  for (let i = 0; i <= np; i++) pfl[i + 2] = elevationsM[i];

  const p10 = toInt(0.1 * np);
  let hSys = 0.0;
  for (let i = p10; i <= np - p10; i++) hSys += pfl[i + 2];
  hSys /= np - 2 * p10 + 1;

  const gammaA = 157e-9;
  const nS = hSys === 0.0 ? surfaceRefractivityNUnits : surfaceRefractivityNUnits * exp(-hSys / 9460.0);
  const gammaE = gammaA * (1.0 - 0.04665 * exp(nS / 179.3));
  const epR = cx(epsilon, (18000 * sigma) / frequencyMHz);
  let zG = cSqrt(cMinus(epR, cx(1.0, 0.0)));
  if (polarization === ItmPolarization.VERTICAL) zG = cDiv(zG, epR);

  const h = [txHeightM, rxHeightM];
  const thetaHzn = [0, 0];
  const dHzn = [0, 0];
  const hE = [0, 0];
  const dh = [0];
  const dist = [0];
  quickPfl(pfl, gammaE, h, thetaHzn, dHzn, hE, dh, dist);
  const deltaH = dh[0];
  const d = dist[0];

  const aRef = [0];
  const propMode = [0];
  rtn = longleyRice(thetaHzn, frequencyMHz, zG, dHzn, hE, gammaE, nS, deltaH, h, d, MODE_P2P, aRef, warn, propMode);
  if (rtn !== 0) return error(rtn);

  const aFs = freeSpaceLoss(d, frequencyMHz);
  const loss = variability(timePct, locationPct, situationPct, hE, deltaH, frequencyMHz, d, aRef[0], climate, mdvar, warn) + aFs;

  const mode = propMode[0] === 1 ? ItmMode.LINE_OF_SIGHT : propMode[0] === 2 ? ItmMode.DIFFRACTION
    : propMode[0] === 3 ? ItmMode.TROPOSCATTER : ItmMode.NOT_SET;
  return {
    returnCode: warn.flags !== 0 ? 1 : 0, lossDb: loss, mode, warnings: warn.flags, freeSpaceLossDb: aFs,
    referenceAttenuationDb: aRef[0], terrainIrregularityM: deltaH,
    effectiveHeightsM: hE.slice(), horizonDistancesM: dHzn.slice(), horizonAnglesRad: thetaHzn.slice(),
  };
}

function validateInputs(hTx, hRx, climate, time, location, situation, n0, fMhz, pol, epsilon, sigma, mdvar, warn) {
  if (hTx < 1.0 || hTx > 1000.0) warn.flags |= WARN_TX_TERMINAL_HEIGHT;
  if (hTx < 0.5 || hTx > 3000.0) return ERROR_TX_TERMINAL_HEIGHT;
  if (hRx < 1.0 || hRx > 1000.0) warn.flags |= WARN_RX_TERMINAL_HEIGHT;
  if (hRx < 0.5 || hRx > 3000.0) return ERROR_RX_TERMINAL_HEIGHT;
  if (!(climate >= 1 && climate <= 7)) return ERROR_INVALID_RADIO_CLIMATE;
  if (n0 < 250 || n0 > 400) return ERROR_REFRACTIVITY;
  if (fMhz < 40.0 || fMhz > 10000.0) warn.flags |= WARN_FREQUENCY;
  if (fMhz < 20 || fMhz > 20000) return ERROR_FREQUENCY;
  if (pol !== 0 && pol !== 1) return ERROR_POLARIZATION;
  if (epsilon < 1) return ERROR_EPSILON;
  if (sigma <= 0) return ERROR_SIGMA;
  if (mdvar < 0 || (mdvar > 3 && mdvar < 10) || (mdvar > 13 && mdvar < 20) || (mdvar > 23 && mdvar < 30) || mdvar > 33) {
    return ERROR_MDVAR;
  }
  if (situation <= 0 || situation >= 100) return ERROR_INVALID_SITUATION;
  if (time <= 0 || time >= 100) return ERROR_INVALID_TIME;
  if (location <= 0 || location >= 100) return ERROR_INVALID_LOCATION;
  return 0;
}

function quickPfl(pfl, gammaE, h, thetaHzn, dHzn, hE, deltaHOut, dOut) {
  const d = pfl[0] * pfl[1];
  dOut[0] = d;
  const np = toInt(pfl[0]);
  const aE = 1 / gammaE;

  findHorizons(pfl, aE, h, thetaHzn, dHzn);

  const dStart = min(15.0 * h[0], 0.1 * dHzn[0]);
  const dEnd = d - min(15.0 * h[1], 0.1 * dHzn[1]);

  const deltaH = computeDeltaH(pfl, dStart, dEnd);
  deltaHOut[0] = deltaH;

  if (dHzn[0] + dHzn[1] > 1.5 * d) {
    const fit = [0, 0];
    linearLeastSquaresFit(pfl, dStart, dEnd, fit);
    const fitTx = fit[0];
    const fitRx = fit[1];

    hE[0] = h[0] + fdim(pfl[2], fitTx);
    hE[1] = h[1] + fdim(pfl[np + 2], fitRx);

    for (let i = 0; i <= 1; i++) {
      dHzn[i] = sqrt(2.0 * hE[i] * aE) * exp(-0.07 * sqrt(deltaH / max(hE[i], 5.0)));
    }

    const combined = dHzn[0] + dHzn[1];
    if (combined <= d) {
      const q = pow(d / combined, 2.0);
      for (let i = 0; i <= 1; i++) {
        hE[i] = hE[i] * q;
        dHzn[i] = sqrt(2.0 * hE[i] * aE) * exp(-0.07 * sqrt(deltaH / max(hE[i], 5.0)));
      }
    }

    for (let i = 0; i <= 1; i++) {
      const q = sqrt(2.0 * hE[i] * aE);
      thetaHzn[i] = (0.65 * deltaH * (q / dHzn[i] - 1.0) - 2.0 * hE[i]) / q;
    }
  } else {
    const fit = [0, 0];
    linearLeastSquaresFit(pfl, dStart, 0.9 * dHzn[0], fit);
    hE[0] = h[0] + fdim(pfl[2], fit[0]);

    linearLeastSquaresFit(pfl, d - 0.9 * dHzn[1], dEnd, fit);
    hE[1] = h[1] + fdim(pfl[np + 2], fit[1]);
  }
}

function computeDeltaH(pfl, dStart, dEnd) {
  const s = new Float64Array(247);
  const np = toInt(pfl[0]);
  let xStart = dStart / pfl[1];
  let xEnd = dEnd / pfl[1];

  if (xEnd - xStart < 2.0) return 0.0;

  let p10 = toInt(0.1 * (xEnd - xStart + 8.0));
  p10 = min(max(4, p10), 25);

  const n = 10 * p10 - 5;
  const p90 = n - p10;

  const npS = n - 1;
  s[0] = npS;
  s[1] = 1.0;

  xEnd = (xEnd - xStart) / npS;
  let i = toInt(xStart);
  xStart -= Math.fround(i + 1.0); // oryginał rzutuje na float

  for (let j = 0; j < n; j++) {
    while (xStart > 0.0 && i + 1 < np) {
      xStart--;
      i++;
    }
    s[j + 2] = pfl[i + 3] + (pfl[i + 3] - pfl[i + 2]) * xStart;
    xStart += xEnd;
  }

  const fit = [0, 0];
  linearLeastSquaresFit(s, 0.0, npS, fit);
  let fitY1 = fit[0];
  const fitY2 = (fit[1] - fit[0]) / npS;

  const diffs = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    diffs[j] = s[j + 2] - fitY1;
    fitY1 += fitY2;
  }
  diffs.sort(); // Float64Array.sort() jest numeryczne rosnąco
  const q10 = diffs[n - p10];
  const q90 = diffs[n - 1 - p90];

  const deltaHD = q10 - q90;
  return deltaHD / (1.0 - 0.8 * exp(-(dEnd - dStart) / 50e3));
}

function findHorizons(pfl, aE, h, thetaHzn, dHzn) {
  const np = toInt(pfl[0]);
  const xi = pfl[1];
  const d = pfl[0] * pfl[1];

  const zTx = pfl[2] + h[0];
  const zRx = pfl[np + 2] + h[1];

  thetaHzn[0] = (zRx - zTx) / d - d / (2 * aE);
  thetaHzn[1] = -(zRx - zTx) / d - d / (2 * aE);

  dHzn[0] = d;
  dHzn[1] = d;

  let dTx = 0.0;
  let dRx = d;

  for (let i = 1; i < np; i++) {
    dTx += xi;
    dRx -= xi;

    const thetaTx = (pfl[i + 2] - zTx) / dTx - dTx / (2 * aE);
    const thetaRx = -(zRx - pfl[i + 2]) / dRx - dRx / (2 * aE);

    if (thetaTx > thetaHzn[0]) {
      thetaHzn[0] = thetaTx;
      dHzn[0] = dTx;
    }
    if (thetaRx > thetaHzn[1]) {
      thetaHzn[1] = thetaRx;
      dHzn[1] = dRx;
    }
  }
}

function linearLeastSquaresFit(pfl, dStart, dEnd, out) {
  const np = toInt(pfl[0]);

  let iStart = toInt(fdim(dStart / pfl[1], 0.0));
  let iEnd = np - toInt(fdim(np, dEnd / pfl[1]));

  if (iEnd <= iStart) {
    iStart = toInt(fdim(iStart, 1.0));
    iEnd = np - toInt(fdim(np, iEnd + 1.0));
  }

  const xLength = iEnd - iStart;

  let midShiftedIndex = -0.5 * xLength;
  const midShiftedEnd = iEnd + midShiftedIndex;

  let sumY = 0.5 * (pfl[iStart + 2] + pfl[iEnd + 2]);
  let scaledSumY = 0.5 * (pfl[iStart + 2] - pfl[iEnd + 2]) * midShiftedIndex;

  let i = 2;
  while (i <= xLength) {
    iStart++;
    midShiftedIndex++;
    sumY += pfl[iStart + 2];
    scaledSumY += pfl[iStart + 2] * midShiftedIndex;
    i++;
  }

  sumY /= xLength;
  scaledSumY = (scaledSumY * 12.0) / ((xLength * xLength + 2.0) * xLength);

  out[0] = sumY - scaledSumY * midShiftedEnd;
  out[1] = sumY + scaledSumY * (np - midShiftedEnd);
}

function longleyRice(thetaHzn, fMhz, zG, dHzn, hE, gammaE, nS, deltaH, h, d, mode, aRefOut, warn, propMode) {
  const aE = 1 / gammaE;

  const dHznS = [sqrt(2.0 * hE[0] * aE), sqrt(2.0 * hE[1] * aE)];

  const dSML = dHznS[0] + dHznS[1];
  const dML = dHzn[0] + dHzn[1];
  const thetaLos = -max(thetaHzn[0] + thetaHzn[1], -dML / aE);

  if (abs(thetaHzn[0]) > 200e-3) warn.flags |= WARN_TX_HORIZON_ANGLE;
  if (abs(thetaHzn[1]) > 200e-3) warn.flags |= WARN_RX_HORIZON_ANGLE;

  if (dHzn[0] < 0.1 * dHznS[0]) warn.flags |= WARN_TX_HORIZON_DISTANCE_1;
  if (dHzn[1] < 0.1 * dHznS[1]) warn.flags |= WARN_RX_HORIZON_DISTANCE_1;

  if (dHzn[0] > 3.0 * dHznS[0]) warn.flags |= WARN_TX_HORIZON_DISTANCE_2;
  if (dHzn[1] > 3.0 * dHznS[1]) warn.flags |= WARN_RX_HORIZON_DISTANCE_2;

  if (nS < 150) return ERROR_SURFACE_REFRACTIVITY_SMALL;
  if (nS > 400) return ERROR_SURFACE_REFRACTIVITY_LARGE;
  if (nS < 250) warn.flags |= WARN_SURFACE_REFRACTIVITY;

  if (aE < 4000000 || aE > 13333333) return ERROR_EFFECTIVE_EARTH;

  if (zG.re <= abs(zG.im)) return ERROR_GROUND_IMPEDANCE;

  const cube = pow(pow(aE, 2.0) / fMhz, 1.0 / 3.0);
  const d3 = max(dSML, dML + 5.0 * cube);
  const d4 = d3 + 10.0 * cube;

  const a3 = diffractionLoss(d3, dHzn, hE, zG, aE, deltaH, h, mode, thetaLos, dSML, fMhz);
  const a4 = diffractionLoss(d4, dHzn, hE, zG, aE, deltaH, h, mode, thetaLos, dSML, fMhz);

  const mD = (a4 - a3) / (d4 - d3);
  const aD0 = a3 - mD * d3;

  const dMin = abs(hE[0] - hE[1]) / 200e-3;

  if (d < dMin) warn.flags |= WARN_PATH_DISTANCE_TOO_SMALL_1;
  if (d < 1e3) warn.flags |= WARN_PATH_DISTANCE_TOO_SMALL_2;
  if (d > 1000e3) warn.flags |= WARN_PATH_DISTANCE_TOO_BIG_1;
  if (d > 2000e3) warn.flags |= WARN_PATH_DISTANCE_TOO_BIG_2;

  let aRef;
  if (d < dSML) {
    const aSML = dSML * mD + aD0;

    let d0 = 0.04 * fMhz * hE[0] * hE[1];

    let d1;
    if (aD0 >= 0.0) {
      d0 = min(d0, 0.5 * dML);
      d1 = d0 + 0.25 * (dML - d0);
    } else {
      d1 = max(-aD0 / mD, 0.25 * dML);
    }

    const a1 = lineOfSightLoss(d1, hE, zG, deltaH, mD, aD0, dSML, fMhz);

    let flag = false;
    let k1 = 0.0;
    let k2 = 0.0;

    if (d0 < d1) {
      const a0 = lineOfSightLoss(d0, hE, zG, deltaH, mD, aD0, dSML, fMhz);
      const q = ln(dSML / d0);

      k2 = max(0.0, ((dSML - d0) * (a1 - a0) - (d1 - d0) * (aSML - a0)) / ((dSML - d0) * ln(d1 / d0) - (d1 - d0) * q));

      flag = aD0 > 0.0 || k2 > 0.0;

      if (flag) {
        k1 = (aSML - a0 - k2 * q) / (dSML - d0);
        if (k1 < 0.0) {
          k1 = 0.0;
          k2 = dim(aSML, a0) / q;
          if (k2 === 0.0) k1 = mD;
        }
      }
    }

    if (!flag) {
      k1 = dim(aSML, a1) / (dSML - d1);
      k2 = 0.0;
      if (k1 === 0.0) k1 = mD;
    }

    const aO = aSML - k1 * dSML - k2 * ln(dSML);
    aRef = aO + k1 * d + k2 * ln(d);
    propMode[0] = 1;
  } else {
    const d5 = dML + 200e3;
    const d6 = dML + 400e3;

    const h0 = [-1.0];
    const a6 = troposcatterLoss(d6, thetaHzn, dHzn, hE, aE, nS, fMhz, thetaLos, h0);
    const a5 = troposcatterLoss(d5, thetaHzn, dHzn, hE, aE, nS, fMhz, thetaLos, h0);

    let mS, aS0, dX;
    if (a5 < 1000.0) {
      mS = (a6 - a5) / 200e3;
      dX = max(max(dSML, dML + 1.088 * pow(pow(aE, 2.0) / fMhz, 1.0 / 3.0) * ln(fMhz)), (a5 - aD0 - mS * d5) / (mD - mS));
      aS0 = (mD - mS) * dX + aD0;
    } else {
      mS = mD;
      aS0 = aD0;
      dX = 10e6;
    }

    if (d > dX) {
      aRef = mS * d + aS0;
      propMode[0] = 3;
    } else {
      aRef = mD * d + aD0;
      propMode[0] = 2;
    }
  }

  aRef = max(aRef, 0.0);
  aRefOut[0] = aRef;
  return 0;
}

function diffractionLoss(d, dHzn, hE, zG, aE, deltaH, h, mode, thetaLos, dSML, fMhz) {
  const aK = knifeEdgeDiffraction(d, fMhz, aE, thetaLos, dHzn);
  const aSe = smoothEarthDiffraction(d, fMhz, aE, thetaLos, dHzn, hE, zG);

  const deltaHDsML = terrainRoughness(dSML, deltaH);
  const sigmaHD = sigmaH(deltaHDsML);
  const aFo = min(15.0, 5 * log10(1.0 + 1e-5 * h[0] * h[1] * fMhz * sigmaHD));

  const deltaHD = terrainRoughness(d, deltaH);

  let q = h[0] * h[1];
  const qk = hE[0] * hE[1] - q;

  if (mode === MODE_P2P) q += 10.0;

  const term1 = sqrt(1.0 + qk / q);

  const dML = dHzn[0] + dHzn[1];
  q = (term1 + (-thetaLos * aE + dML) / d) * min((deltaHD * fMhz) / 47.7, 6283.2);

  const w = 25.1 / (25.1 + sqrt(q));

  return w * aSe + (1.0 - w) * aK + aFo;
}

function smoothEarthDiffraction(d, fMhz, aE, thetaLos, dHzn, hE, zG) {
  const a = [0, 0, 0], dKm = [0, 0, 0], k = [0, 0, 0], b0 = [0, 0, 0], x = [0, 0, 0], c0 = [0, 0, 0];

  const thetaNlos = d / aE - thetaLos;
  const dML = dHzn[0] + dHzn[1];

  a[0] = (d - dML) / (d / aE - thetaLos);
  a[1] = (0.5 * pow(dHzn[0], 2.0)) / hE[0];
  a[2] = (0.5 * pow(dHzn[1], 2.0)) / hE[1];

  dKm[0] = (a[0] * thetaNlos) / 1000.0;
  dKm[1] = dHzn[0] / 1000.0;
  dKm[2] = dHzn[1] / 1000.0;

  for (let i = 0; i <= 2; i++) {
    c0[i] = pow(((4.0 / 3.0) * A_0_METER) / a[i], THIRD);
    k[i] = (0.017778 * c0[i] * pow(fMhz, -THIRD)) / cAbs(zG);
    b0[i] = 1.607 - k[i];
  }

  x[1] = b0[1] * pow(c0[1], 2.0) * pow(fMhz, THIRD) * dKm[1];
  x[2] = b0[2] * pow(c0[2], 2.0) * pow(fMhz, THIRD) * dKm[2];
  x[0] = b0[0] * pow(c0[0], 2.0) * pow(fMhz, THIRD) * dKm[0] + x[1] + x[2];

  const f0 = heightFunction(x[1], k[1]);
  const f1 = heightFunction(x[2], k[2]);

  const gX = 0.05751 * x[0] - 10.0 * log10(x[0]);

  return gX - f0 - f1 - 20;
}

function heightFunction(xKm, k) {
  let result;
  if (xKm < 200.0) {
    const w = -ln(k);
    if (k < 1e-5 || xKm * pow(w, 3.0) > 5495.0) {
      result = -117.0;
      if (xKm > 1.0) result = 17.372 * ln(xKm) + result;
    } else {
      result = (2.5e-5 * pow(xKm, 2.0)) / k - 8.686 * w - 15.0;
    }
  } else {
    result = 0.05751 * xKm - 4.343 * ln(xKm);
    if (xKm < 2000) {
      const w = 0.0134 * xKm * exp(-0.005 * xKm);
      result = (1.0 - w) * result + w * (17.372 * ln(xKm) - 117.0);
    }
  }
  return result;
}

function knifeEdgeDiffraction(d, fMhz, aE, thetaLos, dHzn) {
  const dML = dHzn[0] + dHzn[1];
  const thetaNlos = d / aE - thetaLos;
  const dNlos = d - dML;

  const v1 = (0.0795775 * (fMhz / 47.7) * pow(thetaNlos, 2.0) * dHzn[0] * dNlos) / (dNlos + dHzn[0]);
  const v2 = (0.0795775 * (fMhz / 47.7) * pow(thetaNlos, 2.0) * dHzn[1] * dNlos) / (dNlos + dHzn[1]);

  return fresnelIntegral(v1) + fresnelIntegral(v2);
}

const fresnelIntegral = (v2) => (v2 < 5.76 ? 6.02 + 9.11 * sqrt(v2) - 1.27 * v2 : 12.953 + 10 * log10(v2));

function lineOfSightLoss(d, hE, zG, deltaH, mD, aD0, dSML, fMhz) {
  const deltaHD = terrainRoughness(d, deltaH);
  const sigmaHD = sigmaH(deltaHD);

  const wn = fMhz / 47.7;

  const sinPsi = (hE[0] + hE[1]) / sqrt(pow(d, 2.0) + pow(hE[0] + hE[1], 2.0));

  const sp = cx(sinPsi, 0.0);
  let rE = cScale(cDiv(cMinus(sp, zG), cPlus(sp, zG)), exp(-min(10.0, wn * sigmaHD * sinPsi)));

  const q = pow(rE.re, 2.0) + pow(rE.im, 2.0);
  if (q < 0.25 || q < sinPsi) rE = cScale(rE, sqrt(sinPsi / q));

  let deltaPhi = (wn * 2.0 * hE[0] * hE[1]) / d;

  if (deltaPhi > PI / 2.0) deltaPhi = PI - pow(PI / 2.0, 2.0) / deltaPhi;

  const rr = cPlus(cx(cos(deltaPhi), -sin(deltaPhi)), rE);
  const aT = -10 * log10(pow(rr.re, 2.0) + pow(rr.im, 2.0));

  const aD = mD * d + aD0;

  const w = 1 / (1 + (fMhz * deltaH) / max(10e3, dSML));

  return w * aT + (1 - w) * aD;
}

function fFunction(td) {
  const a = [133.4, 104.6, 71.8];
  const b = [0.332e-3, 0.212e-3, 0.157e-3];
  const c = [-10.0, -2.5, 5.0];
  const i = td <= 10e3 ? 0 : td <= 70e3 ? 1 : 2;
  return a[i] + b[i] * td + c[i] * log10(td);
}

function troposcatterLoss(d, thetaHzn, dHzn, hE, aE, nS, fMhz, thetaLos, h0) {
  let hZero;
  const wn = fMhz / 47.7;

  if (h0[0] > 15.0) {
    hZero = h0[0];
  } else {
    let ad = dHzn[0] - dHzn[1];
    let rr = hE[1] / hE[0];

    if (ad < 0.0) {
      ad = -ad;
      rr = 1.0 / rr;
    }

    const theta = thetaHzn[0] + thetaHzn[1] + d / aE;

    const r1 = 2.0 * wn * theta * hE[0];
    const r2 = 2.0 * wn * theta * hE[1];

    if (r1 < 0.2 && r2 < 0.2) return 1001.0;

    let s = (d - ad) / (d + ad);

    const q = min(max(0.1, rr / s), 10.0);
    s = max(0.1, s);

    const h0Meter = ((d - ad) * (d + ad) * theta * 0.25) / d;

    const z0 = 1.7556e3;
    const z1 = 8.0e3;
    const etaS = (h0Meter / z0) * (1.0 + (0.031 - nS * 2.32e-3 + pow(nS, 2.0) * 5.67e-6) * exp(-pow(min(1.7, h0Meter / z1), 6.0)));

    const hH00 = (h0Function(r1, etaS) + h0Function(r2, etaS)) / 2;
    const deltaH0 = min(hH00, 6.0 * (0.6 - log10(max(etaS, 1.0))) * log10(s) * log10(q));

    hZero = hH00 + deltaH0;
    hZero = max(hZero, 0.0);

    if (etaS < 1.0) {
      hZero = etaS * hZero + (1.0 - etaS) * 10 * log10((pow((1.0 + SQRT2 / r1) * (1.0 + SQRT2 / r2), 2.0) * (r1 + r2)) / (r1 + r2 + 2 * SQRT2));
    }

    if (hZero > 15.0 && h0[0] >= 0.0) hZero = h0[0];
  }

  h0[0] = hZero;
  const th = d / aE - thetaLos;

  const d0 = 40e3;
  const hMeter = 47.7;
  return fFunction(th * d) + 10 * log10(wn * hMeter * pow(th, 4.0)) - 0.1 * (nS - 301.0) * exp((-th * d) / d0) + hZero;
}

function h0Curve(j, r) {
  const a = [25.0, 80.0, 177.0, 395.0, 705.0];
  const b = [24.0, 45.0, 68.0, 80.0, 105.0];
  return 10 * log10(1 + a[j] * pow(1 / r, 4.0) + b[j] * pow(1.0 / r, 2.0));
}

function h0Function(r, etaIn) {
  const eta = min(max(etaIn, 1.0), 5.0);
  const i = toInt(eta);
  const q = eta - i;
  let result = h0Curve(i - 1, r);
  if (q !== 0.0) result = (1.0 - q) * result + q * h0Curve(i, r);
  return result;
}

const sigmaH = (deltaH) => 0.78 * deltaH * exp(-0.5 * pow(deltaH, 0.25));
const terrainRoughness = (d, deltaH) => deltaH * (1.0 - 0.8 * exp(-d / 50e3));
const freeSpaceLoss = (d, fMhz) => 32.45 + 20.0 * log10(fMhz) + 20.0 * log10(d / 1000.0);

function inverseCcdf(q) {
  const c0 = 2.515516, c1 = 0.802853, c2 = 0.010328, d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  let x = q;
  if (q > 0.5) x = 1.0 - x;
  const t = sqrt(-2.0 * ln(x));
  const zeta = ((c2 * t + c1) * t + c0) / (((d3 * t + d2) * t + d1) * t + 1.0);
  let res = t - zeta;
  if (q > 0.5) res = -res;
  return res;
}

const allYear = [
  [-9.67, -0.62, 1.26, -9.21, -0.62, -0.39, 3.15],
  [12.7, 9.19, 15.5, 9.05, 9.19, 2.86, 857.9],
  [144.9e3, 228.9e3, 262.6e3, 84.1e3, 228.9e3, 141.7e3, 2222.0e3],
  [190.3e3, 205.2e3, 185.2e3, 101.1e3, 205.2e3, 315.9e3, 164.8e3],
  [133.8e3, 143.6e3, 99.8e3, 98.6e3, 143.6e3, 167.4e3, 116.3e3],
];
const bsm1 = [2.13, 2.66, 6.11, 1.98, 2.68, 6.86, 8.51];
const bsm2 = [159.5, 7.67, 6.65, 13.11, 7.16, 10.38, 169.8];
const xsm1 = [762.2e3, 100.4e3, 138.2e3, 139.1e3, 93.7e3, 187.8e3, 609.8e3];
const xsm2 = [123.6e3, 172.5e3, 242.2e3, 132.7e3, 186.8e3, 169.6e3, 119.9e3];
const xsm3 = [94.5e3, 136.4e3, 178.6e3, 193.5e3, 133.5e3, 108.9e3, 106.6e3];
const bsp1 = [2.11, 6.87, 10.08, 3.68, 4.75, 8.58, 8.43];
const bsp2 = [102.3, 15.53, 9.60, 159.3, 8.12, 13.97, 8.19];
const xsp1 = [636.9e3, 138.7e3, 165.3e3, 464.4e3, 93.2e3, 216.0e3, 136.2e3];
const xsp2 = [134.8e3, 143.7e3, 225.7e3, 93.1e3, 135.9e3, 152.0e3, 188.5e3];
const xsp3 = [95.6e3, 98.6e3, 129.7e3, 94.2e3, 113.4e3, 122.7e3, 122.9e3];
const cD = [1.224, 0.801, 1.380, 1.000, 1.224, 1.518, 1.518];
const zD = [1.282, 2.161, 1.282, 20.0, 1.282, 1.282, 1.282];
const bfm1 = [1.0, 1.0, 1.0, 1.0, 0.92, 1.0, 1.0];
const bfm2 = [0.0, 0.0, 0.0, 0.0, 0.25, 0.0, 0.0];
const bfm3 = [0.0, 0.0, 0.0, 0.0, 1.77, 0.0, 0.0];
const bfp1 = [1.0, 0.93, 1.0, 0.93, 0.93, 1.0, 1.0];
const bfp2 = [0.0, 0.31, 0.0, 0.19, 0.31, 0.0, 0.0];
const bfp3 = [0.0, 2.00, 0.0, 1.79, 2.00, 0.0, 0.0];

const curve = (c1, c2, x1, x2, x3, de) =>
  ((c1 + c2 / (1.0 + pow((de - x2) / x3, 2.0))) * pow(de / x1, 2.0)) / (1.0 + pow(de / x1, 2.0));

function variability(time, location, situation, hE, deltaH, fMhz, d, aRef, climate, mdvar, warn) {
  let zT = inverseCcdf(time / 100);
  let zL = inverseCcdf(location / 100);
  const zS = inverseCcdf(situation / 100);

  const ci = climate - 1;
  const wn = fMhz / 47.7;

  const dEx = sqrt(2 * A_9000_METER * hE[0]) + sqrt(2 * A_9000_METER * hE[1]) + pow(575.7e12 / wn, THIRD);
  const dE = d < dEx ? (130e3 * d) / dEx : 130e3 + d - dEx;

  let mv = mdvar;
  const plus20 = mv >= 20;
  if (plus20) mv -= 20;

  const sigmaS = plus20 ? 0.0 : 5.0 + 3.0 * exp(-dE / 100e3);

  const plus10 = mv >= 10;
  if (plus10) mv -= 10;

  const vMed = curve(allYear[0][ci], allYear[1][ci], allYear[2][ci], allYear[3][ci], allYear[4][ci], dE);

  if (mv === 0) { zT = zS; zL = zS; }
  else if (mv === 1) zL = zS;
  else if (mv === 2) zL = zT;

  if (abs(zT) > 3.10 || abs(zL) > 3.10 || abs(zS) > 3.10) warn.flags |= WARN_EXTREME_VARIABILITIES;

  let sigmaL;
  if (plus10) sigmaL = 0.0;
  else {
    const deltaHD = terrainRoughness(d, deltaH);
    sigmaL = (10.0 * wn * deltaHD) / (wn * deltaHD + 13.0);
  }
  const yL = sigmaL * zL;

  const q = ln(0.133 * wn);
  const gMinus = bfm1[ci] + bfm2[ci] / (pow(bfm3[ci] * q, 2.0) + 1.0);
  const gPlus = bfp1[ci] + bfp2[ci] / (pow(bfp3[ci] * q, 2.0) + 1.0);

  const sigmaTMinus = curve(bsm1[ci], bsm2[ci], xsm1[ci], xsm2[ci], xsm3[ci], dE) * gMinus;
  const sigmaTPlus = curve(bsp1[ci], bsp2[ci], xsp1[ci], xsp2[ci], xsp3[ci], dE) * gPlus;

  const sigmaTD = cD[ci] * sigmaTPlus;
  const tgtd = (sigmaTPlus - sigmaTD) * zD[ci];

  const sigmaT = zT < 0.0 ? sigmaTMinus : zT <= zD[ci] ? sigmaTPlus : sigmaTD + tgtd / zT;
  const yT = sigmaT * zT;

  const ySTemp = pow(sigmaS, 2.0) + pow(yT, 2.0) / (7.8 + pow(zS, 2.0)) + pow(yL, 2.0) / (24.0 + pow(zS, 2.0));

  let yR, yS;
  if (mv === 0) {
    yR = 0.0;
    yS = sqrt(pow(sigmaT, 2.0) + pow(sigmaL, 2.0) + ySTemp) * zS;
  } else if (mv === 1) {
    yR = yT;
    yS = sqrt(pow(sigmaL, 2.0) + ySTemp) * zS;
  } else if (mv === 2) {
    yR = sqrt(pow(sigmaT, 2.0) + pow(sigmaL, 2.0)) * zT;
    yS = sqrt(ySTemp) * zS;
  } else {
    yR = yT + yL;
    yS = sqrt(ySTemp) * zS;
  }

  let result = aRef - vMed - yR - yS;
  if (result < 0.0) result = (result * (29.0 - result)) / (29.0 - 10.0 * result);
  return result;
}
