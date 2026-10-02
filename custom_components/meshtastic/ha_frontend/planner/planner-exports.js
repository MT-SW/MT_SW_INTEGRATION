// Eksport wyników plannera: model raportu, CSV, KML, GeoJSON i obraz PNG profilu (port PlannerReportBuilder,
// PlannerCsv, PlannerKml, PlannerGeoJson, PlannerProfileImage z aplikacji na Androida). PDF jest w planner-pdf.js.
// Czyste funkcje, bez DOM (poza `profileToPngBlob`, które potrzebuje canvasu — rysowanie jest wydzielone
// do `drawProfileImage(ctx, ...)`, więc da się je testować na atrapie kontekstu).
import { fmt, fmtTrim, niceTicks, decimalsFor } from './planner-format.js';
import { feederLossOf, computeFeeder, destination, sensitivityDbm } from './index.js';

/** Pola napisów raportu -> klucze zasobów (planner_report_*). */
const REPORT_KEYS = {
  title: 'report_title', footer: 'report_footer',
  sectionStationA: 'report_section_station_a', sectionStationB: 'report_section_station_b',
  sectionRadio: 'report_section_radio', sectionLink: 'report_section_link', sectionResults: 'report_section_results',
  sectionWeather: 'report_section_weather', sectionMeasured: 'report_section_measured',
  defaultNameA: 'report_section_station_a', defaultNameB: 'report_section_station_b',
  lblName: 'report_lbl_name', lblLatitude: 'report_lbl_latitude', lblLongitude: 'report_lbl_longitude',
  lblGroundAlt: 'report_lbl_ground_alt', lblAntennaHeight: 'report_lbl_antenna_height', lblTxPower: 'report_lbl_tx_power',
  lblAntennaGain: 'report_lbl_antenna_gain', lblFeederLoss: 'report_lbl_feeder_loss', lblFeederApprox: 'report_lbl_feeder_approx',
  lblFrequency: 'report_lbl_frequency', lblBandwidth: 'report_lbl_bandwidth', lblSpreadingFactor: 'report_lbl_spreading_factor',
  lblNoiseFigure: 'report_lbl_noise_figure', lblNoiseFloor: 'report_lbl_noise_floor', lblSensitivity: 'report_lbl_sensitivity',
  lblDistance: 'report_lbl_distance', lblAzimuthAB: 'report_lbl_azimuth_ab', lblAzimuthBA: 'report_lbl_azimuth_ba',
  lblElevationAngleA: 'report_lbl_elevation_a', lblElevationAngleB: 'report_lbl_elevation_b', lblFspl: 'report_lbl_fspl',
  lblItmLoss: 'report_lbl_itm_loss', lblExtraLoss: 'report_lbl_extra_loss', lblTerrainData: 'report_lbl_terrain_data',
  valTerrainOsm: 'report_val_terrain_osm', lblTotalLoss: 'report_lbl_total_loss', lblLineOfSight: 'report_lbl_line_of_sight',
  lblFresnel: 'report_lbl_fresnel', lblKFactor: 'report_lbl_k_factor', lblRefractivity: 'report_lbl_refractivity',
  lblRxPowerAB: 'report_lbl_rx_power_ab', lblMarginAB: 'report_lbl_margin_ab', lblVerdictAB: 'report_lbl_verdict_ab',
  lblRxPowerBA: 'report_lbl_rx_power_ba', lblMarginBA: 'report_lbl_margin_ba', lblVerdictBA: 'report_lbl_verdict_ba',
  verdictExcellent: 'verdict_excellent', verdictGood: 'verdict_good', verdictMarginal: 'verdict_marginal',
  verdictWeak: 'verdict_weak', verdictNoLink: 'verdict_no_link', yes: 'yes', no: 'no',
  lblWeatherTime: 'report_lbl_weather_time', lblWeatherSource: 'report_lbl_weather_source',
  lblTemperature: 'report_lbl_temperature', lblPressure: 'report_lbl_pressure', lblHumidity: 'report_lbl_humidity',
  lblRain: 'report_lbl_rain', lblDucting: 'report_lbl_ducting',
  ductingNormal: 'ducting_normal', ductingElevated: 'ducting_elevated', ductingPossible: 'ducting_possible',
  lblMeasuredNode: 'report_lbl_measured_node', lblPredictedRssi: 'report_lbl_pred_rssi', lblMeasuredRssi: 'report_lbl_meas_rssi',
  lblRssiDelta: 'report_lbl_delta_rssi', lblPredictedSnr: 'report_lbl_pred_snr', lblMeasuredSnr: 'report_lbl_meas_snr',
  lblSnrDelta: 'report_lbl_delta_snr', noteNotDirect: 'report_note_not_direct',
  chartLabelA: 'chart_label_a', chartLabelB: 'chart_label_b', chartXAxis: 'report_chart_x_axis', chartYAxis: 'report_chart_y_axis',
  coverageTitle: 'report_coverage_title',
  legendExcellent: 'report_legend_excellent', legendGood: 'report_legend_good', legendMarginal: 'report_legend_marginal',
  legendWeak: 'report_legend_weak', legendNone: 'report_legend_none',
  disclaimer: 'report_disclaimer', noteWeatherUsed: 'report_note_weather_used', noteWeatherNotUsed: 'report_note_weather_not_used',
  noteWeatherFailed: 'report_note_weather_failed',
};

