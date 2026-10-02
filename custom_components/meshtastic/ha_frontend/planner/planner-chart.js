// Wykres profilu terenu (SVG inline) i plan zasięgu (canvas) — odpowiedniki ProfileChart.kt i CoveragePlan.
import { coverageRaster } from './index.js';
import { fmt, fmtDistance, niceTicks, niceStep, decimalsFor, nearestIndex, escapeHtml } from './planner-format.js';

const PAD_LEFT = 52;
const PAD_RIGHT = 14;
const PAD_TOP = 22;
const PAD_BOTTOM = 28;
const KM_THRESHOLD_M = 2000;
const X_TICKS = 6;
const Y_TICKS = 5;
const Y_PAD_LOW = 0.05;
const Y_PAD_HIGH = 0.10;

/** Skala wykresu (ChartScale z Androida). */
export function chartScale(series) {
  const d = series.distancesM;
  const xMax = Math.max(1, d[d.length - 1] || 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < d.length; i++) {
    lo = Math.min(lo, series.groundM[i], series.fresnelLowerM[i]);
    hi = Math.max(hi, series.groundM[i], series.fresnelUpperM[i], series.losM[i]);
  }
  const span = Math.max(1, hi - lo);
  const yMin = lo - span * Y_PAD_LOW;
  const yMax = hi + span * Y_PAD_HIGH;
  const useKm = xMax >= KM_THRESHOLD_M;
  const div = useKm ? 1000 : 1;
  const xTicks = niceTicks(0, xMax / div, X_TICKS);
  const yTicks = niceTicks(yMin, yMax, Y_TICKS);
  return {
    xMax, yMin, yMax, useKm, div, xTicks, yTicks,
    xDecimals: decimalsFor(xTicks.length > 1 ? xTicks[1] - xTicks[0] : 1),
    yDecimals: decimalsFor(yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1),
  };
}

const f1 = (v) => (Math.round(v * 10) / 10).toString();

/**
 * Wykres profilu jako SVG. Zwraca {root, svg, readout}: root zawiera SVG, linię odczytu i legendę.
 * Dotknięcie lub przeciągnięcie wykresu odczytuje wartości (tylko w SVG — bez przebudowy sekcji).
 * @param {{series:object,width:number,height?:number,tr:Function}} o
 */
