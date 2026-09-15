/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Mapa — pozycje węzłów i linie topologii z danych NeighborInfo.
 *
 * Leaflet jest biblioteką UMD operującą na prawdziwym DOM-ie, więc ten
 * komponent świadomie rezygnuje z shadow DOM (createRenderRoot zwraca
 * sam element). Inaczej trzeba by wstrzykiwać arkusz Leafleta do każdego
 * cienia z osobna i walczyć z pozycjonowaniem kontrolek.
 */

import { LitElement, html } from "./vendor/lit/lit-element.js";
import { t } from "./i18n.js";

/* OpenStreetMap blokuje ruch aplikacji nietrzymających się ich polityki kafli
   (HTTP 403). Używamy CARTO — tego samego dostawcy, co wbudowana karta mapy
   Home Assistanta — w wariancie dopasowanym do motywu. */
const TILE_URL_LIGHT = "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
const TILE_URL_DARK = "https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION = "&copy; OpenStreetMap &copy; CARTO";

let leafletPromise = null;

/* Leaflet ładujemy raz na dokument i dopiero przy pierwszym wejściu na
   zakładkę — nie ma powodu ciągnąć 148 KB, jeśli ktoś ogląda tylko Radio. */
function loadLeaflet() {
  if (leafletPromise) {
    return leafletPromise;
  }

  const base = import.meta.url.replace(/\/[^/]+$/, "");

  leafletPromise = new Promise((resolve, reject) => {
    if (window.L) {
      resolve(window.L);
      return;
    }

    if (!document.querySelector("link[data-mtsw-leaflet]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${base}/vendor/leaflet/leaflet.css`;
      link.setAttribute("data-mtsw-leaflet", "");
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = `${base}/vendor/leaflet/leaflet.js`;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Nie udało się wczytać Leafleta"));
    document.head.appendChild(script);
  });

  return leafletPromise;
}

function snrColor(snr) {
  if (snr === null || snr === undefined) {
    return "#9E9E9E";
  }
  if (snr >= 0) {
    return "#4CAF50";
  }
  if (snr >= -8) {
    return "#F5C839";
  }
  return "#E57373";
}

class MeshMapTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      nodes: { type: Array },
      tileUrl: { type: String },
      showLinks: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.nodes = [];
    this.tileUrl = null;
    this._tileLayer = null;
    this._darkMode = null;
    this.showLinks = true;
    this._map = null;
    this._markerLayer = null;
    this._linkLayer = null;
    this._fitted = false;
    this._error = null;
  }

  createRenderRoot() {
    return this;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._map) {
      this._map.remove();
      this._map = null;
      this._fitted = false;
    }
  }

  _positioned() {
    return (this.nodes || []).filter(
      (node) =>
        typeof node.latitude === "number" &&
        typeof node.longitude === "number" &&
        !(node.latitude === 0 && node.longitude === 0)
    );
  }

  async _ensureMap() {
    if (this._map) {
      return;
    }
    const container = this.querySelector(".map-canvas");
    if (!container) {
      return;
    }

    let L;
    try {
      L = await loadLeaflet();
    } catch (err) {
      console.error("MT_SW: Leaflet nie wstał", err);
      this._error = t(this.hass, "map.load_failed");
      this.requestUpdate();
      return;
    }

    this._map = L.map(container, { preferCanvas: true }).setView([51.0, 20.9], 9);
    this._applyTileLayer(L);

    this._markerLayer = L.layerGroup().addTo(this._map);
    this._linkLayer = L.layerGroup().addTo(this._map);
  }

  _isDark() {
    return Boolean(this.hass && this.hass.themes && this.hass.themes.darkMode);
  }

  /* Warstwę kafli przestawiamy tylko przy faktycznej zmianie motywu —
     odtwarzanie jej przy każdym odświeżeniu migałoby na ekranie. */
  _applyTileLayer(L) {
    const dark = this._isDark();
    if (this._tileLayer && this._darkMode === dark) {
      return;
    }
    if (this._tileLayer) {
      this._map.removeLayer(this._tileLayer);
    }
    this._tileLayer = L.tileLayer(this.tileUrl || (dark ? TILE_URL_DARK : TILE_URL_LIGHT), {
      maxZoom: 19,
      attribution: DEFAULT_ATTRIBUTION,
    }).addTo(this._map);
    this._darkMode = dark;
  }

  _redraw() {
    if (!this._map || !window.L) {
      return;
    }
    const L = window.L;
    const nodes = this._positioned();

    this._markerLayer.clearLayers();
    this._linkLayer.clearLayers();

    const byId = new Map(nodes.map((node) => [node.node_id, node]));

    if (this.showLinks) {
      // Każda para rysowana raz — NeighborInfo bywa obustronne.
      const drawn = new Set();
      for (const node of nodes) {
        for (const neighbor of node.neighbors || []) {
          const peer = byId.get(neighbor.node_id);
          if (!peer) {
            continue;
          }
          const key = [node.node_id, neighbor.node_id].sort().join("-");
          if (drawn.has(key)) {
            continue;
          }
          drawn.add(key);

          L.polyline(
            [
              [node.latitude, node.longitude],
              [peer.latitude, peer.longitude],
            ],
            { color: snrColor(neighbor.snr), weight: 2, opacity: 0.7 }
          )
            .bindTooltip(
              `${node.long_name || node.node_hex} ↔ ${peer.long_name || peer.node_hex}<br>SNR ${
                neighbor.snr ?? "—"
              } dB`
            )
            .addTo(this._linkLayer);
        }
      }
    }

    for (const node of nodes) {
      const name = node.long_name || node.short_name || node.node_hex;
      L.circleMarker([node.latitude, node.longitude], {
        radius: node.is_gateway ? 9 : 6,
        color: node.is_gateway ? "#F5C839" : "#2C2D3C",
        weight: 2,
        fillColor: node.is_gateway ? "#F5C839" : "#4FC3F7",
        fillOpacity: 0.9,
      })
        .bindTooltip(name, { direction: "top" })
        .bindPopup(
          `<strong>${name}</strong><br>${node.node_hex}` +
            (node.altitude !== null && node.altitude !== undefined ? `<br>${node.altitude} m` : "") +
            (node.snr !== null && node.snr !== undefined ? `<br>SNR ${node.snr} dB` : "")
        )
        .addTo(this._markerLayer);
    }

    // Kadrujemy tylko raz — inaczej mapa skakałaby przy każdym odświeżeniu.
    if (!this._fitted && nodes.length) {
      this._map.fitBounds(
        nodes.map((node) => [node.latitude, node.longitude]),
        { padding: [40, 40], maxZoom: 13 }
      );
      this._fitted = true;
    }
  }

  async updated() {
    await this._ensureMap();
    if (this._map) {
      // Kontener dostaje wymiary dopiero po wstawieniu do drzewa.
      this._map.invalidateSize();
      if (window.L) {
        this._applyTileLayer(window.L);
      }
      this._redraw();
    }
  }

  render() {
    if (!this.hass) {
      return html``;
    }
    const positioned = this._positioned().length;
    const total = (this.nodes || []).length;

    return html`
      <div class="mtsw-map">
        <div class="map-toolbar">
          <label>
            <input
              type="checkbox"
              .checked=${this.showLinks}
              @change=${(e) => {
                this.showLinks = e.target.checked;
              }}
            />
            ${t(this.hass, "map.show_links")}
          </label>
          <span class="map-count">${t(this.hass, "map.count", { n: positioned, total })}</span>
        </div>
        ${this._error ? html`<div class="map-error">${this._error}</div>` : ""}
        <div class="map-canvas"></div>
      </div>
      <style>
        .mtsw-map {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 176px);
        }
        .mtsw-map .map-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--divider-color);
          background: var(--card-background-color);
          font-size: 13px;
        }
        .mtsw-map .map-toolbar label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
        }
        .mtsw-map .map-count {
          color: var(--secondary-text-color);
        }
        .mtsw-map .map-error {
          padding: 8px 16px;
          color: var(--error-color, #db4437);
          font-size: 13px;
        }
        .mtsw-map .map-canvas {
          flex: 1;
          min-height: 320px;
          background: var(--secondary-background-color);
        }
        .mtsw-map .leaflet-container {
          font-family: inherit;
          background: var(--secondary-background-color);
        }
      </style>
    `;
  }
}

if (!customElements.get("mesh-map-tab")) {
  customElements.define("mesh-map-tab", MeshMapTab);
}
