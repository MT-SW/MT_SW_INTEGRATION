/*
 * Mała mapa w szczegółach węzła: pozycja (jeden znacznik) albo ślad z historii pozycji.
 * Używa tego samego Leafleta i tych samych ustawień kafli co zakładka Mapa.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { resolveTileSpec, loadLeafletScript, ensureLeafletCss, loadTileSettings } from "./map.js";

function validPoint(p) {
  return (
    p &&
    Number.isFinite(Number(p.latitude)) &&
    Number.isFinite(Number(p.longitude)) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180 &&
    !(Number(p.latitude) === 0 && Number(p.longitude) === 0)
  );
}

export class MeshMiniMap extends LitElement {
  static get properties() {
    return {
      points: { type: Array }, // [{latitude, longitude, ts?}]
      track: { type: Boolean }, // true: linia ze śladem, false: jeden znacznik
      selected: { type: Number }, // ts zaznaczonego punktu śladu
      badge: { type: String },
      height: { type: Number },
      dark: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.points = [];
    this.track = false;
    this.height = 200;
    this.dark = false;
    this._map = null;
    this._layer = null;
  }

  static get styles() {
    return css`
      :host {
        display: block;
        position: relative;
        margin: 8px 0;
      }
      .box {
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid var(--divider-color);
      }
      .badge {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 1000;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color);
        border-radius: 12px;
        padding: 2px 10px;
        font-size: 12px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      }
      .leaflet-container {
        font-family: inherit;
        background: var(--secondary-background-color);
      }
    `;
  }

  render() {
    return html`
      <div class="box"><div id="map" style="height:${this.height}px"></div></div>
      ${this.badge ? html`<div class="badge">${this.badge}</div>` : ""}
    `;
  }

  async firstUpdated() {
    try {
      const L = await loadLeafletScript();
      await ensureLeafletCss(this.renderRoot);
      if (!this.isConnected) {
        return;
      }
      const container = this.renderRoot.querySelector("#map");
      this._map = L.map(container, { preferCanvas: true, scrollWheelZoom: false });
      const spec = resolveTileSpec(loadTileSettings(), this.dark);
      if (spec.url) {
        L.tileLayer(spec.url, {
          maxZoom: spec.maxZoom,
          attribution: spec.attribution,
          referrerPolicy: spec.referrerPolicy,
        }).addTo(this._map);
      }
      this._layer = L.layerGroup().addTo(this._map);
      if (typeof ResizeObserver !== "undefined") {
        this._resize = new ResizeObserver(() => this._map && this._map.invalidateSize({ animate: false }));
        this._resize.observe(container);
      }
      this._draw(true);
    } catch (err) {
      console.error("MT_SW: minimapa", err);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._resize) {
      this._resize.disconnect();
      this._resize = null;
    }
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }

  updated(changed) {
    if (this._map && (changed.has("points") || changed.has("track") || changed.has("selected"))) {
      this._draw(changed.has("points") || changed.has("track"));
    }
  }

  _draw(refit) {
    const L = window.L;
    if (!L || !this._map || !this._layer) {
      return;
    }
    this._layer.clearLayers();
    const pts = (this.points || []).filter(validPoint);
    if (!pts.length) {
      return;
    }
    const latlngs = pts.map((p) => [Number(p.latitude), Number(p.longitude)]);
    if (this.track && pts.length > 1) {
      L.polyline(latlngs, { color: "#4FC3F7", weight: 3, opacity: 0.9 }).addTo(this._layer);
      pts.forEach((p, i) => {
        const first = i === 0;
        const last = i === pts.length - 1;
        const isSelected = this.selected !== undefined && p.ts === this.selected;
        if (!(first || last || isSelected)) {
          return;
        }
        const marker = L.circleMarker(latlngs[i], {
          radius: isSelected ? 8 : 6,
          color: "#fff",
          weight: 2,
          fillColor: isSelected ? "#F5C839" : last ? "#f44336" : "#4CAF50",
          fillOpacity: 1,
        }).addTo(this._layer);
        marker.on("click", () =>
          this.dispatchEvent(new CustomEvent("point-select", { detail: { ts: p.ts }, bubbles: true, composed: true }))
        );
      });
    } else {
      const last = latlngs[latlngs.length - 1];
      L.circleMarker(last, { radius: 8, color: "#fff", weight: 2, fillColor: "#f44336", fillOpacity: 1 }).addTo(this._layer);
    }
    if (refit) {
      this._map.invalidateSize({ animate: false });
      if (latlngs.length > 1 && this.track) {
        this._map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20], maxZoom: 17 });
      } else {
        this._map.setView(latlngs[latlngs.length - 1], 15);
      }
    }
  }
}

if (!customElements.get("mesh-mini-map")) {
  customElements.define("mesh-mini-map", MeshMiniMap);
}

export { validPoint };
