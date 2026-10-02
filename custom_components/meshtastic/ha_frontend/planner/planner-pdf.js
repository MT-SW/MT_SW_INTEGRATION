// Mały, bezzależnościowy zapis PDF raportu plannera (port PdfWriter.kt z aplikacji na Androida).
// Strona A4, czcionki Helvetica / Helvetica-Bold (Type1, nie osadzane) z kodowaniem WinAnsi rozszerzonym o polskie
// znaki diakrytyczne (kody 1..16 przez /Differences). Wynik: Uint8Array z poprawnym nagłówkiem, tablicą xref i %%EOF.
import { fmt, fmtTrim, niceTicks, decimalsFor } from './planner-format.js';
import { chartData, coverageBinIndex, coverageBinColor } from './planner-exports.js';

const POLISH = 'ąćęłńśźżĄĆĘŁŃŚŹŻ';
const GLYPHS = ['aogonek', 'cacute', 'eogonek', 'lslash', 'nacute', 'sacute', 'zacute', 'zdotaccent',
  'Aogonek', 'Cacute', 'Eogonek', 'Lslash', 'Nacute', 'Sacute', 'Zacute', 'Zdotaccent'];

const WINANSI_EXTRA = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x201E, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2018, 0x91], [0x2019, 0x92],
  [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x2122, 0x99],
]);

const polishCode = (c) => { const i = POLISH.indexOf(c); return i < 0 ? -1 : i + 1; };

function winAnsi(c) {
  const v = c.charCodeAt(0);
  if (v >= 32 && v <= 126) return v;
  if (v === 9 || v === 0xA0) return 32;
  if (v === 0xAD || v === 0x2212) return 45;
  if (v >= 0xA1 && v <= 0xFF) return v;
  return WINANSI_EXTRA.has(v) ? WINANSI_EXTRA.get(v) : -1;
}

function expand(s) {
  return s.replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/≈/g, '~').replace(/→/g, '->').replace(/≠/g, '!=');
}

/** Tekst -> napis o kodach bajtowych (znaki 1..255). */
export function pdfEncode(s) {
  let out = '';
  for (const c of expand(String(s))) {
    const p = polishCode(c);
    if (p > 0) { out += String.fromCharCode(p); continue; }
    const w = winAnsi(c);
    out += w < 0 ? '?' : String.fromCharCode(w);
  }
  return out;
}

export function pdfEscape(encoded) {
  let out = '';
  for (const c of encoded) {
    const v = c.charCodeAt(0);
    if (c === '(' || c === ')' || c === '\\') out += `\\${c}`;
    else if (v < 32 || v > 126) out += `\\${((v >> 6) & 7)}${((v >> 3) & 7)}${(v & 7)}`;
    else out += c;
  }
  return out;
}

export const pdfLiteral = (s) => `(${pdfEscape(pdfEncode(s))})`;

const REG = '278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,'
  + '1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,'
  + '556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584';
const BLD = '278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,'
  + '975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,'
  + '556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584';
const W_REG = REG.split(',').map(Number);
const W_BLD = BLD.split(',').map(Number);
const LAT_U = 'AAAAAAACEEEEIIIIDNOOOOO*OUUUUYPs';
const LAT_L = 'aaaaaaaceeeeiiiidnooooo/ouuuuypy';
const DEFINED_EXTRA = new Set([0x80, 0x82, 0x84, 0x85, 0x86, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x99]);

function codeWidth(code, bold) {
  const t = bold ? W_BLD : W_REG;
  const ascii = (ch) => t[ch.charCodeAt(0) - 32];
  if (code >= 32 && code <= 126) return t[code - 32];
  if (code >= 1 && code <= 16) {
    const idx = (code - 1) % 8;
    const base = 'acelnszz'[idx];
    if (code - 1 >= 8) {
      if (base === 'l') return bold ? 611 : 556;
      return ascii('ACELNSZZ'[idx]);
    }
    if (base === 'l') return bold ? 278 : 222;
    return ascii(base);
  }
  if (code === 0x80) return 556;
  if (code === 0x85 || code === 0x97 || code === 0x99) return 1000;
  if (code === 0x91 || code === 0x92 || code === 0x82) return bold ? 278 : 222;
  if (code === 0x84) return bold ? 500 : 333;
  if (code === 0x86) return 556;
  if (code === 0x93 || code === 0x94) return bold ? 500 : 333;
  if (code === 0x95) return 350;
  if (code === 0x96) return 556;
  if (code === 0xB0) return 400;
  if (code === 0xB1 || code === 0xD7 || code === 0xF7) return 584;
  if (code >= 0xC0 && code <= 0xDF) return LAT_U[code - 0xC0] === '*' ? 584 : ascii(LAT_U[code - 0xC0]);
  if (code >= 0xE0 && code <= 0xFF) return LAT_L[code - 0xE0] === '/' ? 584 : ascii(LAT_L[code - 0xE0]);
  if (code >= 0xA0 && code <= 0xBF) return code === 0xA0 ? 278 : 556;
  return 556;
}

