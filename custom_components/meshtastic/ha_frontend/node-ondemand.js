/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Sekcja "Diagnostyka OnDemand" w oknie szczegółów węzła — odpowiednik ekranu
 * z aplikacji: statystyki węzła, ping, węzły online, błędy routingu, liczniki
 * portów i historie odbioru.
 *
 * Każdy przycisk wysyła jedno zapytanie do węzła (port 354, firmware MT_SW)
 * i pokazuje odpowiedź pod spodem. Nic nie idzie automatycznie: zapytanie
 * zajmuje eter, a odpowiedź z dalekiego węzła bywa kilkanaście sekund w drodze.
 * Wyniki ostatnich zapytań zostają na ekranie, dopóki nie zmieni się węzeł.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { t, formatUptime, formatRelative } from "./i18n.js";
import { formatKb, formatNumber } from "./stats-history.js";
import { portLabel, routingErrorLabel } from "./port-names.js";

export const ONDEMAND_QUERIES = [
  "node_stats",
  "ping",
  "ping_ack",
  "nodes_online",
  "routing_errors",
  "port_counters",
  "air_activity",
  "exchange",
  "rx_avg_time",
  "rx_packet_history",
  "fw_plus_version",
];

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

class MeshNodeOnDemand extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      entryId: { type: String },
      nodeId: { type: Number },
      nodes: { type: Array },
      _results: { type: Object, state: true },
      _busy: { type: String, state: true },
      _error: { type: String, state: true },
    };
  }

  constructor() {
    super();
    this.nodes = [];
    this._results = {};
    this._busy = null;
    this._error = "";
  }

  updated(changed) {
    if (changed.has("nodeId") && changed.get("nodeId") !== undefined) {
      this._results = {};
      this._error = "";
    }
  }

  /* ── zapytania ───────────────────────────────────────────── */

  async _run(query) {
    this._busy = query;
    this._error = "";
    try {
      const result = await this.hass.callWS({
        type: "meshtastic/ondemand",
        entry_id: this.entryId,
        node_id: this.nodeId,
        query,
      });
      this._results = { ...this._results, [query]: result };
    } catch (err) {
      this._error = this._errorText(err);
    } finally {
      this._busy = null;
    }
  }

  _errorText(err) {
    const code = (err && err.message) || String(err);
    if (code === "timeout") {
      return t(this.hass, "ondemand.error.timeout");
    }
    if (code === "not_connected") {
      return t(this.hass, "ondemand.error.not_connected");
    }
    if (code.startsWith("routing:")) {
      return t(this.hass, "ondemand.error.routing", { error: code.slice("routing:".length) });
    }
    return code;
  }

  /* ── formatowanie ────────────────────────────────────────── */

  get _lang() {
    return this.hass.language;
  }

  _num(value, digits = 0) {
    return isNumber(value) ? formatNumber(value, this._lang, digits) : "—";
  }

  _label(nodeId) {
    if (nodeId === 0xffffffff) {
      return t(this.hass, "ondemand.broadcast");
    }
    const hex = `!${(nodeId >>> 0).toString(16).padStart(8, "0")}`;
    const node = (this.nodes || []).find((n) => n.node_id === nodeId);
    return node ? node.long_name || node.short_name || hex : hex;
  }

  _rtt(ms) {
    return ms >= 1000 ? `${this._num(ms / 1000, 1)} s` : `${this._num(ms)} ms`;
  }

  _link(snr, rssi) {
    const parts = [];
    if (isNumber(snr)) {
      parts.push(`${this._num(snr, 1)} dB`);
    }
    if (isNumber(rssi) && rssi !== 0) {
      parts.push(`${this._num(rssi)} dBm`);
    }
    return parts.length ? parts.join(" / ") : "—";
  }

  _row(label, value) {
    return html`
      <div class="detail-row">
        <span class="detail-label">${label}</span>
        <span class="detail-value">${value}</span>
      </div>
    `;
  }

  /* wiersze tylko dla pól, które węzeł faktycznie zgłosił */
  _rows(pairs) {
    return pairs.filter(([, value]) => value !== null && value !== undefined).map(([label, value]) => this._row(label, value));
  }

  _bars(values) {
    const max = Math.max(1, ...values);
    return html`
      <div class="bars">
        ${values.map((value) => html`<i title=${value} style="height:${Math.max(2, (value / max) * 100)}%"></i>`)}
      </div>
    `;
  }

  _series(values) {
    if (!values.length) {
      return html`<div class="route-note">${t(this.hass, "ondemand.empty")}</div>`;
    }
    const sum = values.reduce((acc, value) => acc + value, 0);
    return html`
      <div class="chart-wrap">${this._bars(values)}</div>
      ${this._row(t(this.hass, "ondemand.series.last"), this._num(values[values.length - 1]))}
      ${this._row(t(this.hass, "ondemand.series.min"), this._num(Math.min(...values)))}
      ${this._row(t(this.hass, "ondemand.series.max"), this._num(Math.max(...values)))}
      ${this._row(t(this.hass, "ondemand.series.avg"), this._num(sum / values.length, 1))}
      ${this._row(t(this.hass, "ondemand.series.count"), this._num(values.length))}
    `;
  }

  /* ── widoki odpowiedzi ───────────────────────────────────── */

  _pct(value, base) {
    return isNumber(value) && isNumber(base) && base > 0
      ? html`<span class="pct">(${this._num((value / base) * 100, 1)}%)</span>`
      : "";
  }

  _used(free, total) {
    if (!isNumber(free) || !isNumber(total) || total <= 0) {
      return null;
    }
    const used = total - free;
    return html`${formatKb(used, this._lang)} / ${formatKb(total, this._lang)}
      <span class="pct">(${this._num((used / total) * 100, 1)}%)</span>`;
  }

  _renderNodeStats(d) {
    const tr = (key) => t(this.hass, key);
    const has = (key) => isNumber(d[key]);
    const percent = (key, digits = 1) => (has(key) ? `${this._num(d[key], digits)} %` : null);
    const packet = (key) => (has(key) ? html`${this._num(d[key])} ${key === "numPacketsRx" ? "" : this._pct(d[key], d.numPacketsRx)}` : null);
    const plain = (key) => (has(key) ? this._num(d[key]) : null);
    const bytes = (key) => (has(key) ? formatKb(d[key], this._lang) : null);

    const battery = has("batteryLevel")
      ? d.batteryLevel > 100
        ? tr("ondemand.stats.powered")
        : `${this._num(d.batteryLevel)} %`
      : null;
    const nodes =
      has("numOnlineNodes") || has("numTotalNodes")
        ? `${this._num(d.numOnlineNodes)} / ${this._num(d.numTotalNodes)}`
        : null;

    const power = [];
    for (const n of [1, 2, 3]) {
      const voltage = d[`ch${n}Voltage`];
      const current = d[`ch${n}Current`];
      if (isNumber(voltage) || isNumber(current)) {
        power.push([
          t(this.hass, "ondemand.stats.channel", { n }),
          `${isNumber(voltage) ? `${this._num(voltage, 2)} V` : "—"} / ${isNumber(current) ? `${this._num(current, 1)} mA` : "—"}`,
        ]);
      }
    }

    const section = (key, pairs) => {
      const rows = this._rows(pairs);
      return rows.length ? html`<div class="sub-section">${tr(key)}</div>${rows}` : "";
    };

    return html`
      ${section("ondemand.stats.section.device", [
        [tr("ondemand.stats.battery"), battery],
        [tr("ondemand.stats.voltage"), has("voltage") ? `${this._num(d.voltage, 2)} V` : null],
        [tr("ondemand.stats.chutil"), percent("channelUtilization")],
        [tr("ondemand.stats.airtx"), percent("airUtilTx")],
        [tr("ondemand.stats.uptime"), has("uptimeSeconds") ? formatUptime(this.hass, d.uptimeSeconds) : null],
        [tr("ondemand.stats.reboots"), plain("reboots")],
        [tr("ondemand.stats.firmware"), d.firmwareVersion || null],
        [tr("ondemand.stats.fwplus"), plain("fwPlusVersion")],
        [tr("ondemand.stats.nodes"), nodes],
      ])}
      ${section("ondemand.stats.section.packets", [
        [tr("ondemand.stats.rx"), packet("numPacketsRx")],
        [tr("ondemand.stats.rx_bad"), packet("numPacketsRxBad")],
        [tr("nodes.packets.rx_dupe"), packet("numRxDupe")],
        [tr("ondemand.stats.tx"), packet("numPacketsTx")],
        [tr("nodes.packets.tx_relay"), packet("numTxRelay")],
        [tr("nodes.packets.tx_relay_canceled"), packet("numTxRelayCanceled")],
        [tr("ondemand.stats.blocked_hoplimit"), packet("blockedByHoplimit")],
        [tr("ondemand.stats.flood"), plain("floodCounter")],
        [tr("ondemand.stats.nexthop"), plain("nexthopCounter")],
        [tr("ondemand.stats.rx_bytes"), bytes("rxTotalBytes")],
        [tr("ondemand.stats.tx_bytes"), bytes("txTotalBytes")],
      ])}
      ${section("ondemand.stats.section.resources", [
        [tr("nodes.resources.cpu"), has("cpuUsagePercent") ? `${this._num(d.cpuUsagePercent)} %` : null],
        [tr("nodes.resources.heap"), this._used(d.memoryFreeCheap, d.memoryTotal)],
        [
          tr("nodes.resources.flash"),
          has("flashTotalBytes") && d.flashTotalBytes > 0
            ? this._used(d.flashTotalBytes - (d.flashUsedBytes || 0), d.flashTotalBytes)
            : null,
        ],
        [tr("nodes.resources.psram"), has("memoryPsramTotal") && d.memoryPsramTotal > 0 ? this._used(d.memoryPsramFree, d.memoryPsramTotal) : null],
      ])}
      ${section("ondemand.stats.section.power", power)}
    `;
  }

  _renderPing(result) {
    const d = result.data;
    const tr = (key) => t(this.hass, key);
    return html`
      ${this._rows([
        [tr("ondemand.ping.rtt"), this._rtt(result.rtt_ms)],
        [tr("ondemand.ping.hops_request"), isNumber(d.hopCount) ? this._num(d.hopCount) : null],
        [tr("ondemand.ping.request_link"), isNumber(d.snr) || isNumber(d.rxRssi) ? this._link(d.snr, d.rxRssi) : null],
        [tr("ondemand.ping.response_hops"), isNumber(result.hops_away) ? this._num(result.hops_away) : null],
        [tr("ondemand.ping.response_link"), isNumber(result.rx_snr) ? this._link(result.rx_snr, result.rx_rssi) : null],
      ])}
    `;
  }

  _renderNodesOnline(d) {
    const list = d.nodeList || [];
    if (!list.length) {
      return html`<div class="route-note">${t(this.hass, "ondemand.empty")}</div>`;
    }
    return html`
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>${t(this.hass, "ondemand.nodes.name")}</th>
              <th>${t(this.hass, "ondemand.nodes.hops")}</th>
              <th>${t(this.hass, "ondemand.nodes.snr")}</th>
              <th>${t(this.hass, "ondemand.nodes.heard")}</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(
              (entry) => html`
                <tr>
                  <td class="text">${entry.longName || entry.shortName || this._label(entry.nodeId)}</td>
                  <td>${this._num(entry.hops)}</td>
                  <td>${this._num(entry.snr, 1)} dB</td>
                  <td>${entry.lastHeard ? formatRelative(this.hass, entry.lastHeard * 1000) : "—"}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderRoutingErrors(d) {
    const list = [...(d.routingErrors || [])].sort((a, b) => b.counter - a.counter);
    if (!list.length) {
      return html`<div class="route-note">${t(this.hass, "ondemand.empty")}</div>`;
    }
    return html`
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>${t(this.hass, "ondemand.routing.error")}</th>
              <th>${t(this.hass, "ondemand.count")}</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(
              (entry) => html`
                <tr class=${entry.counter ? "" : "zero"}>
                  <td class="text" title=${entry.name}>${routingErrorLabel(this._lang, entry.name) || entry.num}</td>
                  <td>${this._num(entry.counter)}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderPortCounters(d) {
    const list = [...(d.portCounterHistory || [])].sort((a, b) => b.count - a.count);
    if (!list.length) {
      return html`<div class="route-note">${t(this.hass, "ondemand.empty")}</div>`;
    }
    const total = list.reduce((acc, entry) => acc + entry.count, 0);
    return html`
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>${t(this.hass, "ondemand.ports.port")}</th>
              <th>${t(this.hass, "ondemand.count")}</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(
              (entry) => html`
                <tr class=${entry.count ? "" : "zero"}>
                  <td class="text" title=${entry.name}>
                    ${portLabel(this._lang, entry.name)} <span class="pct">(${entry.port})</span>
                  </td>
                  <td>${this._num(entry.count)} ${this._pct(entry.count, total)}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderAirActivity(d) {
    const list = d.airActivityHistory || [];
    if (!list.length) {
      return html`<div class="route-note">${t(this.hass, "ondemand.empty")}</div>`;
    }
    const tr = (key) => t(this.hass, key);
    return html`
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>${tr("ondemand.air.window")}</th>
              <th>${tr("ondemand.air.tx")}</th>
              <th>${tr("ondemand.air.rx")}</th>
              <th>${tr("ondemand.air.rx_bad")}</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(
              (entry, index) => html`
                <tr>
                  <td class="text">${index + 1}</td>
                  <td>${this._num(entry.txTime)}</td>
                  <td>${this._num(entry.rxTime)}</td>
                  <td>${this._num(entry.rxBadTime)}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderExchange(d) {
    const list = d.exchangeList || [];
    if (!list.length) {
      return html`<div class="route-note">${t(this.hass, "ondemand.empty")}</div>`;
    }
    return html`
      <div class="table-wrap">
        <table>
          <tbody>
            ${list.map(
              (entry) => html`
                <tr>
                  <td class="text">${this._label(entry.fromNode)} → ${this._label(entry.toNode)}</td>
                  <td class="text" title=${entry.portName}>${portLabel(this._lang, entry.portName) || entry.portNum}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderFwPlus(d) {
    const version = d.versionNumber;
    return html`
      ${this._row(t(this.hass, "ondemand.stats.fwplus"), this._num(version))}
      ${version >= 3 ? html`<div class="route-note">${t(this.hass, "ondemand.fwplus.sniffer")}</div>` : ""}
    `;
  }

  _renderBody(result) {
    const d = result.data || {};
    switch (result.kind) {
      case "node_stats":
        return this._renderNodeStats(d);
      case "ping":
        return this._renderPing(result);
      case "node_list":
        return this._renderNodesOnline(d);
      case "routing_errors":
        return this._renderRoutingErrors(d);
      case "port_counter_history":
        return this._renderPortCounters(d);
      case "air_activity_history":
        return this._renderAirActivity(d);
      case "exchange_packet_log":
        return this._renderExchange(d);
      case "rx_avg_time_history":
        return this._series(d.rxAvgHistory || []);
      case "rx_packet_history":
        return this._series(d.rxPacketHistory || []);
      case "fw_plus_version":
        return this._renderFwPlus(d);
      default:
        return html`<pre>${JSON.stringify(d, null, 2)}</pre>`;
    }
  }

  _renderResult(query) {
    const result = this._results[query];
    if (!result) {
      return "";
    }
    const time = new Date(result.received_at).toLocaleTimeString(this._lang);
    const parts =
      result.expected_parts > 1
        ? ` · ${t(this.hass, "ondemand.parts", { got: result.parts, total: result.expected_parts })}`
        : "";
    return html`
      <div class="detail-section">${t(this.hass, `ondemand.q.${query}`)}</div>
      <div class="route-note">${t(this.hass, `ondemand.desc.${query}`)}</div>
      <div class="route-note">
        ${t(this.hass, "ondemand.received", { time, rtt: this._rtt(result.rtt_ms) })}${parts}
      </div>
      ${this._renderBody(result)}
    `;
  }

  render() {
    if (!this.hass) {
      return html``;
    }
    const answered = ONDEMAND_QUERIES.filter((query) => this._results[query]);

    return html`
      <div class="detail-section">${t(this.hass, "ondemand.title")}</div>
      <div class="route-note">${t(this.hass, "ondemand.hint")}</div>
      <div class="buttons">
        ${ONDEMAND_QUERIES.map(
          (query) => html`
            <button
              class="query ${this._results[query] ? "done" : ""}"
              ?disabled=${Boolean(this._busy)}
              @click=${() => this._run(query)}
            >
              ${t(this.hass, `ondemand.q.${query}`)}
            </button>
          `
        )}
      </div>
      ${this._busy ? html`<div class="status">${t(this.hass, "ondemand.waiting")}</div>` : ""}
      ${this._error ? html`<div class="status error">${this._error}</div>` : ""}
      ${answered.map((query) => this._renderResult(query))}
      ${answered.length
        ? html`<div class="buttons">
            <button class="query" @click=${() => { this._results = {}; }}>${t(this.hass, "ondemand.clear")}</button>
          </div>`
        : ""}
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      .detail-section {
        padding: 12px 16px 4px;
        margin-top: 8px;
        border-top: 1px solid var(--divider-color);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--secondary-text-color);
      }

      .sub-section {
        padding: 8px 16px 0;
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary-text-color);
      }

      .route-note {
        padding: 0 16px 8px;
        font-size: 12px;
        color: var(--secondary-text-color);
      }

      .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 4px 16px 8px;
      }

      .query {
        padding: 6px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 16px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 13px;
        cursor: pointer;
      }

      .query.done {
        border-color: var(--primary-color);
      }

      .query:hover:not([disabled]) {
        background: var(--secondary-background-color);
      }

      .query[disabled] {
        opacity: 0.5;
        cursor: default;
      }

      .status {
        margin: 0 16px 8px;
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .status.error {
        color: var(--error-color, #db4437);
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 6px 16px;
      }

      .detail-label {
        color: var(--secondary-text-color);
        font-size: 13px;
      }

      .detail-value {
        font-size: 14px;
        font-variant-numeric: tabular-nums;
        text-align: end;
      }

      .chart-wrap {
        background: var(--card-background-color);
        border-radius: 8px;
        padding: 8px;
        margin: 0 16px 8px;
      }

      .bars {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 64px;
      }

      .bars i {
        flex: 1;
        min-width: 2px;
        border-radius: 2px 2px 0 0;
        background: var(--primary-color);
        opacity: 0.8;
      }

      .table-wrap {
        margin: 0 16px 12px;
        max-height: 340px;
        overflow: auto;
      }

      table {
        border-collapse: collapse;
        width: 100%;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      th,
      td {
        padding: 6px 10px;
        text-align: end;
        white-space: nowrap;
        border-top: 1px solid var(--divider-color);
      }

      th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: var(--card-background-color);
        color: var(--secondary-text-color);
        font-weight: 500;
        border-top: none;
      }

      th:first-child,
      td.text {
        text-align: start;
      }

      tr.zero td {
        color: var(--secondary-text-color);
      }

      .pct {
        color: var(--secondary-text-color);
        margin-inline-start: 2px;
      }

      pre {
        margin: 0 16px 12px;
        font-size: 12px;
        overflow: auto;
      }
    `;
  }
}

if (!customElements.get("mesh-node-ondemand")) {
  customElements.define("mesh-node-ondemand", MeshNodeOnDemand);
}
