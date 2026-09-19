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
const WIDTH = 600;

/* Do SVG trafiają tylko liczby i sformatowane etykiety, ale escapujemy
   wszystko, co idzie do tekstu — taniej niż zakładać, że tak zostanie. */
function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
          point[s.key] = cur >= prev ? cur - prev : 0;
          any = true;
        }
      }
      if (any) {
        out.push(point);
      }
    }
    return out;
  }

  _buildSvg() {
    const points = this._prepared();
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
      // Zawsze zostaw trochę powietrza nad najwyższą wartością.
      vMax = vMax > 0 ? vMax * 1.15 : 1;
    }
    const vSpan = vMax - vMin;

    let formatValue = (v) => (vMax >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
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
    const formatTime = (ts) =>
      new Date(ts).toLocaleTimeString(this.language, { hour: "2-digit", minute: "2-digit" });

    const ticks = [vMin, vMin + vSpan / 2, vMax];
    const tickLabels = ticks.map((v) => `${formatValue(v)}${this.unit}`);
    // W trybie fit etykiety mają jednostkę i miejsca po przecinku (np. "1013.2 hPa"),
    // więc lewy margines rośnie z ich długością.
    const padLeft = this.fit
      ? Math.max(PADDING.left, 10 + 6 * Math.max(...tickLabels.map((label) => label.length)))
      : PADDING.left;
    const innerW = WIDTH - padLeft - PADDING.right;

    const x = (ts) => padLeft + ((ts - tsMin) / tsSpan) * innerW;
    const y = (v) => PADDING.top + innerH - ((v - vMin) / vSpan) * innerH;

    const parts = [];
    parts.push(
      `<svg viewBox="0 0 ${WIDTH} ${this.height}" preserveAspectRatio="none" role="img">`
    );

    ticks.forEach((v, i) => {
      const gy = y(v).toFixed(1);
      parts.push(
        `<line class="grid" x1="${padLeft}" x2="${WIDTH - PADDING.right}" y1="${gy}" y2="${gy}"/>`,
        `<text class="axis" x="${padLeft - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">` +
          `${esc(tickLabels[i])}</text>`
      );
    });

    parts.push(
      `<text class="axis" x="${padLeft}" y="${this.height - 6}" text-anchor="start">` +
        `${esc(formatTime(tsMin))}</text>`,
      `<text class="axis" x="${WIDTH - PADDING.right}" y="${this.height - 6}" text-anchor="end">` +
        `${esc(formatTime(tsMax))}</text>`
    );

    for (const s of this.series) {
      const d = points
        .filter((p) => typeof p[s.key] === "number")
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p[s.key]).toFixed(1)}`)
        .join(" ");
      if (d) {
        parts.push(`<path class="line" d="${d}" stroke="${esc(s.color)}"/>`);
      }
    }

    parts.push("</svg>");
    return parts.join("");
  }

  updated() {
    const canvas = this.renderRoot && this.renderRoot.querySelector(".canvas");
    if (canvas) {
      canvas.innerHTML = this._buildSvg();
    }
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
      <div class="canvas"></div>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      .canvas svg {
        width: 100%;
        height: auto;
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

      .canvas .axis {
        fill: var(--secondary-text-color);
        font-size: 10px;
        font-family: inherit;
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
