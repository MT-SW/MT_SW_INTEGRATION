// Warstwy plannera na mapie Leaflet: znaczniki A/B z linią łącza, tryb wskazywania punktu kliknięciem oraz
// warstwy zasięgu jako nakładki obrazu (raster w stylu MeshMap-Planner) z listą warstw na górze mapy.
//
// Dane warstw (rejestr) są osobno od Leafleta: przeżywają przełączanie zakładek panelu (mapa jest niszczona
// przy wyjściu z zakładki), ale NIE są zapisywane na stałe — po odświeżeniu strony ich nie ma.
import { coverageRaster } from './index.js';
import { MAX_COVERAGE_LAYERS } from './planner-strings.js';

/** Rejestr warstw zasięgu (bez Leafleta, łatwy do testowania). */
export class CoverageLayerRegistry {
  constructor(max = MAX_COVERAGE_LAYERS) {
    this.max = max;
    this.layers = [];
    this._seq = 0;
    this._listeners = new Set();
  }

  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() { for (const fn of [...this._listeners]) { try { fn(this.layers); } catch (e) { console.error(e); } } }

  get count() { return this.layers.length; }

  /**
   * @param {{name:string, subtitle?:string, imageUrl:string, bounds:{south:number,west:number,north:number,east:number},
   *   center:{lat:number,lon:number}, opacity:number}} spec
   * @returns {{ok:true, id:number} | {ok:false, reason:'LIMIT'}}
   */
  add(spec) {
    if (this.layers.length >= this.max) return { ok: false, reason: 'LIMIT' };
    const id = ++this._seq;
    this.layers = [...this.layers, { id, visible: true, subtitle: '', ...spec }];
    this._emit();
    return { ok: true, id };
  }

  _patch(id, patch) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
    this._emit();
  }

  toggle(id) { const l = this.layers.find((x) => x.id === id); if (l) this._patch(id, { visible: !l.visible }); }
  setOpacity(id, opacity) { this._patch(id, { opacity: Math.min(1, Math.max(0.05, opacity)) }); }
  setLastOpacity(opacity) { const l = this.layers[this.layers.length - 1]; if (l) this.setOpacity(l.id, opacity); }
  remove(id) { this.layers = this.layers.filter((l) => l.id !== id); this._emit(); }
  clear() { this.layers = []; this._emit(); }
}

/** Raster pokrycia -> {imageUrl, bounds}. Wymaga DOM (canvas). */
export function coverageToImage(coverage, { gridCells = 360 } = {}) {
  const raster = coverageRaster(coverage, { gridCells, opacity: 1, projection: 'mercator' });
  if (!raster) return null;
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(raster.rgba, raster.width, raster.height), 0, 0);
  return { imageUrl: canvas.toDataURL('image/png'), bounds: raster.bounds };
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * Powiązanie rejestru warstw i znaczników z jedną instancją mapy Leaflet.
 * `tr(key, ...args)` zwraca napis planera (klucz bez prefiksu planner_).
 */