const CREDIT_KEYS = ['credits_line_meshmap', 'credits_line_siteplanner_original', 'credits_line_splat', 'credits_line_itm',
  'credits_line_mapterhorn', 'credits_line_openmeteo', 'credits_line_osm', 'credits_line_cables'];

/** Kolory klas zasięgu w raporcie (jak PlannerReportBuilder.COLORS: ciemna zieleń ... czerwień). */
export const REPORT_COVERAGE_COLORS = Object.freeze([0x1B5E20, 0x66BB6A, 0xFFEB3B, 0xEF6C00, 0xB71C1C]);
export const REPORT_COVERAGE_THRESHOLDS = Object.freeze([20, 10, 0, -10]);

/**
 * Napisy raportu. `tr(key, ...args)` zwraca napis planner_<key> (np. ps.bind(null, hass) albo psLang.bind(null, 'pl')).
 */
export function makeReportStrings(tr, nowMs = Date.now()) {
  const s = {};
  for (const [field, key] of Object.entries(REPORT_KEYS)) s[field] = tr(key);
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  s.generatedAt = `${tr('report_generated')} ${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
  s.credits = CREDIT_KEYS.map((k) => tr(k));
  Object.assign(s, {
    unitM: 'm', unitKm: 'km', unitDb: 'dB', unitDbm: 'dBm', unitMHz: 'MHz', unitKHz: 'kHz', unitW: 'W', unitDeg: '°',
    unitHpa: 'hPa', unitCelsius: '°C', unitPercent: '%', unitMmH: 'mm/h', unitDbi: 'dBi',
  });
  return s;
}

const kv = (label, value) => ({ label, value });
const dbText = (v, s) => `${fmt(v, 1)} ${s.unitDb}`;

function verdictText(v, s) {
  switch (v) {
    case 'EXCELLENT': return s.verdictExcellent;
    case 'GOOD': return s.verdictGood;
    case 'MARGINAL': return s.verdictMarginal;
    case 'WEAK': return s.verdictWeak;
    default: return s.verdictNoLink;
  }
}

function duct(level, s) {
  if (level === 'ELEVATED') return s.ductingElevated;
  if (level === 'POSSIBLE_DUCT') return s.ductingPossible;
  return s.ductingNormal;
}

function endRows(e, s, defaultName, fMHz) {
  const rows = [kv(s.lblName, (e.name && e.name.trim()) || defaultName)];
  if (typeof e.lat === 'number' && typeof e.lon === 'number') {
    rows.push(kv(s.lblLatitude, fmt(e.lat, 6)), kv(s.lblLongitude, fmt(e.lon, 6)));
  }
  if (typeof e.groundAltM === 'number') rows.push(kv(s.lblGroundAlt, `${fmt(e.groundAltM, 1)} ${s.unitM}`));
  rows.push(kv(s.lblAntennaHeight, `${fmtTrim(e.antennaHeightM, 1)} ${s.unitM}`));
  const watts = Math.pow(10, e.txPowerDbm / 10) / 1000;
  rows.push(kv(s.lblTxPower, `${fmtTrim(e.txPowerDbm, 1)} ${s.unitDbm} (${fmtTrim(watts, 3)} ${s.unitW})`));
  rows.push(kv(s.lblAntennaGain, `${fmtTrim(e.antennaGainDbi, 2)} ${s.unitDbi}`));
  rows.push(kv(s.lblFeederLoss, dbText(feederLossOf(e, fMHz), s)));
  if (e.feederPrecise) {
    const res = computeFeeder(e.feederConfig, fMHz);
    for (const line of res.lines) rows.push(kv(line.label, dbText(line.lossDb, s)));
    if (res.approximate) rows.push(kv(s.lblFeederApprox, s.yes));
  }
  return rows;
}

function radioRows(st, s) {
  const noiseFloor = -174 + 10 * Math.log10(st.bandwidthKhz * 1000) + st.noiseFigureDb;
  // UWAGA: kolejność argumentów to (BW, SF, NF) — API.md podaje (BW, NF, SF), co jest błędem w dokumentacji.
  const sens = sensitivityDbm(st.bandwidthKhz, st.spreadingFactor, st.noiseFigureDb);
  return [
    kv(s.lblFrequency, `${fmtTrim(st.frequencyMHz, 5)} ${s.unitMHz}`),
    kv(s.lblBandwidth, `${fmtTrim(st.bandwidthKhz, 3)} ${s.unitKHz}`),
    kv(s.lblSpreadingFactor, `SF${st.spreadingFactor}`),
    kv(s.lblNoiseFigure, dbText(st.noiseFigureDb, s)),
    kv(s.lblNoiseFloor, `${fmt(noiseFloor, 1)} ${s.unitDbm}`),
    kv(s.lblSensitivity, `${fmt(sens, 1)} ${s.unitDbm}`),
  ];
}

function pointOf(e, name, s) {
  if (typeof e.lat !== 'number' || typeof e.lon !== 'number') return null;
  const description = `${fmtTrim(e.txPowerDbm, 1)} ${s.unitDbm}, ${fmtTrim(e.antennaGainDbi, 2)} ${s.unitDbi}, ${fmtTrim(e.antennaHeightM, 1)} ${s.unitM}`;
  return { name, lat: e.lat, lon: e.lon, description };
}

/** Próbki zasięgu: punkt na każdym promieniu i pierścieniu (margines -200 = brak danych jest pomijany). */
export function coverageCells(cov) {
  const cells = [];
  for (let r = 0; r < cov.radials; r++) {
    const bearing = (360 * r) / cov.radials;
    const row = cov.marginDb[r];
    for (let j = 0; j < cov.ringsM.length; j++) {
      const m = row[j];
      if (!(m > -199)) continue;
      const p = destination(cov.center, bearing, cov.ringsM[j]);
      cells.push({ lat: p.lat, lon: p.lon, marginDb: m });
    }
  }
  return cells;
}

function coverageOf(st, s) {
  const cov = st.coverage;
  if (!cov) return null;
  const labels = [s.legendExcellent, s.legendGood, s.legendMarginal, s.legendWeak, s.legendNone];
  const rangeM = cov.ringsM.length ? cov.ringsM[cov.ringsM.length - 1] : 0;
  return {
    centerLat: cov.center.lat,
    centerLon: cov.center.lon,
    samples: coverageCells(cov),
    maxRangeKm: rangeM / 1000,
    legend: labels.map((l, i) => [l, REPORT_COVERAGE_COLORS[i]]),
    title: s.coverageTitle,
    thresholdsDb: [...REPORT_COVERAGE_THRESHOLDS],
  };
}

/**
 * Model raportu (jak PlannerReportBuilder.build). `st` to stan PlannerStore, `s` napisy z makeReportStrings.
 */
export function buildReport(st, s) {
  const sections = [];
  sections.push({ title: s.sectionStationA, rows: endRows(st.a, s, s.defaultNameA, st.frequencyMHz) });
  sections.push({ title: s.sectionStationB, rows: endRows(st.b, s, s.defaultNameB, st.frequencyMHz) });
  sections.push({ title: s.sectionRadio, rows: radioRows(st, s) });
  const link = st.link;
  if (link) {
    const path = [
      kv(s.lblDistance, `${fmt(link.distanceM / 1000, 3)} ${s.unitKm}`),
      kv(s.lblAzimuthAB, `${fmt(link.bearingAToBDeg, 1)} ${s.unitDeg}`),
      kv(s.lblAzimuthBA, `${fmt(link.bearingBToADeg, 1)} ${s.unitDeg}`),
      kv(s.lblElevationAngleA, `${fmt(link.elevationAAngleDeg, 2)} ${s.unitDeg}`),
      kv(s.lblElevationAngleB, `${fmt(link.elevationBAngleDeg, 2)} ${s.unitDeg}`),
      kv(s.lblFspl, dbText(link.freeSpaceLossDb, s)),
      kv(s.lblItmLoss, dbText(link.itmLossDb, s)),
      kv(s.lblExtraLoss, dbText(link.totalPathLossDb - link.itmLossDb, s)),
    ];
    if (st.preciseTerrain && st.clutter && st.clutter.kind === 'ready') path.push(kv(s.lblTerrainData, s.valTerrainOsm));
    path.push(
      kv(s.lblTotalLoss, dbText(link.totalPathLossDb, s)),
      kv(s.lblLineOfSight, link.lineOfSightClear ? s.yes : s.no),
      kv(s.lblFresnel, `${fmt(link.worstFresnelClearanceM, 1)} ${s.unitM} (${fmt(link.worstFresnelRatio * 100, 0)} ${s.unitPercent})`),
      kv(s.lblKFactor, fmt(st.kFactor, 3)),
      kv(s.lblRefractivity, fmt(st.surfaceRefractivity, 1)),
    );
    sections.push({ title: s.sectionLink, rows: path });
    sections.push({
      title: s.sectionResults,
      rows: [
        kv(s.lblRxPowerAB, `${fmt(link.aToB.rxPowerDbm, 1)} ${s.unitDbm}`),
        kv(s.lblMarginAB, dbText(link.aToB.marginDb, s)),
        kv(s.lblVerdictAB, verdictText(link.aToB.verdict, s)),
        kv(s.lblRxPowerBA, `${fmt(link.bToA.rxPowerDbm, 1)} ${s.unitDbm}`),
        kv(s.lblMarginBA, dbText(link.bToA.marginDb, s)),
        kv(s.lblVerdictBA, verdictText(link.bToA.verdict, s)),
      ],
    });
  }
  const notes = [s.disclaimer];
  const ws = st.weather;
  if (st.useWeather && ws && ws.kind === 'ready') {
    const c = ws.conditions;
    sections.push({
      title: s.sectionWeather,
      rows: [
        kv(s.lblWeatherTime, c.fetchedAtIso),
        kv(s.lblWeatherSource, c.source),
        kv(s.lblTemperature, `${fmt(c.tempC, 1)} ${s.unitCelsius}`),
        kv(s.lblPressure, `${fmt(c.pressureHpa, 1)} ${s.unitHpa}`),
        kv(s.lblHumidity, `${fmt(c.rhPct, 0)} ${s.unitPercent}`),
        kv(s.lblRain, `${fmt(c.rainMmH, 1)} ${s.unitMmH}`),
        kv(s.lblDucting, duct(c.level, s)),
        kv(s.lblKFactor, fmt(c.analysis.kFactor, 3)),
        kv(s.lblRefractivity, fmt(c.analysis.seaLevelN, 1)),
      ],
    });
    notes.push(`${s.noteWeatherUsed} ${c.source}, ${c.fetchedAtIso} UTC`);
  } else if (st.useWeather) {
    notes.push(s.noteWeatherFailed);
  } else {
    notes.push(s.noteWeatherNotUsed);
  }
  const cmp = st.comparison;
  if (cmp) {
    const rows = [kv(s.lblMeasuredNode, cmp.nodeName), kv(s.lblPredictedRssi, `${fmt(cmp.predictedRssiDbm, 1)} ${s.unitDbm}`)];
    if (cmp.measuredRssiDbm !== null && cmp.measuredRssiDbm !== undefined) rows.push(kv(s.lblMeasuredRssi, `${cmp.measuredRssiDbm} ${s.unitDbm}`));
    if (cmp.rssiDeltaDb !== null && cmp.rssiDeltaDb !== undefined) rows.push(kv(s.lblRssiDelta, dbText(cmp.rssiDeltaDb, s)));
    rows.push(kv(s.lblPredictedSnr, `${fmt(cmp.predictedSnrDb, 1)} ${s.unitDb}`));
    if (cmp.measuredSnrDb !== null && cmp.measuredSnrDb !== undefined) rows.push(kv(s.lblMeasuredSnr, `${fmt(cmp.measuredSnrDb, 1)} ${s.unitDb}`));
    if (cmp.snrDeltaDb !== null && cmp.snrDeltaDb !== undefined) rows.push(kv(s.lblSnrDelta, dbText(cmp.snrDeltaDb, s)));
    sections.push({ title: s.sectionMeasured, rows });
    if (!cmp.direct) notes.push(s.noteNotDirect);
  }
  notes.push(...s.credits);

  const nameA = (st.a.name && st.a.name.trim()) || s.defaultNameA;
  const nameB = (st.b.name && st.b.name.trim()) || s.defaultNameB;
  const points = [pointOf(st.a, nameA, s), pointOf(st.b, nameB, s)].filter(Boolean);
  const series = st.series;
  const profile = series ? {
    distancesM: series.distancesM, groundM: series.groundM, losM: series.losM,
    fresnelUpperM: series.fresnelUpperM, fresnelLowerM: series.fresnelLowerM,
    labelA: `${s.chartLabelA}: ${nameA}`, labelB: `${s.chartLabelB}: ${nameB}`,
    xAxisLabel: s.chartXAxis, yAxisLabel: s.chartYAxis,
  } : null;
  const subtitle = `${nameA} - ${nameB} | ${fmtTrim(st.frequencyMHz, 5)} ${s.unitMHz} | ${fmtTrim(st.bandwidthKhz, 3)} ${s.unitKHz} | SF${st.spreadingFactor}`;
  return {
    title: s.title, subtitle, generatedAt: s.generatedAt, sections, profile, coverage: coverageOf(st, s), points, notes, footer: s.footer,
  };
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------
const SEP = ';';
const EOL = '\r\n';

export function csvQuote(s) {
  const need = /[;"\n\r]/.test(s) || s.startsWith(' ') || s.endsWith(' ');
  return need ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Wykres: wspólne dane do CSV, PNG i PDF. */
export function chartData(p) {
  const n = Math.min(p.distancesM.length, p.groundM.length, p.losM.length, p.fresnelUpperM.length, p.fresnelLowerM.length);
  const c = { n, valid: n >= 2, x: p.distancesM, ground: p.groundM, los: p.losM, up: p.fresnelUpperM, lo: p.fresnelLowerM,
    xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  if (n >= 1) {
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(c.x[i])) { x0 = Math.min(x0, c.x[i]); x1 = Math.max(x1, c.x[i]); }
      for (const v of [c.ground[i], c.los[i], c.up[i], c.lo[i]]) if (Number.isFinite(v)) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    }
    if (x0 <= x1) { c.xMin = x0; c.xMax = x1; }
    if (y0 <= y1) { c.yMin = y0; c.yMax = y1; }
  }
  if (c.xMax - c.xMin < 1e-9) c.xMax = c.xMin + 1;
  const pad = Math.max((c.yMax - c.yMin) * 0.06, 1);
  c.yMin -= pad;
  c.yMax += pad;
  c.xTicks = niceTicks(c.xMin, c.xMax, 8);
  c.yTicks = niceTicks(c.yMin, c.yMax, 6);
  return c;
}

/** Nagłówek `distance_m;ground_m;los_m;fresnel_upper_m;fresnel_lower_m` i po jednym wierszu na próbkę profilu. */
export function csvProfile(report) {
  let out = `distance_m;ground_m;los_m;fresnel_upper_m;fresnel_lower_m${EOL}`;
  if (!report.profile) return out;
  const c = chartData(report.profile);
  for (let i = 0; i < c.n; i++) {
    out += [fmt(c.x[i], 1), fmt(c.ground[i], 1), fmt(c.los[i], 2), fmt(c.up[i], 2), fmt(c.lo[i], 2)].join(SEP) + EOL;
  }
  return out;
}

/** Wiersz `etykieta;wartość` dla każdego wiersza każdej sekcji. */
export function csvSummary(report) {
  let out = '';
  for (const s of report.sections) {
    if (s.rows.length === 0) out += csvQuote(s.title) + SEP + EOL;
    for (const r of s.rows) out += csvQuote(r.label) + SEP + csvQuote(r.value) + EOL;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// KML / GeoJSON
// ---------------------------------------------------------------------------------------------
export function xmlEscape(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&apos;';
    else if (c < 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) continue;
    else if (c === 0xfffe || c === 0xffff) continue;
    else out += ch;
  }
  return out;
}

export function jsonStr(s) {
  // JSON.stringify daje poprawny napis JSON; dodatkowo U+2028/2029 jako \\u (jak w wersji Android)
  return JSON.stringify(String(s)).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
}

const hex2 = (v) => (v < 16 ? '0' : '') + v.toString(16);

/** Indeks klasy zasięgu wg progów raportu (0 = najlepsza). */
export function coverageBinIndex(cov, margin) {
  const k = cov.legend.length;
  if (k === 0) return -1;
  for (let i = 0; i < k - 1; i++) {
    const t = i < cov.thresholdsDb.length && cov.thresholdsDb.length >= k - 1 ? cov.thresholdsDb[i] : 20 - 10 * i;
    if (margin >= t) return i;
  }
  return k - 1;
}

export function coverageBinColor(cov, idx) {
  const raw = idx >= 0 && idx < cov.legend.length ? cov.legend[idx][1] : 0x607D8B;
  return raw & 0xFFFFFF;
}

const kmlColor = (rgb) => `ff${hex2(rgb & 255)}${hex2((rgb >> 8) & 255)}${hex2((rgb >> 16) & 255)}`;
const kmlCoord = (lat, lon) => `${fmt(lon, 6)},${fmt(lat, 6)},0`;

export function renderKml(report) {
  let sb = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n';
  sb += `<name>${xmlEscape(report.title)}</name>\n`;
  const desc = [report.subtitle, report.generatedAt].filter((x) => x).join('\n');
  if (desc) sb += `<description>${xmlEscape(desc)}</description>\n`;
  sb += '<Style id="pt"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>\n';
  sb += '<Style id="link"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style>\n';
  const cov = report.coverage;
  const icon = 'http://maps.google.com/mapfiles/kml/shapes/placemark_square.png';
  if (cov) {
    for (let i = 0; i < cov.legend.length; i++) {
      sb += `<Style id="cov${i}"><IconStyle><color>${kmlColor(coverageBinColor(cov, i))}</color><scale>0.4</scale><Icon><href>${icon}</href></Icon></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>\n`;
    }
    sb += `<Style id="cov-1"><IconStyle><color>ff8b7d60</color><scale>0.4</scale><Icon><href>${icon}</href></Icon></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>\n`;
  }
  for (const p of report.points) {
    sb += `<Placemark><name>${xmlEscape(p.name)}</name>`;
    if (p.description) sb += `<description>${xmlEscape(p.description)}</description>`;
    sb += `<styleUrl>#pt</styleUrl><Point><coordinates>${kmlCoord(p.lat, p.lon)}</coordinates></Point></Placemark>\n`;
  }
  if (report.points.length >= 2) {
    const [a, b] = report.points;
    sb += `<Placemark><name>${xmlEscape(`${a.name} - ${b.name}`)}</name><styleUrl>#link</styleUrl><LineString><tessellate>1</tessellate><coordinates>${kmlCoord(a.lat, a.lon)} ${kmlCoord(b.lat, b.lon)}</coordinates></LineString></Placemark>\n`;
  }
  if (cov) {
    sb += `<Folder><name>${xmlEscape(cov.title)}</name>\n`;
    sb += `<Placemark><name>${xmlEscape(cov.title)}</name><styleUrl>#pt</styleUrl><Point><coordinates>${kmlCoord(cov.centerLat, cov.centerLon)}</coordinates></Point></Placemark>\n`;
    for (const s of cov.samples) {
      if (Number.isNaN(s.marginDb)) continue;
      const idx = coverageBinIndex(cov, s.marginDb);
      sb += `<Placemark><styleUrl>#cov${idx}</styleUrl><ExtendedData><Data name="margin_db"><value>${fmt(s.marginDb, 1)}</value></Data></ExtendedData><Point><coordinates>${kmlCoord(s.lat, s.lon)}</coordinates></Point></Placemark>\n`;
    }
    sb += '</Folder>\n';
  }
  return `${sb}</Document>\n</kml>\n`;
}