/** Wpis /FirstChar /LastChar /Widths czcionki. */
export function pdfWidthsEntry(bold) {
  const parts = [];
  for (let code = 1; code <= 255; code++) {
    const defined = (code >= 1 && code <= 16) || (code >= 32 && code <= 126) || (code >= 0xA0 && code <= 0xFF) || DEFINED_EXTRA.has(code);
    parts.push(defined ? codeWidth(code, bold) : 0);
  }
  return `/FirstChar 1 /LastChar 255 /Widths [${parts.join(' ')}]`;
}

/** Szerokość tekstu w punktach. */
export function pdfTextWidth(s, bold, size) {
  let w = 0;
  for (const c of pdfEncode(s)) w += codeWidth(c.charCodeAt(0), bold);
  return (w * size) / 1000;
}

/** Zawijanie tekstu do szerokości maxW (słowa dłuższe niż linia są łamane). */
export function pdfWrap(text, bold, size, maxW) {
  const out = [];
  for (const para of String(text).replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word0 of para.split(' ')) {
      let word = word0;
      if (word === '' && line !== '') continue;
      while (pdfTextWidth(word, bold, size) > maxW && word.length > 1) {
        if (line) { out.push(line); line = ''; }
        let k = 1;
        while (k < word.length && pdfTextWidth(word.slice(0, k + 1), bold, size) <= maxW) k++;
        out.push(word.slice(0, k));
        word = word.slice(k);
      }
      const cand = line === '' ? word : `${line} ${word}`;
      if (line !== '' && pdfTextWidth(cand, bold, size) > maxW) { out.push(line); line = word; } else line = cand;
    }
    out.push(line);
  }
  return out;
}

const PW = 595;
const PH = 842;
const ML = 40;
const CW = PW - 2 * ML;
const BOTTOM = 52;
const TOP = PH - 40;
const f2 = (v) => fmt(v, 2);
const col = (v) => fmt(v / 255, 3);

