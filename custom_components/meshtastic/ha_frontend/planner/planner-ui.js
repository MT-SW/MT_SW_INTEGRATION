// Mesh Link Planer (by MT_SW) — panel boczny w zakładce Mapa. Odpowiednik PlannerSheet.kt i sekcji z aplikacji
// na Androida. Jedyne miejsce zaczepienia w map.js: attachPlanner() (patrz map.js). Cała logika jest tutaj:
// stan w planner-state.js, napisy w planner-strings.js, wykresy w planner-chart.js, warstwy w planner-map-layer.js.
import {
  PLANNER_BANDS, MODEM_PRESETS, CABLES, CONNECTORS, FEEDER_PRESETS, computeFeeder, FEEDER_CUSTOM_ID, FEEDER_NONE_ID,
  MAX_CONNECTORS, PlannerClutter, coverageLegendGradientCss, FREE_ID, FREE_MIN_MHZ, FREE_MAX_MHZ, sensitivityDbm,
  noiseFloorDbm, dbmToWatts, ITM_ERROR_LOSS_DB, CLUTTER_PRESETS, feederLossOf,
} from './index.js';
import { ps, plannerLanguage, MAX_COVERAGE_LAYERS } from './planner-strings.js';
import {
  fmt, fmtTrim, fmtSigned, fmtDistance, verdictColor, verdictKey, itmModeKey, ductingKey, clutterPresetKey, errorKey,
  feederPresetKey, feederWarningKey, localizeFeederLabel, parseNumber, parseCoordinate, parseLatLonPair, formatCoordinates,
  formatField, formatWatts, sameValue, fileStamp,
} from './planner-format.js';
import {
  PlannerStore, SIDES, endOf, otherSide, isEndComplete, isLinkReady, hintsOf, nodeOptionsFromHaNodes,
} from './planner-state.js';
import { createWidgets, buildInfoDialog, h } from './planner-widgets.js';
import { setPlannerProxy, createHassProxy } from './net.js';
import { buildProfileChart, buildCoveragePlan } from './planner-chart.js';
import { CoverageLayerRegistry, PlannerMapLayer, coverageToImage } from './planner-map-layer.js';
import { makeReportStrings, buildReport, csvSummary, csvProfile, renderKml, renderGeoJson, profileToPngBlob } from './planner-exports.js';
import { renderPdf } from './planner-pdf.js';
import { PLANNER_CSS } from './planner-styles.js';
import { viaInfo, signalInfo } from '../hops.js';

const HOPS = { viaInfo, signalInfo };
const MAX_GROUND_M = 9000;
const MIN_GROUND_M = -500;
const MAX_HEIGHT_M = 2000;
const COORD_DECIMALS = 6;
const TOAST_MS = 7000;

/** Stan sesji przeżywa przełączanie zakładek panelu (mapa jest wtedy niszczona), ale nie odświeżenie strony. */
let session = null;
export function getPlannerSession() {
  if (!session) {
    session = {
      store: new PlannerStore(),
      registry: new CoverageLayerRegistry(),
      fieldTexts: new Map(),
      coordTexts: { A: null, B: null },
      inWatts: { A: false, B: false },
      open: false,
    };
  }
  return session;
}

/** Test/diagnostyka: porzuca stan sesji. */
export function resetPlannerSession() {
  if (session) session.store.destroy();
  session = null;
}

/** Zaczepienie w komponencie mapy. Zwraca kontroler z update(hass, nodes) i destroy(). */
export function attachPlanner(opts) {
  try {
    return new PlannerController(opts);
  } catch (e) {
    // Błąd plannera nie może zepsuć mapy.
    console.error('MT_SW planner: nie udało się uruchomić', e);
    return { update() {}, destroy() {} };
  }
}

const sameConfig = (a, b) => a.connectorIds.length === b.connectorIds.length
  && a.connectorIds.every((c, i) => c === b.connectorIds[i])
  && a.sections.length === b.sections.length
  && a.sections.every((s, i) => s.cableId === b.sections[i].cableId && s.lengthM === b.sections[i].lengthM
    && (s.customDbPerM ?? null) === (b.sections[i].customDbPerM ?? null));

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

let clutterDetailsOpen = false;

/** Szczegóły techniczne błędu pobierania OSM jako zwykły tekst (do wklejenia w zgłoszeniu). */
export function clutterDetailText(status) {
  if (!status || status.kind !== 'failed') return '';
  const d = status.detail || {};
  const lines = [`failure: ${status.failure}`];
  if (d.status !== undefined) lines.push(`HTTP: ${d.status}`);
  if (d.errorName || d.errorMessage) lines.push(`error: ${[d.errorName, d.errorMessage].filter(Boolean).join(': ')}`);
  if (d.remark) lines.push(`server: ${d.remark}`);
  if (d.proxyError) lines.push(`proxy: ${d.proxyError}`);
  if (d.piecesTotal !== undefined) lines.push(`piece: ${d.piecesDone + 1} of ${d.piecesTotal}`);
  if (d.radiusKm !== undefined) lines.push(`radius: ${d.requestedRadiusKm} km -> ${d.radiusKm} km`);
  for (const a of d.attempts || []) {
    const bits = [a.mirror];
    if (a.status !== undefined) bits.push(`HTTP ${a.status}`);
    if (a.timedOut) bits.push('timeout');
    if (a.errorName) bits.push(`${a.errorName}: ${a.errorMessage || ''}`);
    if (a.remark) bits.push(a.remark);
    if (a.viaProxy) bits.push('via proxy');
    if (a.proxyError) bits.push(`proxy: ${a.proxyError}`);
    bits.push(`${a.ms} ms`);
    lines.push(`- ${bits.join(' | ')}`);
  }
  return lines.join('\n');
}

class PlannerController {
  /**
   * @param {{host:HTMLElement, map:object, L:object, container:HTMLElement, hass:object, nodes?:Array}} o
   *  host = element zakładki Mapa (light DOM), container = element .map-canvas, mount = jego rodzic (.mtsw-map)
   */
  constructor({ host, map, L, container, hass, nodes }) {
    this.host = host;
    this.map = map;
    this.L = L;
    this.container = container;
    this.mount = container.parentElement || host;
    this.hass = hass;
    // Awaryjna droga przez backend integracji, gdy bezpośrednie zapytanie do Overpass/Mapterhorn/Open-Meteo
    // padnie na CORS/sieci (patrz net.js, planner_proxy.py).
    setPlannerProxy(createHassProxy(() => this.hass));
    this.session = getPlannerSession();
    this.store = this.session.store;
    this.registry = this.session.registry;
    this._lang = plannerLanguage(hass);
    this._destroyed = false;
    this._raf = 0;
    this._lastNodesRef = null;
    this._pinsKey = '';
    this._chartWidth = 380;
    this._exportMsg = null;
    this._infoEl = null;
    this._toastTimer = 0;
    this.tr = (key, ...a) => ps(this.hass, key, ...a);
    this.W = null;
    this._buildWidgets();

    this.styleEl = h('style', { 'data-mlp': '' });
    this.styleEl.textContent = PLANNER_CSS;
    this.mount.appendChild(this.styleEl);

    this._buildButton();
    this._buildPanel();
    this.layer = new PlannerMapLayer({
      L, map, mount: this.mount, registry: this.registry, tr: (...a) => this.tr(...a),
      onPick: (side, lat, lon) => this._picked(side, lat, lon),
      onCancelPick: () => this.panel.classList.remove('mlp-away'),
      onCountChange: (n) => this._updateBadge(n),
    });
    this._unsubState = this.store.subscribe(() => this._scheduleRender());
    this._unsubProgress = this.store.onProgress((p) => this._progress(p));

    this._resizeObs = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => this._onResize())
      : null;
    if (this._resizeObs) this._resizeObs.observe(this.body);

