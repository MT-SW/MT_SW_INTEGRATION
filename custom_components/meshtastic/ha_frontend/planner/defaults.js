// Wartości domyślne, limity i pomocnicze przeliczenia stanu plannera (PlannerUiState / PlannerViewModel z Androida).
import { FEEDER_PRESETS } from './feeder.js';
import {
  DEFAULT_BAND_ID, FREE_ID, bandById, bandIdFor, bandwidthScale, clampMHz, defaultFrequencyMHz, radioFromPreset,
} from './bands.js';
import { PlannerClutter, CLUTTER_HEIGHT_DEFAULTS } from './clutter.js';
import { clamp } from './util.js';

/** Domyślne k i N0 (atmosfera standardowa). */
export const DEFAULT_K = 4.0 / 3.0;
export const DEFAULT_N0 = 301.0;

export const END_DEFAULTS = Object.freeze({
  heightM: 2.0, txPowerDbm: 20.0, antennaGainDbi: 2.15,
});

/** Domyślne wartości całego stanu plannera (preset Narrow Fast, 869.44165 MHz, zasięg 50 km). */
export const PLANNER_DEFAULTS = Object.freeze({
  frequencyMHz: 869.44165,
  bandId: DEFAULT_BAND_ID,
  modemPreset: 'NARROW_FAST',
  radioOverride: false,
  bandwidthKhz: 62.5,
  spreadingFactor: 7,
  noiseFigureDb: 6.0,
  useWeather: false,
  extraLossDb: 0.0,
  clutterPreset: 'NONE',
  preciseTerrain: false,
  clutterRadiusKm: PlannerClutter.DEFAULT_AREA_RADIUS_KM,
  forestHeightM: CLUTTER_HEIGHT_DEFAULTS.forestM,
  buildingHeightM: CLUTTER_HEIGHT_DEFAULTS.buildingM,
  coverageSide: 'A',
  coverageMaxRangeKm: 50.0,
  coverageRadials: 180,
  coverageOpacity: 0.62,
  coverageRxHeightM: 2.0,
  coverageRxGainDbi: 0.0,
});

/** Zakresy wartości wymuszane przez ViewModel (normalizePlannerInput ich używa). */
export const PLANNER_LIMITS = Object.freeze({
  antennaHeightM: [0.0, 2000.0],
  txPowerDbm: [-10.0, 50.0],
  antennaGainDbi: [-10.0, 60.0],
  feederManualDb: [0.0, 100.0],
  frequencyMHz: [20.0, 20000.0],
  bandwidthKhz: [1.0, 2000.0],
  spreadingFactor: [5, 12],
  noiseFigureDb: [0.0, 30.0],
  extraLossDb: [0.0, 100.0],
  clutterRadiusKm: [1.0, PlannerClutter.MAX_AREA_RADIUS_KM],
  clutterHeightM: [0.0, 200.0],
  coverageMaxRangeKm: [1.0, 300.0],
  coverageRadials: [8, 360],
  coverageOpacity: [0.15, 1.0],
  coverageRxHeightM: [0.0, 100.0],
  coverageRxGainDbi: [-10.0, 30.0],
});

/** Presety strat przeszkód (klutter): dodatkowa strata w dB. CUSTOM = wartość wpisana ręcznie. */
export const CLUTTER_PRESETS = Object.freeze([
  { id: 'NONE', extraDb: 0.0 }, { id: 'RURAL_OPEN', extraDb: 0.0 }, { id: 'FOREST_LIGHT', extraDb: 3.0 },
  { id: 'FOREST_DENSE', extraDb: 10.0 }, { id: 'SUBURBAN', extraDb: 6.0 }, { id: 'URBAN', extraDb: 12.0 },
  { id: 'CUSTOM', extraDb: 0.0 },
].map(Object.freeze));

export const clutterPresetExtraDb = (id) => (CLUTTER_PRESETS.find((p) => p.id === id) || CLUTTER_PRESETS[0]).extraDb;

export const dbmToWatts = (dbm) => Math.pow(10.0, dbm / 10.0) / 1000.0;
export const wattsToDbm = (watts) => (watts <= 0.0 ? -100.0 : 10.0 * Math.log10(watts * 1000.0));

/** Poziom szumu (dBm) = -174 + 10 log10(BW) + NF. */
export const noiseFloorDbm = (bandwidthKhz, noiseFigureDb) => -174.0 + 10.0 * Math.log10(bandwidthKhz * 1000.0) + noiseFigureDb;

