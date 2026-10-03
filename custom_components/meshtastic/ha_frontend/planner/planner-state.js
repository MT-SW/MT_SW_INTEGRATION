// Stan i zachowanie plannera w panelu HA (odpowiednik PlannerUiState + PlannerViewModel z aplikacji na Androida).
// Bez DOM: wyłącznie dane, debounce przeliczeń i anulowanie nieaktualnych obliczeń przez AbortSignal.
// Silnik (index.js) jest wstrzykiwany, więc testy w Node mogą podstawić atrapę.
import * as defaultEngine from './index.js';

export const DEBOUNCE_MS = 400;
export const SIDES = Object.freeze(['A', 'B']);
export const otherSide = (s) => (s === 'A' ? 'B' : 'A');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isAbort = (e) => !!e && (e.name === 'AbortError' || e.code === 20);

export const endOf = (st, side) => (side === 'A' ? st.a : st.b);
export const isEndComplete = (e) => typeof e.lat === 'number' && typeof e.lon === 'number';
export const isLinkReady = (st) => isEndComplete(st.a) && isEndComplete(st.b);

/** Podpowiedzi per strona (kody: POINT_MISSING, STATION_NO_POSITION). */
export function hintsOf(end) {
  const out = [];
  if (!isEndComplete(end)) out.push('POINT_MISSING');
  if (end.stationUnavailable) out.push('STATION_NO_POSITION');
  return out;
}

