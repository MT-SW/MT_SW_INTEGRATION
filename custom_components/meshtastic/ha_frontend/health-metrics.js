/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zdrowie sieci jak w aplikacji: siedem zakładek metryk (Zasilanie, Sygnał, Eter, Środowisko, Zasoby,
 * Ruch, Sąsiedzi), lista węzłów z oceną i małym wykresem, a po kliknięciu węzła duże wykresy
 * z wyborem zakresu czasu oraz minimum, maksimum i ostatnią wartością.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import "./chart.js";
import { t } from "./i18n.js";
import { buildTelemetryCharts } from "./telemetry-charts.js";
import { buildResourceRows, buildResourceCharts } from "./stats-history.js";

const H = 3600e3;
const D = 24 * H;

/* kinds: klucz historii dla wykresów -> rodzaj serii w magazynie */
export const METRICS = [
  { id: "power", pl: "Zasilanie", en: "Power", charts: ["battery", "voltage", "current"], kinds: { device: "device_metrics", environment: "environment_metrics", power: "power_metrics" } },
  { id: "signal", pl: "Sygnał", en: "Signal", charts: ["snr", "rssi", "noise"], kinds: { signal: "signal", stats: "local_stats" } },
  { id: "ether", pl: "Eter", en: "Airtime", charts: ["airtime"], kinds: { device: "device_metrics" } },
  { id: "environment", pl: "Środowisko", en: "Environment", charts: ["temperature", "humidity", "pressure"], kinds: { environment: "environment_metrics" } },
  { id: "resources", pl: "Zasoby", en: "Resources", kinds: { stats: "local_stats", extended: "local_stats_extended" } },
  { id: "traffic", pl: "Ruch", en: "Traffic", kinds: { stats: "local_stats" } },
  { id: "neighbors", pl: "Sąsiedzi", en: "Neighbors", kinds: { neighbors: "neighbor_count" } },
];

const RANGES = [
  ["1 h", H],
  ["24 h", D],
  ["2 dni", 2 * D],
  ["7 dni", 7 * D],
  ["2 tyg.", 14 * D],
  ["30 dni", 30 * D],
  ["Wszystko", null],
];

const ACTIVITY = [
  ["any", 0],
  ["1 h", H],
  ["6 h", 6 * H],
  ["24 h", D],
  ["2 dni", 2 * D],
  ["7 dni", 7 * D],
  ["30 dni", 30 * D],
];

const TRAFFIC_SERIES = [
  { key: "numPacketsRx", labelKey: "nodes.packets.rx", color: "#4FC3F7" },
  { key: "numPacketsTx", labelKey: "nodes.packets.tx", color: "#F5C839" },
  { key: "numRxDupe", labelKey: "nodes.packets.rx_dupe", color: "#9575CD" },
  { key: "numTxRelay", labelKey: "nodes.packets.tx_relay", color: "#81C784" },
  { key: "numPacketsRxBad", labelKey: "nodes.packets.rx_bad", color: "#FF8A65" },
];