class Doc {
  constructor() { this.sb = ''; this.pages = []; this.y = TOP; this.cur = ''; this.pages.push(''); this.idx = 0; }
  get out() { return this.pages[this.idx]; }
  set out(v) { this.pages[this.idx] = v; }
  add(s) { this.pages[this.idx] += s; }
  newPage() { this.pages.push(''); this.idx = this.pages.length - 1; this.y = TOP; }
  ensure(h) { if (this.y - h < BOTTOM) { this.newPage(); return true; } return false; }
  fill(c) { this.add(`${col((c >> 16) & 255)} ${col((c >> 8) & 255)} ${col(c & 255)} rg\n`); }
  stroke(c) { this.add(`${col((c >> 16) & 255)} ${col((c >> 8) & 255)} ${col(c & 255)} RG\n`); }
  width(w) { this.add(`${f2(w)} w\n`); }
  rect(x, y, w, h, color) { this.fill(color); this.add(`${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re f\n`); }
  strokeRect(x, y, w, h, color, lw) { this.stroke(color); this.width(lw); this.add(`${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re S\n`); }
  line(x0, y0, x1, y1, color, lw) { this.stroke(color); this.width(lw); this.add(`${f2(x0)} ${f2(y0)} m ${f2(x1)} ${f2(y1)} l S\n`); }
  polygon(xs, ys, color) {
    if (xs.length < 3) return;
    this.fill(color);
    for (let i = 0; i < xs.length; i++) this.add(`${f2(xs[i])} ${f2(ys[i])}${i === 0 ? ' m\n' : ' l\n'}`);
    this.add('h f\n');
  }
  polyline(xs, ys, color, lw) {
    if (xs.length < 2) return;
    this.stroke(color); this.width(lw);
    for (let i = 0; i < xs.length; i++) this.add(`${f2(xs[i])} ${f2(ys[i])}${i === 0 ? ' m\n' : ' l\n'}`);
    this.add('S\n');
  }
  text(x, y, size, bold, s, color = 0x222222) {
    if (!s) return;
    this.fill(color);
    this.add(`BT /${bold ? 'F2' : 'F1'} ${f2(size)} Tf ${f2(x)} ${f2(y)} Td ${pdfLiteral(s)} Tj ET\n`);
  }
  textRight(xr, y, size, bold, s, color = 0x222222) { this.text(xr - pdfTextWidth(s, bold, size), y, size, bold, s, color); }
  textCenter(xc, y, size, bold, s, color = 0x222222) { this.text(xc - pdfTextWidth(s, bold, size) / 2, y, size, bold, s, color); }
  textUp(x, y, size, bold, s, color = 0x222222) {
    if (!s) return;
    this.fill(color);
    this.add(`BT /${bold ? 'F2' : 'F1'} ${f2(size)} Tf 0 1 -1 0 ${f2(x)} ${f2(y)} Tm ${pdfLiteral(s)} Tj ET\n`);
  }
  clipRect(x, y, w, h) { this.add(`q ${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re W n\n`); }
  restore() { this.add('Q\n'); }
}

function section(d, s) {
  const labelW = 170;
  const pad = 3;
  const lh = 11;
  const rowH = (r) => Math.max(pdfWrap(r.label, true, 9, labelW - 2 * pad - 2).length, pdfWrap(r.value, false, 9, CW - labelW - 2 * pad - 2).length) * lh + 2 * pad;
  const heading = () => {
    d.y -= 16;
    d.rect(ML, d.y - 4, CW, 18, 0xE3EEF9);
    d.text(ML + 6, d.y + 1, 11, true, s.title, 0x0D47A1);
    d.y -= 6;
  };
  const firstH = s.rows.length === 0 ? 0 : rowH(s.rows[0]);
  d.ensure(30 + firstH);
  heading();
  let shade = false;
  for (const r of s.rows) {
    const lab = pdfWrap(r.label, true, 9, labelW - 2 * pad - 2);
    const vals = pdfWrap(r.value, false, 9, CW - labelW - 2 * pad - 2);
    const h = Math.max(lab.length, vals.length) * lh + 2 * pad;
    if (d.ensure(h)) { heading(); shade = false; }
    if (shade) d.rect(ML, d.y - h, CW, h, 0xF5F5F5);
    shade = !shade;
    let ty = d.y - pad - 8;
    for (const l of lab) { d.text(ML + pad + 1, ty, 9, true, l, 0x333333); ty -= lh; }
    ty = d.y - pad - 8;
    for (const l of vals) { d.text(ML + labelW + pad, ty, 9, false, l, 0x111111); ty -= lh; }
    d.y -= h;
  }
  d.line(ML, d.y, ML + CW, d.y, 0xCCCCCC, 0.5);
  d.y -= 6;
}

