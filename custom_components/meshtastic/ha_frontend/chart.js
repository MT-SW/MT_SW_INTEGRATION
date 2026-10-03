/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Mały wykres liniowy w czystym SVG.
 *
 * Świadomie bez D3 — rysowanie kilku linii na siatce nie jest warte 276 KB
 * zależności. Komponent przyjmuje surowe punkty z magazynu i sam liczy skalę.
 *
 * Uwaga implementacyjna: zvendorowana paczka Lita eksportuje wyłącznie
 * LitElement, html i css — nie ma tagu `svg`. Bez niego zagnieżdżone szablony
 * wewnątrz <svg> trafiłyby do przestrzeni nazw HTML i nie narysowałyby się,
 * więc SVG budujemy jako tekst i wstawiamy do kontenera w updated().
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";

const PADDING = { top: 8, right: 8, bottom: 20, left: 40 };
const DEFAULT_WIDTH = 600;

/* Do SVG trafiają tylko liczby i sformatowane etykiety, ale escapujemy
   wszystko, co idzie do tekstu — taniej niż zakładać, że tak zostanie. */
function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* „Ładna” wartość osi: 1, 2, 5 razy potęga dziesięciu. */
function niceCeil(value) {
  if (!(value > 0)) {
    return 1;
  }
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const frac = value / base;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * base;
}

/* Równy krok osi: najmniejszy z 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 razy potęga dziesięciu, który jest >= wanted. */
function niceStep(wanted) {
  if (!(wanted > 0)) {
    return 1;
  }
  const base = 10 ** Math.floor(Math.log10(wanted));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * base >= wanted * 0.9999) {
      return m * base;
    }
  }
  return 10 * base;
}

const TICKS_Y = 5;
const TICKS_X = 5;

class MeshLineChart extends LitElement {
  static get properties() {
    return {
      /* [{ ts: number, <key>: number }] */
      points: { type: Array },
      /* [{ key: string, label: string, color: string }] */
      series: { type: Array },
      unit: { type: String },
      height: { type: Number },
      /* Jeśli true, rysujemy przyrosty między próbkami zamiast wartości
         bezwzględnych — liczniki pakietów rosną monotonicznie i bez tego
         wykres byłby nudną prostą do góry. */
      derivative: { type: Boolean },
      /* Razem z `derivative`: przyrost przeliczany na minutę, żeby wysokość
         słupka nie zależała od tego, jak rzadko przyszła próbka. */
      rate: { type: Boolean },
      /* Jeśli true, oś Y jest dopasowana do danych (min..max z zapasem, także
         dla wartości ujemnych) zamiast zaczynać się od zera — potrzebne dla
         wielkości takich jak ciśnienie czy napięcie, które wahają się w wąskim
         przedziale daleko od zera. */
      fit: { type: Boolean },
      language: { type: String },
      emptyLabel: { type: String },
    };
  }

  constructor() {
    super();
    this.points = [];
    this.series = [];
    this.unit = "";
    this.height = 160;
    this.derivative = false;
    this.rate = false;
    this._tip = null;
    this.fit = false;
    this.language = "pl";
    this.emptyLabel = "";
  }

  _prepared() {
    const raw = (this.points || []).filter((p) => p && typeof p.ts === "number");
    if (raw.length < 2) {
      return [];
    }
    if (!this.derivative) {
      return raw;
    }
    const out = [];
    for (let i = 1; i < raw.length; i += 1) {
      const point = { ts: raw[i].ts };
      let any = false;
      for (const s of this.series) {
        const prev = raw[i - 1][s.key];
        const cur = raw[i][s.key];
        if (typeof prev === "number" && typeof cur === "number") {
          // reset licznika po restarcie radia -> pomijamy ujemny skok
          let delta = cur >= prev ? cur - prev : 0;
          if (this.rate) {
            const minutes = (raw[i].ts - raw[i - 1].ts) / 60000;
            delta = minutes > 0 ? delta / minutes : 0;
          }
          point[s.key] = delta;
          any = true;
        }
      }
      if (any) {
        out.push(point);
      }
    }
    return out;
  }

