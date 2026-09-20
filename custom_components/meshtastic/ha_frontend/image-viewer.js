/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Pełnoekranowy podgląd zdjęcia z czatu, jak w aplikacji na Androida: ciemne tło,
 * zdjęcie na środku, powiększanie (kółko myszy albo dwa palce), przeciąganie
 * powiększonego zdjęcia i dwukrotne kliknięcie, które przywraca widok. Zamyka go
 * krzyżyk, klawisz Escape albo kliknięcie w tło.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;
const WHEEL_STEP = 1.15;

/* Nowy stan widoku po zmianie skali o factor w punkcie (cx, cy) liczonym od środka zdjęcia:
   punkt pod kursorem zostaje pod kursorem, więc zdjęcie nie ucieka spod palców. */
export function zoomAt(view, factor, cx, cy) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  if (scale === MIN_SCALE) {
    return { scale, x: 0, y: 0 };
  }
  const ratio = scale / view.scale;
  return { scale, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

class MeshImageViewer extends LitElement {
  static get properties() {
    return {
      src: { type: String },
      _view: { type: Object, state: true },
    };
  }

  constructor() {
    super();
    this.src = "";
    this._view = { scale: 1, x: 0, y: 0 };
    this._pointers = new Map();
    this._pinchStart = null;
    this._onKey = (event) => {
      if (event.key === "Escape") {
        this._close();
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("keydown", this._onKey);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._onKey);
  }

  updated(changed) {
    if (changed.has("src")) {
      this._reset();
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  _reset() {
    this._view = { scale: 1, x: 0, y: 0 };
    this._pointers.clear();
    this._pinchStart = null;
  }

  /* Środek zdjęcia to środek okna, więc współrzędne kursora przeliczamy względem niego. */
  _fromCenter(event) {
    return { x: event.clientX - window.innerWidth / 2, y: event.clientY - window.innerHeight / 2 };
  }

  _onWheel(event) {
    event.preventDefault();
    const point = this._fromCenter(event);
    this._view = zoomAt(this._view, event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, point.x, point.y);
  }

  _distance() {
    const [a, b] = [...this._pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _onPointerDown(event) {
    this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.target && event.target.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
    this._pinchStart = this._pointers.size === 2 ? { distance: this._distance(), scale: this._view.scale } : null;
  }

  _onPointerMove(event) {
    const previous = this._pointers.get(event.pointerId);
    if (!previous) {
      return;
    }
    const current = { x: event.clientX, y: event.clientY };
    this._pointers.set(event.pointerId, current);
    if (this._pointers.size === 2 && this._pinchStart && this._pinchStart.distance > 0) {
      const target = this._pinchStart.scale * (this._distance() / this._pinchStart.distance);
      const [a, b] = [...this._pointers.values()];
      const midX = (a.x + b.x) / 2 - window.innerWidth / 2;
      const midY = (a.y + b.y) / 2 - window.innerHeight / 2;
      this._view = zoomAt(this._view, target / this._view.scale, midX, midY);
    } else if (this._pointers.size === 1 && this._view.scale > MIN_SCALE) {
      this._view = { ...this._view, x: this._view.x + current.x - previous.x, y: this._view.y + current.y - previous.y };
    }
  }

  _onPointerUp(event) {
    this._pointers.delete(event.pointerId);
    this._pinchStart = null;
  }

  /* Tło zamyka podgląd tylko przy niepowiększonym zdjęciu — przeciąganie po tle nie ma zamykać. */
  _onBackdrop(event) {
    if (event.target === event.currentTarget && this._view.scale === MIN_SCALE) {
      this._close();
    }
  }

  render() {
    if (!this.src) {
      return html``;
    }
    const { scale, x, y } = this._view;
    return html`
      <div class="backdrop" @click=${this._onBackdrop} @wheel=${this._onWheel}>
        <div class="toolbar">
          <a class="original" href=${this.src} target="_blank" rel="noopener noreferrer">
            <ha-icon icon="mdi:open-in-new"></ha-icon>
          </a>
          <button class="close" @click=${() => this._close()}>✕</button>
        </div>
        <img
          src=${this.src}
          draggable="false"
          referrerpolicy="no-referrer"
          style="transform: translate(${x}px, ${y}px) scale(${scale})"
          @pointerdown=${this._onPointerDown}
          @pointermove=${this._onPointerMove}
          @pointerup=${this._onPointerUp}
          @pointercancel=${this._onPointerUp}
          @dblclick=${() => this._reset()}
        />
      </div>
    `;
  }

  static get styles() {
    return css`
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.92);
        overflow: hidden;
      }
      img {
        max-width: 96vw;
        max-height: 92vh;
        object-fit: contain;
        touch-action: none;
        user-select: none;
        cursor: grab;
      }
      .toolbar {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        gap: 8px;
        z-index: 1;
      }
      .close,
      .original {
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
        font-size: 18px;
        cursor: pointer;
        text-decoration: none;
      }
      .close:hover,
      .original:hover {
        background: rgba(255, 255, 255, 0.3);
      }
    `;
  }
}

if (!customElements.get("mesh-image-viewer")) {
  customElements.define("mesh-image-viewer", MeshImageViewer);
}