function profileBlock(d, p) {
  const h = 250;
  d.ensure(h + 12);
  d.y -= 8;
  const ox = ML;
  const oyTop = d.y;
  const left = 52; const right = 10; const top = 22; const bottom = 34;
  const px0 = ox + left;
  const pw = CW - left - right;
  const ph = h - top - bottom;
  const pyTop = oyTop - top;
  const pyBot = pyTop - ph;
  const c = chartData(p);
  const sx = (v) => px0 + ((v - c.xMin) / (c.xMax - c.xMin)) * pw;
  const sy = (v) => pyBot + ((v - c.yMin) / (c.yMax - c.yMin)) * ph;
  const xt = c.xTicks; const yt = c.yTicks;
  const xd = decimalsFor(xt.length > 1 ? Math.abs(xt[1] - xt[0]) : 1);
  const yd = decimalsFor(yt.length > 1 ? Math.abs(yt[1] - yt[0]) : 1);
  d.rect(px0, pyBot, pw, ph, 0xFFFFFF);
  for (const t of yt) d.line(px0, sy(t), px0 + pw, sy(t), 0xE0E0E0, 0.4);
  for (const t of xt) d.line(sx(t), pyBot, sx(t), pyTop, 0xE0E0E0, 0.4);
  if (c.valid) {
    const n = c.n;
    d.clipRect(px0, pyBot, pw, ph);
    const fx = new Array(2 * n); const fy = new Array(2 * n);
    for (let i = 0; i < n; i++) { fx[i] = sx(c.x[i]); fy[i] = sy(c.up[i]); }
    for (let i = 0; i < n; i++) { fx[n + i] = sx(c.x[n - 1 - i]); fy[n + i] = sy(c.lo[n - 1 - i]); }
    d.polygon(fx, fy, 0xBFD9F2);
    const gx = new Array(n + 2); const gy = new Array(n + 2);
    for (let i = 0; i < n; i++) { gx[i] = sx(c.x[i]); gy[i] = sy(c.ground[i]); }
    gx[n] = gx[n - 1]; gy[n] = pyBot; gx[n + 1] = gx[0]; gy[n + 1] = pyBot;
    d.polygon(gx, gy, 0xB89F78);
    d.polyline(gx.slice(0, n), gy.slice(0, n), 0x6B5636, 0.8);
    const lx = []; const ly = [];
    for (let i = 0; i < n; i++) { lx.push(sx(c.x[i])); ly.push(sy(c.los[i])); }
    d.polyline(lx, ly, 0xD32F2F, 1.4);
    d.restore();
  }
  d.line(px0, pyBot, px0, pyTop, 0x222222, 0.8);
  d.line(px0, pyBot, px0 + pw, pyBot, 0x222222, 0.8);
  for (const t of xt) {
    d.line(sx(t), pyBot, sx(t), pyBot - 3, 0x222222, 0.6);
    d.textCenter(sx(t), pyBot - 12, 7, false, fmt(t, xd), 0x333333);
  }
  for (const t of yt) {
    d.line(px0 - 3, sy(t), px0, sy(t), 0x222222, 0.6);
    d.textRight(px0 - 5, sy(t) - 2.5, 7, false, fmt(t, yd), 0x333333);
  }
  d.textCenter(px0 + pw / 2, pyBot - 25, 8, false, p.xAxisLabel, 0x222222);
  d.textUp(ox + 9, pyBot + ph / 2 - pdfTextWidth(p.yAxisLabel, false, 8) / 2, 8, false, p.yAxisLabel, 0x222222);
  d.text(px0, pyTop + 6, 11, true, p.labelA, 0x111111);
  d.textRight(px0 + pw, pyTop + 6, 11, true, p.labelB, 0x111111);
  d.y = oyTop - h - 6;
}

const coverageXKm = (c, lon) => (lon - c.centerLon) * Math.cos(c.centerLat * 0.017453292519943295) * 111.320;
const coverageYKm = (c, lat) => (lat - c.centerLat) * 110.574;

function medianCellKm(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const step = Math.max(1, Math.floor(n / 150));
  const nn = [];
  for (let i = 0; i < n; i += step) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = xs[j] - xs[i]; const dy = ys[j] - ys[i];
      const dd = dx * dx + dy * dy;
      if (dd > 1e-12 && dd < best) best = dd;
    }
    if (best < Infinity) nn.push(Math.sqrt(best));
  }
  if (!nn.length) return 0;
  nn.sort((a, b) => a - b);
  return nn[Math.floor(nn.length / 2)];
}