export class PlannerMapLayer {
  constructor({ L, map, mount, registry, tr, onPick, onCancelPick, onCountChange }) {
    this.L = L;
    this.map = map;
    this.mount = mount;
    this.registry = registry;
    this.tr = tr;
    this.onPick = onPick;
    this.onCancelPick = onCancelPick;
    this.onCountChange = onCountChange;
    this._pickSide = null;
    this._overlays = new Map();
    this._collapsed = false;
    this._destroyed = false;

    if (!map.getPane('mlpCoverage')) {
      const pane = map.createPane('mlpCoverage');
      pane.style.zIndex = 350; // nad kaflami (200), pod liniami i znacznikami węzłów (400+)
      pane.style.pointerEvents = 'none';
    }
    this._pins = L.layerGroup().addTo(map);
    this._pinA = null;
    this._pinB = null;
    this._line = null;

    this._banner = el('div', 'mlp-banner mlp-hidden');
    this._bannerText = el('span');
    this._bannerCancel = el('button', 'mlp-btn mlp-btn-text', tr('cancel'));
    this._bannerCancel.type = 'button';
    this._bannerCancel.addEventListener('click', () => { this.setPickMode(null); if (this.onCancelPick) this.onCancelPick(); });
    this._banner.append(this._bannerText, this._bannerCancel);

    this._box = el('div', 'mlp-layers mlp-hidden');
    mount.append(this._banner, this._box);
    if (L.DomEvent) {
      L.DomEvent.disableClickPropagation(this._box);
      L.DomEvent.disableScrollPropagation(this._box);
      L.DomEvent.disableClickPropagation(this._banner);
    }

    this._clickHandler = (ev) => {
      if (!this._pickSide) return;
      const side = this._pickSide;
      this.setPickMode(null);
      if (this.onPick) this.onPick(side, ev.latlng.lat, ev.latlng.lng);
    };
    map.on('click', this._clickHandler);

    this._unsub = registry.subscribe(() => this._sync());
    this._sync();
  }

  /** Napisy zależne od języka — wywołaj po zmianie języka. */
  retranslate(tr) {
    this.tr = tr;
    this._bannerCancel.textContent = tr('cancel');
    this._renderList();
  }