/** Pusty koniec łącza (bez punktu). */
export function createDefaultEnd() {
  return {
    lat: null, lon: null, name: '',
    pointSource: { type: 'none' }, // none | map | manual | station | node (num)
    groundAltM: null, groundAltManual: false,
    antennaHeightM: END_DEFAULTS.heightM, txPowerDbm: END_DEFAULTS.txPowerDbm, antennaGainDbi: END_DEFAULTS.antennaGainDbi,
    feederManualDb: 0.0, feederPrecise: false,
    feederConfig: FEEDER_PRESETS.find((p) => p.id === 'direct').config,
  };
}

/** Domyślne wejście plannera (oba końce puste). */
export function createDefaultInput() {
  return { a: createDefaultEnd(), b: createDefaultEnd(), ...PLANNER_DEFAULTS };
}

const num = (v, d) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
const lim = (v, [lo, hi], d) => clamp(num(v, d), lo, hi);

function normalizeEnd(e = {}) {
  const d = createDefaultEnd();
  const hasPoint = typeof e.lat === 'number' && typeof e.lon === 'number' && !Number.isNaN(e.lat) && !Number.isNaN(e.lon);
  return {
    ...d, ...e,
    lat: hasPoint ? e.lat : null, lon: hasPoint ? e.lon : null,
    antennaHeightM: lim(e.antennaHeightM, PLANNER_LIMITS.antennaHeightM, d.antennaHeightM),
    txPowerDbm: lim(e.txPowerDbm, PLANNER_LIMITS.txPowerDbm, d.txPowerDbm),
    antennaGainDbi: lim(e.antennaGainDbi, PLANNER_LIMITS.antennaGainDbi, d.antennaGainDbi),
    feederManualDb: lim(e.feederManualDb, PLANNER_LIMITS.feederManualDb, 0.0),
    feederPrecise: !!e.feederPrecise,
    feederConfig: e.feederConfig || d.feederConfig,
    groundAltManual: !!e.groundAltManual,
    groundAltM: typeof e.groundAltM === 'number' && !Number.isNaN(e.groundAltM) ? e.groundAltM : null,
  };
}

/**
 * Uzupełnia domyślne i obcina wartości do zakresów z PLANNER_LIMITS (jak setter-y ViewModelu).
 * Nie mutuje wejścia. Wołane automatycznie przez planLink/planCoverage.
 */
export function normalizePlannerInput(input = {}) {
  const base = { ...PLANNER_DEFAULTS, ...input };
  const f = clampMHz(num(base.frequencyMHz, PLANNER_DEFAULTS.frequencyMHz));
  return {
    ...base,
    a: normalizeEnd(input.a),
    b: normalizeEnd(input.b),
    frequencyMHz: f,
    bandwidthKhz: lim(base.bandwidthKhz, PLANNER_LIMITS.bandwidthKhz, PLANNER_DEFAULTS.bandwidthKhz),
    spreadingFactor: Math.round(lim(base.spreadingFactor, PLANNER_LIMITS.spreadingFactor, PLANNER_DEFAULTS.spreadingFactor)),
    noiseFigureDb: lim(base.noiseFigureDb, PLANNER_LIMITS.noiseFigureDb, PLANNER_DEFAULTS.noiseFigureDb),
    extraLossDb: lim(base.extraLossDb, PLANNER_LIMITS.extraLossDb, 0.0),
    useWeather: !!base.useWeather,
    preciseTerrain: !!base.preciseTerrain,
    clutterRadiusKm: lim(base.clutterRadiusKm, PLANNER_LIMITS.clutterRadiusKm, PLANNER_DEFAULTS.clutterRadiusKm),
    forestHeightM: lim(base.forestHeightM, PLANNER_LIMITS.clutterHeightM, PLANNER_DEFAULTS.forestHeightM),
    buildingHeightM: lim(base.buildingHeightM, PLANNER_LIMITS.clutterHeightM, PLANNER_DEFAULTS.buildingHeightM),
    coverageSide: base.coverageSide === 'B' ? 'B' : 'A',
    coverageMaxRangeKm: lim(base.coverageMaxRangeKm, PLANNER_LIMITS.coverageMaxRangeKm, PLANNER_DEFAULTS.coverageMaxRangeKm),
    coverageRadials: Math.round(lim(base.coverageRadials, PLANNER_LIMITS.coverageRadials, PLANNER_DEFAULTS.coverageRadials)),
    coverageOpacity: lim(base.coverageOpacity, PLANNER_LIMITS.coverageOpacity, PLANNER_DEFAULTS.coverageOpacity),
    coverageRxHeightM: lim(base.coverageRxHeightM, PLANNER_LIMITS.coverageRxHeightM, PLANNER_DEFAULTS.coverageRxHeightM),
    coverageRxGainDbi: lim(base.coverageRxGainDbi, PLANNER_LIMITS.coverageRxGainDbi, PLANNER_DEFAULTS.coverageRxGainDbi),
  };
}

