/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Kalkulator anten — wymiary 13 typów anten, zysk, impedancja, straty
 * w kablu i złączach oraz moc wypromieniowana na tle limitów pasm.
 * Matematyka jak w aplikacji MT_SW_APP (AntennaMath); wzory: Stutzman & Thiele,
 * Rothammel / DL6WU (Yagi), Hammerstad (mikropasek).
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { getPlannerSession } from "./planner/planner-ui.js";

const C = 299792458.0;
const OUR_MHZ = 869.44165;
const DIPOLE_GAIN = 2.15;

const TYPES = [
  "GROUND_PLANE", "DIPOLE", "FOLDED_DIPOLE", "FIVE_EIGHTHS", "J_POLE", "SLIM_JIM", "COLLINEAR",
  "YAGI", "MOXON", "BIQUAD", "HELIX", "PATCH", "COAX_STUB",
];

const INSULATION = { NONE: 1.0, THIN: 0.97, THICK: 0.95 };

/* nazwa, współczynnik prędkości, f1 [MHz], tłumienie1 [dB/100 m], f2, tłumienie2 */
const CABLES = {
  RG174: ["RG-174", 0.66, 432, 60, 1296, 110],
  RG316: ["RG-316", 0.695, 400, 54.8, 1000, 101.7],
  RG58: ["RG-58", 0.66, 432, 40, 1296, 90],
  RG8X: ["RG-8X (Mini-8)", 0.82, 400, 25.9, 1000, 42.7],
  RG213: ["RG-213", 0.66, 432, 15, 1296, 26],
  H155: ["H-155", 0.79, 432, 19.8, 1296, 34.9],
  AIRCELL7: ["Aircell 7", 0.83, 432, 14.1, 1296, 26.1],
  ECOFLEX10: ["Ecoflex 10", 0.86, 432, 8.9, 1296, 16.5],
  ECOFLEX15: ["Ecoflex 15", 0.86, 432, 6.1, 1296, 11.4],
  H2000: ["H-2000 Flex", 0.83, 432, 8.5, 1296, 15.7],
  LMR240: ["LMR-240", 0.84, 400, 16.1, 1000, 25.9],
  LMR400: ["LMR-400", 0.85, 400, 8.2, 1000, 14.1],
  LMR600: ["LMR-600", 0.87, 400, 4.6, 1000, 8.9],
};

const CONNECTORS = {
  N: ["N", 0.05], SMA: ["SMA", 0.05], RP_SMA: ["RP-SMA", 0.05], BNC: ["BNC", 0.1], UHF: ["UHF (PL-259/SO-239)", 0.2],
  UFL: ["U.FL / IPEX", 0.2], ADAPTER: ["adapter", 0.1], ARRESTER: ["odgromnik / arrester", 0.2],
};

/* limity mocy popularnych pasm bez licencji: od, do, ERP dBm, EIRP dBm, wypełnienie %, nazwa */
const BANDS = [
  [433.05, 434.79, 10, null, 10, "433 MHz (EU)"],
  [863.0, 868.0, 14, null, 1, "863–868 MHz (EU)"],
  [868.0, 868.6, 14, null, 1, "868,0–868,6 MHz (EU)"],
  [868.7, 869.2, 14, null, 0.1, "868,7–869,2 MHz (EU)"],
  [869.4, 869.65, 27, null, 10, "869,4–869,65 MHz (EU)"],
  [869.7, 870.0, 14, null, 1, "869,7–870 MHz (EU)"],
  [902.0, 928.0, null, 36, null, "902–928 MHz (US)"],
  [2400.0, 2483.5, null, 20, null, "2,4 GHz (EU)"],
];

