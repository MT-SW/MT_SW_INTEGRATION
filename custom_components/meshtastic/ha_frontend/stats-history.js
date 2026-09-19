/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Historia pakietów i zasobów węzła (statystyki LocalStats i LocalStatsExtended).
 *
 * Pakiety: tabela zapisanych próbek. Przy każdym liczniku dostajemy też udział
 * procentowy w wszystkich pakietach odebranych (numPacketsRx) z tej samej
 * próbki — liczniki zerują się po restarcie węzła, więc procent liczymy zawsze
 * w obrębie jednej próbki, nigdy między próbkami.
 *
 * Zasoby: heap, flash i PSRAM jako procent zajętości oraz zużycie CPU. Każda
 * wielkość ma własny wykres z własną skalą, bo wahania heapu giną na osi
 * współdzielonej z flashem.
 *
 * Moduł jest czystą funkcją, bez zależności od Lita ani DOM.
 */

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/* base: kolumna odniesienia (100%), więc bez procentu */
export const PACKET_COLUMNS = [
  { field: "numPacketsRx", labelKey: "nodes.packets.rx", base: true },
  { field: "numPacketsRxBad", labelKey: "nodes.packets.rx_bad" },
  { field: "numRxDupe", labelKey: "nodes.packets.rx_dupe" },
  { field: "numPacketsTx", labelKey: "nodes.packets.tx" },
  { field: "numTxRelay", labelKey: "nodes.packets.tx_relay" },
  { field: "numTxRelayCanceled", labelKey: "nodes.packets.tx_relay_canceled" },
  { field: "numTxDropped", labelKey: "nodes.packets.tx_dropped" },
];

const RESOURCES = [
  { id: "cpu", labelKey: "nodes.resources.cpu", color: "#F5C839" },
  { id: "heap", labelKey: "nodes.resources.heap", color: "#4FC3F7" },
  { id: "flash", labelKey: "nodes.resources.flash", color: "#FF8A65" },
  { id: "psram", labelKey: "nodes.resources.psram", color: "#9575CD" },
];

export function formatNumber(value, language, digits) {
  return Number(value).toLocaleString(language, {
    minimumFractionDigits: digits || 0,
    maximumFractionDigits: digits || 0,
  });
}

export function formatKb(bytes, language) {
  return `${formatNumber(bytes / 1024, language, 1)} kB`;
}

/**
 * @param {Array} points punkty "local_stats" z magazynu (od najstarszego)
 * @returns {Array<{ts: number, cells: Array<{value: number|null, pct: number|null}>}>}
 *   wiersze od najnowszego; cells w kolejności PACKET_COLUMNS
 */
export function buildPacketRows(points) {
  const rows = [];
  for (const point of points || []) {
    if (!point || !isNumber(point.ts)) {
      continue;
    }
    const received = isNumber(point.numPacketsRx) ? point.numPacketsRx : 0;
    const cells = PACKET_COLUMNS.map((col) => {
      const value = isNumber(point[col.field]) ? point[col.field] : null;
      const pct = col.base || value === null || received <= 0 ? null : (value / received) * 100;
      return { value, pct };
    });
    rows.push({ ts: point.ts, cells });
  }
  return rows.reverse();
}

/* total == 0 znaczy, że tego zasobu węzeł nie ma (np. brak PSRAM). */
function memory(total, free) {
  if (!isNumber(total) || total <= 0) {
    return null;
  }
  const used = Math.min(total, Math.max(0, total - (isNumber(free) ? free : 0)));
  return { total, used, pct: (used / total) * 100 };
}

/**
 * Łączy próbki z dwóch pakietów w jeden szereg wierszy (od najstarszego).
 * Heap przychodzi z obu (LocalStats i LocalStatsExtended), reszta tylko
 * z LocalStatsExtended.
 *
 * @param {{stats?: Array, extended?: Array}} hist
 */
export function buildResourceRows(hist) {
  const rows = [];

  for (const p of (hist && hist.stats) || []) {
    if (!p || !isNumber(p.ts)) {
      continue;
    }
    const heap = memory(p.heapTotalBytes, p.heapFreeBytes);
    if (heap) {
      rows.push({ ts: p.ts, heap });
    }
  }

  for (const p of (hist && hist.extended) || []) {
    if (!p || !isNumber(p.ts)) {
      continue;
    }
    const row = { ts: p.ts };
    const heap = memory(p.memoryTotal, p.memoryFreeCheap);
    const flash = isNumber(p.flashTotalBytes)
      ? memory(p.flashTotalBytes, p.flashTotalBytes - (p.flashUsedBytes || 0))
      : null;
    const psram = memory(p.memoryPsramTotal, p.memoryPsramFree);
    if (heap) row.heap = heap;
    if (flash) row.flash = flash;
    if (psram) row.psram = psram;
    if (isNumber(p.cpuUsagePercent)) row.cpu = p.cpuUsagePercent;
    if (Object.keys(row).length > 1) {
      rows.push(row);
    }
  }

  return rows.sort((a, b) => a.ts - b.ts);
}

/* Ostatnia znana wartość każdego zasobu — nie każda próbka niesie wszystkie. */
export function latestResources(rows) {
  const latest = {};
  for (const res of RESOURCES) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i][res.id] !== undefined) {
        latest[res.id] = { ts: rows[i].ts, ...(res.id === "cpu" ? { value: rows[i].cpu } : rows[i][res.id]) };
        break;
      }
    }
  }
  return latest;
}

/** Wykresy zajętości w %, po jednym na zasób; rysowalna jest linia z >= 2 punktami. */
export function buildResourceCharts(rows, tr) {
  const charts = [];
  for (const res of RESOURCES) {
    const points = [];
    for (const row of rows) {
      const raw = row[res.id];
      const value = res.id === "cpu" ? raw : raw && raw.pct;
      if (isNumber(value)) {
        points.push({ ts: row.ts, value });
      }
    }
    if (points.length >= 2) {
      charts.push({
        id: res.id,
        unit: " %",
        points,
        series: [{ key: "value", label: tr(res.labelKey), color: res.color }],
      });
    }
  }
  return charts;
}

export const RESOURCE_IDS = RESOURCES.map((res) => ({ id: res.id, labelKey: res.labelKey }));