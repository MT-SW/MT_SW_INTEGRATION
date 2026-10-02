// Pasma częstotliwości plannera + presety modemu LoRa — port PlannerBands.kt (+ potrzebne fragmenty
// RegionInfo / ChannelOption z core/model Androida).

export const FREE_ID = 'free';
export const FREE_MIN_MHZ = 20.0;
export const FREE_MAX_MHZ = 20000.0;
export const DEFAULT_BAND_ID = '868';
/** Domyślna częstotliwość MT_SW dla presetów Narrow w paśmie 868 MHz. */
export const NARROW_868_MHZ = 869.44165;

/** @typedef {{id:string,name:string,centerMHz:number,minMHz:number,maxMHz:number}} PlannerBand */
/** @type {ReadonlyArray<PlannerBand>} */
export const PLANNER_BANDS = Object.freeze([
  { id: '169', name: '169 MHz', centerMHz: 169.4, minMHz: 160.0, maxMHz: 180.0 },
  { id: '433', name: '433 MHz (ISM)', centerMHz: 433.5, minMHz: 430.0, maxMHz: 440.0 },
  { id: '470', name: '470 MHz', centerMHz: 490.0, minMHz: 470.0, maxMHz: 510.0 },
  { id: '868', name: '868 MHz (EU)', centerMHz: 869.44165, minMHz: 863.0, maxMHz: 870.0 },
  { id: '915', name: '915 MHz', centerMHz: 915.0, minMHz: 902.0, maxMHz: 922.0 },
  { id: '923', name: '923 MHz', centerMHz: 923.0, minMHz: 922.0, maxMHz: 930.0 },
  { id: '2400', name: '2400 MHz', centerMHz: 2440.0, minMHz: 2400.0, maxMHz: 2500.0 },
  { id: FREE_ID, name: '20-20000 MHz', centerMHz: 868.0, minMHz: FREE_MIN_MHZ, maxMHz: FREE_MAX_MHZ },
].map(Object.freeze));

// Regiony (freqStart/padding w MHz jak w RegionInfo; wideLora = LoRa 2.4 GHz)
const REGIONS = {
  EU_433: { freqStart: 433.0, padding: 0.0, wideLora: false },
  CN: { freqStart: 470.0, padding: 0.0, wideLora: false },
  EU_868: { freqStart: 869.4, padding: 0.0, wideLora: false },
  EU_N_868: { freqStart: 869.4, padding: 0.0104, wideLora: false },
  US: { freqStart: 902.0, padding: 0.0, wideLora: false },
  LORA_24: { freqStart: 2400.0, padding: 0.0, wideLora: true },
};

export function bandById(id) {
  return PLANNER_BANDS.find((b) => b.id === id) || null;
}

/** Id pierwszego pasma stałego zawierającego mHz, inaczej 'free'. */
export function bandIdFor(mHz) {
  const b = PLANNER_BANDS.find((x) => x.id !== FREE_ID && mHz >= x.minMHz && mHz <= x.maxMHz);
  return b ? b.id : FREE_ID;
}

/** Region (freqStart, padding, wideLora) odpowiadający pasmu albo null. */
export function regionFor(bandId, bandwidthKhz) {
  switch (bandId) {
    case '433': return REGIONS.EU_433;
    case '470': return REGIONS.CN;
    case '868': return Math.abs(bandwidthKhz - 62.5) < 1.0 ? REGIONS.EU_N_868 : REGIONS.EU_868;
    case '915': return REGIONS.US;
    case '2400': return REGIONS.LORA_24;
    default: return null;
  }
}

// Float -> tekst -> Double (jak w Kotlinie), żeby nie mieć szumu typu 869.4000244
// Kotlin Float.toString() daje najkrótszą reprezentację rozróżniającą float; przybliżamy to szukaniem
// najkrótszej liczby cyfr, która po rzutowaniu na float daje tę samą wartość.
function floatShortest(x) {
  const t = Math.fround(x);
  for (let p = 1; p <= 9; p++) {
    const s = t.toPrecision(p);
    if (Math.fround(Number(s)) === t) return Number(s);
  }
  return t;
}

/**
 * Domyślna częstotliwość (MHz) dla pasma i szerokości kanału (efektywnej, już przeskalowanej dla 2.4 GHz).
 * 868 + 62.5 kHz -> 869.44165; inne szerokości w 868: 869.4 + BW/2 (np. 869.525 dla 250 kHz).
 */
export function defaultFrequencyMHz(bandId, bandwidthKhz) {
  const band = bandById(bandId);
  if (!band) return 868.0;
  const region = regionFor(band.id, bandwidthKhz);
  if (!region) return band.centerMHz;
  return floatShortest(region.freqStart) + floatShortest(region.padding) + bandwidthKhz / 2000.0;
}

/** 2.4 GHz to "wide LoRa": firmware skaluje szerokość pasma presetu przez 3.25. */
export function bandwidthScale(bandId) {
  const r = regionFor(bandId, 0.0);
  return r && r.wideLora ? 3.25 : 1.0;
}

/** Obcięcie do zakresu 20..20000 MHz (ważność ITM); NaN -> 868. */
export function clampMHz(mHz) {
  if (Number.isNaN(mHz)) return 868.0;
  return Math.min(FREE_MAX_MHZ, Math.max(FREE_MIN_MHZ, mHz));
}

/**
 * Presety modemu LoRa (ChannelOption): bandwidthKhz (bazowa), sf, cr (mianownik coding rate).
 * snrLimitDb = -7.5 - 2.5*(sf-7).
 */
export const MODEM_PRESETS = Object.freeze([
  ['VERY_LONG_SLOW', 62.5, 12, 8], ['LONG_TURBO', 500, 11, 8], ['LONG_FAST', 250, 11, 5],
  ['LONG_MODERATE', 125, 11, 8], ['LONG_SLOW', 125, 12, 8], ['MEDIUM_FAST', 250, 9, 5],
  ['MEDIUM_SLOW', 250, 10, 5], ['MEDIUM_TURBO', 500, 9, 5], ['SHORT_FAST', 250, 7, 5],
  ['SHORT_SLOW', 250, 8, 5], ['SHORT_TURBO', 500, 7, 5], ['LITE_FAST', 125, 9, 5],
  ['LITE_SLOW', 125, 10, 5], ['NARROW_FAST', 62.5, 7, 6], ['NARROW_SLOW', 62.5, 8, 6],
  ['TINY_FAST', 15.625, 7, 5], ['TINY_SLOW', 15.625, 8, 6],
].map(([id, bandwidthKhz, sf, cr]) => Object.freeze({ id, bandwidthKhz, sf, cr, snrLimitDb: -7.5 - 2.5 * (sf - 7) })));

export const DEFAULT_PRESET_ID = 'LONG_FAST';

/** Parametry radia (bandwidthKhz, spreadingFactor) presetu; nieznany -> LONG_FAST. */
export function radioFromPreset(presetId) {
  const p = MODEM_PRESETS.find((x) => x.id === presetId) || MODEM_PRESETS.find((x) => x.id === DEFAULT_PRESET_ID);
  return { bandwidthKhz: p.bandwidthKhz, spreadingFactor: p.sf };
}