    this.update(hass, nodes);
    this._syncPins(true);
    this._updateBadge(this.registry.count);
    if (this.session.open) this.open();
  }

  // ------------------------------------------------------------------------------------------
  // cykl życia
  // ------------------------------------------------------------------------------------------
  /** Wołane z updated() zakładki Mapa przy każdej zmianie hass/nodes. */
  update(hass, nodes) {
    if (this._destroyed) return;
    this.hass = hass || this.hass;
    const lang = plannerLanguage(this.hass);
    if (lang !== this._lang) {
      this._lang = lang;
      this._buildWidgets();
      this._retranslateChrome();
      this.layer.retranslate((...a) => this.tr(...a));
      this._scheduleRender();
    }
    if (nodes && nodes !== this._lastNodesRef) {
      this._lastNodesRef = nodes;
      this.store.setNodes(nodeOptionsFromHaNodes(nodes, HOPS));
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    clearTimeout(this._toastTimer);
    if (this._unsubState) this._unsubState();
    if (this._unsubProgress) this._unsubProgress();
    if (this._resizeObs) this._resizeObs.disconnect();
    this.layer.destroy();
    this.panel.remove();
    this.btn.remove();
    this.styleEl.remove();
    if (this._infoEl) this._infoEl.remove();
    // Obliczenia zasięgu w tle nie mają sensu bez widocznego UI, ale stan i wyniki zostają w sesji.
  }

  _buildWidgets() {
    this.W = createWidgets({
      tr: (...a) => this.tr(...a),
      fieldTexts: this.session.fieldTexts,
      openInfo: (topic) => this._openInfo(topic),
    });
  }

  _buildButton() {
    const slot = this.host.querySelector('.mlp-slot')
      || this.host.querySelector('.map-toolbar-right')
      || this.host.querySelector('.map-toolbar');
    this.btn = h('button', { class: 'map-settings-toggle mlp-open', type: 'button', 'aria-pressed': 'false', onClick: () => this.toggle() });
    this._btnLabel = h('span', null, this.tr('title'));
    this._badge = h('span', { class: 'mlp-badge mlp-hidden', title: this.tr('ha_layers_badge', 0) }, '0');
    this.btn.append(this._btnLabel, this._badge);
    this.btn.title = this.tr('ha_open_planner');
    if (slot) slot.prepend(this.btn);
    else this.mount.prepend(this.btn);
  }

  _updateBadge(n) {
    this._badge.textContent = String(n);
    this._badge.title = this.tr('ha_layers_badge', n);
    this._badge.classList.toggle('mlp-hidden', n === 0);
  }

  _retranslateChrome() {
    this._btnLabel.textContent = this.tr('title');
    this.btn.title = this.tr('ha_open_planner');
    this._titleEl.textContent = this.tr('title');
    this._byEl.textContent = this.tr('title_by');
    this._closeBtn.title = this.tr('close');
    this._closeBtn.setAttribute('aria-label', this.tr('close'));
    this._updateBadge(this.registry.count);
    for (const sec of this.sections) sec.last = null;
  }

  // ------------------------------------------------------------------------------------------
  // panel
  // ------------------------------------------------------------------------------------------
  _buildPanel() {
    const { W } = this;
    this._titleEl = h('h2', null, this.tr('title'));
    this._byEl = h('span', { class: 'mlp-head-by' }, this.tr('title_by'));
    this._closeBtn = h('button', { class: 'mlp-x', type: 'button', title: this.tr('close'), 'aria-label': this.tr('close'), onClick: () => this.close() }, '×');
    this.headInfoHolder = h('span');
    this.head = h('div', { class: 'mlp-head' }, h('div', { class: 'mlp-head-title' }, this._titleEl, this._byEl), this.headInfoHolder, this._closeBtn);
    this.toast = h('div', { class: 'mlp-toast mlp-hidden', 'aria-live': 'polite' });
    this.body = h('div', { class: 'mlp-body' });
    this.panel = h('aside', { class: 'mlp-panel mlp-hidden', role: 'complementary', 'aria-label': this.tr('title') }, this.head, this.toast, this.body);
    this._renderHeadInfo();

    const isReady = (s) => isLinkReady(s);
    this.sections = [
      { id: 'side', deps: (s) => [s.a, s.b, s.selectedSide, s.frequencyMHz], render: (s) => this._secSide(s) },
      { id: 'point', deps: (s) => [s.selectedSide, endOf(s, s.selectedSide)], render: (s) => this._secPoint(s) },
      { id: 'station', deps: (s) => [s.selectedSide, endOf(s, s.selectedSide), s.frequencyMHz], render: (s) => this._secStation(s) },
      { id: 'radio', deps: (s) => [s.bandId, s.frequencyMHz, s.modemPreset, s.bandwidthKhz, s.spreadingFactor, s.radioOverride, s.noiseFigureDb], render: (s) => this._secRadio(s) },
      {
        id: 'env',
        deps: (s) => [s.useWeather, s.weather, s.kFactor, s.surfaceRefractivity, s.atmosphericLossDb, s.preciseTerrain, s.clutterRadiusKm,
          s.forestHeightM, s.buildingHeightM, s.clutter, s.clutterNote, s.clutterPreset, s.extraLossDb],
        render: (s) => this._secEnv(s),
      },
      {
        id: 'result',
        deps: (s) => [s.error, s.computing, s.link, s.kFactor, s.comparison, isEndComplete(s.a), isEndComplete(s.b), s.a.stationUnavailable, s.b.stationUnavailable],
        render: (s) => this._secResult(s),
      },
      { id: 'profile', deps: (s) => [s.series, s.link, isReady(s), this._chartWidth], render: (s) => this._secProfile(s) },
      {
        id: 'coverage',
        deps: (s) => [s.coverageSide, s.coverageMaxRangeKm, s.coverageRadials, s.coverageRxHeightM, s.coverageRxGainDbi, isEndComplete(s.a), isEndComplete(s.b),
          s.coverageComputing, s.coverage, s.coverageError],
        render: (s) => this._secCoverage(s),
      },
      { id: 'export', deps: (s) => [s.link, s.series, s.coverage, isReady(s), this._exportMsg], render: (s) => this._secExport(s) },
      { id: 'credits', deps: () => [], render: () => this._secCredits() },
    ];
    for (const sec of this.sections) {
      sec.el = h('div', { class: 'mlp-sec', 'data-sec': sec.id });
      sec.last = null;
      this.body.append(sec.el);
    }
    if (typeof this.L.DomEvent !== 'undefined') {
      this.L.DomEvent.disableClickPropagation(this.panel);
      this.L.DomEvent.disableScrollPropagation(this.panel);
    }
    this.panel.addEventListener('keydown', (e) => e.stopPropagation());
    this.mount.appendChild(this.panel);
    void W;
  }

  _renderHeadInfo() {
    this.headInfoHolder.replaceChildren(this.W.infoButton('general'));
  }

  get isOpen() { return !this.panel.classList.contains('mlp-hidden'); }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  open() {
    this.panel.style.top = `${this.container.offsetTop || 0}px`;
    this.panel.classList.remove('mlp-hidden', 'mlp-away');
    this.btn.setAttribute('aria-pressed', 'true');
    this.session.open = true;
    this._onResize();
    this._renderNow();
  }

  close() {
    this.layer.setPickMode(null);
    this.panel.classList.add('mlp-hidden');
    this.panel.classList.remove('mlp-away');
    this.btn.setAttribute('aria-pressed', 'false');
    this.session.open = false;
    this._closeInfo();
  }

  _onResize() {
    const w = Math.round(this.body.clientWidth || 0);
    if (w <= 0) return;
    const next = Math.max(260, Math.min(640, Math.floor((w - 56) / 20) * 20));
    if (next !== this._chartWidth) {
      this._chartWidth = next;
      this._scheduleRender();
    }
  }

  // ------------------------------------------------------------------------------------------
  // renderowanie z pomijaniem niezmienionych sekcji
  // ------------------------------------------------------------------------------------------
  _scheduleRender() {
    if (this._destroyed || this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._renderNow(); });
  }

  _renderNow() {
    if (this._destroyed) return;
    this._syncPins(false);
    if (!this.isOpen) return;
    const s = this.store.state;
    for (const sec of this.sections) {
      const deps = [this._lang, ...sec.deps(s)];
      if (sec.last && sec.last.length === deps.length && deps.every((v, i) => v === sec.last[i])) continue;
      sec.last = deps;
      const focus = this._captureFocus(sec.el);
      let nodes;
      try {
        nodes = sec.render(s);
      } catch (e) {
        console.error('MT_SW planner: błąd renderowania sekcji', sec.id, e);
        nodes = [this.W.notice(this.tr('error_compute_failed'), true)];
      }
      sec.el.replaceChildren(...[].concat(nodes));
      this._restoreFocus(sec.el, focus);
    }
  }

  _forceSection(id) {
    const sec = this.sections.find((x) => x.id === id);
    if (sec) sec.last = null;
    this._scheduleRender();
  }

  _captureFocus(el) {
    const root = this.panel.getRootNode();
    const ae = (root && root.activeElement) || document.activeElement;
    if (ae && ae !== document.body && el.contains(ae) && ae.dataset && ae.dataset.k) {
      return { k: ae.dataset.k, s: ae.selectionStart, e: ae.selectionEnd };
    }
    return null;
  }

  _restoreFocus(el, f) {
    if (!f) return;
    const n = el.querySelector(`[data-k="${f.k.replace(/"/g, '\\"')}"]`);
    if (!n) return;
    try { n.focus({ preventScroll: true }); } catch { /* ignoruj */ }
    try { if (typeof f.s === 'number') n.setSelectionRange(f.s, f.e); } catch { /* pole bez zaznaczenia */ }
  }

  _progress(p) {
    if (this._progressEl) this._progressEl.value = p;
    if (this._progressText) this._progressText.textContent = this.tr('ha_coverage_progress', Math.round(p * 100));
    if (this._clutterProgText) this._clutterProgText.textContent = this._clutterProgressLabel();
  }

  /** Napis o pobieraniu danych terenu kawałkami (pusty, gdy nic się nie pobiera). */
  _clutterProgressLabel() {
    const cp = this.store.state.clutterProgress;
    return cp ? this.tr('precise_progress', cp.done, cp.total) : '';
  }

  _toast(text, isError = false) {
    clearTimeout(this._toastTimer);
    this.toast.replaceChildren(this.W.notice(text, isError));
    this.toast.classList.remove('mlp-hidden');
    this._toastTimer = setTimeout(() => this.toast.classList.add('mlp-hidden'), TOAST_MS);
  }

  // ------------------------------------------------------------------------------------------
  // znaczniki na mapie
  // ------------------------------------------------------------------------------------------
  _syncPins(force) {
    const s = this.store.state;
    const key = [s.a.lat, s.a.lon, s.b.lat, s.b.lon].join('|');
    if (!force && key === this._pinsKey) return;
    const prev = this._pinsKey.split('|');
    this._pinsKey = key;
    this.layer.setPoints(
      isEndComplete(s.a) ? s.a : null, isEndComplete(s.b) ? s.b : null,
      { A: this.sideName('A'), B: this.sideName('B') },
    );
    // nowy punkt poza widokiem: przesuń mapę, żeby użytkownik go zobaczył
    const now = key.split('|');
    const changed = [[0, 1, s.a], [2, 3, s.b]].find(([i, j]) => !force && (now[i] !== prev[i] || now[j] !== prev[j]));
    if (changed && isEndComplete(changed[2])) {
      try {
        const b = this.map.getBounds();
        if (b && !b.contains([changed[2].lat, changed[2].lon])) this.map.panTo([changed[2].lat, changed[2].lon]);
      } catch { /* mapa jeszcze bez rozmiaru */ }
    }
  }

  sideName(side) { return this.tr(side === 'A' ? 'point_a' : 'point_b'); }

  _startPick(side) {
    this.layer.setPickMode(side, this.sideName(side));
    this.panel.classList.add('mlp-away');
  }

  _picked(side, lat, lon) {
    this.store.selectSide(side);
    this.store.setPointFromMap(side, lat, lon);
    this.panel.classList.remove('mlp-away');
    if (!this.isOpen) this.open();
  }

  // ------------------------------------------------------------------------------------------
  // okna objaśnień
  // ------------------------------------------------------------------------------------------
  _openInfo(topic) {
    this._closeInfo();
    this._infoEl = buildInfoDialog({ tr: (...a) => this.tr(...a), topic, onClose: () => this._closeInfo() });
    this.mount.appendChild(this._infoEl);
  }

  _closeInfo() {
    if (this._infoEl) { this._infoEl.remove(); this._infoEl = null; }
  }

  // ------------------------------------------------------------------------------------------
  // sekcje
  // ------------------------------------------------------------------------------------------
  _unit(k) { return this.tr(`unit_${k}`); }

  _secSide(s) {
    const { W, tr } = this;
    const summary = (side) => {
      const end = endOf(s, side);
      const incomplete = hintsOf(end).length > 0 || !isEndComplete(end);
      return W.h('button', {
        class: `mlp-sidecard${s.selectedSide === side ? ' mlp-sidecard-on' : ''}`, type: 'button', 'aria-pressed': s.selectedSide === side ? 'true' : 'false',
        onClick: () => this.store.selectSide(side),
      },
      W.h('div', { class: 'mlp-sidecard-head' }, W.h('span', null, this.sideName(side)),
        incomplete ? W.h('span', { class: 'mlp-warn-ic', title: tr('incomplete'), 'aria-label': tr('incomplete') }, '!') : null),
      W.h('div', { class: 'mlp-trunc' }, (end.name && end.name.trim()) || tr('point_unnamed')),
      W.h('div', { class: 'mlp-small mlp-trunc' }, isEndComplete(end) ? formatCoordinates(end.lat, end.lon, 4) : tr('point_not_set')),
      W.h('div', { class: 'mlp-small' }, tr('summary_radio', fmt(end.txPowerDbm, 1), fmt(end.antennaGainDbi, 1), fmt(end.antennaHeightM, 1), fmt(feederLossOf(end, s.frequencyMHz), 1))));
    };
    return [
      W.segmented(SIDES.map((x) => [x, this.sideName(x)]), s.selectedSide, (x) => this.store.selectSide(x)),
      W.h('div', { class: 'mlp-sidecards' }, summary('A'), summary('B')),
      W.h('div', { class: 'mlp-flow' }, W.button(tr('copy_a_to_b'), () => this.store.copyAToB()), W.button(tr('swap_ab'), () => this.store.swapAB())),
      W.small(tr('copy_a_to_b_hint')),
    ];
  }

  _secPoint(s) {
    const { W, tr } = this;
    const side = s.selectedSide;
    const end = endOf(s, side);
    const store = this.store;
    const src = (end.pointSource || { type: 'none' }).type;
    const srcKey = { none: 'source_none', node: 'source_node', map: 'source_map', manual: 'source_manual', station: 'source_station_used' }[src] || 'source_none';
    const out = [];
    out.push(W.textField(`${side}.name`, tr('point_name'), end.name, (v) => store.setName(side, v)));
    out.push(W.h('div', { class: 'mlp-row' },
      W.h('div', { style: { flex: 1 } }, W.h('div', null, tr('source_label', tr(srcKey))),
        isEndComplete(end) ? W.small(formatCoordinates(end.lat, end.lon)) : null),
      isEndComplete(end) ? W.h('button', { class: 'mlp-x', type: 'button', title: tr('clear_point'), 'aria-label': tr('clear_point'), onClick: () => store.clearPoint(side) }, '×') : null));
    out.push(W.h('div', { class: 'mlp-flow' },
      W.button(`☰ ${tr('source_pick_node')}`, () => this._openNodePicker(side)),
      W.button(`⌖ ${tr('source_tap_map')}`, () => this._startPick(side)),
      W.button(`◎ ${tr('source_station')}`, () => store.useStation(side)),
      W.button(`⬚ ${tr('source_map_center')}`, () => { const c = this.layer.center(); store.setPointFromMap(side, c.lat, c.lon); })));
    out.push(this._coordinateFields(side, end));
    for (const hint of hintsOf(end)) out.push(W.notice(this._hintText(side, hint)));
    // wysokość terenu
    const supporting = !isEndComplete(end) ? tr('ground_alt_no_point')
      : end.groundAltManual ? tr('ground_alt_manual')
        : end.groundAltM !== null && end.groundAltM !== undefined ? tr('ground_alt_from_model') : tr('ground_alt_waiting');
    out.push(W.subheading(tr('ground_alt_title'), 'ground_alt'));
    out.push(W.h('div', { class: 'mlp-two' },
      W.numberField({
        key: `${side}.ground`, label: tr('ground_alt'), value: end.groundAltM ?? null, onValue: (v) => store.setGroundAlt(side, v), onBlank: () => store.setGroundAlt(side, null),
        decimals: 1, suffix: this._unit('m_asl'), min: MIN_GROUND_M, max: MAX_GROUND_M, supporting, enabled: isEndComplete(end),
      }),
      W.h('div', { style: { flex: '0 0 auto', paddingTop: '18px' } }, W.chip(tr('ground_alt_auto'), !end.groundAltManual, () => store.setGroundAlt(side, null), { disabled: !isEndComplete(end) }))));
    out.push(W.subheading(tr('antenna_height_title'), 'antenna_height'));
    out.push(W.numberField({
      key: `${side}.height`, label: tr('antenna_height'), value: end.antennaHeightM, onValue: (v) => store.setAntennaHeight(side, v),
      decimals: 1, suffix: this._unit('m'), min: 0, max: MAX_HEIGHT_M,
    }));
    return W.card(tr('section_point', this.sideName(side)), 'points', out);
  }

  _hintText(side, hint) {
    return hint === 'POINT_MISSING' ? this.tr('hint_point_missing', this.sideName(side)) : this.tr('hint_station_no_position', this.sideName(side));
  }

  _coordinateFields(side, end) {
    const { W, tr } = this;
    const store = this.store;
    let entry = this.session.coordTexts[side];
    if (!entry) { entry = { lat: undefined, lon: undefined, latText: '', lonText: '' }; this.session.coordTexts[side] = entry; }
    if (entry.lat !== end.lat || entry.lon !== end.lon) {
      if (end.lat === null || end.lat === undefined || end.lon === null || end.lon === undefined) {
        entry.latText = ''; entry.lonText = '';
      } else {
        const pLat = parseCoordinate(entry.latText, true);
        const pLon = parseCoordinate(entry.lonText, false);
        if (pLat === null || !sameValue(pLat, end.lat)) entry.latText = formatField(end.lat, COORD_DECIMALS);
        if (pLon === null || !sameValue(pLon, end.lon)) entry.lonText = formatField(end.lon, COORD_DECIMALS);
      }
      entry.lat = end.lat; entry.lon = end.lon;
    }
    const latSupport = h('div', { class: 'mlp-support' });
    const lonSupport = h('div', { class: 'mlp-support' });
    const latIn = h('input', { class: 'mlp-input', type: 'text', autocomplete: 'off', 'data-k': `${side}.lat`, value: entry.latText, 'aria-label': tr('latitude') });
    const lonIn = h('input', { class: 'mlp-input', type: 'text', autocomplete: 'off', 'data-k': `${side}.lon`, value: entry.lonText, 'aria-label': tr('longitude') });
    const validate = () => {
      const latBad = latIn.value.trim() !== '' && parseCoordinate(latIn.value, true) === null;
      const lonBad = lonIn.value.trim() !== '' && parseCoordinate(lonIn.value, false) === null;
      latIn.classList.toggle('mlp-invalid', latBad);
      lonIn.classList.toggle('mlp-invalid', lonBad);
      latSupport.classList.toggle('mlp-support-error', latBad);
      lonSupport.classList.toggle('mlp-support-error', lonBad);
      latSupport.textContent = latBad ? tr('error_latitude') : tr('coordinates_hint');
      lonSupport.textContent = lonBad ? tr('error_longitude') : '';
    };
    const commit = (latT, lonT) => {
      const la = parseCoordinate(latT, true);
      const lo = parseCoordinate(lonT, false);
      if (la !== null && lo !== null) store.setPointManual(side, la, lo);
    };
    latIn.addEventListener('input', () => {
      const t = latIn.value;
      const pair = t.includes(';') || t.trim().includes(' ') ? parseLatLonPair(t) : null;
      if (pair) {
        entry.latText = formatField(pair[0], COORD_DECIMALS);
        entry.lonText = formatField(pair[1], COORD_DECIMALS);
        latIn.value = entry.latText; lonIn.value = entry.lonText;
        validate();
        store.setPointManual(side, pair[0], pair[1]);
      } else {
        entry.latText = t;
        validate();
        commit(t, entry.lonText);
      }
    });
    lonIn.addEventListener('input', () => {
      entry.lonText = lonIn.value;
      validate();
      commit(entry.latText, lonIn.value);
    });
    validate();
    return W.h('div', { class: 'mlp-card-body' },
      W.subheading(tr('coordinates_title')),
      W.h('label', { class: 'mlp-field' }, W.h('span', { class: 'mlp-field-label' }, tr('latitude')), latIn, latSupport),
      W.h('label', { class: 'mlp-field' }, W.h('span', { class: 'mlp-field-label' }, tr('longitude')), lonIn, lonSupport));
  }

  _openNodePicker(side) {
    const { tr } = this;
    this._closeInfo();
    const store = this.store;
    const selectedNum = ((endOf(store.state, side).pointSource) || {}).num;
    let query = '';
    const list = h('div', { class: 'mlp-picklist' });
    const search = h('input', { class: 'mlp-input', type: 'text', placeholder: tr('node_search'), 'aria-label': tr('node_search'), autocomplete: 'off' });
    const close = () => this._closeInfo();
    const draw = () => {
      const q = query.trim().toLowerCase();
      const nodes = store.nodes
        .filter((n) => !q || n.displayName.toLowerCase().includes(q) || n.shortName.toLowerCase().includes(q))
        .sort((a, b) => (Number(b.isOurs) - Number(a.isOurs)) || (a.hopsAway - b.hopsAway) || a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));
      if (nodes.length === 0) { list.replaceChildren(h('div', { class: 'mlp-small' }, tr('node_none'))); return; }
      list.replaceChildren(...nodes.map((n) => {
        const detail = [tr('node_hops', n.hopsAway), n.snrDb !== null ? tr('node_snr', fmt(n.snrDb, 1)) : null, n.rssiDbm !== null ? tr('node_rssi', n.rssiDbm) : null].filter(Boolean).join(' · ');
        return h('button', { class: 'mlp-pickrow', type: 'button', onClick: () => { store.setPointFromNode(side, n.num); close(); } },
          h('span', { style: { fontWeight: n.num === selectedNum ? '700' : '400' } }, n.displayName + (n.isOurs ? ` (${tr('node_ours')})` : '')),
          h('span', { class: 'mlp-small' }, detail));
      }));
    };
    search.addEventListener('input', () => { query = search.value; draw(); });
    draw();
    const closeBtn = h('button', { class: 'mlp-btn mlp-btn-primary', type: 'button', onClick: close }, tr('close'));
    const dialog = h('div', { class: 'mlp-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('node_picker_title') },
      h('h3', { class: 'mlp-dialog-title' }, tr('node_picker_title')),
      h('div', { class: 'mlp-dialog-body' }, search, h('div', { style: { height: '8px' } }), list),
      h('div', { class: 'mlp-dialog-actions' }, closeBtn));
    const backdrop = h('div', { class: 'mlp-backdrop', onClick: (e) => { if (e.target === backdrop) close(); } }, dialog);
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    this._infoEl = backdrop;
    this.mount.appendChild(backdrop);
    setTimeout(() => search.focus(), 0);
  }

  // ---- stacja ----
  _secStation(s) {
    const { W, tr } = this;
    const side = s.selectedSide;
    const end = endOf(s, side);
    const store = this.store;
    const inWatts = this.session.inWatts[side];
    const wattsText = (w) => fmt(w, w >= 1 ? 2 : 4);
    const out = [];
    out.push(W.subheading(tr('tx_power_title'), 'tx_power'));
    const txWatts = dbmToWatts(end.txPowerDbm);
    out.push(W.h('div', { class: 'mlp-two' },
      W.numberField({
        key: `${side}.tx${inWatts ? 'w' : 'dbm'}`, label: tr(inWatts ? 'tx_power_w' : 'tx_power_dbm'), value: inWatts ? txWatts : end.txPowerDbm,
        onValue: (v) => (inWatts ? store.setTxPowerW(side, v) : store.setTxPowerDbm(side, v)),
        decimals: inWatts ? 4 : 1, min: inWatts ? 0.0001 : -10, max: inWatts ? 100 : 50,
        supporting: inWatts ? `= ${fmt(end.txPowerDbm, 1)} dBm` : `= ${wattsText(txWatts)} W`,
      }),
      W.h('div', { style: { flex: '0 0 120px', paddingTop: '18px' } },
        W.segmented([[false, 'dBm'], [true, 'W']], inWatts, (v) => { this.session.inWatts[side] = v; this._forceSection('station'); }))));
    out.push(W.subheading(tr('antenna_gain_title'), 'antenna_gain'));
    out.push(W.numberField({
      key: `${side}.gain`, label: tr('antenna_gain'), value: end.antennaGainDbi, onValue: (v) => store.setAntennaGain(side, v),
      decimals: 2, suffix: this._unit('dbi'), min: -10, max: 60,
    }));
    out.push(this._feederBlock(s, side, end));
    const feeder = feederLossOf(end, s.frequencyMHz);
    const eirp = end.txPowerDbm + end.antennaGainDbi - feeder;
    out.push(W.h('div', { style: { color: 'var(--primary-color, #03a9f4)' } }, tr('eirp', fmt(eirp, 1), wattsText(dbmToWatts(eirp)))));
    return W.card(tr('section_station', this.sideName(side)), null, out);
  }

  _feederBlock(s, side, end) {
    const { W, tr } = this;
    const store = this.store;
    const box = W.h('div', { class: 'mlp-card-body' });
    box.append(W.subheading(tr('feeder_title'), 'feeder'));
    if (!end.feederPrecise) {
      box.append(W.numberField({
        key: `${side}.feederdb`, label: tr('feeder_manual'), value: end.feederManualDb, onValue: (v) => store.setFeederManualDb(side, v),
        decimals: 2, suffix: this._unit('db'), min: 0, max: 100,
      }));
    }
    box.append(W.checkRow(end.feederPrecise, tr('feeder_precise'), (on) => store.setFeederPrecise(side, on), 'feeder_precise'));
    if (end.feederPrecise) box.append(this._feederBuilder(s, side, end));
    return box;
  }

  _feederBuilder(s, side, end) {
    const { W, tr } = this;
    const store = this.store;
    const cfg = end.feederConfig;
    const count = cfg.connectorIds.length;
    const customLabel = tr('feeder_custom_cable');
    const approx = ' ~';
    const presetMatch = FEEDER_PRESETS.find((p) => sameConfig(p.config, cfg));
    const box = W.h('div', { class: 'mlp-card-body' });
    box.append(W.dropdown(`${side}.fpreset`, tr('feeder_preset'), FEEDER_PRESETS.map((p) => [p.id, tr(feederPresetKey(p.id))]),
      presetMatch ? presetMatch.id : null, (id) => store.applyFeederPreset(side, id), { extraOption: presetMatch ? null : tr('feeder_preset_custom') }));
    box.append(W.h('div', { class: 'mlp-stepper' }, W.h('span', null, tr('feeder_connector_count')),
      W.h('button', { class: 'mlp-btn mlp-btn-icon', type: 'button', disabled: count <= 0, title: tr('feeder_fewer'), 'aria-label': tr('feeder_fewer'), onClick: () => store.resizeFeederConnectors(side, count - 1) }, '−'),
      W.h('span', { class: 'mlp-count' }, String(count)),
      W.h('button', { class: 'mlp-btn mlp-btn-icon', type: 'button', disabled: count >= MAX_CONNECTORS, title: tr('feeder_more'), 'aria-label': tr('feeder_more'), onClick: () => store.resizeFeederConnectors(side, count + 1) }, '+')));
    const connOptions = CONNECTORS.map((c) => [c.id, c.approximate ? c.name + approx : c.name]);
    for (let i = 0; i < count; i++) {
      const id = cfg.connectorIds[i];
      box.append(W.dropdown(`${side}.conn${i}`, tr('feeder_connector_n', i + 1), connOptions, CONNECTORS.some((c) => c.id === id) ? id : null,
        (v) => { const ids = [...cfg.connectorIds]; ids[i] = v; store.setFeederConfig(side, { ...cfg, connectorIds: ids }); },
        { extraOption: CONNECTORS.some((c) => c.id === id) ? null : id }));
      if (i < count - 1) box.append(this._sectionEditor(side, cfg, i, customLabel, approx));
    }
    box.append(this._feederBreakdown(end, s.frequencyMHz, customLabel));
    return box;
  }

  _sectionEditor(side, cfg, i, customLabel, approx) {
    const { W, tr } = this;
    const store = this.store;
    const section = cfg.sections[i] || { cableId: 'rg316', lengthM: 0.2, customDbPerM: null };
    const isCustom = section.cableId === FEEDER_CUSTOM_ID;
    const isNone = section.cableId === FEEDER_NONE_ID;
    const update = (patch) => {
      const list = cfg.sections.map((x) => ({ ...x }));
      while (list.length <= i) list.push({ cableId: 'rg316', lengthM: 0.2, customDbPerM: null });
      list[i] = { ...list[i], ...patch };
      store.setFeederConfig(side, { ...cfg, sections: list });
    };
    const options = [[FEEDER_NONE_ID, tr('feeder_no_cable')], ...CABLES.map((c) => [c.id, c.approximate ? c.name + approx : c.name]), [FEEDER_CUSTOM_ID, customLabel]];
    const known = options.some(([v]) => v === section.cableId);
    const box = W.h('div', { class: 'mlp-card-body', style: { paddingLeft: '16px' } });
    box.append(W.dropdown(`${side}.cable${i}`, tr('feeder_cable_n', i + 1), options, known ? section.cableId : null,
      (id) => update({ cableId: id, customDbPerM: id === FEEDER_CUSTOM_ID ? (section.customDbPerM ?? 0.5) : section.customDbPerM }),
      { extraOption: known ? null : section.cableId }));
    if (!isNone) {
      const fields = [W.numberField({
        key: `${side}.len${i}`, label: tr('feeder_length'), value: section.lengthM, onValue: (v) => update({ lengthM: v }),
        decimals: 2, suffix: this._unit('m'), min: 0, max: 1000,
      })];
      if (isCustom) {
        fields.push(W.numberField({
          key: `${side}.cdb${i}`, label: tr('feeder_custom_loss'), value: section.customDbPerM ?? 0.5, onValue: (v) => update({ customDbPerM: v }),
          decimals: 3, suffix: this._unit('db_per_m'), min: 0, max: 10,
        }));
      }
      box.append(W.h('div', { class: 'mlp-two' }, fields));
    }
    return box;
  }

  _feederBreakdown(end, fMHz, customLabel) {
    const { W, tr } = this;
    const result = computeFeeder(end.feederConfig, fMHz);
    const unitDb = this._unit('db');
    const box = W.h('div', { class: 'mlp-card-body' });
    box.append(W.subheading(tr('feeder_breakdown')));
    for (const line of result.lines) box.append(W.valueRow(localizeFeederLabel(line.label, customLabel), `${fmt(line.lossDb, 2)} ${unitDb}`));
    box.append(W.h('hr', { class: 'mlp-hr' }));
    box.append(W.valueRow(tr('feeder_total'), `${fmt(result.totalDb, 2)} ${unitDb}`, { bold: true }));
    if (result.approximate) box.append(W.small(tr('feeder_approximate'), 'mlp-warn-text'));
    for (const code of [...new Set(result.warnings)]) box.append(W.notice(tr(feederWarningKey(code))));
    return box;
  }

  // ---- radio ----
  _secRadio(s) {
    const { W, tr } = this;
    const store = this.store;
    const out = [];
    out.push(W.subheading(tr('frequency_title'), 'frequency'));
    out.push(W.h('div', { class: 'mlp-flow' }, PLANNER_BANDS.map((b) => W.chip(b.id === FREE_ID ? tr('band_free') : b.name, s.bandId === b.id, () => store.setBand(b.id)))));
    out.push(W.numberField({
      key: 'freq', label: tr('frequency'), value: s.frequencyMHz, onValue: (v) => store.setFrequency(v),
      decimals: 5, suffix: this._unit('mhz'), min: FREE_MIN_MHZ, max: FREE_MAX_MHZ,
    }));
    out.push(W.subheading(tr('modem_title'), 'modem'));
    out.push(W.dropdown('modem', tr('modem_preset'), MODEM_PRESETS.map((p) => [p.id, p.id]), s.modemPreset || null, (id) => store.setModemPreset(id),
      { extraOption: s.modemPreset ? null : tr('modem_custom') }));
    out.push(W.h('div', { class: 'mlp-two' },
      W.numberField({
        key: 'bw', label: tr('bandwidth'), value: s.bandwidthKhz, onValue: (v) => store.setBandwidthKhz(v), decimals: 2, suffix: this._unit('khz'), min: 1, max: 2000,
      }),
      W.dropdown('sf', tr('spreading_factor'), [5, 6, 7, 8, 9, 10, 11, 12].map((v) => [v, `SF${v}`]), s.spreadingFactor, (v) => store.setSpreadingFactor(v))));
    if (s.radioOverride) out.push(W.small(tr('modem_override_note'), 'mlp-warn-text'));
    out.push(W.subheading(tr('sensitivity_title'), 'sensitivity'));
    out.push(W.numberField({
      key: 'nf', label: tr('noise_figure'), value: s.noiseFigureDb, onValue: (v) => store.setNoiseFigure(v), decimals: 1, suffix: this._unit('db'), min: 0, max: 30,
    }));
    out.push(W.valueRow(tr('noise_floor'), `${fmt(noiseFloorDbm(s.bandwidthKhz, s.noiseFigureDb), 1)} ${this._unit('dbm')}`));
    out.push(W.valueRow(tr('sensitivity'), `${fmt(sensitivityDbm(s.bandwidthKhz, s.spreadingFactor, s.noiseFigureDb), 1)} ${this._unit('dbm')}`, { bold: true }));
    return W.card(tr('section_radio'), null, out);
  }

  _secEnv(s) {
    const { W, tr } = this;
    const store = this.store;
    const unitDb = this._unit('db');
    const out = [];
    out.push(W.checkRow(s.useWeather, tr('use_weather'), (on) => store.setUseWeather(on), 'weather'));
    if (s.useWeather) out.push(...this._weatherBlock(s));
    out.push(W.subheading(tr('k_factor_title'), 'k_factor'));
    out.push(W.valueRow(tr('k_factor'), fmt(s.kFactor, 3)));
    out.push(W.valueRow(tr('refractivity'), fmt(s.surfaceRefractivity, 1)));
    if (s.atmosphericLossDb > 0) out.push(W.valueRow(tr('atmospheric_loss'), `${fmt(s.atmosphericLossDb, 2)} ${unitDb}`));
    out.push(W.subheading(tr('clutter_title'), 'clutter'));
    out.push(W.checkRow(s.preciseTerrain, tr('precise_terrain'), (on) => store.setPreciseTerrain(on), 'clutter'));
    if (s.preciseTerrain) {
      out.push(W.small(tr('precise_warning'), 'mlp-warn-text'));
      const radii = PlannerClutter.AREA_RADIUS_OPTIONS_KM;
      out.push(W.dropdown('clutter.radius', tr('precise_radius'), radii.map((km) => [km, tr('precise_radius_value', km)]),
        radii.includes(Math.round(s.clutterRadiusKm)) ? Math.round(s.clutterRadiusKm) : null, (km) => store.setClutterRadius(km),
        { extraOption: radii.includes(Math.round(s.clutterRadiusKm)) ? null : tr('precise_radius_value', Math.round(s.clutterRadiusKm)) }));
      out.push(W.small(tr('precise_radius_hint')));
      out.push(W.numberField({
        key: 'forestH', label: tr('precise_forest_height'), value: s.forestHeightM, onValue: (v) => store.setForestHeight(v), decimals: 0, suffix: this._unit('m'), min: 0, max: 200,
      }));
      out.push(W.numberField({
        key: 'buildingH', label: tr('precise_building_height'), value: s.buildingHeightM, onValue: (v) => store.setBuildingHeight(v), decimals: 0, suffix: this._unit('m'), min: 0, max: 200,
      }));
      out.push(this._clutterStatus(s.clutter));
      if (s.clutterNote) out.push(W.small(tr('ha_precise_radius_reduced', Math.round(s.clutterNote.requestedKm), fmtTrim(s.clutterNote.usedKm, 1)), 'mlp-warn-text'));
      out.push(W.small(tr('precise_coverage_note', Math.round(s.clutterRadiusKm))));
    }
    if (!s.preciseTerrain || (s.clutter && s.clutter.kind === 'failed')) {
      out.push(W.dropdown('clutter.preset', tr('clutter'), CLUTTER_PRESETS.map((p) => [p.id, this._clutterLabel(p)]), s.clutterPreset, (id) => store.setClutterPreset(id)));
      out.push(W.numberField({
        key: 'extraLoss', label: tr('extra_loss'), value: s.extraLossDb, onValue: (v) => store.setExtraLossDb(v), decimals: 1, suffix: unitDb, min: 0, max: 100,
      }));
    }
    return W.card(tr('section_environment'), null, out);
  }

  _clutterLabel(p) {
    const base = this.tr(clutterPresetKey(p.id));
    return p.id !== 'CUSTOM' && p.extraDb > 0 ? `${base} (${fmt(p.extraDb, 0)} ${this._unit('db')})` : base;
  }

  _clutterStatus(status) {
    const { W, tr } = this;
    if (!status || status.kind === 'idle') return W.h('span');
    if (status.kind === 'loading') return W.h('div', { class: 'mlp-status' }, W.h('span', { class: 'mlp-spin' }), W.small(tr('precise_loading')));
    if (status.kind === 'ready') return W.small(tr('precise_ready', status.stats.buildings, status.stats.forests, status.stats.areas));
    const key = status.failure === 'NETWORK' ? 'precise_failed_network' : status.failure === 'TOO_LARGE' ? 'precise_failed_large'
      : status.failure === 'SERVER_LIMIT' ? 'precise_failed_server' : 'precise_failed_data';
    const msg = W.small(tr(key), 'mlp-err-text');
    const text = clutterDetailText(status);
    if (!text) return msg;
    // Szczegóły techniczne zwijane; stan otwarcia zapamiętany, bo panel jest przebudowywany przy każdej zmianie.
    return W.h('div', null, msg, W.h('details', {
      class: 'mlp-details', open: clutterDetailsOpen,
      onToggle: (e) => { clutterDetailsOpen = !!e.target.open; },
    }, W.h('summary', null, tr('ha_tech_details')), W.h('pre', { class: 'mlp-pre' }, text)));
  }

  _weatherBlock(s) {
    const { W, tr } = this;
    const st = s.weather || { kind: 'idle' };
    let status;
    if (st.kind === 'loading') {
      status = [W.h('span', { class: 'mlp-spin' }), W.small(tr('weather_loading'))];
    } else if (st.kind === 'ready') {
      const c = st.conditions;
      status = [W.small(tr('weather_ready', tr(ductingKey(c.level)), fmt(c.analysis.kFactor, 3), c.fetchedAtIso, c.source))];
    } else if (st.kind === 'failed') {
      const reason = st.error === 'BAD_RESPONSE' ? tr('weather_error_bad_response') : st.error === 'HTTP_ERROR' ? tr('weather_error_http') : tr('weather_error_offline');
      status = [W.small(tr('weather_failed', reason), 'mlp-err-text')];
    } else {
      status = [W.small(tr('weather_idle'))];
    }
    const refresh = W.h('button', { class: 'mlp-btn mlp-btn-icon', type: 'button', title: tr('weather_refresh'), 'aria-label': tr('weather_refresh'), onClick: () => this.store.refreshWeather() }, '↻');
    const out = [W.h('div', { class: 'mlp-status' }, status, refresh)];
    if (st.kind === 'ready' && st.conditions.level === 'POSSIBLE_DUCT') out.push(W.notice(tr('ducting_warning'), true));
    return out;
  }

  // ---- wynik łącza ----
  _secResult(s) {
    const { W, tr } = this;
    const out = [];
    if (s.error) out.push(W.notice(tr(errorKey(s.error)), true));
    if (s.computing) out.push(W.h('progress', { class: 'mlp-progress', 'aria-label': tr('section_result') }));
    if (!isLinkReady(s)) {
      out.push(W.notice(tr('result_need_points')));
      for (const side of SIDES) for (const hint of hintsOf(endOf(s, side))) out.push(W.notice(this._hintText(side, hint)));
    }
    if (s.link && isLinkReady(s)) out.push(...this._linkDetails(s, s.link));
    const cards = [W.card(tr('section_result'), 'link_result', out)];
    if (s.comparison) cards.push(this._measuredCard(s.comparison));
    return cards;
  }

  _linkDetails(s, link) {
    const { W, tr } = this;
    const unitDb = this._unit('db');
    const unitDbm = this._unit('dbm');
    const unitM = this._unit('m');
    const deg = '°';
    const out = [];
    out.push(W.valueRow(tr('distance'), fmtDistance(link.distanceM, unitM, this._unit('km')), { bold: true }));
    out.push(W.subheading(tr('bearing_title'), 'bearing'));
    out.push(W.valueRow(tr('bearing_ab'), fmt(link.bearingAToBDeg, 1) + deg));
    out.push(W.valueRow(tr('bearing_ba'), fmt(link.bearingBToADeg, 1) + deg));
    out.push(W.valueRow(tr('elevation_a'), fmt(link.elevationAAngleDeg, 2) + deg));
    out.push(W.valueRow(tr('elevation_b'), fmt(link.elevationBAngleDeg, 2) + deg));
    out.push(W.small(tr('bearing_note')));
    out.push(W.h('hr', { class: 'mlp-hr' }));
    out.push(W.subheading(tr('losses_title')));
    out.push(W.valueRow(tr('fspl'), `${fmt(link.freeSpaceLossDb, 1)} ${unitDb}`));
    if (link.itmLossDb >= ITM_ERROR_LOSS_DB) {
      out.push(W.notice(tr('itm_failed'), true));
    } else {
      out.push(W.valueRow(tr('itm_loss'), `${fmt(link.itmLossDb, 1)} ${unitDb}`));
      out.push(W.valueRow(tr('extra_loss_result'), `${fmt(link.totalPathLossDb - link.itmLossDb, 1)} ${unitDb}`));
      out.push(W.valueRow(tr('total_loss'), `${fmt(link.totalPathLossDb, 1)} ${unitDb}`, { bold: true }));
    }
    out.push(W.valueRow(tr('sensitivity'), `${fmt(link.sensitivityDbm, 1)} ${unitDbm}`));
    out.push(W.valueRow(tr('itm_mode'), tr(itmModeKey(link.itmMode))));
    if (link.itmWarnings) out.push(W.notice(tr('itm_warnings', link.itmWarnings)));
    out.push(W.h('hr', { class: 'mlp-hr' }));
    out.push(W.subheading(tr('margin_title'), 'margin'));
    const dir = (title, d) => {
      const color = verdictColor(d.verdict);
      return W.h('div', { class: 'mlp-dir', style: { borderColor: color } },
        W.h('div', { class: 'mlp-dir-title' }, title),
        W.h('div', { class: 'mlp-small' }, `${tr('rx_power')}: ${fmt(d.rxPowerDbm, 1)} ${unitDbm}`),
        W.h('div', { class: 'mlp-dir-margin', style: { color } }, `${tr('margin')}: ${fmtSigned(d.marginDb, 1)} ${unitDb}`),
        W.h('div', { class: 'mlp-dir-verdict', style: { color } }, tr(verdictKey(d.verdict))));
    };
    out.push(W.h('div', { class: 'mlp-dircards' }, dir(tr('direction_ab'), link.aToB), dir(tr('direction_ba'), link.bToA)));
    out.push(W.h('hr', { class: 'mlp-hr' }));
    out.push(W.subheading(tr('los_title'), 'fresnel'));
    out.push(W.valueRow(tr('los'), tr(link.lineOfSightClear ? 'yes' : 'no'), { color: link.lineOfSightClear ? '#2e9e4f' : '#ef7c00' }));
    const fresnelOk = link.worstFresnelRatio >= 0.6;
    out.push(W.valueRow(tr('fresnel'), `${fmt(link.worstFresnelClearanceM, 1)} ${unitM} (${fmt(link.worstFresnelRatio * 100, 0)} %)`, { color: fresnelOk ? '#2e9e4f' : '#ef7c00' }));
    if (!fresnelOk) out.push(W.small(tr('fresnel_note')));
    out.push(W.valueRow(tr('k_factor'), fmt(s.kFactor, 3)));
    return out;
  }

  _measuredCard(cmp) {
    const { W, tr } = this;
    const unitDb = this._unit('db');
    const unitDbm = this._unit('dbm');
    const missing = tr('measured_missing');
    const out = [];
    out.push(W.valueRow(tr('measured_node'), `${cmp.nodeName || `!${(cmp.nodeNum >>> 0).toString(16)}`} (${this.sideName(cmp.nodeSide)})`));
    if (!cmp.direct) out.push(W.notice(tr('measured_not_direct')));
    out.push(W.valueRow(tr('measured_pred_rssi'), `${fmt(cmp.predictedRssiDbm, 1)} ${unitDbm}`));
    out.push(W.valueRow(tr('measured_meas_rssi'), cmp.measuredRssiDbm !== null && cmp.measuredRssiDbm !== undefined ? `${cmp.measuredRssiDbm} ${unitDbm}` : missing));
    if (cmp.rssiDeltaDb !== null && cmp.rssiDeltaDb !== undefined) out.push(W.valueRow(tr('measured_delta_rssi'), `${fmtSigned(cmp.rssiDeltaDb, 1)} ${unitDb}`, { bold: true }));
    out.push(W.valueRow(tr('measured_pred_snr'), `${fmt(cmp.predictedSnrDb, 1)} ${unitDb}`));
    out.push(W.valueRow(tr('measured_meas_snr'), cmp.measuredSnrDb !== null && cmp.measuredSnrDb !== undefined ? `${fmt(cmp.measuredSnrDb, 2)} ${unitDb}` : missing));
    if (cmp.snrDeltaDb !== null && cmp.snrDeltaDb !== undefined) out.push(W.valueRow(tr('measured_delta_snr'), `${fmtSigned(cmp.snrDeltaDb, 1)} ${unitDb}`, { bold: true }));
    out.push(W.small(tr('measured_note')));
    return W.card(tr('section_measured'), 'measured', out);
  }

  // ---- profil ----
  _secProfile(s) {
    const { W, tr } = this;
    const series = s.series;
    if (!series || series.distancesM.length < 2 || !isLinkReady(s) || !s.link) {
      return W.card(tr('section_profile'), 'profile', W.small(tr('profile_empty')));
    }
    const chart = buildProfileChart({ series, width: this._chartWidth + 20, tr: (...a) => this.tr(...a) });
    return W.card(tr('section_profile'), 'profile', chart.root);
  }

  // ---- zasięg ----
  _secCoverage(s) {
    const { W, tr } = this;
    const store = this.store;
    const side = s.coverageSide;
    const out = [];
    out.push(W.h('div', { class: 'mlp-field-label' }, tr('coverage_side')));
    out.push(W.segmented(SIDES.map((x) => [x, this.sideName(x)]), side, (x) => store.setCoverageSide(x)));
    out.push(W.h('div', { class: 'mlp-two' },
      W.numberField({
        key: 'cov.range', label: tr('coverage_range'), value: s.coverageMaxRangeKm, onValue: (v) => store.setCoverageMaxRangeKm(v), decimals: 1, suffix: this._unit('km'), min: 1, max: 300,
      }),
      W.numberField({
        key: 'cov.radials', label: tr('coverage_radials'), value: s.coverageRadials, onValue: (v) => store.setCoverageRadials(Math.round(v)), decimals: 0, min: 8, max: 360,
      })));
    out.push(W.h('div', { class: 'mlp-two' },
      W.numberField({
        key: 'cov.rxh', label: tr('coverage_rx_height'), value: s.coverageRxHeightM, onValue: (v) => store.setCoverageRxHeightM(v), decimals: 1, suffix: this._unit('m'), min: 0, max: 100,
      }),
      W.numberField({
        key: 'cov.rxg', label: tr('coverage_rx_gain'), value: s.coverageRxGainDbi, onValue: (v) => store.setCoverageRxGainDbi(v), decimals: 1, suffix: this._unit('dbi'), min: -10, max: 30,
      })));
    // suwak krycia: aktualizowany w miejscu (przebudowa sekcji w trakcie przeciągania zrywałaby gest)
    const opLabel = W.h('div', { class: 'mlp-field-label' }, tr('coverage_opacity', `${Math.round(s.coverageOpacity * 100)}%`));
    const slider = W.h('input', { type: 'range', min: '15', max: '100', step: '1', value: String(Math.round(s.coverageOpacity * 100)), 'aria-label': tr('coverage_opacity', '') });
    slider.addEventListener('input', () => {
      const v = Number(slider.value) / 100;
      opLabel.textContent = tr('coverage_opacity', `${Math.round(v * 100)}%`);
      store.setCoverageOpacity(v);
      this.registry.setLastOpacity(v);
    });
    out.push(opLabel, slider, W.small(tr('ha_coverage_hint_opacity_live')));
    if (!isEndComplete(endOf(s, side))) out.push(W.notice(tr('coverage_need_point', this.sideName(side))));
    const compute = W.button(tr('coverage_compute'), () => { store.computeCoverage(); }, { primary: true, disabled: s.coverageComputing });
    const buttons = [compute];
    if (s.coverageComputing) buttons.push(W.button(tr('cancel'), () => store.clearCoverage()));
    else if (s.coverage) buttons.push(W.button(tr('coverage_clear'), () => store.clearCoverage()));
    out.push(W.h('div', { class: 'mlp-flow' }, buttons));
    this._progressEl = null;
    this._progressText = null;
    this._clutterProgText = null;
    if (s.coverageComputing) {
      this._progressEl = W.h('progress', { class: 'mlp-progress', max: '1', value: String(store.state.coverageProgress || 0) });
      this._progressText = W.small(tr('ha_coverage_progress', Math.round((store.state.coverageProgress || 0) * 100)));
      this._clutterProgText = W.small(this._clutterProgressLabel());
      out.push(this._progressEl, this._progressText, this._clutterProgText);
    }
    if (s.coverageError) out.push(W.notice(tr(errorKey(s.coverageError)), true));
    if (s.coverage && !s.coverageComputing) {
      out.push(buildCoveragePlan({ coverage: s.coverage, tr: (...a) => this.tr(...a) }));
      out.push(this._legend());
      out.push(W.button(tr('show_on_map'), () => this._showOnMap(), { primary: true }));
    }
    return W.card(tr('section_coverage'), 'coverage', out);
  }

  _legend() {
    const { W, tr } = this;
    return W.h('div', { class: 'mlp-card-body' },
      W.small(tr('ha_legend_title')),
      W.h('div', { class: 'mlp-grad', style: { background: coverageLegendGradientCss('to right') } }),
      W.h('div', { class: 'mlp-grad-labels' }, W.h('span', null, '0'), W.h('span', null, '10'), W.h('span', null, '20'), W.h('span', null, '≥ 30')));
  }

  /** Dodaje warstwę zasięgu (albo tylko wyśrodkowuje mapę na łączu) i zamyka panel, jak w aplikacji. */
  _showOnMap() {
    const { tr } = this;
    const s = this.store.state;
    const cov = s.coverage;
    if (cov) {
      const img = coverageToImage(cov);
      if (!img) { this._toast(tr('export_nothing'), true); return; }
      const sideLabel = s.coverageCenterName || this.sideName(s.coverageSide);
      const range = (cov.ringsM.length ? cov.ringsM[cov.ringsM.length - 1] : 0) / 1000;
      const res = this.registry.add({
        name: `${tr('ha_layer_coverage')} – ${sideLabel}`,
        subtitle: `${fmtTrim(range, 1)} km · ${fmtTrim(s.frequencyMHz, 5)} MHz · ${s.modemPreset || `SF${s.spreadingFactor}`}`,
        imageUrl: img.imageUrl, bounds: img.bounds, center: { lat: cov.center.lat, lon: cov.center.lon }, opacity: s.coverageOpacity,
      });
      if (!res.ok) { this._toast(tr('ha_layer_limit', MAX_COVERAGE_LAYERS), true); return; }
      try { this.map.fitBounds([[img.bounds.south, img.bounds.west], [img.bounds.north, img.bounds.east]], { padding: [20, 20] }); } catch { /* mapa bez rozmiaru */ }
    } else if (isEndComplete(s.a) && isEndComplete(s.b)) {
      try { this.map.fitBounds([[s.a.lat, s.a.lon], [s.b.lat, s.b.lon]], { padding: [60, 60] }); } catch { /* ignoruj */ }
    } else {
      const p = isEndComplete(s.a) ? s.a : isEndComplete(s.b) ? s.b : null;
      if (p) this.layer.moveTo(p.lat, p.lon);
    }
    this.close();
  }

  // ---- eksport ----
  _secExport(s) {
    const { W, tr } = this;
    const hasLink = isLinkReady(s) && !!s.link;
    const hasAnything = hasLink || !!s.coverage;
    const hasProfile = hasLink && !!s.series;
    const out = [];
    if (hasAnything) out.push(W.button(tr('show_on_map'), () => this._showOnMap(), { primary: true }));
    const mk = (labelKey, kind, enabled) => W.button(tr(labelKey), () => this._export(kind), { disabled: !enabled });
    out.push(W.h('div', { class: 'mlp-flow' },
      mk('export_pdf', 'pdf', hasAnything), mk('export_csv_summary', 'csvSummary', hasAnything), mk('export_csv_profile', 'csvProfile', hasProfile),
      mk('export_kml', 'kml', hasAnything), mk('export_geojson', 'geojson', hasAnything), mk('export_png', 'png', hasProfile)));
    const m = this._exportMsg;
    if (m === 'SAVED') out.push(W.small(tr('export_saved')));
    else if (m === 'FAILED') out.push(W.small(tr('export_failed'), 'mlp-err-text'));
    else if (m === 'NOTHING') out.push(W.small(tr('export_nothing'), 'mlp-err-text'));
    else if (!hasAnything) out.push(W.small(tr('export_unavailable')));
    return W.card(tr('section_export'), 'export', out);
  }

  _setExportMsg(m) {
    this._exportMsg = m;
    this._forceSection('export');
  }

  async _export(kind) {
    this._setExportMsg(null);
    await new Promise((r) => setTimeout(r, 20)); // pozwól przeglądarce odmalować przed ciężką pracą
    try {
      const now = Date.now();
      const st = this.store.state;
      const report = buildReport(st, makeReportStrings((...a) => this.tr(...a), now));
      const base = `mt_sw_planner_${fileStamp(now)}`;
      const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
      let blob;
      let name;
      switch (kind) {
        case 'pdf': blob = new Blob([renderPdf(report)], { type: 'application/pdf' }); name = `${base}.pdf`; break;
        case 'csvSummary': blob = new Blob([bom, csvSummary(report)], { type: 'text/csv' }); name = `${base}_summary.csv`; break;
        case 'csvProfile': blob = new Blob([bom, csvProfile(report)], { type: 'text/csv' }); name = `${base}_profile.csv`; break;
        case 'kml': blob = new Blob([renderKml(report)], { type: 'application/vnd.google-earth.kml+xml' }); name = `${base}.kml`; break;
        case 'geojson': blob = new Blob([renderGeoJson(report)], { type: 'application/geo+json' }); name = `${base}.geojson`; break;
        case 'png':
          if (!report.profile) { this._setExportMsg('NOTHING'); return; }
          blob = await profileToPngBlob(report.profile);
          name = `${base}_profile.png`;
          break;
        default: this._setExportMsg('NOTHING'); return;
      }
      downloadBlob(blob, name);
      this._setExportMsg('SAVED');
    } catch (e) {
      console.error('MT_SW planner: eksport nie powiódł się', e);
      this._setExportMsg('FAILED');
    }
  }

  // ---- stopka ----
  _secCredits() {
    const { W, tr } = this;
    return W.h('div', { class: 'mlp-card-body' },
      W.small(tr('disclaimer')),
      W.h('div', { class: 'mlp-flow' }, W.h('button', { class: 'mlp-btn mlp-btn-text', type: 'button', onClick: () => this._openInfo('credits') }, tr('credits_button'))));
  }
}

// eksport pomocniczy do testów jednostkowych poza przeglądarką
export const __test = { sameConfig, parseNumber, formatWatts, otherSide };