  /* Gdy próbek jest więcej niż jedna na kilka pikseli, uśredniamy je w przedziałach czasu: sto kolców na
     centymetr wykresu niczego nie pokazuje, a średnia z przedziału tak (puste przedziały zostają puste,
     więc dziury w danych nadal widać). */
  _bucketed(points, widthPx) {
    const target = Math.max(20, Math.floor(widthPx / 4));
    if (points.length <= target * 1.5) {
      return points;
    }
    const tsMin = points[0].ts;
    const span = Math.max(1, points[points.length - 1].ts - tsMin);
    const out = [];
    let acc = null;
    let idx = -1;
    const flush = () => {
      if (!acc) {
        return;
      }
      const point = { ts: acc.ts / acc.n };
      for (const s of this.series) {
        if (acc.cnt[s.key]) {
          point[s.key] = acc.sum[s.key] / acc.cnt[s.key];
        }
      }
      out.push(point);
    };
    for (const p of points) {
      const i = Math.min(target - 1, Math.floor(((p.ts - tsMin) / span) * target));
      if (i !== idx) {
        flush();
        acc = { ts: 0, n: 0, sum: {}, cnt: {} };
        idx = i;
      }
      acc.ts += p.ts;
      acc.n += 1;
      for (const s of this.series) {
        if (typeof p[s.key] === "number" && Number.isFinite(p[s.key])) {
          acc.sum[s.key] = (acc.sum[s.key] || 0) + p[s.key];
          acc.cnt[s.key] = (acc.cnt[s.key] || 0) + 1;
        }
      }
    }
    flush();
    return out;
  }

  _buildSvg() {
    const rawPoints = this._prepared();
    if (rawPoints.length < 2) {
      return "";
    }
    const points = this._bucketed(rawPoints, (this._width || DEFAULT_WIDTH) - PADDING.left - PADDING.right);
    if (points.length < 2) {
      return "";
    }

    const innerH = this.height - PADDING.top - PADDING.bottom;

    const tsMin = points[0].ts;
    const tsMax = points[points.length - 1].ts;
    const tsSpan = Math.max(1, tsMax - tsMin);

    let vMin = 0;
    let vMax = 0;
    if (this.fit) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of points) {
        for (const s of this.series) {
          const v = p[s.key];
          if (typeof v === "number" && Number.isFinite(v)) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
      }
      if (!Number.isFinite(lo)) {
        return "";
      }
      // Zapas nad i pod danymi; płaska linia dostaje symetryczny przedział.
      const pad = hi === lo ? Math.abs(hi) * 0.05 || 1 : (hi - lo) * 0.12;
      vMin = lo - pad;
      vMax = hi + pad;
      // Wielkości nieujemne (wilgotność, napięcie...) nie schodzą poniżej zera.
      if (lo >= 0 && vMin < 0) {
        vMin = 0;
      }
    } else {
      for (const p of points) {
        for (const s of this.series) {
          if (typeof p[s.key] === "number" && p[s.key] > vMax) {
            vMax = p[s.key];
          }
        }
      }
      // Zawsze zostaw trochę powietrza nad najwyższą wartością i zaokrąglij
      // oś do równej liczby, żeby podziałki były czytelne (0, 25, 50, 75, 100).
      vMax = niceStep((vMax * 1.04) / (TICKS_Y - 1)) * (TICKS_Y - 1);
    }
    const vSpan = vMax - vMin;