// ---- przejścia stanu radia (czyste funkcje; odpowiedniki setBand / setRadioFromPreset / setFrequency z ViewModelu) ----

function withBandRadio(st, previousBandId) {
  if (st.radioOverride || !st.modemPreset || st.bandId === previousBandId) return st;
  const base = radioFromPreset(st.modemPreset);
  return { ...st, bandwidthKhz: base.bandwidthKhz * bandwidthScale(st.bandId) };
}

/** Wybór pasma: szerokość kanału wg pasma (2.4 GHz = wide LoRa x3.25), częstotliwość na domyślną pasma. */
export function applyBand(state, bandId) {
  const band = bandById(bandId);
  if (!band) return state;
  if (band.id === FREE_ID) return { ...state, bandId: band.id };
  const moved = withBandRadio({ ...state, bandId: band.id }, state.bandId);
  return { ...moved, frequencyMHz: defaultFrequencyMHz(band.id, moved.bandwidthKhz) };
}

/** Wybór presetu modemu LoRa (id jak 'LONG_FAST'); częstotliwość podąża za presetem, jeśli była domyślna. */
export function applyModemPreset(state, presetId) {
  const base = radioFromPreset(presetId);
  const bandwidthKhz = base.bandwidthKhz * bandwidthScale(state.bandId);
  const followsDefault = Math.abs(state.frequencyMHz - defaultFrequencyMHz(state.bandId, state.bandwidthKhz)) < 1.0e-6;
  return {
    ...state, bandwidthKhz, spreadingFactor: base.spreadingFactor, modemPreset: presetId, radioOverride: false,
    frequencyMHz: followsDefault && state.bandId !== FREE_ID ? defaultFrequencyMHz(state.bandId, bandwidthKhz) : state.frequencyMHz,
  };
}

/** Ręczna częstotliwość (20..20000 MHz); pasmo podąża za nią. */
export function applyFrequency(state, mHz) {
  if (Number.isNaN(mHz)) return state;
  const f = clampMHz(mHz);
  return withBandRadio({ ...state, frequencyMHz: f, bandId: bandIdFor(f) }, state.bandId);
}

/** Ręczna szerokość pasma (kHz) — wyłącza preset (radioOverride). */
export function applyBandwidth(state, khz) {
  if (Number.isNaN(khz) || khz <= 0.0) return state;
  return { ...state, bandwidthKhz: clamp(khz, 1.0, 2000.0), modemPreset: null, radioOverride: true };
}

/** Ręczny współczynnik rozpraszania SF 5..12 — wyłącza preset. */
export function applySpreadingFactor(state, sf) {
  return { ...state, spreadingFactor: clamp(Math.round(sf), 5, 12), modemPreset: null, radioOverride: true };
}

/** Preset strat przeszkód: ustawia extraLossDb (CUSTOM tylko oznacza wartość ręczną). */
export function applyClutterPreset(state, presetId) {
  if (presetId === 'CUSTOM') return { ...state, clutterPreset: presetId };
  return { ...state, clutterPreset: presetId, extraLossDb: clutterPresetExtraDb(presetId) };
}

/** Ręczna dodatkowa strata (dB); preset staje się CUSTOM, chyba że wartość równa się presetowi. */
export function applyExtraLoss(state, db) {
  if (Number.isNaN(db)) return state;
  const v = clamp(db, 0.0, 100.0);
  const keep = state.clutterPreset !== 'CUSTOM' && clutterPresetExtraDb(state.clutterPreset) === v;
  return { ...state, extraLossDb: v, clutterPreset: keep ? state.clutterPreset : 'CUSTOM' };
}
