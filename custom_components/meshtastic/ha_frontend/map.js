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
 *
 * Źródło kafli jest wybierane przez użytkownika i zapamiętywane w
 * localStorage. Dostawcy zmieniają zasady w trakcie życia integracji
 * (CARTO zaczęło wymagać klucza w sierpniu 2026, OpenStreetMap blokuje
 * klientów spoza swojej polityki), więc zaszycie jednego na stałe oznacza
 * zepsutą mapę przy każdej takiej zmianie.
 */

import { LitElement, html } from "./vendor/lit/lit-element.js";
import { t } from "./i18n.js";

const STORAGE_KEY = "mtsw.map.tiles";

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ESRI_ATTR = "Kafle &copy; Esri";

/* Domyślny jest Esri: nie wymaga rejestracji ani klucza, ma dobre pokrycie
   Polski i od lat jest jednym z dostawców wymienianych jako darmowe
   w leaflet-providers. */
const TILE_PRESETS = {
  esri_street: {
    labelKey: "map.tiles.esri_street",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: ESRI_ATTR,
    maxZoom: 19,
  },
  esri_topo: {
    labelKey: "map.tiles.esri_topo",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: ESRI_ATTR,
    maxZoom: 19,
  },
  esri_imagery: {
    labelKey: "map.tiles.esri_imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: ESRI_ATTR,
    maxZoom: 19,
  },
  opentopo: {
    labelKey: "map.tiles.opentopo",
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: `${OSM_ATTR}, SRTM | &copy; OpenTopoMap (CC-BY-SA)`,
    maxZoom: 17,
  },
  /* CARTO wygląda najlepiej i ma wariant ciemny, ale od sierpnia 2026
     wymaga darmowego klucza — bez niego kafle wracają ze znakiem wodnym. */
  carto: {
    labelKey: "map.tiles.carto",
    url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    darkUrl: "https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
    attribution: `${OSM_ATTR} &copy; CARTO`,
    maxZoom: 20,
    needsKey: true,
  },
  /* Klasyczny wygląd OSM (Mapnik), ale nie z tile.openstreetmap.org — ich
     polityka wprost zabrania takiego użycia bez wcześniejszej zgody (zob.
     operations.osmfoundation.org/policies/tiles). Stadia renderuje z tych
     samych danych OSM i ma darmowy poziom. */
  osm_bright: {
    labelKey: "map.tiles.osm_bright",
    url: "https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png",
    attribution: `${OSM_ATTR} &copy; <a href="https://stadiamaps.com/">Stadia Maps</a>`,
    maxZoom: 20,
    needsKey: true,
    keyParam: "api_key",
  },
  custom: {
    labelKey: "map.tiles.custom",
    url: "",
    attribution: "",
    maxZoom: 19,
    isCustom: true,
  },
};

const DEFAULT_PRESET = "esri_street";

const BASE_URL = import.meta.url.replace(/\/[^/]+$/, "");

let leafletPromise = null;
let leafletCssText = null;

/* Skrypt Leafleta jest globalny, więc ładujemy go raz na dokument i dopiero
   przy pierwszym wejściu na zakładkę — nie ma powodu ciągnąć 148 KB, jeśli
   ktoś ogląda tylko Radio. */
function loadLeafletScript() {
  if (leafletPromise) {
    return leafletPromise;
  }

  leafletPromise = new Promise((resolve, reject) => {
    if (window.L) {
      resolve(window.L);
      return;
    }
    const script = document.createElement("script");
    script.src = `${BASE_URL}/vendor/leaflet/leaflet.js`;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Nie udało się wczytać Leafleta"));
    document.head.appendChild(script);
  });

  return leafletPromise;
}

/* Arkusz Leafleta musi trafić do tego samego drzewa, w którym stoi mapa.
   Ten komponent renderuje do light DOM, ale sam siedzi w shadow roocie
   panelu — a style z document.head nie przenikają przez granicę cienia.
   Bez nich kafle są zwykłymi obrazkami bez pozycjonowania i rozjeżdżają się
   po stronie. Pobieramy arkusz raz jako tekst i wstawiamy go jako <style>
   do właściwego korzenia. */
async function ensureLeafletCss(root) {
  if (!root || root.querySelector("style[data-mtsw-leaflet]")) {
    return;
  }
  if (leafletCssText === null) {
    const response = await fetch(`${BASE_URL}/vendor/leaflet/leaflet.css`);
    if (!response.ok) {
      throw new Error(`Arkusz Leafleta: HTTP ${response.status}`);
    }
    leafletCssText = await response.text();
  }
  if (root.querySelector("style[data-mtsw-leaflet]")) {
    return;
  }
  const style = document.createElement("style");
  style.setAttribute("data-mtsw-leaflet", "");
  style.textContent = leafletCssText;
  root.appendChild(style);
}

function loadTileSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && TILE_PRESETS[parsed.preset]) {
        return { preset: parsed.preset, customUrl: parsed.customUrl || "", key: parsed.key || "" };
      }
    }
  } catch (err) {
    console.debug("MT_SW: nie udało się odczytać ustawień kafli", err);
  }
  return { preset: DEFAULT_PRESET, customUrl: "", key: "" };
}

function saveTileSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.debug("MT_SW: nie udało się zapisać ustawień kafli", err);
  }
}

/* Meshtastic obcina współrzędne do `precisionBits`, więc pozycja jest
   w istocie kwadratem, nie punktem. Promień koła niepewności maleje
   dwukrotnie z każdym bitem — 10 bitów to ~23 km, 19 bitów ~45 m. */
const PRECISION_BASE_METERS = 23905787;
const MIN_PRECISION_BITS = 1;
const MAX_PRECISION_BITS = 31;

function precisionRadius(bits) {
  if (typeof bits !== "number" || bits < MIN_PRECISION_BITS || bits > MAX_PRECISION_BITS) {
    return null;
  }
  return PRECISION_BASE_METERS / Math.pow(2, bits);
}

/* Rozsuwanie nakładających się węzłów.
   Grupujemy po odległości w pikselach przy bieżącym powiększeniu, więc ta sama
   grupa rozjeżdża się płynnie w miarę przybliżania — dokładnie jak w aplikacji.
   Offset liczony jest w przestrzeni ekranu, żeby odstęp był stały wizualnie. */
const CLUSTER_PX = 18;
const SPREAD_PX = 16;
/* Poniżej tego powiększenia markery zostają na prawdziwych pozycjach.
   Wcześniej rozsuwanie działało na każdym poziomie, więc z oddali grupa
   węzłów zamieniała się w okrąg kółek zamiast wyglądać jak jeden punkt. */
const SPREAD_MIN_ZOOM = 13;
const SPREAD_FULL_ZOOM = 16;