/** Nazwa węzła z HA do wyświetlenia. */
export function nodeDisplayName(n) {
  return (n.longName && n.longName.trim()) || (n.shortName && n.shortName.trim()) || `!${(n.num >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Węzły HA (pola jak w meshtastic/nodes: node_id, node_hex, long_name, short_name, latitude, longitude, altitude,
 * is_gateway, hops_away, via_*) -> opcje plannera. Tylko węzły z pozycją. `viaInfo`/`signalInfo` z hops.js.
 */
export function nodeOptionsFromHaNodes(nodes, hops) {
  const out = [];
  for (const n of nodes || []) {
    if (!Number.isFinite(n.latitude) || !Number.isFinite(n.longitude)) continue;
    if (Math.abs(n.latitude) > 90 || Math.abs(n.longitude) > 180) continue;
    if (n.latitude === 0 && n.longitude === 0) continue;
    if (typeof n.node_id !== 'number') continue;
    const via = hops ? hops.viaInfo(n) : { hops: typeof n.hops_away === 'number' ? n.hops_away : null };
    const sig = hops ? hops.signalInfo(n) : null;
    const opt = {
      num: n.node_id,
      longName: n.long_name || '',
      shortName: n.short_name || '',
      lat: n.latitude,
      lon: n.longitude,
      altitudeM: typeof n.altitude === 'number' ? n.altitude : null,
      snrDb: sig && sig.snr !== null && sig.snr !== undefined ? sig.snr : null,
      rssiDbm: sig && sig.rssi !== null && sig.rssi !== undefined ? sig.rssi : null,
      hopsAway: via.hops === null || via.hops === undefined ? 99 : via.hops,
      isOurs: !!n.is_gateway,
    };
    opt.displayName = nodeDisplayName(opt);
    out.push(opt);
  }
  return out;
}

export class PlannerStore {
  /**
   * @param {{engine?: object, debounceMs?: number}} [o]
   */
  constructor({ engine = defaultEngine, debounceMs = DEBOUNCE_MS } = {}) {
    this.engine = engine;
    this.debounceMs = debounceMs;
    this._listeners = new Set();
    this._progressListeners = new Set();
    this._nodes = [];
    this._nodesSig = '';
    this._timer = null;
    this._abort = null;
    this._covAbort = null;
    this._destroyed = false;
    this.state = this._initialState();
  }

  _initialState() {
    const base = this.engine.createDefaultInput();
    return {
      ...base,
      a: { ...base.a, stationUnavailable: false },
      b: { ...base.b, stationUnavailable: false },
      selectedSide: 'A',
      weather: { kind: 'idle' },
      kFactor: this.engine.DEFAULT_K ?? 4 / 3,
      surfaceRefractivity: this.engine.DEFAULT_N0 ?? 301,
      atmosphericLossDb: 0,
      clutter: { kind: 'idle' },
      clutterNote: null, // { requestedKm, usedKm, failure } - obszar przeszkód był za duży, użyto mniejszego promienia
      computing: false,
      link: null,
      series: null,
      comparison: null,
      error: null,
      coverage: null,
      coverageComputing: false,
      coverageProgress: 0,
      coverageError: null,
      coverageCenterName: '',
    };
  }

  // ---- subskrypcje ----
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  onProgress(fn) { this._progressListeners.add(fn); return () => this._progressListeners.delete(fn); }

  _emit() {
    if (this._destroyed) return;
    for (const fn of [...this._listeners]) {
      try { fn(this.state); } catch (e) { console.error('MT_SW planner: błąd subskrybenta', e); }
    }
  }

  /** Scala patch ze stanem; recompute=false dla zmian, które nie wpływają na łącze. */
  _set(patch, { recompute = false } = {}) {
    this.state = { ...this.state, ...patch };
    if (recompute) this._schedule();
    this._emit();
  }

  _setEnd(side, fn, opts) {
    const cur = endOf(this.state, side);
    const next = fn(cur);
    this._set(side === 'A' ? { a: next } : { b: next }, opts ?? { recompute: true });
  }

  // ---- węzły ----
  /** Lista opcji węzłów (patrz nodeOptionsFromHaNodes). Nie emituje, jeśli nic się nie zmieniło. */
  setNodes(options) {
    const sig = JSON.stringify(options.map((n) => [n.num, n.displayName, n.lat, n.lon, n.snrDb, n.rssiDbm, n.hopsAway, n.isOurs]));
    if (sig === this._nodesSig) return;
    this._nodesSig = sig;
    this._nodes = options;
    const st = this.state;
    if (st.link) {
      let cmp = null;
      try { cmp = this.engine.compareMeasured(st, st.link, options); } catch { cmp = null; }
      this._set({ comparison: cmp });
    } else {
      this._emit();
    }
  }
  get nodes() { return this._nodes; }

  // ---- punkty ----
  selectSide(side) { if (side === 'A' || side === 'B') this._set({ selectedSide: side }); }

  _placed(e, source, lat, lon, name) {
    return { ...e, pointSource: source, lat, lon, name, groundAltM: null, groundAltManual: false, stationUnavailable: false };
  }

  setPointFromNode(side, num) {
    const node = this._nodes.find((n) => n.num === num);
    if (!node) return;
    this._setEnd(side, (e) => this._placed(e, { type: 'node', num }, node.lat, node.lon, node.displayName));
  }

  _setPoint(side, type, lat, lon) {
    if ([lat, lon].some((v) => typeof v !== 'number' || Number.isNaN(v)) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    this._setEnd(side, (e) => {
      const keepName = ['map', 'manual', 'none'].includes((e.pointSource || { type: 'none' }).type);
      return this._placed(e, { type }, lat, lon, keepName ? e.name : '');
    });
  }
  setPointFromMap(side, lat, lon) { this._setPoint(side, 'map', lat, lon); }
  setPointManual(side, lat, lon) { this._setPoint(side, 'manual', lat, lon); }

  useStation(side) {
    const ours = this._nodes.find((n) => n.isOurs);
    if (!ours) {
      this._setEnd(side, (e) => ({ ...e, stationUnavailable: true }), { recompute: false });
      return;
    }
    this._setEnd(side, (e) => this._placed(e, { type: 'station' }, ours.lat, ours.lon, ours.displayName));
  }

  clearPoint(side) {
    this._setEnd(side, (e) => ({
      ...e, pointSource: { type: 'none' }, lat: null, lon: null, name: '', groundAltM: null, groundAltManual: false, stationUnavailable: false,
    }));
  }

  setName(side, name) { this._setEnd(side, (e) => ({ ...e, name }), { recompute: false }); }

  /** Ręczna wysokość terenu (m n.p.m.); null/NaN wraca do wartości z modelu. */
  setGroundAlt(side, meters) {
    this._setEnd(side, (e) => (meters === null || meters === undefined || Number.isNaN(meters)
      ? { ...e, groundAltManual: false, groundAltM: null }
      : { ...e, groundAltManual: true, groundAltM: meters }));
  }

  // ---- parametry końców ----
  _edit(side, value, fn) {
    if (typeof value !== 'number' || Number.isNaN(value)) return;
    this._setEnd(side, (e) => fn(e, value));
  }
  setAntennaHeight(side, m) { this._edit(side, m, (e, v) => ({ ...e, antennaHeightM: clamp(v, 0, 2000) })); }
  setTxPowerDbm(side, dbm) { this._edit(side, dbm, (e, v) => ({ ...e, txPowerDbm: clamp(v, -10, 50) })); }
  setTxPowerW(side, w) { this._edit(side, w, (e, v) => ({ ...e, txPowerDbm: clamp(this.engine.wattsToDbm(v), -10, 50) })); }
  setAntennaGain(side, dbi) { this._edit(side, dbi, (e, v) => ({ ...e, antennaGainDbi: clamp(v, -10, 60) })); }
  setFeederManualDb(side, db) { this._edit(side, db, (e, v) => ({ ...e, feederManualDb: clamp(v, 0, 100) })); }
  setFeederPrecise(side, precise) { this._setEnd(side, (e) => ({ ...e, feederPrecise: !!precise })); }
  setFeederConfig(side, config) { this._setEnd(side, (e) => ({ ...e, feederConfig: config, feederPrecise: true })); }
  applyFeederPreset(side, presetId) {
    const preset = this.engine.FEEDER_PRESETS.find((p) => p.id === presetId);
    if (preset) this.setFeederConfig(side, preset.config);
  }
  resizeFeederConnectors(side, count) {
    this._setEnd(side, (e) => ({ ...e, feederConfig: this.engine.resizeFeeder(e.feederConfig, count), feederPrecise: true }));
  }

  /** Kopiuje moc, zysk, wysokość i cały tor antenowy z A do B (bez położenia). */
  copyAToB() {
    const a = this.state.a;
    this._set({
      b: {
        ...this.state.b,
        txPowerDbm: a.txPowerDbm, antennaGainDbi: a.antennaGainDbi, antennaHeightM: a.antennaHeightM,
        feederManualDb: a.feederManualDb, feederPrecise: a.feederPrecise, feederConfig: a.feederConfig,
      },
    }, { recompute: true });
  }

  swapAB() {
    const st = this.state;
    this._set({ a: st.b, b: st.a, coverageSide: otherSide(st.coverageSide), coverage: null }, { recompute: true });
  }

  // ---- radio ----
  setFrequency(mHz) { if (!Number.isNaN(mHz)) this._set(this.engine.applyFrequency(this.state, mHz), { recompute: true }); }
  setBand(bandId) { this._set(this.engine.applyBand(this.state, bandId), { recompute: true }); }
  setModemPreset(presetId) { this._set(this.engine.applyModemPreset(this.state, presetId), { recompute: true }); }
  setBandwidthKhz(khz) { this._set(this.engine.applyBandwidth(this.state, khz), { recompute: true }); }
  setSpreadingFactor(sf) { if (!Number.isNaN(sf)) this._set(this.engine.applySpreadingFactor(this.state, sf), { recompute: true }); }
  setNoiseFigure(db) { if (!Number.isNaN(db)) this._set({ noiseFigureDb: clamp(db, 0, 30) }, { recompute: true }); }

  // ---- środowisko ----
  setUseWeather(on) {
    this._set({
      useWeather: !!on,
      weather: on ? this.state.weather : { kind: 'idle' },
      kFactor: on ? this.state.kFactor : (this.engine.DEFAULT_K ?? 4 / 3),
      surfaceRefractivity: on ? this.state.surfaceRefractivity : (this.engine.DEFAULT_N0 ?? 301),
    }, { recompute: true });
  }

  refreshWeather() {
    try { this.engine.getSharedComputer().invalidateWeather(); } catch { /* atrapa bez cache */ }
    this._schedule(true);
    this._emit();
  }

  setExtraLossDb(db) { if (!Number.isNaN(db)) this._set(this.engine.applyExtraLoss(this.state, db), { recompute: true }); }
  setClutterPreset(id) { this._set(this.engine.applyClutterPreset(this.state, id), { recompute: true }); }
  setPreciseTerrain(on) { this._set({ preciseTerrain: !!on, clutter: { kind: 'idle' }, clutterNote: null }, { recompute: true }); }
  setClutterRadius(km) {
    if (Number.isNaN(km)) return;
    const [lo, hi] = this.engine.PLANNER_LIMITS.clutterRadiusKm;
    this._set({ clutterRadiusKm: clamp(km, lo, hi), clutter: { kind: 'idle' }, clutterNote: null }, { recompute: true });
  }
  setForestHeight(m) { if (!Number.isNaN(m)) this._set({ forestHeightM: clamp(m, 0, 200) }, { recompute: true }); }
  setBuildingHeight(m) { if (!Number.isNaN(m)) this._set({ buildingHeightM: clamp(m, 0, 200) }, { recompute: true }); }

  // ---- zasięg (ustawienia nie przeliczają łącza) ----
  setCoverageSide(side) { if (side === 'A' || side === 'B') this._set({ coverageSide: side }); }
  setCoverageMaxRangeKm(km) { if (!Number.isNaN(km)) this._set({ coverageMaxRangeKm: clamp(km, 1, 300) }); }
  setCoverageOpacity(v) { if (!Number.isNaN(v)) this._set({ coverageOpacity: clamp(v, 0.15, 1) }); }
  setCoverageRadials(n) { if (!Number.isNaN(n)) this._set({ coverageRadials: clamp(Math.round(n), 8, 360) }); }
  setCoverageRxHeightM(m) { if (!Number.isNaN(m)) this._set({ coverageRxHeightM: clamp(m, 0, 100) }); }
  setCoverageRxGainDbi(d) { if (!Number.isNaN(d)) this._set({ coverageRxGainDbi: clamp(d, -10, 30) }); }

  // ---- obliczenia ----
  /** Natychmiastowe przeliczenie (zwykle niepotrzebne: każdy setter planuje je z opóźnieniem). */
  recompute() { this._schedule(true); }

  _schedule(immediate = false) {
    if (this._destroyed) return;
    if (this._timer) clearTimeout(this._timer);
    // wynik poprzedniego przebiegu jest już nieaktualny — nie ma po co go dokańczać
    if (this._abort) { this._abort.abort(); this._abort = null; }
    const run = () => { this._timer = null; this._runCompute(); };
    if (immediate || this.debounceMs <= 0) {
      this._timer = null;
      Promise.resolve().then(run);
    } else {
      this._timer = setTimeout(run, this.debounceMs);
    }
  }

  /** Czeka na zakończenie bieżącego (zaplanowanego) przeliczenia — dla testów. */
  async settle() {
    for (let i = 0; i < 200; i++) {
      if (!this._timer && !this._running) return;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  _applyGround(current, computedFor, auto) {
    if (current.groundAltManual || auto === null || auto === undefined) return current;
    if (current.lat !== computedFor.lat || current.lon !== computedFor.lon) return current;
    return { ...current, groundAltM: auto };
  }

  async _runCompute() {
    if (this._destroyed) return;
    const snap = this.state;
    const ctl = new AbortController();
    this._abort = ctl;
    this._running = true;
    if (isLinkReady(snap)) {
      this._set({
        computing: true,
        weather: snap.useWeather ? { kind: 'loading' } : { kind: 'idle' },
        clutter: snap.preciseTerrain ? { kind: 'loading' } : { kind: 'idle' },
      });
    } else {
      this._set({ computing: false });
    }
    let res = null;
    try {
      res = await this.engine.planLink(snap, { nodes: this._nodes, signal: ctl.signal });
    } catch (e) {
      if (isAbort(e)) { if (this._abort === ctl) this._running = false; return; }
      res = { error: 'COMPUTE_FAILED', link: null, series: null, comparison: null, weather: { kind: 'idle' }, clutter: { kind: 'idle' },
        kFactor: this.engine.DEFAULT_K ?? 4 / 3, surfaceRefractivity: this.engine.DEFAULT_N0 ?? 301, atmosphericLossDb: 0 };
    }
    if (this._abort !== ctl || this._destroyed) return; // nieaktualny wynik
    this._abort = null;
    this._running = false;
    const cur = this.state;
    this._set({
      a: this._applyGround(cur.a, snap.a, res.groundAltA),
      b: this._applyGround(cur.b, snap.b, res.groundAltB),
      link: res.link ?? null,
      series: res.series ?? null,
      comparison: res.comparison ?? null,
      error: res.error ?? null,
      weather: cur.useWeather ? (res.weather || { kind: 'idle' }) : { kind: 'idle' },
      clutter: cur.preciseTerrain ? (res.clutter || { kind: 'idle' }) : { kind: 'idle' },
      kFactor: res.kFactor,
      surfaceRefractivity: res.surfaceRefractivity,
      atmosphericLossDb: res.atmosphericLossDb ?? 0,
      computing: false,
    });
  }

  /** Uruchamia obliczanie zasięgu dla coverageSide (postęp przez onProgress). Zwraca wynik albo null. */
  async computeCoverage() {
    const snap = this.state;
    const end = endOf(snap, snap.coverageSide);
    if (!isEndComplete(end)) {
      this._set({ coverageError: 'COVERAGE_NEEDS_POINT' });
      return null;
    }
    if (this._covAbort) this._covAbort.abort();
    const ctl = new AbortController();
    this._covAbort = ctl;
    this._set({ coverageComputing: true, coverageProgress: 0, coverageError: null, clutterNote: null });
    const input = { ...snap, clutterStatus: snap.clutter };
    let lastTick = 0;
    try {
      const result = await this.engine.planCoverage(input, {
        signal: ctl.signal,
        onProgress: (p) => {
          if (this._covAbort !== ctl) return;
          this.state = { ...this.state, coverageProgress: p };
          const now = Date.now();
          if (now - lastTick < 60 && p < 1) return; // nie zalewaj UI
          lastTick = now;
          for (const fn of [...this._progressListeners]) fn(p);
        },
        onClutterFailure: (f, detail) => { if (this._covAbort === ctl) this._set({ clutter: { kind: 'failed', failure: f, detail: detail || {} } }); },
        onClutterRadius: (info) => { if (this._covAbort === ctl) this._set({ clutterNote: info }); },
      });
      if (this._covAbort !== ctl) return null;
      this._covAbort = null;
      this._set({ coverage: result, coverageComputing: false, coverageProgress: 1, coverageCenterName: end.name || '' });
      return result;
    } catch (e) {
      if (this._covAbort !== ctl) return null; // anulowane / zastąpione
      this._covAbort = null;
      let code = 'COMPUTE_FAILED';
      if (!isAbort(e)) {
        if (e && e.code === 'COVERAGE_NEEDS_POINT') code = 'COVERAGE_NEEDS_POINT';
        else if (e && e.failure === 'NETWORK') code = 'ELEVATION_OFFLINE';
        else if (e && e.failure === 'DECODE') code = 'ELEVATION_DECODE';
        this._set({ coverageComputing: false, coverageError: code });
      } else {
        this._set({ coverageComputing: false });
      }
      return null;
    }
  }

  /** Anuluje trwające obliczanie zasięgu i usuwa wynik. */
  clearCoverage() {
    if (this._covAbort) { this._covAbort.abort(); this._covAbort = null; }
    this._set({ coverage: null, coverageComputing: false, coverageProgress: 0, coverageError: null });
  }

  reset() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._abort) { this._abort.abort(); this._abort = null; }
    if (this._covAbort) { this._covAbort.abort(); this._covAbort = null; }
    this._running = false;
    this.state = this._initialState();
    this._emit();
  }

  destroy() {
    this._destroyed = true;
    if (this._timer) clearTimeout(this._timer);
    if (this._abort) this._abort.abort();
    if (this._covAbort) this._covAbort.abort();
    this._listeners.clear();
    this._progressListeners.clear();
  }
}