const gjPos = (lat, lon) => `[${fmt(lon, 6)},${fmt(lat, 6)}]`;

export function renderGeoJson(report) {
  const feats = [];
  for (const p of report.points) {
    feats.push(`{"type":"Feature","geometry":{"type":"Point","coordinates":${gjPos(p.lat, p.lon)}},"properties":{"name":${jsonStr(p.name)},"description":${jsonStr(p.description)}}}`);
  }
  if (report.points.length >= 2) {
    const [a, b] = report.points;
    feats.push(`{"type":"Feature","geometry":{"type":"LineString","coordinates":[${gjPos(a.lat, a.lon)},${gjPos(b.lat, b.lon)}]},"properties":{"name":${jsonStr(`${a.name} - ${b.name}`)}}}`);
  }
  const cov = report.coverage;
  if (cov) {
    feats.push(`{"type":"Feature","geometry":{"type":"Point","coordinates":${gjPos(cov.centerLat, cov.centerLon)}},"properties":{"name":${jsonStr(cov.title)},"kind":"coverage_center"}}`);
    for (const s of cov.samples) {
      if (Number.isNaN(s.marginDb) || !Number.isFinite(s.marginDb)) continue;
      const col = coverageBinColor(cov, coverageBinIndex(cov, s.marginDb));
      feats.push(`{"type":"Feature","geometry":{"type":"Point","coordinates":${gjPos(s.lat, s.lon)}},"properties":{"margin_db":${fmt(s.marginDb, 1)},"color":"#${hex2((col >> 16) & 255)}${hex2((col >> 8) & 255)}${hex2(col & 255)}"}}`);
    }
  }
  return `{"type":"FeatureCollection","name":${jsonStr(report.title)},"features":[\n${feats.join(',\n')}\n]}\n`;
}