const cableLossPer100m = (key, mhz) => {
  const [, , f1, a1, f2, a2] = CABLES[key];
  const s1 = Math.sqrt(f1);
  const s2 = Math.sqrt(f2);
  const det = s1 * f2 - s2 * f1;
  const a = (a1 * f2 - a2 * f1) / det;
  const b = (s1 * a2 - s2 * a1) / det;
  return Math.max(0, a * Math.sqrt(mhz) + b * mhz);
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dim = (letter, kind, meters, index = 0) => ({ letter, kind, meters, index });

const thicknessFactor = (lambda, diameterM) => {
  if (diameterM <= 0) return 0.98;
  const ratio = lambda / 2 / diameterM;
  if (ratio <= 3) return 0.85;
  return clamp(1 - 0.2257 / Math.log(ratio), 0.85, 0.995);
};

const YAGI_SPACING = [0.24, 0.075, 0.18, 0.215, 0.25, 0.28, 0.3, 0.315, 0.33, 0.345, 0.36, 0.375, 0.385, 0.39, 0.395, 0.4, 0.4, 0.4, 0.4, 0.4];

const collinearGain = (n) => (n <= 1 ? DIPOLE_GAIN : n <= 8 ? [2.15, 3.5, 5.0, 6.0, 6.8, 7.5, 8.2, 8.7][n - 1] : Math.min(10, 8.7 + 0.3 * (n - 8)));

const microstripWidth = (z0, er, h) => {
  const a = (z0 / 60) * Math.sqrt((er + 1) / 2) + ((er - 1) / (er + 1)) * (0.23 + 0.11 / er);
  const narrow = (8 * Math.exp(a)) / (Math.exp(2 * a) - 2);
  if (narrow < 2) return narrow * h;
  const b = (377 * Math.PI) / (2 * z0 * Math.sqrt(er));
  return ((h * 2) / Math.PI) * (b - 1 - Math.log(2 * b - 1) + ((er - 1) / (2 * er)) * (Math.log(b - 1) + 0.39 - 0.61 / er));
};

/* Projekt anteny: wymiary, impedancja, zysk, polaryzacja, uwagi. */
export function design(inp) {
  const f = clamp(inp.mhz, 1, 100000);
  const l = C / (f * 1e6);
  const d = inp.diameterMm / 1000;
  const k = thicknessFactor(l, d) * INSULATION[inp.insulation];
  const vf = CABLES[inp.cable][1];
  switch (inp.type) {
    case "GROUND_PLANE": {
      const angle = clamp(inp.radialAngleDeg, 0, 90);
      const z = 36 + (14 * Math.min(angle, 45)) / 45 + Math.max(0, angle - 45) * 0.4;
      return { dims: [dim("A", "RADIATOR", (l / 4) * k), dim("B", "RADIAL", (l / 4) * k)], z, gain: DIPOLE_GAIN, pol: "VERTICAL", notes: ["RADIALS_ANGLE", "TUNE_SWR"], k };
    }
    case "DIPOLE": {
      const total = (l / 2) * k;
      const gap = l / 100;
      return { dims: [dim("A", "TOTAL", total), dim("B", "ARM", (total - gap) / 2), dim("C", "GAP", gap)], z: 73, gain: DIPOLE_GAIN, pol: "ANY", notes: ["TUNE_SWR"], k };
    }
    case "FOLDED_DIPOLE": {
      const spacing = inp.foldedSpacingMm > 0 ? inp.foldedSpacingMm / 1000 : l / 50;
      return {
        dims: [dim("A", "TOTAL", (l / 2) * k), dim("B", "SPACING", spacing), dim("C", "GAP", l / 100), dim("D", "HALF", (l / 2) * vf)],
        z: 292, gain: DIPOLE_GAIN, pol: "ANY", notes: ["BALUN_4_1", "HALF_WAVE_BALUN", "TUNE_SWR"], k,
      };
    }
    case "FIVE_EIGHTHS":
      return { dims: [dim("A", "RADIATOR", l * 0.625 * k), dim("B", "RADIAL", (l / 4) * k)], z: 50, gain: 4.0, pol: "VERTICAL", notes: ["COIL_MATCH", "RADIALS_ANGLE", "GAIN_APPROX", "TUNE_SWR"], k };
    case "J_POLE":
    case "SLIM_JIM": {
      const slim = inp.type === "SLIM_JIM";
      const gap = l / 100;
      const dims = [
        dim("A", "TOTAL", l * 0.75 * k + (slim ? gap : 0)),
        dim("B", "RADIATOR", (l / 2) * k),
        dim("C", "STUB", (l / 4) * k),
        dim("D", "FEED", (l / 40) * k),
      ];
      if (slim) dims.push(dim("E", "GAP", gap));
      dims.push(dim(slim ? "F" : "E", "SPACING", l / 50));
      return { dims, z: 50, gain: DIPOLE_GAIN, pol: "VERTICAL", notes: ["FEED_TAP", "CHOKE", "TUNE_SWR"], k };
    }
    case "COLLINEAR": {
      const n = clamp(Math.round(inp.sections), 2, 16);
      const section = (l / 2) * vf;
      const whip = (l / 4) * k;
      return { dims: [dim("A", "SECTION", section), dim("B", "WHIP", whip), dim("C", "TOTAL", n * section + whip)], z: 50, gain: collinearGain(n), pol: "VERTICAL", notes: ["COAX_VF", "CHOKE", "GAIN_APPROX", "TUNE_SWR"], k };
    }
    case "YAGI": {
      const n = clamp(Math.round(inp.elements), 3, 20);
      const boom = clamp(inp.boomMm / 1000 / l, 0.01, 0.05);
      const corr = inp.metalBoom ? -416.86 * boom ** 3 + 46.183 * boom * boom - 0.6834 * boom + 0.0059 : 0;
      const dl = clamp(d / l, 0.002, 0.01);
      const t = (dl - 0.002) / 0.008;
      const dims = [dim("R", "REFLECTOR", l * (0.482 + corr)), dim("Z", "DRIVEN", (l / 2) * k)];
      let length = 0;
      for (let i = 0; i < n - 1; i++) length += YAGI_SPACING[i];
      let position = YAGI_SPACING[0];
      dims.push(dim("S0", "POSITION", YAGI_SPACING[0] * l, 1));
      for (let j = 1; j <= n - 2; j++) {
        const big = -7e-6 * j ** 3 + 0.0003 * j * j - 0.0073 * j + 0.433;
        const small = -3e-6 * j ** 3 + 0.0002 * j * j - 0.0049 * j + 0.4595;
        dims.push(dim(`D${j}`, "DIRECTOR", l * (corr + small + (big - small) * t), j));
        position += YAGI_SPACING[j];
        dims.push(dim(`S${j}`, "POSITION", position * l, j + 1));
      }
      dims.push(dim("L", "BOOM", length * l));
      return { dims, z: 50, gain: 3.39 * Math.log(length) + 9.15 + DIPOLE_GAIN, pol: "ANY", notes: ["YAGI_DRIVEN", "YAGI_BOOM", "GAIN_APPROX", "TUNE_SWR"], k };
    }
    case "MOXON": {
      const dw = clamp(d / l, 1e-5, 1e-2);
      const d1 = Math.log10(dw);
      const a = -0.0008571428571 * d1 * d1 - 0.009571428571 * d1 + 0.3398571429;
      const b = -0.002142857143 * d1 * d1 - 0.02035714286 * d1 + 0.008285714286;
      const c = 0.001809523381 * d1 * d1 + 0.01780952381 * d1 + 0.05164285714;
      const dd = 0.001 * d1 + 0.07178571429;
      return {
        dims: [dim("A", "WIDTH", a * l), dim("B", "TAIL_DRIVER", b * l), dim("C", "GAP", c * l), dim("D", "TAIL_REFLECTOR", dd * l), dim("E", "DEPTH", (b + c + dd) * l)],
        z: 50, gain: 5.9, pol: "ANY", notes: ["MOXON_RANGE", "GAIN_APPROX", "TUNE_SWR"], k,
      };
    }
    case "BIQUAD":
      return { dims: [dim("A", "SIDE", l / 4), dim("B", "SPACING", l * 0.12), dim("C", "REFLECTOR_PLATE", l)], z: 50, gain: 10.5, pol: "LINEAR", notes: ["GAIN_APPROX", "TUNE_SWR"], k };
    case "HELIX": {
      const n = clamp(Math.round(inp.turns), 3, 40);
      const s = l / 4;
      return {
        dims: [dim("A", "DIAMETER", l / Math.PI), dim("B", "PITCH", s), dim("C", "LENGTH", n * s), dim("D", "GROUND", l * 0.75), dim("E", "TURN_WIRE", Math.sqrt(l * l + s * s))],
        z: 140, gain: 10 * Math.log10(15 * n * (s / l)), pol: "CIRCULAR", notes: ["HELIX_MATCH", "HELIX_GAIN", "TUNE_SWR"], k: 1,
      };
    }
    case "PATCH": {
      const er = clamp(inp.epsR, 1, 20);
      const h = clamp(inp.substrateMm, 0.1, 20) / 1000;
      const fh = f * 1e6;
      const w = (C / (2 * fh)) * Math.sqrt(2 / (er + 1));
      const eff = (er + 1) / 2 + (er - 1) / 2 / Math.sqrt(1 + (12 * h) / w);
      const dl = (0.412 * h * (eff + 0.3) * (w / h + 0.264)) / ((eff - 0.258) * (w / h + 0.8));
      const len = C / (2 * fh * Math.sqrt(eff)) - 2 * dl;
      const l0 = C / fh;
      const k0h = ((2 * Math.PI) / l0) * h;
      const g1 = (w / (120 * l0)) * (1 - (k0h * k0h) / 24);
      const rEdge = 1 / (2 * g1);
      const inset = rEdge > 50 ? (len / Math.PI) * Math.acos(Math.sqrt(50 / rEdge)) : 0;
      return {
        dims: [dim("A", "PATCH_W", w), dim("B", "PATCH_L", len), dim("C", "INSET", inset), dim("D", "FEED_WIDTH", microstripWidth(50, er, h)), dim("E", "GROUND", w + 6 * h), dim("F", "GROUND", len + 6 * h)],
        z: 50, gain: er > 3 ? 5 : 7, pol: "LINEAR", notes: ["PATCH_FR4", "GAIN_APPROX", "TUNE_SWR"], k: 1,
      };
    }
    default:
      return { dims: [dim("A", "QUARTER", (l / 4) * vf), dim("B", "HALF", (l / 2) * vf), dim("λ", "WAVELENGTH", l)], z: null, gain: 0, pol: "LINEAR", notes: ["COAX_VF"], k: 1 };
  }
}

const mismatchLossDb = (swr) => {
  if (swr <= 1) return 0;
  const g = (swr - 1) / (swr + 1);
  return -10 * Math.log10(1 - g * g);
};

/* Moc na antenie i wypromieniowana, na tle limitu pasma. */
export function feed({ mhz, txDbm, cable, cableM, connectors, swr, gain }) {
  const cableDb = (cableLossPer100m(cable, mhz) * cableM) / 100;
  const connDb = Object.entries(connectors).reduce((s, [key, n]) => s + CONNECTORS[key][1] * n, 0);
  const mm = mismatchLossDb(swr);
  const total = cableDb + connDb + mm;
  const at = txDbm - total;
  const eirp = at + gain;
  const erp = eirp - DIPOLE_GAIN;
  const band = BANDS.find((b) => mhz >= b[0] && mhz <= b[1]) || null;
  let over = null;
  if (band) {
    if (band[2] !== null) over = erp > band[2] + 0.05;
    else if (band[3] !== null) over = eirp > band[3] + 0.05;
  }
  return { cableDb, connDb, mm, total, at, eirp, erp, range: 10 ** ((gain - DIPOLE_GAIN - total) / 20), band, over };
}

const TEXT = {
  pl: {
    title: "Kalkulator anten",
    help: "Oblicza wymiary anteny, zysk i impedancję oraz straty w kablu i złączach. Wyniki są orientacyjne, antenę zawsze dostrój miernikiem SWR.",
    type: "Typ anteny",
    mhz: "Częstotliwość [MHz]",
    use_our: "Częstotliwość sieci",
    diameter: "Średnica drutu/rurki [mm]",
    insulation: "Izolacja drutu",
    ins_NONE: "brak (goły)",
    ins_THIN: "cienka",
    ins_THICK: "gruba",
    radial_angle: "Kąt radiali [°]",
    sections: "Liczba odcinków",
    elements: "Liczba elementów",
    boom: "Średnica bomu [mm]",
    metal_boom: "Metalowy bom",
    cable: "Kabel (współczynnik prędkości)",
    turns: "Liczba zwojów",
    eps: "Przenikalność laminatu (εr)",
    substrate: "Grubość laminatu [mm]",
    folded_spacing: "Odstęp przewodów [mm] (0 = auto)",
    dims: "Wymiary",
    letter: "Oznaczenie",
    what: "Element",
    length: "Długość",
    impedance: "Impedancja",
    gain: "Zysk",
    polarization: "Polaryzacja",
    notes: "Uwagi",
    feed_title: "Zasilanie i straty",
    tx: "Moc nadajnika [dBm]",
    swr: "SWR",
    feeder_cable: "Kabel zasilający",
    none_cable: "brak",
    feeder_len: "Długość kabla [m]",
    connectors: "Złącza (sztuk)",
    gain_override: "Zysk wpisany ręcznie [dBi]",
    cable_loss: "Kabel",
    conn_loss: "Złącza",
    mismatch_loss: "Niedopasowanie (SWR)",
    total_loss: "Straty razem",
    to_planner: "Użyj w planerze",
    planner_a: "koniec A",
    planner_b: "koniec B",
    sent: "Przekazano do planera: zysk i straty",
    at_antenna: "Moc na antenie",
    eirp: "EIRP",
    erp: "ERP",
    range: "Zasięg względem dipola bez strat",
    band: "Pasmo",
    no_band: "poza znanymi pasmami",
    limit_ok: "mieści się w limicie",
    limit_over: "PRZEKRACZA limit mocy pasma",
    duty: "wypełnienie",
    mw: "mW",
    ...{
      T_GROUND_PLANE: "Ground plane (1/4 fali z radialami)", T_DIPOLE: "Dipol półfalowy", T_FOLDED_DIPOLE: "Dipol pętlowy (folded)",
      T_FIVE_EIGHTHS: "5/8 fali", T_J_POLE: "J-pole", T_SLIM_JIM: "Slim Jim", T_COLLINEAR: "Collinear z kabla koncentrycznego",
      T_YAGI: "Yagi", T_MOXON: "Moxon", T_BIQUAD: "Biquad z reflektorem", T_HELIX: "Helisa (polaryzacja kołowa)",
      T_PATCH: "Antena płytkowa (patch)", T_COAX_STUB: "Odcinki kabla (ćwierć/pół fali)",
      D_TOTAL: "Długość całkowita", D_RADIATOR: "Promiennik", D_RADIAL: "Radial", D_ARM: "Ramię dipola", D_GAP: "Przerwa zasilania",
      D_SPACING: "Odstęp", D_STUB: "Odcinek dopasowujący", D_FEED: "Punkt zasilania od dołu", D_SECTION: "Odcinek kabla", D_WHIP: "Bat na końcu",
      D_REFLECTOR: "Reflektor", D_DRIVEN: "Wibrator", D_DIRECTOR: "Direktor", D_BOOM: "Długość bomu", D_POSITION: "Położenie na bomie",
      D_WIDTH: "Szerokość", D_DEPTH: "Głębokość", D_TAIL_DRIVER: "Ogon wibratora", D_TAIL_REFLECTOR: "Ogon reflektora", D_SIDE: "Bok kwadratu",
      D_REFLECTOR_PLATE: "Płyta reflektora (bok)", D_DIAMETER: "Średnica zwoju", D_PITCH: "Skok zwojów", D_TURN_WIRE: "Drut na jeden zwój",
      D_LENGTH: "Długość helisy", D_GROUND: "Płaszczyzna masy", D_PATCH_W: "Szerokość płytki", D_PATCH_L: "Długość płytki",
      D_INSET: "Wcięcie zasilania", D_FEED_WIDTH: "Szerokość ścieżki 50 Ω", D_QUARTER: "1/4 fali w kablu", D_HALF: "1/2 fali w kablu",
      D_WAVELENGTH: "Długość fali w próżni",
      P_VERTICAL: "pionowa", P_ANY: "pozioma lub pionowa", P_CIRCULAR: "kołowa", P_LINEAR: "liniowa",
      N_TUNE_SWR: "Po zbudowaniu dostrój długość (skracaj po 1–2 mm), mierząc SWR.",
      N_RADIALS_ANGLE: "Radiale opuszczone pod ok. 45° dają ok. 50 Ω; poziome ok. 36 Ω.",
      N_BALUN_4_1: "Impedancja ok. 292 Ω — użyj baluna 4:1.",
      N_COIL_MATCH: "Dopasowanie cewką u podstawy — punkt zasilania wymaga dostrojenia.",
      N_CHOKE: "Załóż dławik (kilka zwojów kabla albo ferryty) na kablu przy antenie.",
      N_FEED_TAP: "Punkt zasilania znajdź doświadczalnie, przesuwając go od dołu, aż SWR będzie najniższy.",
      N_YAGI_DRIVEN: "Wibrator można złożyć (folded) dla lepszego dopasowania; sprawdź SWR.",
      N_MOXON_RANGE: "Wymiary ważne dla drutu o średnicy między 1e-5 a 0,01 długości fali.",
      N_HELIX_MATCH: "Dopasuj ok. 140 Ω do 50 Ω paskiem miedzi albo odcinkiem ćwierćfalowym.",
      N_HELIX_GAIN: "Zysk helisy jest szacowany dla 3–40 zwojów, polaryzacja kołowa.",
      N_PATCH_FR4: "Wymiary liczone dla wybranego laminatu; FR4 daje wąskie pasmo.",
      N_GAIN_APPROX: "Zysk jest orientacyjny — zależy od wykonania.",
      N_YAGI_BOOM: "Elementy przez metalowy bom są skorygowane, jeśli zaznaczono metalowy bom.",
      N_COAX_VF: "Długości liczone ze współczynnikiem prędkości kabla; zmierz własny kabel.",
      N_HALF_WAVE_BALUN: "Półfalową pętlę kabla (D) użyj jako baluna 4:1.",
    },
  },
  en: {
    title: "Antenna calculator",
    help: "Calculates antenna dimensions, gain and impedance, plus losses in the cable and connectors. Results are approximate, always tune the antenna with an SWR meter.",
    type: "Antenna type",
    mhz: "Frequency [MHz]",
    use_our: "Network frequency",
    diameter: "Wire/tube diameter [mm]",
    insulation: "Wire insulation",
    ins_NONE: "none (bare)",
    ins_THIN: "thin",
    ins_THICK: "thick",
    radial_angle: "Radial angle [°]",
    sections: "Number of sections",
    elements: "Number of elements",
    boom: "Boom diameter [mm]",
    metal_boom: "Metal boom",
    cable: "Cable (velocity factor)",
    turns: "Number of turns",
    eps: "Substrate permittivity (εr)",
    substrate: "Substrate thickness [mm]",
    folded_spacing: "Wire spacing [mm] (0 = auto)",
    dims: "Dimensions",
    letter: "Mark",
    what: "Element",
    length: "Length",
    impedance: "Impedance",
    gain: "Gain",
    polarization: "Polarization",
    notes: "Notes",
    feed_title: "Feed and losses",
    tx: "Transmitter power [dBm]",
    swr: "SWR",
    feeder_cable: "Feed cable",
    none_cable: "none",
    feeder_len: "Cable length [m]",
    connectors: "Connectors (pieces)",
    gain_override: "Gain typed by hand [dBi]",
    cable_loss: "Cable",
    conn_loss: "Connectors",
    mismatch_loss: "Mismatch (SWR)",
    total_loss: "Total losses",
    to_planner: "Use in the planner",
    planner_a: "end A",
    planner_b: "end B",
    sent: "Sent to the planner: gain and losses",
    at_antenna: "Power at the antenna",
    eirp: "EIRP",
    erp: "ERP",
    range: "Range vs a lossless dipole",
    band: "Band",
    no_band: "outside known bands",
    limit_ok: "within the limit",
    limit_over: "EXCEEDS the band power limit",
    duty: "duty cycle",
    mw: "mW",
    ...{
      T_GROUND_PLANE: "Ground plane (1/4 wave with radials)", T_DIPOLE: "Half-wave dipole", T_FOLDED_DIPOLE: "Folded dipole",
      T_FIVE_EIGHTHS: "5/8 wave", T_J_POLE: "J-pole", T_SLIM_JIM: "Slim Jim", T_COLLINEAR: "Coaxial collinear",
      T_YAGI: "Yagi", T_MOXON: "Moxon", T_BIQUAD: "Biquad with reflector", T_HELIX: "Helix (circular polarization)",
      T_PATCH: "Patch antenna", T_COAX_STUB: "Coax sections (quarter/half wave)",
      D_TOTAL: "Total length", D_RADIATOR: "Radiator", D_RADIAL: "Radial", D_ARM: "Dipole arm", D_GAP: "Feed gap",
      D_SPACING: "Spacing", D_STUB: "Matching stub", D_FEED: "Feed point from the bottom", D_SECTION: "Cable section", D_WHIP: "Whip at the end",
      D_REFLECTOR: "Reflector", D_DRIVEN: "Driven element", D_DIRECTOR: "Director", D_BOOM: "Boom length", D_POSITION: "Position on the boom",
      D_WIDTH: "Width", D_DEPTH: "Depth", D_TAIL_DRIVER: "Driven tail", D_TAIL_REFLECTOR: "Reflector tail", D_SIDE: "Square side",
      D_REFLECTOR_PLATE: "Reflector plate (side)", D_DIAMETER: "Turn diameter", D_PITCH: "Turn pitch", D_TURN_WIRE: "Wire per turn",
      D_LENGTH: "Helix length", D_GROUND: "Ground plane", D_PATCH_W: "Patch width", D_PATCH_L: "Patch length",
      D_INSET: "Feed inset", D_FEED_WIDTH: "50 Ω trace width", D_QUARTER: "1/4 wave in cable", D_HALF: "1/2 wave in cable",
      D_WAVELENGTH: "Free-space wavelength",
      P_VERTICAL: "vertical", P_ANY: "horizontal or vertical", P_CIRCULAR: "circular", P_LINEAR: "linear",
      N_TUNE_SWR: "After building, trim the length (1–2 mm at a time) while watching the SWR.",
      N_RADIALS_ANGLE: "Radials drooping about 45° give about 50 Ω; flat ones about 36 Ω.",
      N_BALUN_4_1: "Impedance about 292 Ω — use a 4:1 balun.",
      N_COIL_MATCH: "Match with a coil at the base — the feed point needs tuning.",
      N_CHOKE: "Add a choke (a few turns of cable or ferrites) on the cable at the antenna.",
      N_FEED_TAP: "Find the feed point by trying it from the bottom until the SWR is lowest.",
      N_YAGI_DRIVEN: "The driven element can be folded for a better match; check the SWR.",
      N_MOXON_RANGE: "Valid for wire between 1e-5 and 0.01 of a wavelength thick.",
      N_HELIX_MATCH: "Match about 140 Ω to 50 Ω with a copper strip or a quarter-wave section.",
      N_HELIX_GAIN: "Helix gain is estimated for 3–40 turns, circular polarization.",
      N_PATCH_FR4: "Dimensions are for the chosen substrate; FR4 gives a narrow bandwidth.",
      N_GAIN_APPROX: "Gain is approximate — it depends on the build.",
      N_YAGI_BOOM: "Elements through a metal boom are corrected when metal boom is ticked.",
      N_COAX_VF: "Lengths use the cable's velocity factor; measure your own cable.",
      N_HALF_WAVE_BALUN: "Use the half-wave cable loop (D) as a 4:1 balun.",
    },
  },
};

const fmtLen = (m) => (m >= 1 ? `${m.toFixed(3)} m` : `${(m * 1000).toFixed(1)} mm`);

class MeshAntennaTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      _in: { type: Object },
      _feed: { type: Object },
    };
  }

  constructor() {
    super();
    this._in = {
      type: "GROUND_PLANE", mhz: OUR_MHZ, diameterMm: 1.5, insulation: "NONE", radialAngleDeg: 45, elements: 5, boomMm: 20,
      metalBoom: true, cable: "RG58", sections: 4, turns: 8, epsR: 4.4, substrateMm: 1.6, foldedSpacingMm: 0,
    };
    this._feed = { txDbm: 22, swr: 1.0, cable: "none", cableM: 3, connectors: { SMA: 2 }, gainOverride: "" };
  }

  _tr(key, fallback) {
    const lang = (this.hass && this.hass.language) || "pl";
    const dict = TEXT[lang.startsWith("pl") ? "pl" : "en"] || TEXT.pl;
    return dict[key] !== undefined ? dict[key] : fallback !== undefined ? fallback : key;
  }

  _set(prop, value) {
    this._in = { ...this._in, [prop]: value };
  }

  _setFeed(prop, value) {
    this._feed = { ...this._feed, [prop]: value };
  }

  _num(prop, label, min, max, step = 1) {
    return html`<label class="f">${label}
      <input type="number" min=${min} max=${max} step=${step} .value=${String(this._in[prop])}
        @change=${(e) => this._set(prop, clamp(Number(e.target.value) || min, min, max))} /></label>`;
  }

  _inputs() {
    const t = this._in.type;
    const wire = !["BIQUAD", "HELIX", "PATCH", "COAX_STUB"].includes(t);
    const cableTypes = ["FOLDED_DIPOLE", "COLLINEAR", "COAX_STUB"];
    return html`
      <div class="grid">
        <label class="f">${this._tr("type")}
          <select @change=${(e) => this._set("type", e.target.value)}>
            ${TYPES.map((x) => html`<option value=${x} ?selected=${x === t}>${this._tr(`T_${x}`)}</option>`)}
          </select></label>
        <label class="f">${this._tr("mhz")}
          <input type="number" step="0.001" .value=${String(this._in.mhz)} @change=${(e) => this._set("mhz", clamp(Number(e.target.value) || OUR_MHZ, 1, 100000))} /></label>
        ${wire ? this._num("diameterMm", this._tr("diameter"), 0.1, 50, 0.1) : ""}
        ${wire
          ? html`<label class="f">${this._tr("insulation")}
              <select @change=${(e) => this._set("insulation", e.target.value)}>
                ${Object.keys(INSULATION).map((x) => html`<option value=${x} ?selected=${x === this._in.insulation}>${this._tr(`ins_${x}`)}</option>`)}
              </select></label>`
          : ""}
        ${["GROUND_PLANE", "FIVE_EIGHTHS"].includes(t) ? this._num("radialAngleDeg", this._tr("radial_angle"), 0, 90) : ""}
        ${t === "COLLINEAR" ? this._num("sections", this._tr("sections"), 2, 16) : ""}
        ${t === "YAGI" ? this._num("elements", this._tr("elements"), 3, 20) : ""}
        ${t === "YAGI" ? this._num("boomMm", this._tr("boom"), 1, 100) : ""}
        ${t === "YAGI"
          ? html`<label class="tog"><input type="checkbox" .checked=${this._in.metalBoom} @change=${(e) => this._set("metalBoom", e.target.checked)} />${this._tr("metal_boom")}</label>`
          : ""}
        ${cableTypes.includes(t)
          ? html`<label class="f">${this._tr("cable")}
              <select @change=${(e) => this._set("cable", e.target.value)}>
                ${Object.entries(CABLES).map(([k, v]) => html`<option value=${k} ?selected=${k === this._in.cable}>${v[0]} (${v[1]})</option>`)}
              </select></label>`
          : ""}
        ${t === "HELIX" ? this._num("turns", this._tr("turns"), 3, 40) : ""}
        ${t === "PATCH" ? this._num("epsR", this._tr("eps"), 1, 20, 0.1) : ""}
        ${t === "PATCH" ? this._num("substrateMm", this._tr("substrate"), 0.1, 20, 0.1) : ""}
        ${t === "FOLDED_DIPOLE" ? this._num("foldedSpacingMm", this._tr("folded_spacing"), 0, 200, 1) : ""}
      </div>
      <div class="bar"><button class="chip" @click=${() => this._set("mhz", OUR_MHZ)}>${this._tr("use_our")} (${OUR_MHZ} MHz)</button></div>
    `;
  }

  /* Jak w aplikacji: zysk anteny i straty toru trafiają do planera zasięgu (wybrany koniec łącza). */
  _toPlanner(side, gain, lossDb) {
    try {
      const store = getPlannerSession().store;
      store.setAntennaGain(side, Math.round(gain * 10) / 10);
      store.setFeederPrecise(side, false);
      store.setFeederManualDb(side, Math.round(lossDb * 100) / 100);
      this._sent = `${side}: ${gain.toFixed(1)} dBi, ${lossDb.toFixed(2)} dB`;
    } catch (err) {
      this._sent = `błąd: ${err && err.message ? err.message : err}`;
    }
    this.requestUpdate();
  }

  _feedBlock(gain) {
    const f = this._feed;
    const r = feed({
      mhz: this._in.mhz,
      txDbm: f.txDbm,
      cable: f.cable === "none" ? "RG58" : f.cable,
      cableM: f.cable === "none" ? 0 : f.cableM,
      connectors: f.connectors,
      swr: f.swr,
      gain,
    });
    const mw = (dbm) => (10 ** (dbm / 10)).toFixed(dbm > 20 ? 0 : 1);
    return html`
      <h4>${this._tr("feed_title")}</h4>
      <div class="grid">
        <label class="f">${this._tr("tx")}<input type="number" step="1" .value=${String(f.txDbm)} @change=${(e) => this._setFeed("txDbm", clamp(Number(e.target.value) || 0, -20, 50))} /></label>
        <label class="f">${this._tr("swr")}<input type="number" step="0.1" min="1" .value=${String(f.swr)} @change=${(e) => this._setFeed("swr", clamp(Number(e.target.value) || 1, 1, 20))} /></label>
        <label class="f">${this._tr("feeder_cable")}
          <select @change=${(e) => this._setFeed("cable", e.target.value)}>
            <option value="none" ?selected=${f.cable === "none"}>${this._tr("none_cable")}</option>
            ${Object.entries(CABLES).map(([k, v]) => html`<option value=${k} ?selected=${k === f.cable}>${v[0]}</option>`)}
          </select></label>
        <label class="f">${this._tr("feeder_len")}<input type="number" step="0.5" min="0" .value=${String(f.cableM)} @change=${(e) => this._setFeed("cableM", clamp(Number(e.target.value) || 0, 0, 500))} /></label>
        <label class="f">${this._tr("gain_override")}<input type="number" step="0.1" .value=${String(f.gainOverride)} @change=${(e) => this._setFeed("gainOverride", e.target.value === "" ? "" : Number(e.target.value))} /></label>
      </div>
      <div class="sub">${this._tr("connectors")}</div>
      <div class="grid">
        ${Object.entries(CONNECTORS).map(
          ([k, v]) => html`<label class="f">${v[0]}<input type="number" min="0" max="10" .value=${String(f.connectors[k] || 0)}
            @change=${(e) => this._setFeed("connectors", { ...f.connectors, [k]: clamp(Math.round(Number(e.target.value) || 0), 0, 10) })} /></label>`
        )}
      </div>
      <div class="table-wrap"><table><tbody>
        <tr><td>${this._tr("cable_loss")}</td><td>${r.cableDb.toFixed(2)} dB</td></tr>
        <tr><td>${this._tr("conn_loss")}</td><td>${r.connDb.toFixed(2)} dB</td></tr>
        <tr><td>${this._tr("mismatch_loss")}</td><td>${r.mm.toFixed(2)} dB</td></tr>
        <tr><td><b>${this._tr("total_loss")}</b></td><td><b>${r.total.toFixed(2)} dB</b></td></tr>
        <tr><td>${this._tr("at_antenna")}</td><td>${r.at.toFixed(1)} dBm (${mw(r.at)} ${this._tr("mw")})</td></tr>
        <tr><td>${this._tr("eirp")}</td><td>${r.eirp.toFixed(1)} dBm (${mw(r.eirp)} ${this._tr("mw")})</td></tr>
        <tr><td>${this._tr("erp")}</td><td>${r.erp.toFixed(1)} dBm (${mw(r.erp)} ${this._tr("mw")})</td></tr>
        <tr><td>${this._tr("range")}</td><td>${(r.range * 100).toFixed(0)}%</td></tr>
        <tr><td>${this._tr("band")}</td><td>${r.band ? html`${r.band[5]}${r.band[4] !== null ? html`, ${this._tr("duty")} ${r.band[4]}%` : ""}` : this._tr("no_band")}</td></tr>
        ${r.over === null ? "" : html`<tr><td></td><td class=${r.over ? "bad" : "good"}>${this._tr(r.over ? "limit_over" : "limit_ok")}</td></tr>`}
      </tbody></table></div>
      <div class="sub">${this._tr("to_planner")}</div>
      <div class="grid">
        ${["A", "B"].map((side) => html`<button @click=${() => this._toPlanner(side, gain, r.total)}>${this._tr("to_planner")}: ${this._tr(side === "A" ? "planner_a" : "planner_b")}</button>`)}
      </div>
      ${this._sent ? html`<p class="legend">${this._tr("sent")} (${this._sent})</p>` : ""}
    `;
  }

  render() {
    const d = design(this._in);
    const gain = this._feed.gainOverride === "" ? d.gain : Number(this._feed.gainOverride);
    return html`
      <div class="wrap">
        <h3>${this._tr("title")}</h3>
        <p class="legend">${this._tr("help")}</p>
        ${this._inputs()}
        <h4>${this._tr("dims")}</h4>
        <div class="table-wrap"><table>
          <thead><tr><th>${this._tr("letter")}</th><th>${this._tr("what")}</th><th>${this._tr("length")}</th></tr></thead>
          <tbody>
            ${d.dims.map((x) => html`<tr><td>${x.letter}</td><td>${this._tr(`D_${x.kind}`)}</td><td>${fmtLen(x.meters)}</td></tr>`)}
          </tbody>
        </table></div>
        <div class="tiles">
          <div class="tile"><b>${gain.toFixed(1)} dBi</b><span>${this._tr("gain")}</span></div>
          <div class="tile"><b>${d.z === null ? "–" : `${Math.round(d.z)} Ω`}</b><span>${this._tr("impedance")}</span></div>
          <div class="tile"><b>${this._tr(`P_${d.pol}`)}</b><span>${this._tr("polarization")}</span></div>
        </div>
        <h4>${this._tr("notes")}</h4>
        <ul class="notes">${d.notes.map((n) => html`<li>${this._tr(`N_${n}`)}</li>`)}</ul>
        ${this._feedBlock(gain)}
      </div>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; height: var(--mtsw-tab-height, 100%); overflow: auto; }
      .wrap { padding: 8px 16px 24px; max-width: 1100px; margin: 0 auto; }
      h3, h4 { margin: 14px 0 6px; font-weight: 500; }
      .sub { font-size: 13px; color: var(--secondary-text-color); margin: 10px 0 4px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; align-items: end; }
      .f { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--secondary-text-color); }
      input:not([type="checkbox"]), select { padding: 6px 8px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; font-size: 14px; }
      .bar { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
      .chip { appearance: none; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); border-radius: 16px; padding: 5px 14px; font: inherit; font-size: 13px; cursor: pointer; }
      .tog { font-size: 13px; display: flex; gap: 4px; align-items: center; }
      .table-wrap { overflow-x: auto; border: 1px solid var(--divider-color); border-radius: 12px; background: var(--card-background-color); }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--divider-color); white-space: nowrap; }
      th { font-size: 12px; color: var(--secondary-text-color); font-weight: 500; }
      .tiles { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
      .tile { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px 18px; min-width: 120px; display: flex; flex-direction: column; }
      .tile b { font-size: 20px; }
      .tile span { font-size: 12px; color: var(--secondary-text-color); }
      .notes { margin: 4px 0; padding-left: 20px; font-size: 14px; }
      .legend { font-size: 12px; color: var(--secondary-text-color); }
      .good { color: var(--success-color, #43a047); }
      .bad { color: var(--error-color, #db4437); font-weight: 600; }
    `;
  }
}

if (!customElements.get("mtsw-antenna-tab")) {
  customElements.define("mtsw-antenna-tab", MeshAntennaTab);
}