    const axisStep = (vMax - vMin) / (TICKS_Y - 1);
    const axisDecimals = Math.abs(axisStep - Math.round(axisStep)) < 1e-9 ? 0 : Math.abs(axisStep * 10 - Math.round(axisStep * 10)) < 1e-9 ? 1 : 2;
    let formatValue = (v) => (this.fit ? String(v) : v.toFixed(axisDecimals));
    if (this.fit) {
      // Liczba miejsc po przecinku zależy od rozpiętości osi, nie od wartości.
      let decimals = 3;
      if (vSpan >= 20) {
        decimals = 0;
      } else if (vSpan >= 2) {
        decimals = 1;
      } else if (vSpan >= 0.2) {
        decimals = 2;
      }
      formatValue = (v) => v.toFixed(decimals);
    }
    const longSpan = tsSpan > 24 * 3600 * 1000;
    const formatTime = (ts) =>
      longSpan
        ? new Date(ts).toLocaleString(this.language, {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : new Date(ts).toLocaleTimeString(this.language, { hour: "2-digit", minute: "2-digit" });

    const ticks = Array.from({ length: TICKS_Y }, (_, i) => vMin + (vSpan * i) / (TICKS_Y - 1));
    const tickLabels = ticks.map((v) => `${formatValue(v)}${this.unit}`);
    // W trybie fit etykiety mają jednostkę i miejsca po przecinku (np. "1013.2 hPa"),
    // więc lewy margines rośnie z ich długością.
    const padLeft = Math.max(PADDING.left, 12 + 6.5 * Math.max(...tickLabels.map((label) => label.length)));
    // Rysujemy w prawdziwych pikselach (szerokość pudełka), a nie w stałym układzie rozciąganym na cały panel:
    // dzięki temu napisy mają swój rozmiar i nie rosną razem z szerokością ekranu.
    const WIDTH = this._width || DEFAULT_WIDTH;
    const innerW = WIDTH - padLeft - PADDING.right;

    const x = (ts) => padLeft + ((ts - tsMin) / tsSpan) * innerW;
    const y = (v) => PADDING.top + innerH - ((v - vMin) / vSpan) * innerH;

    const parts = [];
    parts.push(
      `<svg width="${WIDTH}" height="${this.height}" viewBox="0 0 ${WIDTH} ${this.height}" role="img">`
    );

    ticks.forEach((v, i) => {
      const gy = y(v).toFixed(1);
      parts.push(
        `<line class="grid" x1="${padLeft}" x2="${WIDTH - PADDING.right}" y1="${gy}" y2="${gy}"/>`,
        `<text class="axis" x="${padLeft - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">` +
          `${esc(tickLabels[i])}</text>`
      );
    });

    // Etykiety czasu mają ok. 80-110 px: na wąskim wykresie jest ich mniej, żeby na siebie nie nachodziły.
    const ticksX = Math.max(2, Math.min(TICKS_X, Math.floor(innerW / (longSpan ? 120 : 90))));
    for (let i = 0; i < ticksX; i += 1) {
      const ts = tsMin + (tsSpan * i) / (ticksX - 1);
      const gx = x(ts).toFixed(1);
      const anchor = i === 0 ? "start" : i === ticksX - 1 ? "end" : "middle";
      parts.push(
        `<line class="grid grid-v" x1="${gx}" x2="${gx}" y1="${PADDING.top}" y2="${PADDING.top + innerH}"/>`,
        `<text class="axis" x="${gx}" y="${this.height - 6}" text-anchor="${anchor}">` +
          `${esc(formatTime(ts))}</text>`
      );
    }

    // Przerwa w danych (np. restart integracji) przerywa linię zamiast ciągnąć
    // fałszywą prostą przez dziurę.
    const gaps = [];
    for (let i = 1; i < points.length; i += 1) {
      gaps.push(points[i].ts - points[i - 1].ts);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    const maxGap = Math.max(median * 4, 10 * 60 * 1000);

    for (const s of this.series) {
      let d = "";
      let prevTs = null;
      const dots = [];
      for (const p of points) {
        const v = p[s.key];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          continue;
        }
        const cx = x(p.ts).toFixed(1);
        const cy = y(v).toFixed(1);
        d += `${prevTs === null || p.ts - prevTs > maxGap ? "M" : "L"}${cx},${cy} `;
        prevTs = p.ts;
        dots.push(`<circle class="dot" cx="${cx}" cy="${cy}" r="2.5" fill="${esc(s.color)}"/>`);
      }
      if (d) {
        parts.push(`<path class="line" d="${d.trim()}" stroke="${esc(s.color)}"/>`);
        // Kropki tylko przy małej liczbie próbek, żeby nie zasłaniały linii.
        if (dots.length <= 80) {
          parts.push(...dots);
        }
      }
    }

    parts.push("</svg>");
    this._geom = { width: WIDTH, points, padLeft, innerW, tsMin, tsSpan, formatValue, formatTime };
    return parts.join("");
  }

  connectedCallback() {
    super.connectedCallback();
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => this._redraw());
      this._ro.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    super.disconnectedCallback();
  }

  /* Przerysowuje SVG, gdy zmieni się szerokość pudełka (obrót ekranu, zmiana rozmiaru panelu). */
  _redraw() {
    const canvas = this.renderRoot && this.renderRoot.querySelector(".canvas");
    const box = this.renderRoot && this.renderRoot.querySelector(".box");
    if (!canvas || !box) {
      return;
    }
    const width = Math.round(box.clientWidth) || DEFAULT_WIDTH;
    if (width === this._width && canvas.firstChild) {
      return;
    }
    this._width = width;
    this._geom = null;
    canvas.innerHTML = this._buildSvg();
    this._hideTip();
  }

