/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Definicje wykresów historii telemetrii węzła.
 *
 * Każdy parametr fizyczny dostaje własny wykres z własną skalą (temperatura,
 * wilgotność i ciśnienie na jednej osi byłyby nieczytelne). Napięcie i prąd
 * zbieramy ze wszystkich pakietów, które je niosą: pakiet środowiskowy
 * (czujnik), pakiet urządzenia (napięcie baterii) i pakiet mocy (kanały 1-3) —
 * ten sam węzeł potrafi wysyłać je różnymi drogami, więc każde źródło jest
 * osobną linią na wspólnym wykresie tej samej wielkości.
 *
 * Moduł jest czystą funkcją, bez zależności od Lita ani DOM.
 */

/* source: klucz z this._telemetryHistory (device | environment | power) */
const CHARTS = [
  {
    id: "temperature",
    unit: " °C",
    series: [
      { source: "environment", field: "temperature", labelKey: "nodes.history.temperature", color: "#F5C839" },
    ],
  },
  {
    id: "humidity",
    unit: " %",
    series: [
      { source: "environment", field: "relativeHumidity", labelKey: "nodes.history.humidity", color: "#4FC3F7" },
    ],
  },
  {
    id: "pressure",
    unit: " hPa",
    series: [
      { source: "environment", field: "barometricPressure", labelKey: "nodes.history.pressure", color: "#FF8A65" },
    ],
  },
  {
    id: "voltage",
    unit: " V",
    series: [
      { source: "environment", field: "voltage", labelKey: "nodes.history.voltage_sensor", color: "#81C784" },
      { source: "device", field: "voltage", labelKey: "nodes.history.voltage_device", color: "#F06292" },
      { source: "power", field: "ch1Voltage", label: "CH1", color: "#4FC3F7" },
      { source: "power", field: "ch2Voltage", label: "CH2", color: "#FFD54F" },
      { source: "power", field: "ch3Voltage", label: "CH3", color: "#9575CD" },
    ],
  },
  {
    id: "current",
    unit: " mA",
    series: [
      { source: "environment", field: "current", labelKey: "nodes.history.current_sensor", color: "#FFB74D" },
      { source: "power", field: "ch1Current", label: "CH1", color: "#4FC3F7" },
      { source: "power", field: "ch2Current", label: "CH2", color: "#FFD54F" },
      { source: "power", field: "ch3Current", label: "CH3", color: "#9575CD" },
    ],
  },
  {
    id: "battery",
    unit: " %",
    series: [{ source: "device", field: "batteryLevel", labelKey: "nodes.history.battery", color: "#9575CD" }],
  },
  {
    id: "airtime",
    unit: " %",
    series: [
      { source: "device", field: "channelUtilization", labelKey: "nodes.history.chutil", color: "#F5C839" },
      { source: "device", field: "airUtilTx", labelKey: "nodes.history.airutil", color: "#4FC3F7" },
    ],
  },
];

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/* Punkty jednego źródła zrzutowane na klucze tego wykresu; punkt bez żadnej
   z potrzebnych wartości jest pomijany. Pola z tego samego pakietu zostają
   w jednym punkcie. */
function project(points, mapping) {
  const rows = [];
  for (const point of points || []) {
    if (!point || !isNumber(point.ts)) {
      continue;
    }
    const row = { ts: point.ts };
    let any = false;
    for (const [field, key] of Object.entries(mapping)) {
      if (isNumber(point[field])) {
        row[key] = point[field];
        any = true;
      }
    }
    if (any) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * @param {{device?: Array, environment?: Array, power?: Array}} hist historia z magazynu
 * @param {(key: string) => string} tr tłumaczenie klucza i18n
 * @returns {Array<{id: string, unit: string, points: Array, series: Array}>}
 */
export function buildTelemetryCharts(hist, tr) {
  const charts = [];
  for (const def of CHARTS) {
    const bySource = {};
    for (const s of def.series) {
      (bySource[s.source] = bySource[s.source] || {})[s.field] = `${s.source}.${s.field}`;
    }

    let points = [];
    for (const [source, mapping] of Object.entries(bySource)) {
      points = points.concat(project(hist && hist[source], mapping));
    }
    points.sort((a, b) => a.ts - b.ts);

    // Rysowalna jest tylko linia z co najmniej dwoma punktami.
    const series = def.series
      .map((s) => ({
        key: `${s.source}.${s.field}`,
        label: s.labelKey ? tr(s.labelKey) : s.label,
        color: s.color,
        count: points.filter((p) => isNumber(p[`${s.source}.${s.field}`])).length,
      }))
      .filter((s) => s.count >= 2)
      .map(({ count, ...rest }) => rest);

    if (series.length) {
      charts.push({ id: def.id, unit: def.unit, points, series });
    }
  }
  return charts;
}