function spreadOverlapping(map, nodes) {
  const zoom = map.getZoom();
  if (zoom < SPREAD_MIN_ZOOM) {
    // Bez rozsuwania markerów nadal grupujemy, żeby policzyć, ile węzłów
    // dzieli jeden punkt — ta liczba steruje rozsunięciem etykiet.
    const groups = new Map();
    return nodes.map((node) => {
      const key = `${node.latitude.toFixed(5)},${node.longitude.toFixed(5)}`;
      const index = groups.get(key) || 0;
      groups.set(key, index + 1);
      return {
        node,
        latlng: [node.latitude, node.longitude],
        offset: false,
        stackIndex: index,
      };
    });
  }
  // Od progu do pełnego przybliżenia rozsunięcie narasta płynnie,
  // żeby nie „wystrzeliwało" skokowo przy jednym kliknięciu zoomu.
  const ramp = Math.min(1, (zoom - SPREAD_MIN_ZOOM) / (SPREAD_FULL_ZOOM - SPREAD_MIN_ZOOM));

  const placed = [];
  const groups = [];

  for (const node of nodes) {
    const point = map.latLngToLayerPoint([node.latitude, node.longitude]);
    let group = groups.find((g) => {
      const dx = g.point.x - point.x;
      const dy = g.point.y - point.y;
      return Math.sqrt(dx * dx + dy * dy) <= CLUSTER_PX;
    });
    if (!group) {
      group = { point, members: [] };
      groups.push(group);
    }
    group.members.push({ node, point });
  }

  for (const group of groups) {
    if (group.members.length === 1) {
      const only = group.members[0];
      placed.push({
        node: only.node,
        latlng: [only.node.latitude, only.node.longitude],
        offset: false,
        stackIndex: 0,
      });
      continue;
    }
    // Promień rośnie z liczbą węzłów, żeby przy kilkunastu nadal dało się je rozróżnić.
    const radius = (SPREAD_PX + group.members.length * 1.5) * ramp;
    group.members.forEach((member, index) => {
      const angle = (2 * Math.PI * index) / group.members.length;
      const shifted = map.layerPointToLatLng([
        group.point.x + radius * Math.cos(angle),
        group.point.y + radius * Math.sin(angle),
      ]);
      placed.push({ node: member.node, latlng: [shifted.lat, shifted.lng], offset: true });
    });
  }

  return placed;
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
      showLinks: { type: Boolean },
      showLabels: { type: Boolean },
      showPrecision: { type: Boolean },
      _tiles: { type: Object },
      _showTileSettings: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.nodes = [];
    this.showLinks = true;
    this.showLabels = true;
    this.showPrecision = true;
    this._tiles = loadTileSettings();
    this._showTileSettings = false;
    this._map = null;
    this._markerLayer = null;
    this._linkLayer = null;
    this._tileLayer = null;
    this._tileSignature = null;
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
      this._tileLayer = null;
      this._tileSignature = null;
      this._fitted = false;
    }
  }

  _isDark() {
    return Boolean(this.hass && this.hass.themes && this.hass.themes.darkMode);
  }

  /* Adres kafli wraz z kluczem, jeśli dostawca go wymaga. */
  _tileSpec() {
    const preset = TILE_PRESETS[this._tiles.preset] || TILE_PRESETS[DEFAULT_PRESET];
    let url = preset.isCustom ? (this._tiles.customUrl || "").trim() : preset.url;

    if (preset.darkUrl && this._isDark()) {
      url = preset.darkUrl;
    }
    if (preset.needsKey && this._tiles.key && url) {
      const keyParam = preset.keyParam || "key";
      url += `${url.includes("?") ? "&" : "?"}${keyParam}=${encodeURIComponent(this._tiles.key)}`;
    }

    return {
      url,
      attribution: preset.isCustom ? OSM_ATTR : preset.attribution,
      maxZoom: preset.maxZoom || 19,
      preset,
    };
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
      // Arkusz musi być na miejscu przed inicjalizacją — Leaflet odczytuje
      // rozmiar kontenera, a bez stylów ten rozmiar jest bez sensu.
      await ensureLeafletCss(this.getRootNode());
      L = await loadLeafletScript();
    } catch (err) {
      console.error("MT_SW: Leaflet nie wstał", err);
      this._error = t(this.hass, "map.load_failed");
      this.requestUpdate();
      return;
    }

    this._map = L.map(container, { preferCanvas: true }).setView([50.87, 20.63], 9);
    this._applyTileLayer(L);
    this._markerLayer = L.layerGroup().addTo(this._map);
    this._linkLayer = L.layerGroup().addTo(this._map);
    this._precisionLayer = L.layerGroup().addTo(this._map);
    // Rozsunięcie liczone jest w pikselach, więc po każdej zmianie
    // powiększenia trzeba je przeliczyć od nowa.
    this._map.on("zoomend", () => this._redraw());
  }

  /* Warstwę kafli przestawiamy tylko przy faktycznej zmianie adresu —
     odtwarzanie jej przy każdym odświeżeniu migałoby na ekranie. */
  _applyTileLayer(L) {
    const spec = this._tileSpec();
    if (!spec.url) {
      if (this._tileLayer) {
        this._map.removeLayer(this._tileLayer);
        this._tileLayer = null;
        this._tileSignature = null;
      }
      return;
    }
    if (this._tileLayer && this._tileSignature === spec.url) {
      return;
    }
    if (this._tileLayer) {
      this._map.removeLayer(this._tileLayer);
    }
    this._tileLayer = L.tileLayer(spec.url, {
      maxZoom: spec.maxZoom,
      attribution: spec.attribution,
    }).addTo(this._map);
    this._tileSignature = spec.url;
  }

  _redraw() {
    if (!this._map || !window.L) {
      return;
    }
    const L = window.L;
    const nodes = this._positioned();

    this._markerLayer.clearLayers();
    this._linkLayer.clearLayers();
    this._precisionLayer.clearLayers();

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

    if (this.showPrecision) {
      for (const node of nodes) {
        const radius = precisionRadius(node.precision_bits);
        if (radius) {
          L.circle([node.latitude, node.longitude], {
            radius,
            color: "#4FC3F7",
            weight: 1,
            opacity: 0.5,
            fillColor: "#4FC3F7",
            fillOpacity: 0.08,
            interactive: false,
          }).addTo(this._precisionLayer);
        }
      }
    }

    // Linie topologii łączą prawdziwe pozycje; rozsuwamy tylko markery,
    // żeby obraz zasięgu pozostał zgodny z rzeczywistością.
    for (const placement of spreadOverlapping(this._map, nodes)) {
      const node = placement.node;
      const name = node.long_name || node.short_name || node.node_hex;
      const marker = L.circleMarker(placement.latlng, {
        radius: node.is_gateway ? 9 : 6,
        color: node.is_gateway ? "#F5C839" : "#2C2D3C",
        weight: 2,
        fillColor: node.is_gateway ? "#F5C839" : "#4FC3F7",
        fillOpacity: 0.9,
      })
        .bindPopup(
          `<strong>${name}</strong><br>${node.node_hex}` +
            (node.altitude !== null && node.altitude !== undefined ? `<br>${node.altitude} m` : "") +
            (node.snr !== null && node.snr !== undefined ? `<br>SNR ${node.snr} dB` : "") +
            (placement.offset ? `<br><em>${t(this.hass, "map.offset_note")}</em>` : "")
        )
        .addTo(this._markerLayer);

      // Gdy markery nie są rozsunięte (małe powiększenie), same etykiety
      // rozsuwamy pionowo — inaczej kilka węzłów w jednym punkcie dawałoby
      // jeden napis i nie byłoby widać, że jest ich więcej.
      const stack = placement.offset ? 0 : placement.stackIndex || 0;
      marker.bindTooltip(this.showLabels ? node.short_name || name : name, {
        direction: "top",
        permanent: Boolean(this.showLabels),
        className: "mtsw-node-label",
        offset: [0, -4 - stack * 14],
      });
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

  _updateTiles(patch) {
    this._tiles = { ...this._tiles, ...patch };
    saveTileSettings(this._tiles);
    if (this._map && window.L) {
      this._applyTileLayer(window.L);
    }
    this.requestUpdate();
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

  _renderTileSettings() {
    const preset = TILE_PRESETS[this._tiles.preset] || TILE_PRESETS[DEFAULT_PRESET];
    return html`
      <div class="map-tilebar">
        <label class="map-field">
          <span>${t(this.hass, "map.tiles.source")}</span>
          <select
            @change=${(e) => this._updateTiles({ preset: e.target.value })}
          >
            ${Object.entries(TILE_PRESETS).map(
              ([id, cfg]) => html`<option value=${id} ?selected=${id === this._tiles.preset}>
                ${t(this.hass, cfg.labelKey)}
              </option>`
            )}
          </select>
        </label>

        ${preset.isCustom
          ? html`<label class="map-field grow">
              <span>${t(this.hass, "map.tiles.url")}</span>
              <input
                type="text"
                .value=${this._tiles.customUrl}
                placeholder="https://…/{z}/{x}/{y}.png"
                @change=${(e) => this._updateTiles({ customUrl: e.target.value })}
              />
            </label>`
          : ""}

        ${preset.needsKey
          ? html`<label class="map-field grow">
              <span>${t(this.hass, "map.tiles.key")}</span>
              <input
                type="text"
                .value=${this._tiles.key}
                placeholder=${t(this.hass, "map.tiles.key_hint")}
                @change=${(e) => this._updateTiles({ key: e.target.value })}
              />
            </label>`
          : ""}
      </div>
      ${preset.needsKey && !this._tiles.key
        ? html`<div class="map-hint">${t(this.hass, "map.tiles.key_missing")}</div>`
        : ""}
    `;
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
          <label>
            <input
              type="checkbox"
              .checked=${this.showLabels}
              @change=${(e) => {
                this.showLabels = e.target.checked;
                this._fitted = true;
                this._redraw();
              }}
            />
            ${t(this.hass, "map.show_labels")}
          </label>
          <label>
            <input
              type="checkbox"
              .checked=${this.showPrecision}
              @change=${(e) => {
                this.showPrecision = e.target.checked;
                this._redraw();
              }}
            />
            ${t(this.hass, "map.show_precision")}
          </label>
          <span class="map-toolbar-right">
            <span class="map-count">${t(this.hass, "map.count", { n: positioned, total })}</span>
            <button
              class="map-settings-toggle"
              @click=${() => {
                this._showTileSettings = !this._showTileSettings;
              }}
            >
              ${t(this.hass, "map.tiles.toggle")}
            </button>
          </span>
        </div>
        ${this._showTileSettings ? this._renderTileSettings() : ""}
        ${this._error ? html`<div class="map-error">${this._error}</div>` : ""}
        <div class="map-canvas"></div>
      </div>
      <style>
        .mtsw-map {
          display: flex;
          flex-direction: column;
          height: var(--mtsw-tab-height, calc(100vh - 105px));
          min-height: 320px;
        }
        .mtsw-map .map-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px 16px;
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
        .mtsw-map .map-toolbar-right {
          display: inline-flex;
          align-items: center;
          gap: 12px;
        }
        .mtsw-map .map-count {
          color: var(--secondary-text-color);
        }
        .mtsw-map .map-settings-toggle {
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: none;
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 12px;
          padding: 5px 10px;
          cursor: pointer;
        }
        .mtsw-map .map-settings-toggle:hover {
          background: var(--secondary-background-color);
        }
        .mtsw-map .map-tilebar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
        }
        .mtsw-map .map-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .mtsw-map .map-field.grow {
          flex: 1;
          min-width: 240px;
        }
        .mtsw-map .map-field select,
        .mtsw-map .map-field input {
          padding: 6px 8px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 13px;
        }
        .mtsw-map .map-hint {
          padding: 8px 16px;
          font-size: 12px;
          color: var(--warning-color, #ffa600);
          border-bottom: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
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
        .mtsw-map .mtsw-node-label {
          background: rgba(44, 45, 60, 0.85);
          border: none;
          border-radius: 4px;
          box-shadow: none;
          color: #fff;
          font-size: 11px;
          font-weight: 500;
          padding: 1px 5px;
          white-space: nowrap;
        }
        .mtsw-map .mtsw-node-label::before {
          display: none;
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