const TEXT = {
  pl: { search: "Szukaj węzła", sort_value: "Wg wartości", sort_heard: "Wg ostatnio słyszanych", back: "Wróć", empty: "Brak węzłów.", nodata: "Brak danych", min: "min", max: "maks", last: "ostatnio", chart_empty: "Za mało danych na wykres w tym zakresie.", powered: "zasilanie", note_traffic: "Przyrost pakietów na minutę.", sort: "Sortowanie", f_activity: "Aktywność", f_any: "Wszystkie", f_fav: "Ulubione", f_fav_only: "Tylko ulubione", f_fav_no: "Bez ulubionych", f_hops: "Odległość", f_hops_all: "Dowolna", f_hops_0: "Bezpośrednio", f_hops_1: "1 skok", f_hops_2: "2 skoki", f_hops_3: "3+ skoków", f_group: "Grupa", f_group_all: "Wszystkie węzły", f_pos: "Tylko z pozycją", f_nomqtt: "Bez MQTT", f_ign: "Ukryj ignorowane", f_reset: "Wyczyść filtry", shown: "Pokazano", of: "z" },
  en: { search: "Search node", sort_value: "By value", sort_heard: "By last heard", back: "Back", empty: "No nodes.", nodata: "No data", min: "min", max: "max", last: "latest", chart_empty: "Not enough data for a chart in this range.", powered: "powered", note_traffic: "Packets per minute.", sort: "Sorting", f_activity: "Activity", f_any: "All", f_fav: "Favorites", f_fav_only: "Favorites only", f_fav_no: "Without favorites", f_hops: "Distance", f_hops_all: "Any", f_hops_0: "Direct", f_hops_1: "1 hop", f_hops_2: "2 hops", f_hops_3: "3+ hops", f_group: "Group", f_group_all: "All nodes", f_pos: "With position only", f_nomqtt: "Hide MQTT", f_ign: "Hide ignored", f_reset: "Clear filters", shown: "Shown", of: "of" },
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function levelOf(metric, v) {
  if (!isNum(v)) return "";
  switch (metric) {
    case "power": return v > 100 || v >= 50 ? "good" : v >= 20 ? "ok" : "bad";
    case "signal": return v >= 0 ? "good" : v >= -10 ? "ok" : "bad";
    case "ether": return v < 25 ? "good" : v < 50 ? "ok" : "bad";
    case "resources": return v < 60 ? "good" : v < 85 ? "ok" : "bad";
    case "neighbors": return v >= 3 ? "good" : v >= 1 ? "ok" : "bad";
    default: return "";
  }
}

class MtswHealthMetrics extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      entryId: { type: String },
      nodes: { type: Array },
      metric: { type: String },
      _metric: { type: String },
      _search: { type: String },
      _sort: { type: String },
      _series: { type: Object },
      _detail: { type: Object },
      _hist: { type: Object },
      _range: { type: Number },
      _act: { type: Number },
      _fav: { type: String },
      _hops: { type: String },
      _group: { type: String },
      _groups: { type: Object },
      _pos: { type: Boolean },
      _nomqtt: { type: Boolean },
      _ign: { type: Boolean },
      _loading: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.nodes = [];
    this._metric = "power";
    this._search = "";
    this._sort = "value";
    this._series = {};
    this._detail = null;
    this._hist = null;
    this._range = 3;
    this._act = 0;
    this._fav = "all";
    this._hops = "all";
    this._group = "";
    this._groups = {};
    this._pos = false;
    this._nomqtt = false;
    this._ign = true;
    this._loading = false;
    this._timer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadSeries();
    this._loadGroups();
    this._timer = setInterval(() => this._loadSeries(), 60000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
  }

  updated(changed) {
    if (changed.has("metric") && this.metric && this.metric !== this._metric) this._pick(this.metric);
  }

  _tr(key) {
    const lang = (this.hass && this.hass.language) || "pl";
    return (TEXT[lang.startsWith("pl") ? "pl" : "en"] || TEXT.pl)[key] || key;
  }

  _label(m) {
    return ((this.hass && this.hass.language) || "pl").startsWith("pl") ? m.pl : m.en;
  }

  async _loadGroups() {
    try {
      const r = await this.hass.callWS({ type: "meshtastic/ui_settings" });
      this._groups = (r && r.settings && r.settings.node_groups) || {};
    } catch (err) {
      console.warn("MT_SW: grupy węzłów", err);
    }
  }

  _resetFilters() {
    this._search = "";
    this._act = 0;
    this._fav = "all";
    this._hops = "all";
    this._group = "";
    this._pos = false;
    this._nomqtt = false;
    this._ign = true;
  }

  _passes(n) {
    if (this._act) {
      const ms = ACTIVITY[this._act][1];
      if (!n.last_heard || Date.now() - n.last_heard * 1000 > ms) return false;
    }
    if (this._fav === "fav" && !n.is_favorite) return false;
    if (this._fav === "nofav" && n.is_favorite) return false;
    if (this._hops !== "all") {
      const h = n.hops_away;
      if (typeof h !== "number") return false;
      if (this._hops === "3" ? h < 3 : h !== Number(this._hops)) return false;
    }
    if (this._group && this._groups[this._group] && !this._groups[this._group].includes(n.node_id)) return false;
    if (this._pos && typeof n.latitude !== "number") return false;
    if (this._nomqtt && n.via_mqtt) return false;
    if (this._ign && n.is_ignored) return false;
    return true;
  }

  async _loadSeries() {
    if (!this.hass || !this.entryId) return;
    const metric = this._metric;
    try {
      const r = await this.hass.callWS({ type: "meshtastic/health_series", entry_id: this.entryId, metric, days: 7 });
      if (metric === this._metric) this._series = (r && r.nodes) || {};
    } catch (err) {
      console.warn("MT_SW: zdrowie sieci", err);
      this._series = {};
    }
  }

  _pick(id) {
    this._metric = id;
    this._series = {};
    this._detail = null;
    this._hist = null;
    this._loadSeries();
  }

  _name(n) {
    return n.long_name || n.short_name || n.node_hex || String(n.node_id);
  }

  _value(node) {
    const s = this._series[String(node.node_id)];
    return s && isNum(s.last) ? s.last : null;
  }

  _fmt(v) {
    if (!isNum(v)) return "–";
    switch (this._metric) {
      case "power": return v > 100 ? this._tr("powered") : `${Math.round(v)} %`;
      case "signal": return `${v.toFixed(1)} dB`;
      case "ether": return `${v.toFixed(1)} %`;
      case "environment": return `${v.toFixed(1)} °C`;
      case "resources": return `${v.toFixed(0)} %`;
      case "traffic": return `RX ${Math.round(v)}`;
      default: return String(Math.round(v));
    }
  }

  _rows() {
    const q = this._search.trim().toLowerCase();
    const rows = (this.nodes || [])
      .filter((n) => this._passes(n))
      .filter((n) => !q || this._name(n).toLowerCase().includes(q) || (n.node_hex || "").toLowerCase().includes(q))
      .map((n) => ({ node: n, value: this._value(n) }));
    if (this._sort === "heard") {
      rows.sort((a, b) => (b.node.last_heard || 0) - (a.node.last_heard || 0));
    } else {
      rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || this._name(a.node).localeCompare(this._name(b.node)));
    }
    return rows;
  }

  _spark(values) {
    const pts = (values || []).map((v, i) => [i, v]).filter(([, v]) => isNum(v));
    if (pts.length < 2) return html`<span class="nospark"></span>`;
    const ys = pts.map(([, v]) => v);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const span = hi - lo || 1;
    const n = values.length - 1 || 1;
    const line = pts.map(([i, v]) => `${((i / n) * 100).toFixed(1)},${(22 - ((v - lo) / span) * 20).toFixed(1)}`).join(" ");
    return html`<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline points=${line} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"></polyline></svg>`;
  }

  async _open(node) {
    this._detail = node;
    this._hist = null;
    this._loading = true;
    const metric = METRICS.find((m) => m.id === this._metric);
    const hist = {};
    await Promise.all(
      Object.entries(metric.kinds).map(async ([key, kind]) => {
        try {
          const r = await this.hass.callWS({ type: "meshtastic/node_history", entry_id: this.entryId, node_id: node.node_id, kind });
          hist[key] = (r && r.points) || [];
        } catch (err) {
          console.warn("MT_SW: historia węzła", kind, err);
          hist[key] = [];
        }
      })
    );
    this._hist = hist;
    this._loading = false;
  }

  _ranged(points) {
    const ms = RANGES[this._range][1];
    if (ms === null) return points || [];
    const from = Date.now() - ms;
    return (points || []).filter((p) => p && p.ts >= from);
  }

  _charts() {
    const tr = (k) => t(this.hass, k);
    const h = this._hist || {};
    const m = METRICS.find((x) => x.id === this._metric);
    const r = (k) => this._ranged(h[k]);
    switch (m.id) {
      case "resources":
        return buildResourceCharts(buildResourceRows({ stats: r("stats"), extended: r("extended") }), tr);
      case "traffic": {
        const points = r("stats");
        const series = TRAFFIC_SERIES.map((s) => ({ key: s.key, label: tr(s.labelKey), color: s.color })).filter(
          (s) => points.filter((p) => isNum(p[s.key])).length >= 2
        );
        return series.length ? [{ id: "traffic", unit: " /min", points, series, derivative: true }] : [];
      }
      case "neighbors": {
        const points = r("neighbors");
        return points.length >= 2 ? [{ id: "neighbors", unit: "", points, series: [{ key: "count", label: this._label(m), color: "#4FC3F7" }] }] : [];
      }
      default: {
        const ranged = {};
        for (const key of Object.keys(m.kinds)) ranged[key] = r(key);
        return buildTelemetryCharts(ranged, tr).filter((c) => m.charts.includes(c.id));
      }
    }
  }

  _stats(chart) {
    return chart.series.map((s) => {
      const vals = chart.derivative ? [] : chart.points.map((p) => p[s.key]).filter(isNum);
      if (!vals.length) return null;
      const f = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
      return html`<span><i style="background:${s.color}"></i>${s.label}: ${this._tr("min")} ${f(Math.min(...vals))}, ${this._tr("max")} ${f(Math.max(...vals))}, ${this._tr("last")} ${f(vals[vals.length - 1])}${chart.unit}</span>`;
    });
  }

  _renderDetail() {
    const node = this._detail;
    const charts = this._hist ? this._charts() : [];
    const m = METRICS.find((x) => x.id === this._metric);
    return html`
      <div class="bar"><button class="chip" @click=${() => { this._detail = null; this._hist = null; }}>← ${this._tr("back")}</button>
        <b>${this._name(node)}</b><span class="hex">${node.node_hex || ""}</span></div>
      <div class="bar">${RANGES.map(
        ([label], i) => html`<button class="chip ${i === this._range ? "on" : ""}" @click=${() => (this._range = i)}>${label}</button>`
      )}</div>
      ${this._loading ? html`<p class="hint">…</p>` : ""}
      ${!this._loading && !charts.length ? html`<p class="hint">${this._tr("chart_empty")}</p>` : ""}
      ${m.id === "traffic" && charts.length ? html`<p class="hint">${this._tr("note_traffic")}</p>` : ""}
      ${charts.map(
        (c) => html`<div class="card">
          <div class="stats">${this._stats(c)}</div>
          <mesh-line-chart .points=${c.points} .series=${c.series} .unit=${c.unit} .height=${150} .fit=${!c.derivative}
            .derivative=${!!c.derivative} .rate=${!!c.derivative} .language=${this.hass.language}
            .emptyLabel=${this._tr("chart_empty")}></mesh-line-chart>
        </div>`
      )}
    `;
  }

  render() {
    if (this._detail) return html`<div class="wrap">${this._renderDetail()}</div>`;
    const rows = this._rows();
    return html`
      <div class="wrap">
        <div class="bar">
          <input class="search" placeholder=${this._tr("search")} .value=${this._search} @input=${(e) => (this._search = e.target.value)} />
          <select @change=${(e) => (this._sort = e.target.value)}>
            <option value="value" ?selected=${this._sort === "value"}>${this._tr("sort_value")}</option>
            <option value="heard" ?selected=${this._sort === "heard"}>${this._tr("sort_heard")}</option>
          </select>
        </div>
        <div class="bar filters">
          <label>${this._tr("f_activity")}
            <select @change=${(e) => (this._act = Number(e.target.value))}>
              ${ACTIVITY.map(([label], i) => html`<option value=${i} ?selected=${this._act === i}>${i === 0 ? this._tr("f_any") : label}</option>`)}
            </select></label>
          <label>${this._tr("f_fav")}
            <select @change=${(e) => (this._fav = e.target.value)}>
              <option value="all" ?selected=${this._fav === "all"}>${this._tr("f_any")}</option>
              <option value="fav" ?selected=${this._fav === "fav"}>${this._tr("f_fav_only")}</option>
              <option value="nofav" ?selected=${this._fav === "nofav"}>${this._tr("f_fav_no")}</option>
            </select></label>
          <label>${this._tr("f_hops")}
            <select @change=${(e) => (this._hops = e.target.value)}>
              ${[["all", "f_hops_all"], ["0", "f_hops_0"], ["1", "f_hops_1"], ["2", "f_hops_2"], ["3", "f_hops_3"]].map(
                ([v, k]) => html`<option value=${v} ?selected=${this._hops === v}>${this._tr(k)}</option>`
              )}
            </select></label>
          ${Object.keys(this._groups).length
            ? html`<label>${this._tr("f_group")}
                <select @change=${(e) => (this._group = e.target.value)}>
                  <option value="" ?selected=${!this._group}>${this._tr("f_group_all")}</option>
                  ${Object.keys(this._groups).map((g) => html`<option value=${g} ?selected=${this._group === g}>${g}</option>`)}
                </select></label>`
            : ""}
        </div>
        <div class="bar filters">
          <label class="chk"><input type="checkbox" .checked=${this._pos} @change=${(e) => (this._pos = e.target.checked)} />${this._tr("f_pos")}</label>
          <label class="chk"><input type="checkbox" .checked=${this._nomqtt} @change=${(e) => (this._nomqtt = e.target.checked)} />${this._tr("f_nomqtt")}</label>
          <label class="chk"><input type="checkbox" .checked=${this._ign} @change=${(e) => (this._ign = e.target.checked)} />${this._tr("f_ign")}</label>
          <button class="chip" @click=${() => this._resetFilters()}>${this._tr("f_reset")}</button>
          <span class="hint">${this._tr("shown")}: ${rows.length} ${this._tr("of")} ${(this.nodes || []).length}</span>
        </div>
        ${rows.length
          ? rows.map((r) => {
              const s = this._series[String(r.node.node_id)];
              return html`<div class="row" @click=${() => this._open(r.node)}>
                <span class="dot ${levelOf(this._metric, r.value)}"></span>
                <span class="nm">${this._name(r.node)}<small>${r.node.node_hex || ""}</small></span>
                <span class="spk ${levelOf(this._metric, r.value)}">${s ? this._spark(s.values) : ""}</span>
                <b class="val">${r.value === null ? this._tr("nodata") : this._fmt(r.value)}</b>
              </div>`;
            })
          : html`<p class="hint">${this._tr("empty")}</p>`}
      </div>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; }
      .wrap { padding: 8px 0 24px; }
      .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
      .chip { appearance: none; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); border-radius: 16px; padding: 4px 12px; font: inherit; font-size: 13px; cursor: pointer; }
      .chip.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
      .search { flex: 1; min-width: 160px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
      select { padding: 6px 8px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
      .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--divider-color); cursor: pointer; }
      .row:hover { background: var(--secondary-background-color); }
      .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nm small, .hex { color: var(--secondary-text-color); font-size: 11px; margin-left: 6px; }
      .spk { width: 90px; flex: none; color: var(--secondary-text-color); }
      .spk.good { color: var(--success-color, #43a047); }
      .spk.ok { color: var(--warning-color, #ffa000); }
      .spk.bad { color: var(--error-color, #db4437); }
      .spark { width: 90px; height: 24px; display: block; }
      .val { width: 90px; text-align: right; flex: none; font-size: 14px; }
      .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--disabled-text-color, #999); }
      .dot.good { background: var(--success-color, #43a047); }
      .dot.ok { background: var(--warning-color, #ffa000); }
      .dot.bad { background: var(--error-color, #db4437); }
      .card { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px 14px; margin: 10px 0; }
      .stats { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--secondary-text-color); margin-bottom: 6px; }
      .stats i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
      .filters label { font-size: 12px; color: var(--secondary-text-color); display: flex; flex-direction: column; gap: 2px; }
      .filters .chk { flex-direction: row; align-items: center; gap: 6px; color: var(--primary-text-color); font-size: 13px; }
      .hint { font-size: 13px; color: var(--secondary-text-color); }
    `;
  }
}

if (!customElements.get("mtsw-health-metrics")) customElements.define("mtsw-health-metrics", MtswHealthMetrics);