export function buildProfileChart({ series, width, height = 260, tr }) {
  const sc = chartScale(series);
  const d = series.distancesM;
  const n = d.length;
  const left = PAD_LEFT;
  const right = width - PAD_RIGHT;
  const top = PAD_TOP;
  const bottom = height - PAD_BOTTOM;
  const px = (m) => left + (m / sc.xMax) * (right - left);
  const py = (v) => bottom - ((v - sc.yMin) / (sc.yMax - sc.yMin)) * (bottom - top);
  const unitM = tr('unit_m');
  const unitKm = tr('unit_km');
  const parts = [];
  parts.push(`<svg class="mlp-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(tr('section_profile'))}">`);
  parts.push(`<defs><clipPath id="mlpclip"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"/></clipPath></defs>`);
  sc.yTicks.forEach((v) => {
    const y = py(v);
    parts.push(`<line class="grid" x1="${left}" y1="${f1(y)}" x2="${right}" y2="${f1(y)}"/>`);
    parts.push(`<text class="lbl" x="${left - 4}" y="${f1(y + 3)}" text-anchor="end">${fmt(v, sc.yDecimals)}</text>`);
  });
  sc.xTicks.forEach((v) => {
    const x = px(v * sc.div);
    parts.push(`<line class="grid" x1="${f1(x)}" y1="${top}" x2="${f1(x)}" y2="${bottom}"/>`);
    parts.push(`<text class="lbl" x="${f1(x)}" y="${bottom + 14}" text-anchor="middle">${fmt(v, sc.xDecimals)}</text>`);
  });
  parts.push(`<text class="lbl" x="${right}" y="${height - 2}" text-anchor="end">${escapeHtml(sc.useKm ? unitKm : unitM)}</text>`);
  parts.push(`<text class="lbl" x="${left}" y="10" text-anchor="start">${escapeHtml(tr('chart_y_axis'))}</text>`);
  const pts = (arr) => Array.from({ length: n }, (_, i) => `${f1(px(d[i]))},${f1(py(arr[i]))}`);
  const terrain = pts(series.groundM);
  parts.push('<g clip-path="url(#mlpclip)">');
  parts.push(`<polygon class="terrain" points="${f1(px(d[0]))},${f1(bottom)} ${terrain.join(' ')} ${f1(px(d[n - 1]))},${f1(bottom)}"/>`);
  parts.push(`<polyline class="terrain-line" fill="none" points="${terrain.join(' ')}"/>`);
  const up = pts(series.fresnelUpperM);
  const lo = Array.from({ length: n }, (_, k) => { const i = n - 1 - k; return `${f1(px(d[i]))},${f1(py(series.fresnelLowerM[i]))}`; });
  parts.push(`<polygon class="fresnel" points="${up.join(' ')} ${lo.join(' ')}"/>`);
  parts.push(`<line class="los" x1="${f1(px(d[0]))}" y1="${f1(py(series.losM[0]))}" x2="${f1(px(d[n - 1]))}" y2="${f1(py(series.losM[n - 1]))}"/>`);
  parts.push('</g>');
  [[0, tr('chart_label_a')], [n - 1, tr('chart_label_b')]].forEach(([i, label]) => {
    const x = px(d[i]);
    const yTop = py(series.losM[i]);
    parts.push(`<line class="mast" x1="${f1(x)}" y1="${f1(py(series.groundM[i]))}" x2="${f1(x)}" y2="${f1(yTop)}"/>`);
    parts.push(`<circle class="los-dot" cx="${f1(x)}" cy="${f1(yTop)}" r="4"/>`);
    const lx = Math.min(width - 8, Math.max(8, x));
    parts.push(`<text class="lbl" x="${f1(lx)}" y="${f1(Math.max(10, yTop - 8))}" text-anchor="middle">${escapeHtml(label)}</text>`);
  });
  parts.push(`<line class="axis" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"/>`);
  parts.push(`<line class="axis" x1="${left}" y1="${top}" x2="${left}" y2="${bottom}"/>`);
  parts.push('<g class="sel" style="display:none"><line class="sel-line" y1="' + top + '" y2="' + bottom + '"/><circle class="sel-g" r="4"/><circle class="sel-l" r="4"/></g>');
  parts.push(`<rect class="hit" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="transparent" style="touch-action:pan-y"/>`);
  parts.push('</svg>');

  const root = document.createElement('div');
  root.className = 'mlp-chart';
  root.innerHTML = parts.join('');
  const svg = root.querySelector('svg');
  const readout = document.createElement('div');
  readout.className = 'mlp-small';
  readout.textContent = tr('chart_tap_hint');
  const legend = document.createElement('div');
  legend.className = 'mlp-legend';
  [['mlp-dot-terrain', tr('chart_legend_terrain')], ['mlp-dot-los', tr('chart_legend_los')], ['mlp-dot-fresnel', tr('chart_legend_fresnel')]].forEach(([cls, text]) => {
    const item = document.createElement('span');
    item.className = 'mlp-legend-item';
    const dot = document.createElement('i');
    dot.className = `mlp-dot ${cls}`;
    item.append(dot, document.createTextNode(text));
    legend.append(item);
  });
  root.append(readout, legend);

  const sel = svg.querySelector('.sel');
  const hit = svg.querySelector('.hit');
  const select = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width ? width / rect.width : 1;
    const xView = (clientX - rect.left) * scaleX;
    const frac = Math.min(1, Math.max(0, (xView - left) / (right - left)));
    const i = nearestIndex(d, frac * sc.xMax);
    const x = px(d[i]);
    sel.style.display = '';
    const line = sel.querySelector('.sel-line');
    line.setAttribute('x1', f1(x)); line.setAttribute('x2', f1(x));
    const cg = sel.querySelector('.sel-g');
    cg.setAttribute('cx', f1(x)); cg.setAttribute('cy', f1(py(series.groundM[i])));
    const cl = sel.querySelector('.sel-l');
    cl.setAttribute('cx', f1(x)); cl.setAttribute('cy', f1(py(series.losM[i])));
    const ground = series.groundM[i];
    const los = series.losM[i];
    readout.textContent = tr('chart_readout',
      fmtDistance(d[i], unitM, unitKm), `${fmt(ground, 1)} ${unitM}`, `${fmt(los, 1)} ${unitM}`,
      `${fmt(los - ground, 1)} ${unitM}`, `${fmt(series.fresnelUpperM[i] - los, 1)} ${unitM}`);
  };
  let dragging = false;
  hit.addEventListener('pointerdown', (e) => { dragging = true; try { hit.setPointerCapture(e.pointerId); } catch { /* ignoruj */ } select(e.clientX); });
  hit.addEventListener('pointermove', (e) => { if (dragging) select(e.clientX); });
  const stop = () => { dragging = false; };
  hit.addEventListener('pointerup', stop);
  hit.addEventListener('pointercancel', stop);
  return { root, svg, readout, scale: sc };
}

/**
 * Plan zasięgu (kwadrat z pierścieniami i podziałką) na canvasie — odpowiednik CoveragePlan.
 * Zwraca element <div> z canvasem i podpisem zasięgu.
 */
export function buildCoveragePlan({ coverage, tr, size = 360 }) {
  const wrap = document.createElement('div');
  wrap.className = 'mlp-plan';
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.className = 'mlp-plan-canvas';
  const radiusKm = (coverage.ringsM.length ? coverage.ringsM[coverage.ringsM.length - 1] : 0) / 1000;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#efefef';
    ctx.fillRect(0, 0, size, size);
    const raster = coverageRaster(coverage, { gridCells: 160, opacity: 0.85, projection: 'equirectangular' });
    if (raster) {
      const tmp = document.createElement('canvas');
      tmp.width = raster.width;
      tmp.height = raster.height;
      tmp.getContext('2d').putImageData(new ImageData(raster.rgba, raster.width, raster.height), 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, size, size);
    }
    const c = size / 2;
    const pxPerKm = radiusKm > 0 ? c / radiusKm : 0;
    const unitKm = tr('unit_km');
    const ringKm = niceTicks(0, radiusKm, 4).filter((v) => v > 0);
    const ringDec = decimalsFor(ringKm[0] || 1);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ringKm.forEach((km) => {
      const r = km * pxPerKm;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(fmt(km, ringDec), c + 3, c - r - 2);
    });
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(c, c, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c, c, 6, 0, Math.PI * 2); ctx.stroke();
    const scaleKm = niceStep(radiusKm * 0.4);
    const barLen = scaleKm * pxPerKm;
    const y = size - 14;
    const x0 = 10;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + barLen, y); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y + 4); ctx.moveTo(x0 + barLen, y - 4); ctx.lineTo(x0 + barLen, y + 4); ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.fillText(`${fmt(scaleKm, decimalsFor(scaleKm))} ${unitKm}`, x0, y - 8);
  }
  const caption = document.createElement('div');
  caption.className = 'mlp-small';
  caption.textContent = tr('coverage_extent', `${fmt(radiusKm, 1)} ${tr('unit_km')}`);
  wrap.append(canvas, caption);
  return wrap;
}
