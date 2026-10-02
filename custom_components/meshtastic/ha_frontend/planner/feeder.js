// Kreator feedera (złącza + odcinki kabli) — port FeederBuilder.kt.
import { cableById, connectorById, cableLossDbPerM, connectorLossDb, MIN_F, MAX_F } from './cables.js';

export const CUSTOM_ID = 'custom';
/** Odcinek bez kabla (przejściówka): liczą się tylko straty złączy. */
export const NONE_ID = 'none';
export const MAX_CONNECTORS = 8;
const DEFAULT_CONNECTOR = 'sma';
const DEFAULT_CABLE = 'rg316';
const DEFAULT_LENGTH_M = 0.2;

const S = (cableId, lengthM, customDbPerM = null) => ({ cableId, lengthM, customDbPerM });
const P = (id, connectorIds, sections) => Object.freeze({ id, config: { connectorIds, sections } });

/** Gotowe konfiguracje feedera: {id, config:{connectorIds:string[], sections:{cableId,lengthM,customDbPerM}[]}}. */
export const FEEDER_PRESETS = Object.freeze([
  P('direct', [], []),
  P('pigtail', ['ufl', 'sma'], [S('rg316', 0.2)]),
  P('adapter_sma_n', ['sma', 'n'], [S(NONE_ID, 0.0)]),
  P('adapter_n_n', ['n', 'n'], [S(NONE_ID, 0.0)]),
  P('pigtail_cable', ['ufl', 'sma', 'n'], [S('rg316', 0.2), S('lmr400', 10.0)]),
  P('long_lmr400', ['ufl', 'sma', 'n'], [S('rg316', 0.2), S('lmr400', 20.0)]),
  P('ecoflex_roof', ['ufl', 'sma', 'n'], [S('rg316', 0.2), S('ecoflex10', 15.0)]),
  P('heliax_mast', ['sma', 'n', 'n'], [S('lmr195', 1.0), S('ldf4_50a', 40.0)]),
]);

/** Liczba z maks. 2 miejscami po przecinku, bez zer końcowych (jak fmt() w Kotlinie). */
function fmt(v) {
  const r = Math.round(Math.min(v, 1.0e6) * 100.0) / 100.0;
  return String(r);
}

/**
 * Strata feedera przy fMHz. Kolejność: złącze 0, odcinek 0, złącze 1, ...
 * @returns {{totalDb:number, lines:{label:string,lossDb:number}[], approximate:boolean, warnings:string[]}}
 *  warnings: SECTION_COUNT_MISMATCH, CONNECTOR_COUNT_EXCEEDS_MAX, UNKNOWN_CONNECTOR:<id>, UNKNOWN_CABLE:<id>,
 *  CUSTOM_LOSS_MISSING, INVALID_LENGTH, FREQUENCY_CLAMPED
 */
export function computeFeeder(config, fMHz) {
  const warnings = [];
  const lines = [];
  let approx = false;
  let total = 0.0;

  if (Number.isNaN(fMHz) || fMHz < MIN_F || fMHz > MAX_F) warnings.push('FREQUENCY_CLAMPED');

  let n = config.connectorIds.length;
  if (n > MAX_CONNECTORS) {
    warnings.push('CONNECTOR_COUNT_EXCEEDS_MAX');
    n = MAX_CONNECTORS;
  }
  const expectedSections = n > 0 ? n - 1 : 0;
  if (config.sections.length !== expectedSections) warnings.push('SECTION_COUNT_MISMATCH');

  for (let i = 0; i < n; i++) {
    const id = config.connectorIds[i];
    const c = connectorById(id);
    if (!c) {
      warnings.push(`UNKNOWN_CONNECTOR:${id}`);
      approx = true;
      lines.push({ label: id, lossDb: 0.0 });
    } else {
      const l = connectorLossDb(c, fMHz);
      total += l;
      if (c.approximate) approx = true;
      lines.push({ label: c.name, lossDb: l });
    }
    if (i < expectedSections && i < config.sections.length) {
      const s = config.sections[i];
      let len = s.lengthM;
      if (Number.isNaN(len) || len < 0.0) {
        warnings.push('INVALID_LENGTH');
        len = 0.0;
      }
      const lenLabel = fmt(len);
      if (s.cableId === NONE_ID) {
        // przejściówka: brak straty kabla i brak linii
      } else if (s.cableId === CUSTOM_ID) {
        const perM = s.customDbPerM;
        if (perM == null || Number.isNaN(perM) || perM < 0.0) {
          warnings.push('CUSTOM_LOSS_MISSING');
          lines.push({ label: `${CUSTOM_ID} · ${lenLabel} m`, lossDb: 0.0 });
        } else {
          const l = perM * len;
          total += l;
          lines.push({ label: `${CUSTOM_ID} · ${lenLabel} m`, lossDb: l });
        }
      } else {
        const cable = cableById(s.cableId);
        if (!cable) {
          warnings.push(`UNKNOWN_CABLE:${s.cableId}`);
          approx = true;
          lines.push({ label: `${s.cableId} · ${lenLabel} m`, lossDb: 0.0 });
        } else {
          const l = cableLossDbPerM(cable, fMHz) * len;
          total += l;
          if (cable.approximate) approx = true;
          lines.push({ label: `${cable.name} · ${lenLabel} m`, lossDb: l });
        }
      }
    }
  }
  return { totalDb: total, lines, approximate: approx, warnings };
}

/** Zmienia liczbę złączy (0..8) i odcinków max(N-1,0), zachowując istniejące; nowe: SMA / RG316 0.2 m. */
export function resizeFeeder(config, connectorCount) {
  const n = Math.min(MAX_CONNECTORS, Math.max(0, Math.trunc(connectorCount)));
  const sectionCount = n > 0 ? n - 1 : 0;
  const connectorIds = Array.from({ length: n }, (_, i) => config.connectorIds[i] ?? DEFAULT_CONNECTOR);
  const sections = Array.from({ length: sectionCount }, (_, i) => config.sections[i] ?? S(DEFAULT_CABLE, DEFAULT_LENGTH_M));
  return { connectorIds, sections };
}