  // ---- znaczniki A/B ----
  setPoints(a, b, names = { A: 'A', B: 'B' }) {
    const L = this.L;
    const make = (end, letter, cls) => L.marker([end.lat, end.lon], {
      icon: L.divIcon({ className: 'mlp-pin-wrap', html: `<div class="mlp-pin ${cls}">${letter}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      interactive: false, keyboard: false, zIndexOffset: 1000, title: names[letter] || letter,
    });
    const okA = a && Number.isFinite(a.lat) && Number.isFinite(a.lon);
    const okB = b && Number.isFinite(b.lat) && Number.isFinite(b.lon);
    this._pins.clearLayers();
    this._pinA = okA ? make(a, 'A', 'mlp-pin-a').addTo(this._pins) : null;
    this._pinB = okB ? make(b, 'B', 'mlp-pin-b').addTo(this._pins) : null;
    this._line = okA && okB
      ? L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: '#d32f2f', weight: 3, opacity: 0.9, dashArray: '8 6', interactive: false }).addTo(this._pins)
      : null;
  }

  // ---- wskazywanie punktu na mapie ----
  /** side: 'A' | 'B' | null; tekst banera: planner_pick_banner. */
  setPickMode(side, sideLabel = '') {
    this._pickSide = side;
    const container = this.map.getContainer();
    if (side) {
      this._bannerText.textContent = this.tr('pick_banner', sideLabel);
      this._banner.classList.remove('mlp-hidden');
      container.classList.add('mlp-picking');
    } else {
      this._banner.classList.add('mlp-hidden');
      container.classList.remove('mlp-picking');
    }
  }
  get picking() { return this._pickSide; }

  center() { const c = this.map.getCenter(); return { lat: c.lat, lon: c.lng }; }
  moveTo(lat, lon) { this.map.panTo([lat, lon]); }

  // ---- warstwy zasięgu ----
  _sync() {
    if (this._destroyed) return;
    const L = this.L;
    const ids = new Set(this.registry.layers.map((l) => l.id));
    for (const [id, ov] of this._overlays) {
      if (!ids.has(id)) { this.map.removeLayer(ov.group); this._overlays.delete(id); }
    }
    for (const lay of this.registry.layers) {
      let ov = this._overlays.get(lay.id);
      if (!ov) {
        const b = lay.bounds;
        const image = L.imageOverlay(lay.imageUrl, [[b.south, b.west], [b.north, b.east]], {
          pane: 'mlpCoverage', interactive: false, opacity: lay.opacity, className: 'mlp-cov-img', zIndex: 10 + lay.id,
        });
        const marker = L.circleMarker([lay.center.lat, lay.center.lon], {
          radius: 5, color: '#1565c0', weight: 2, fillColor: '#ffffff', fillOpacity: 1, interactive: false,
        });
        ov = { group: L.layerGroup([image, marker]), image, visible: false };
        this._overlays.set(lay.id, ov);
      }
      ov.image.setOpacity(lay.opacity);
      if (lay.visible && !ov.visible) { ov.group.addTo(this.map); ov.visible = true; }
      if (!lay.visible && ov.visible) { this.map.removeLayer(ov.group); ov.visible = false; }
    }
    this._renderList();
    if (this.onCountChange) this.onCountChange(this.registry.count);
  }

  _renderList() {
    const tr = this.tr;
    const box = this._box;
    const layers = this.registry.layers;
    box.classList.toggle('mlp-hidden', layers.length === 0);
    if (layers.length === 0) { box.replaceChildren(); return; }
    const head = el('button', 'mlp-layers-head');
    head.type = 'button';
    head.append(el('span', 'mlp-layers-title', `${tr('ha_layers_manage')} (${layers.length}/${this.registry.max})`), el('span', 'mlp-layers-caret', this._collapsed ? '▸' : '▾'));
    head.addEventListener('click', () => { this._collapsed = !this._collapsed; this._renderList(); });
    const list = el('div', 'mlp-layers-list');
    list.hidden = this._collapsed;
    for (const lay of [...layers].reverse()) {
      const row = el('div', 'mlp-layer-row');
      const info = el('div', 'mlp-layer-info');
      info.append(el('div', 'mlp-layer-name', lay.name));
      if (lay.subtitle) info.append(el('div', 'mlp-layer-sub', lay.subtitle));
      const slider = el('input');
      slider.type = 'range'; slider.min = '5'; slider.max = '100'; slider.step = '1';
      slider.value = String(Math.round(lay.opacity * 100));
      const lbl = el('div', 'mlp-layer-sub', tr('ha_layer_opacity', Math.round(lay.opacity * 100)));
      slider.addEventListener('input', () => {
        lbl.textContent = tr('ha_layer_opacity', Number(slider.value));
        const ov = this._overlays.get(lay.id);
        if (ov) ov.image.setOpacity(Number(slider.value) / 100); // płynnie, bez przebudowy listy
      });
      slider.addEventListener('change', () => this.registry.setOpacity(lay.id, Number(slider.value) / 100));
      info.append(lbl, slider);
      const btns = el('div', 'mlp-layer-btns');
      const mk = (txt, title, fn) => {
        const b = el('button', 'mlp-btn mlp-btn-icon', txt);
        b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
        b.addEventListener('click', fn);
        return b;
      };
      btns.append(
        mk(lay.visible ? '\u{1F441}' : '◌', lay.visible ? tr('ha_layer_hide') : tr('ha_layer_show'), () => this.registry.toggle(lay.id)),
        mk('⌖', tr('ha_layer_zoom'), () => {
          const b = lay.bounds;
          this.map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [20, 20] });
        }),
        mk('\u{1F5D1}', tr('ha_layer_remove'), () => this.registry.remove(lay.id)),
      );
      row.append(info, btns);
      list.append(row);
    }
    box.replaceChildren(head, list);
  }

  destroy() {
    this._destroyed = true;
    if (this._unsub) this._unsub();
    try { this.map.off('click', this._clickHandler); } catch { /* mapa już usunięta */ }
    try { this.map.getContainer().classList.remove('mlp-picking'); } catch { /* ignoruj */ }
    for (const [, ov] of this._overlays) { try { this.map.removeLayer(ov.group); } catch { /* ignoruj */ } }
    this._overlays.clear();
    try { this._pins.clearLayers(); this.map.removeLayer(this._pins); } catch { /* ignoruj */ }
    this._banner.remove();
    this._box.remove();
  }
}