function coverageBlock(d, cov) {
  const size = 340;
  d.ensure(size + 40);
  d.y -= 6;
  d.text(ML, d.y - 10, 11, true, cov.title, 0x0D47A1);
  d.y -= 18;
  const x0 = ML;
  const yTop = d.y;
  const yBot = yTop - size;
  d.rect(x0, yBot, size, size, 0xF2F2F2);
  const xs = cov.samples.map((s) => coverageXKm(cov, s.lon));
  const ys = cov.samples.map((s) => coverageYKm(cov, s.lat));
  let half = cov.maxRangeKm;
  if (!(half > 0)) {
    half = 0;
    for (let i = 0; i < xs.length; i++) half = Math.max(half, Math.abs(xs[i]), Math.abs(ys[i]));
    if (half <= 0) half = 1;
  }
  half *= 1.05;
  const scale = size / (2 * half);
  const cellKm = medianCellKm(xs, ys);
  const side = Math.max(1.2, cellKm * scale * 1.02);
  const cx = x0 + size / 2; const cy = yBot + size / 2;
  d.clipRect(x0, yBot, size, size);
  const groups = new Map();
  cov.samples.forEach((s, i) => {
    if (Number.isNaN(s.marginDb)) return;
    const idx = coverageBinIndex(cov, s.marginDb);
    if (!groups.has(idx)) groups.set(idx, []);
    groups.get(idx).push(i);
  });
  for (const idx of [...groups.keys()].sort((a, b) => b - a)) {
    d.fill(coverageBinColor(cov, idx));
    for (const i of groups.get(idx)) d.add(`${f2(cx + xs[i] * scale - side / 2)} ${f2(cy + ys[i] * scale - side / 2)} ${f2(side)} ${f2(side)} re f\n`);
  }
  if (cov.maxRangeKm > 0) {
    const r = cov.maxRangeKm * scale;
    const k = 0.5523 * r;
    d.stroke(0x555555); d.width(0.6);
    d.add(`[3 3] 0 d ${f2(cx + r)} ${f2(cy)} m `);
    d.add(`${f2(cx + r)} ${f2(cy + k)} ${f2(cx + k)} ${f2(cy + r)} ${f2(cx)} ${f2(cy + r)} c `);
    d.add(`${f2(cx - k)} ${f2(cy + r)} ${f2(cx - r)} ${f2(cy + k)} ${f2(cx - r)} ${f2(cy)} c `);
    d.add(`${f2(cx - r)} ${f2(cy - k)} ${f2(cx - k)} ${f2(cy - r)} ${f2(cx)} ${f2(cy - r)} c `);
    d.add(`${f2(cx + k)} ${f2(cy - r)} ${f2(cx + r)} ${f2(cy - k)} ${f2(cx + r)} ${f2(cy)} c S [] 0 d\n`);
  }
  d.rect(cx - 4, cy - 4, 8, 8, 0xFFFFFF);
  d.line(cx - 6, cy, cx + 6, cy, 0x000000, 1.2);
  d.line(cx, cy - 6, cx, cy + 6, 0x000000, 1.2);
  d.restore();
  d.strokeRect(x0, yBot, size, size, 0x444444, 0.8);
  const target = (2 * half) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const fr = target / mag;
  const barKm = (fr < 1.5 ? 1 : fr < 3.5 ? 2 : fr < 7.5 ? 5 : 10) * mag;
  const barPt = barKm * scale;
  const by = yBot + 12;
  d.rect(x0 + 8, by - 3, barPt + 6, 20, 0xFFFFFF);
  d.line(x0 + 11, by + 2, x0 + 11 + barPt, by + 2, 0x000000, 1.5);
  d.line(x0 + 11, by - 1, x0 + 11, by + 5, 0x000000, 1.0);
  d.line(x0 + 11 + barPt, by - 1, x0 + 11 + barPt, by + 5, 0x000000, 1.0);
  d.text(x0 + 11, by + 8, 7, false, `${fmtTrim(barKm, 3)} km`, 0x000000);
  const lx = x0 + size + 16;
  let ly = yTop - 12;
  cov.legend.forEach((e, i) => {
    const lines = pdfWrap(e[0], false, 9, ML + CW - lx - 20);
    d.rect(lx, ly - 2, 12, 12, coverageBinColor(cov, i));
    d.strokeRect(lx, ly - 2, 12, 12, 0x666666, 0.4);
    let ty = ly;
    for (const l of lines) { d.text(lx + 18, ty, 9, false, l, 0x222222); ty -= 11; }
    ly -= Math.max(18, lines.length * 11 + 6);
  });
  d.y = yBot - 12;
}