// ---------------------------------------------------------------------------------------------
// PNG profilu (canvas 2D)
// ---------------------------------------------------------------------------------------------
const PNG_COLORS = { bg: '#ffffff', ink: '#222222', grid: '#dddddd', fresnel: '#bfd9f2', terrain: '#b89f78', terrainLine: '#6b5636', los: '#d32f2f' };

/**
 * Rysuje wykres profilu na kontekście 2D o rozmiarze width x height (jak PlannerProfileImage).
 * @returns {{px0:number,py0:number,pw:number,ph:number}} obszar wykresu
 */
export function drawProfileImage(ctx, profile, width = 1200, height = 600) {
  const C = PNG_COLORS;
  const s = width >= 900 ? 2 : 1;
  const chart = chartData(profile);
  const left = 12 * s * 3 + 10;
  const right = 40;
  const top = 22 * s + 14;
  const bottom = 8 * s * 3 + 10;
  const pw = Math.max(10, width - left - right);
  const ph = Math.max(10, height - top - bottom);
  const px0 = left;
  const py0 = top;
  const sx = (v) => px0 + ((v - chart.xMin) / (chart.xMax - chart.xMin)) * pw;
  const sy = (v) => py0 + ph - ((v - chart.yMin) / (chart.yMax - chart.yMin)) * ph;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, height);
  const line = (x0, y0, x1, y1, w, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  };
  const xd = decimalsFor(chart.xTicks.length > 1 ? chart.xTicks[1] - chart.xTicks[0] : 1);
  const yd = decimalsFor(chart.yTicks.length > 1 ? chart.yTicks[1] - chart.yTicks[0] : 1);
  for (const t of chart.yTicks) line(px0, sy(t), px0 + pw, sy(t), 1, C.grid);
  for (const t of chart.xTicks) line(sx(t), py0, sx(t), py0 + ph, 1, C.grid);
  if (chart.valid) {
    const n = chart.n;
    ctx.fillStyle = C.fresnel;
    ctx.beginPath();
    for (let i = 0; i < n; i++) (i === 0 ? ctx.moveTo(sx(chart.x[i]), sy(chart.up[i])) : ctx.lineTo(sx(chart.x[i]), sy(chart.up[i])));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(sx(chart.x[i]), sy(chart.lo[i]));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.terrain;
    ctx.beginPath();
    for (let i = 0; i < n; i++) (i === 0 ? ctx.moveTo(sx(chart.x[i]), sy(chart.ground[i])) : ctx.lineTo(sx(chart.x[i]), sy(chart.ground[i])));
    ctx.lineTo(sx(chart.x[n - 1]), py0 + ph);
    ctx.lineTo(sx(chart.x[0]), py0 + ph);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.terrainLine; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i < n; i++) (i === 0 ? ctx.moveTo(sx(chart.x[i]), sy(chart.ground[i])) : ctx.lineTo(sx(chart.x[i]), sy(chart.ground[i])));
    ctx.stroke();
    ctx.strokeStyle = C.los; ctx.lineWidth = 2.2; ctx.beginPath();
    for (let i = 0; i < n; i++) (i === 0 ? ctx.moveTo(sx(chart.x[i]), sy(chart.los[i])) : ctx.lineTo(sx(chart.x[i]), sy(chart.los[i])));
    ctx.stroke();
  }
  line(px0, py0, px0, py0 + ph, 1.5, C.ink);
  line(px0, py0 + ph, px0 + pw, py0 + ph, 1.5, C.ink);
  const fontPx = 6 * s + 6;
  ctx.fillStyle = C.ink;
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  for (const t of chart.xTicks) {
    const x = sx(t);
    line(x, py0 + ph, x, py0 + ph + 5, 1.5, C.ink);
    ctx.fillText(fmt(t, xd), x, py0 + ph + 9 + fontPx);
  }
  ctx.textAlign = 'right';
  for (const t of chart.yTicks) {
    const y = sy(t);
    line(px0 - 5, y, px0, y, 1.5, C.ink);
    ctx.fillText(fmt(t, yd), px0 - 9, y + fontPx * 0.35);
  }
  ctx.textAlign = 'center';
  ctx.fillText(profile.xAxisLabel, px0 + pw / 2, height - 8);
  ctx.save();
  ctx.translate(fontPx + 2, py0 + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(profile.yAxisLabel, 0, 0);
  ctx.restore();
  const labelPx = fontPx + 4;
  ctx.font = `bold ${labelPx}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(profile.labelA, px0, py0 - 8);
  ctx.textAlign = 'right';
  ctx.fillText(profile.labelB, px0 + pw, py0 - 8);
  return { px0, py0, pw, ph };
}

/** PNG profilu jako Blob (potrzebuje przeglądarki). */
export function profileToPngBlob(profile, width = 1200, height = 600) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D niedostępny')); return; }
      drawProfileImage(ctx, profile, width, height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob zwrócił null'))), 'image/png');
    } catch (e) {
      reject(e);
    }
  });
}