  updated() {
    this._width = 0; // dane się zmieniły: wymuś przerysowanie
    this._redraw();
  }

  _hideTip() {
    const tip = this.renderRoot && this.renderRoot.querySelector(".tip");
    const cursor = this.renderRoot && this.renderRoot.querySelector(".cursor");
    if (tip) {
      tip.style.display = "none";
    }
    if (cursor) {
      cursor.style.display = "none";
    }
  }

  /* Najechanie / dotknięcie pokazuje dokładne wartości najbliższej próbki. */
  _onMove(event) {
    const g = this._geom;
    const box = this.renderRoot.querySelector(".box");
    const tip = this.renderRoot.querySelector(".tip");
    const cursor = this.renderRoot.querySelector(".cursor");
    if (!g || !box || !tip || !cursor) {
      return;
    }
    const rect = box.getBoundingClientRect();
    if (!rect.width) {
      return;
    }
    const vx = ((event.clientX - rect.left) / rect.width) * g.width;
    const ts = g.tsMin + ((vx - g.padLeft) / g.innerW) * g.tsSpan;
    let best = null;
    for (const p of g.points) {
      if (best === null || Math.abs(p.ts - ts) < Math.abs(best.ts - ts)) {
        best = p;
      }
    }
    if (!best) {
      return;
    }
    const px = ((g.padLeft + ((best.ts - g.tsMin) / g.tsSpan) * g.innerW) / g.width) * rect.width;
    const rows = this.series
      .filter((s) => typeof best[s.key] === "number")
      .map(
        (s) =>
          `<div><span class="swatch" style="background:${esc(s.color)}"></span>${esc(s.label)}: ` +
          `<b>${esc(g.formatValue(best[s.key]))}${esc(this.unit)}</b></div>`
      )
      .join("");
    tip.innerHTML = `<div class="tip-time">${esc(g.formatTime(best.ts))}</div>${rows}`;
    tip.style.display = "block";
    cursor.style.display = "block";
    cursor.style.left = `${px}px`;
    const tipW = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(rect.width - tipW, px + 10))}px`;
  }

  render() {
    const hasData = this._prepared().length >= 2;
    return html`
      ${hasData
        ? html`<div class="legend">
            ${this.series.map(
              (s) => html`<span class="legend-item">
                <span class="swatch" style="background:${s.color}"></span>${s.label}
              </span>`
            )}
          </div>`
        : html`<div class="chart-empty">${this.emptyLabel}</div>`}
      <div
        class="box"
        @pointermove=${(e) => this._onMove(e)}
        @pointerleave=${() => this._hideTip()}
      >
        <div class="canvas"></div>
        <div class="cursor"></div>
        <div class="tip"></div>
      </div>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      .canvas svg {
        display: block;
        max-width: 100%;
        overflow: visible;
      }

      .canvas .line {
        fill: none;
        stroke-width: 2;
        stroke-linejoin: round;
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }

      .canvas .grid {
        stroke: var(--divider-color);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }

      .canvas .grid-v {
        stroke-dasharray: 2 4;
        opacity: 0.6;
      }

      .box {
        position: relative;
        touch-action: pan-y;
      }

      .cursor {
        display: none;
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--secondary-text-color);
        opacity: 0.6;
        pointer-events: none;
      }

      .tip {
        display: none;
        position: absolute;
        top: 4px;
        z-index: 2;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.5;
        white-space: nowrap;
        pointer-events: none;
        color: var(--primary-text-color);
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      }

      .tip .swatch {
        display: inline-block;
        margin-right: 6px;
      }

      .tip-time {
        color: var(--secondary-text-color);
        margin-bottom: 2px;
      }

      .canvas .axis {
        fill: var(--secondary-text-color);
        font-size: 11px;
        font-family: inherit;
        font-variant-numeric: tabular-nums;
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 8px;
        font-size: 12px;
        color: var(--secondary-text-color);
      }

      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .swatch {
        width: 10px;
        height: 10px;
        border-radius: 2px;
      }

      .chart-empty {
        color: var(--secondary-text-color);
        font-size: 13px;
        padding: 12px 0;
      }
    `;
  }
}

if (!customElements.get("mesh-line-chart")) {
  customElements.define("mesh-line-chart", MeshLineChart);
}