function pointsBlock(d, pts) {
  const w1 = 150; const w2 = 115; const lh = 11; const pad = 3;
  d.ensure(30);
  d.y -= 6;
  let shade = false;
  for (const p of pts) {
    const n = pdfWrap(p.name, true, 9, w1 - 2 * pad);
    const coord = `${fmt(p.lat, 5)}, ${fmt(p.lon, 5)}`;
    const ds = pdfWrap(p.description, false, 9, CW - w1 - w2 - 2 * pad);
    const h = Math.max(n.length, ds.length) * lh + 2 * pad;
    if (d.ensure(h)) shade = false;
    if (shade) d.rect(ML, d.y - h, CW, h, 0xF5F5F5);
    shade = !shade;
    let ty = d.y - pad - 8;
    for (const l of n) { d.text(ML + pad, ty, 9, true, l, 0x111111); ty -= lh; }
    d.text(ML + w1, d.y - pad - 8, 9, false, coord, 0x333333);
    ty = d.y - pad - 8;
    for (const l of ds) { d.text(ML + w1 + w2, ty, 9, false, l, 0x333333); ty -= lh; }
    d.y -= h;
  }
  d.line(ML, d.y, ML + CW, d.y, 0xCCCCCC, 0.5);
  d.y -= 8;
}

function notesBlock(d, notes) {
  d.ensure(30);
  d.y -= 6;
  for (const n of notes) {
    const lines = pdfWrap(n, false, 8, CW - 12);
    const h = lines.length * 10 + 3;
    d.ensure(h);
    d.text(ML, d.y - 8, 8, false, '•', 0x555555);
    let ty = d.y - 8;
    for (const l of lines) { d.text(ML + 10, ty, 8, false, l, 0x555555); ty -= 10; }
    d.y -= h;
  }
}

function utf16Hex(s) {
  let out = '<FEFF';
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `${out}>`;
}

/** Składa obiekty PDF: katalog, strony, czcionki, kodowanie, info, strony i strumienie treści. */
function assemble(contents, title) {
  const np = contents.length;
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = contents.map((_, i) => `${7 + 2 * i} 0 R`).join(' ');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${np} >>`);
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ${pdfWidthsEntry(false)} /Encoding 5 0 R >>`);
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold ${pdfWidthsEntry(true)} /Encoding 5 0 R >>`);
  objs.push(`<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [1 ${GLYPHS.map((g) => `/${g}`).join(' ')}] >>`);
  objs.push(`<< /Title ${utf16Hex(title)} /Creator (Planer MT_SW) >>`);
  for (let i = 0; i < np; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${8 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /ProcSet [/PDF /Text] >> >>`);
    const c = contents[i];
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  }
  let out = `%PDF-1.4\n%${String.fromCharCode(0xE2, 0xE3, 0xCF, 0xD3)}\n`;
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
  return bytes;
}

/**
 * Raport -> PDF (Uint8Array). Model raportu pochodzi z buildReport() (planner-exports.js).
 */
export function renderPdf(report) {
  const d = new Doc();
  for (const l of pdfWrap(report.title, true, 20, CW)) { d.y -= 22; d.text(ML, d.y, 20, true, l, 0x111111); }
  if (report.subtitle) for (const l of pdfWrap(report.subtitle, false, 11, CW)) { d.y -= 14; d.text(ML, d.y, 11, false, l, 0x444444); }
  if (report.generatedAt) { d.y -= 13; d.text(ML, d.y, 9, false, report.generatedAt, 0x777777); }
  d.y -= 8;
  d.line(ML, d.y, ML + CW, d.y, 0x1565C0, 1.5);
  d.y -= 14;
  for (const s of report.sections) section(d, s);
  if (report.profile) profileBlock(d, report.profile);
  if (report.coverage) coverageBlock(d, report.coverage);
  if (report.points.length) pointsBlock(d, report.points);
  if (report.notes.length) notesBlock(d, report.notes);
  const total = d.pages.length;
  for (let i = 0; i < total; i++) {
    d.idx = i;
    d.line(ML, 40, ML + CW, 40, 0xBBBBBB, 0.5);
    const num = `${i + 1} / ${total}`;
    const nw = pdfTextWidth(num, false, 8);
    const ft = pdfWrap(report.footer, false, 8, CW - nw - 16)[0] || '';
    d.text(ML, 28, 8, false, ft, 0x777777);
    d.textRight(ML + CW, 28, 8, false, num, 0x777777);
  }
  return assemble(d.pages, report.title);
}
