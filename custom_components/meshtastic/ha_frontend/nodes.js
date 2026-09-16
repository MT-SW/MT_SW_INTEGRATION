/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Węzły — pełna lista z bazy urządzenia, filtry i akcje.
 *
 * Źródłem jest baza węzłów radia, a nie coordinator.data. Opcja "nodes"
 * wpisu konfiguracyjnego decyduje wyłącznie o tym, dla których węzłów
 * powstają encje Home Assistanta — panel pokazuje wszystko, co widzi radio,
 * tak jak klient WWW. Węzły z encjami są oznaczone, żeby nadal było wiadomo,
 * które trafiają do automatyzacji.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { layoutStyles, emptyStateStyles } from "./styles.js";
import { t, formatUptime } from "./i18n.js";

const COLUMNS = [
  { key: "name", labelKey: "nodes.col.name", numeric: false },
  { key: "snr", labelKey: "nodes.col.snr", numeric: true },
  { key: "hops_away", labelKey: "nodes.col.hops", numeric: true },
  { key: "battery_level", labelKey: "nodes.col.battery", numeric: true },
  { key: "last_heard", labelKey: "nodes.col.last_heard", numeric: true },
];

const FILTERS = [
  { key: "favorites", labelKey: "nodes.filter.favorites" },
  { key: "direct", labelKey: "nodes.filter.direct" },
  { key: "positioned", labelKey: "nodes.filter.positioned" },
  { key: "tracked", labelKey: "nodes.filter.tracked" },
  { key: "hideMqtt", labelKey: "nodes.filter.hide_mqtt" },
  { key: "showIgnored", labelKey: "nodes.filter.show_ignored" },
];

class MeshNodesTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      entryId: { type: String },
      nodes: { type: Array },
      _filter: { type: String },
      _toggles: { type: Object },
      _sortKey: { type: String },
      _sortAsc: { type: Boolean },
      _detail: { type: Object },
      _busy: { type: String },
      _error: { type: String },
      _notice: { type: String },
      _traceroute: { type: Object },
    };
  }

  constructor() {
    super();
    this.nodes = [];
    this._filter = "";
    this._toggles = {};
    this._sortKey = "last_heard";
    this._sortAsc = false;
    this._detail = null;
    this._busy = null;
    this._error = null;
    this._notice = null;
    this._traceroute = null;
  }

  _displayName(node) {
    return node.long_name || node.short_name || node.node_hex || String(node.node_id);
  }

  _current() {
    // Dialog trzyma kopię sprzed odświeżenia, więc szukamy aktualnej wersji.
    if (!this._detail) {
      return null;
    }
    return (this.nodes || []).find((n) => n.node_id === this._detail.node_id) || this._detail;
  }

  _sortValue(node, key) {
    if (key === "name") {
      return this._displayName(node).toLowerCase();
    }
    const value = node[key];
    return value === null || value === undefined ? -Infinity : value;
  }

  _visibleNodes() {
    const needle = (this._filter || "").trim().toLowerCase();
    const on = this._toggles;
    let list = this.nodes || [];

    list = list.filter((node) => {
      if (node.is_ignored && !on.showIgnored) return false;
      if (on.favorites && !node.is_favorite) return false;
      if (on.direct && node.hops_away !== 0) return false;
      if (on.positioned && typeof node.latitude !== "number") return false;
      if (on.tracked && !node.is_tracked) return false;
      if (on.hideMqtt && node.via_mqtt) return false;
      if (needle) {
        const haystack = [node.long_name, node.short_name, node.node_hex, node.role]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const direction = this._sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      // Ulubione zawsze na górze, niezależnie od wybranego sortowania.
      if (a.is_favorite !== b.is_favorite) {
        return a.is_favorite ? -1 : 1;
      }
      const va = this._sortValue(a, this._sortKey);
      const vb = this._sortValue(b, this._sortKey);
      if (va < vb) return -1 * direction;
      if (va > vb) return 1 * direction;
      return 0;
    });
  }

  _toggleSort(key) {
    if (this._sortKey === key) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortKey = key;
      this._sortAsc = key === "name";
    }
  }

  _toggleFilter(key) {
    this._toggles = { ...this._toggles, [key]: !this._toggles[key] };
  }

  _formatValue(value, suffix, digits) {
    if (value === null || value === undefined) {
      return t(this.hass, "common.unknown");
    }
    const shown = typeof value === "number" && digits !== undefined ? value.toFixed(digits) : value;
    return suffix ? `${shown}${suffix}` : String(shown);
  }

  /* lastHeard przychodzi z radia jako uniksowy czas w sekundach */
  _formatLastHeard(seconds) {
    if (!seconds) {
      return t(this.hass, "common.unknown");
    }
    return new Date(seconds * 1000).toLocaleString(this.hass.language);
  }

  async _call(kind, payload) {
    if (!this.entryId || this._busy) {
      return;
    }
    this._busy = kind;
    this._error = null;
    this._notice = null;
    try {
      const result = await this.hass.callWS({
        type: `meshtastic/${kind}`,
        entry_id: this.entryId,
        ...payload,
      });
      // Radio potrafi przyjąć polecenie bez potwierdzenia — wtedy nic się nie
      // stało i nie wolno tego meldować jako sukcesu.
      if (result && result.confirmed === false) {
        this._error = t(this.hass, "nodes.action.unconfirmed");
        return false;
      }
      this._notice = t(
        this.hass,
        kind === "remove_node" ? "nodes.action.removed" : "nodes.action.sent"
      );
      this.dispatchEvent(new CustomEvent("mtsw-refresh", { bubbles: true, composed: true }));
      return result && result.result !== undefined ? result.result || true : true;
    } catch (err) {
      console.error("MT_SW: akcja nie powiodła się", kind, err);
      this._error = (err && err.message) || t(this.hass, "nodes.action.failed");
      return false;
    } finally {
      this._busy = null;
    }
  }

  _openDm(node) {
    this.dispatchEvent(
      new CustomEvent("mtsw-open-dm", {
        detail: { nodeId: node.node_id },
        bubbles: true,
        composed: true,
      })
    );
  }

  async _confirmRemove(node) {
    const message = t(this.hass, "nodes.action.remove_confirm", { name: this._displayName(node) });
    // eslint-disable-next-line no-alert
    if (!window.confirm(message)) {
      return;
    }
    const removed = await this._call("remove_node", { node_id: node.node_id });
    if (removed) {
      // Usuwamy też z lokalnej listy, żeby wiersz zniknął natychmiast,
      // nie dopiero po następnym odpytaniu.
      this.nodes = (this.nodes || []).filter((n) => n.node_id !== node.node_id);
      this._detail = null;
    }
  }

  _renderStar(node) {
    return html`
      <button
        class="star ${node.is_favorite ? "on" : ""}"
        title=${t(this.hass, node.is_favorite ? "nodes.action.unfavorite" : "nodes.action.favorite")}
        @click=${(e) => {
          e.stopPropagation();
          this._call("set_favorite", { node_id: node.node_id, favorite: !node.is_favorite });
        }}
      >
        ${node.is_favorite ? "★" : "☆"}
      </button>
    `;
  }

  _renderRow(node) {
    return html`
      <tr class=${node.is_ignored ? "ignored" : ""} @click=${() => (this._detail = node)}>
        <td class="star-cell">${this._renderStar(node)}</td>
        <td>
          <span class="name">${this._displayName(node)}</span>
          ${node.is_gateway ? html`<span class="tag">${t(this.hass, "nodes.gateway")}</span>` : ""}
          ${node.via_mqtt ? html`<span class="tag mqtt">MQTT</span>` : ""}
          ${node.is_ignored ? html`<span class="tag muted">${t(this.hass, "nodes.ignored")}</span>` : ""}
          ${node.is_tracked ? html`<span class="dot" title=${t(this.hass, "nodes.tracked_hint")}></span>` : ""}
          <span class="hex">${node.node_hex}</span>
        </td>
        <td class="num">${this._formatValue(node.snr, " dB", 1)}</td>
        <td class="num">${this._formatValue(node.hops_away)}</td>
        <td class="num">${this._formatValue(node.battery_level, " %")}</td>
        <td class="num">${this._formatLastHeard(node.last_heard)}</td>
      </tr>
    `;
  }

  _detailRow(labelKey, value) {
    if (value === null || value === undefined || value === "") {
      return html``;
    }
    return html`
      <div class="detail-row">
        <span class="detail-label">${t(this.hass, labelKey)}</span>
        <span class="detail-value">${value}</span>
      </div>
    `;
  }

  _nameOf(nodeId) {
    const node = (this.nodes || []).find((n) => n.node_id === nodeId);
    if (node) {
      return this._displayName(node);
    }
    return `!${(nodeId >>> 0).toString(16).padStart(8, "0")}`;
  }

  _renderActions(node) {
    const busy = Boolean(this._busy);
    const action = (kind, labelKey, payload, danger) => html`
      <button
        class="action ${danger ? "danger" : ""}"
        ?disabled=${busy}
        @click=${() => this._call(kind, payload)}
      >
        ${t(this.hass, labelKey)}
      </button>
    `;

    return html`
      <div class="actions">
        <button class="action primary" ?disabled=${busy} @click=${() => this._openDm(node)}>
          ${t(this.hass, "nodes.action.message")}
        </button>
        <button
          class="action"
          ?disabled=${busy}
          @click=${() => this._call("set_favorite", { node_id: node.node_id, favorite: !node.is_favorite })}
        >
          ${t(this.hass, node.is_favorite ? "nodes.action.unfavorite" : "nodes.action.favorite")}
        </button>
        <button
          class="action"
          ?disabled=${busy}
          @click=${() => this._call("set_ignored", { node_id: node.node_id, ignored: !node.is_ignored })}
        >
          ${t(this.hass, node.is_ignored ? "nodes.action.unignore" : "nodes.action.ignore")}
        </button>
        ${action("request_position", "nodes.action.position", { node_id: node.node_id })}
        ${action("request_neighbors", "nodes.action.neighbors", { node_id: node.node_id })}
        <button
          class="action"
          ?disabled=${busy}
          @click=${async () => {
            this._traceroute = null;
            const route = await this._call("traceroute", { node_id: node.node_id });
            if (route && typeof route === "object") {
              this._traceroute = route;
            }
          }}
        >
          ${t(this.hass, "nodes.action.traceroute")}
        </button>
        <button class="action danger" ?disabled=${busy} @click=${() => this._confirmRemove(node)}>
          ${t(this.hass, "nodes.action.remove")}
        </button>
      </div>
      ${this._busy ? html`<div class="status">${t(this.hass, "nodes.action.working")}</div>` : ""}
      ${this._notice ? html`<div class="status ok">${this._notice}</div>` : ""}
      ${this._error ? html`<div class="status error">${this._error}</div>` : ""}
    `;
  }

  /* RouteDiscovery niesie same przeskoki pośrednie — bez nadawcy i celu.
     Żeby trasa dała się przeczytać, doklejamy oba końce i budujemy łańcuch:
     bramka -> przeskok -> ... -> cel. SNR dotyczy odcinków, więc jest ich
     o jeden mniej niż węzłów; wartości są w czwartych częściach decybela. */
  _gatewayId() {
    const gateway = (this.nodes || []).find((n) => n.is_gateway);
    return gateway ? gateway.node_id : null;
  }

  _snrClass(db) {
    if (db === null) return "";
    if (db >= 0) return "good";
    if (db >= -8) return "fair";
    return "poor";
  }

  _renderChain(labelKey, chain, snrs) {
    if (!chain || chain.length < 2) {
      return html``;
    }
    return html`
      <div class="detail-section">${t(this.hass, labelKey)}</div>
      <div class="route">
        ${chain.map((hop, index) => {
          const raw = snrs && snrs[index] !== undefined ? snrs[index] / 4 : null;
          return html`
            <div class="route-node">
              <span class="route-dot ${index === 0 ? "start" : ""}${index === chain.length - 1 ? "end" : ""}"></span>
              <span class="route-name">${this._nameOf(hop)}</span>
            </div>
            ${index < chain.length - 1
              ? html`<div class="route-link">
                  <span class="route-line"></span>
                  <span class="route-snr ${this._snrClass(raw)}">
                    ${raw === null ? t(this.hass, "common.unknown") : `${raw.toFixed(2)} dB`}
                  </span>
                </div>`
              : ""}
          `;
        })}
      </div>
    `;
  }

  _renderTraceroute(node) {
    const route = this._traceroute;
    if (!route) {
      return html``;
    }
    const gateway = this._gatewayId();
    const towards = [gateway, ...(route.route || []), node.node_id].filter(
      (id) => id !== null && id !== undefined
    );
    const back = [node.node_id, ...(route.routeBack || []), gateway].filter(
      (id) => id !== null && id !== undefined
    );

    const direct = (route.route || []).length === 0;

    return html`
      ${this._renderChain("nodes.traceroute.towards", towards, route.snrTowards)}
      ${route.routeBack ? this._renderChain("nodes.traceroute.back", back, route.snrBack) : ""}
      ${direct
        ? html`<div class="route-note">${t(this.hass, "nodes.traceroute.direct")}</div>`
        : ""}
    `;
  }

  _renderDetail() {
    const node = this._current();
    if (!node) {
      return html``;
    }

    return html`
      <div class="scrim" @click=${() => this._closeDetail()}>
        <div class="dialog" @click=${(e) => e.stopPropagation()}>
          <div class="dialog-header">
            <span>${this._renderStar(node)} ${this._displayName(node)}</span>
            <button class="close" @click=${() => this._closeDetail()}>✕</button>
          </div>
          <div class="dialog-body">
            ${this._renderActions(node)}

            ${this._detailRow("nodes.col.id", node.node_hex)}
            ${this._detailRow("radio.hw_model", node.hw_model)}
            ${this._detailRow("radio.role", node.role)}
            ${this._detailRow("nodes.col.snr", this._formatValue(node.snr, " dB", 1))}
            ${this._detailRow("nodes.col.hops", node.hops_away)}
            ${this._detailRow("nodes.col.last_heard", this._formatLastHeard(node.last_heard))}
            ${this._detailRow("radio.battery", this._formatValue(node.battery_level, " %"))}
            ${this._detailRow("radio.voltage", this._formatValue(node.voltage, " V", 2))}
            ${this._detailRow(
              "radio.channel_utilization",
              this._formatValue(node.channel_utilization, " %", 1)
            )}
            ${this._detailRow("radio.air_util_tx", this._formatValue(node.air_util_tx, " %", 1))}
            ${node.uptime_seconds
              ? this._detailRow("radio.uptime", formatUptime(this.hass, node.uptime_seconds))
              : ""}
            ${this._detailRow("nodes.temperature", this._formatValue(node.temperature, " °C", 1))}
            ${this._detailRow("nodes.humidity", this._formatValue(node.humidity, " %", 0))}
            ${this._detailRow("nodes.pressure", this._formatValue(node.pressure, " hPa", 0))}
            ${typeof node.latitude === "number"
              ? this._detailRow(
                  "nodes.position",
                  `${node.latitude.toFixed(5)}, ${node.longitude.toFixed(5)}` +
                    (node.altitude !== null && node.altitude !== undefined ? ` (${node.altitude} m)` : "")
                )
              : ""}
            ${this._detailRow("nodes.tracked", node.is_tracked ? t(this.hass, "common.yes") : t(this.hass, "common.no"))}

            ${this._renderTraceroute(node)}

            ${node.neighbors && node.neighbors.length
              ? html`
                  <div class="detail-section">${t(this.hass, "tab.neighbors")}</div>
                  ${node.neighbors.map(
                    (neighbor) => html`
                      <div class="detail-row">
                        <span class="detail-label">${this._nameOf(neighbor.node_id)}</span>
                        <span class="detail-value">${this._formatValue(neighbor.snr, " dB", 2)}</span>
                      </div>
                    `
                  )}
                `
              : ""}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.hass) {
      return html``;
    }
    const nodes = this._visibleNodes();

    return html`
      <div class="tab-content">
        <div class="toolbar">
          <input
            type="search"
            .value=${this._filter}
            placeholder=${t(this.hass, "nodes.filter")}
            @input=${(e) => {
              this._filter = e.target.value;
            }}
          />
          <span class="count">${t(this.hass, "nodes.count", { n: nodes.length })}</span>
        </div>

        <div class="chips">
          ${FILTERS.map(
            (filter) => html`
              <button
                class="chip ${this._toggles[filter.key] ? "on" : ""}"
                @click=${() => this._toggleFilter(filter.key)}
              >
                ${t(this.hass, filter.labelKey)}
              </button>
            `
          )}
        </div>

        ${nodes.length === 0
          ? html`<div class="empty-state">${t(this.hass, "nodes.empty")}</div>`
          : html`
              <div class="card">
                <table>
                  <thead>
                    <tr>
                      <th class="star-cell"></th>
                      ${COLUMNS.map(
                        (column) => html`
                          <th
                            class=${column.numeric ? "num" : ""}
                            @click=${() => this._toggleSort(column.key)}
                          >
                            ${t(this.hass, column.labelKey)}
                            ${this._sortKey === column.key ? (this._sortAsc ? " ▲" : " ▼") : ""}
                          </th>
                        `
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    ${nodes.map((node) => this._renderRow(node))}
                  </tbody>
                </table>
              </div>
            `}
      </div>
      ${this._renderDetail()}
    `;
  }

  static get styles() {
    return [
      layoutStyles,
      emptyStateStyles,
      css`
        .tab-content {
          padding: 16px;
        }

        .toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
        }

        input[type="search"] {
          flex: 1;
          max-width: 360px;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 14px;
        }

        .count {
          font-size: 13px;
          color: var(--secondary-text-color);
        }

        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }

        .chip {
          border: 1px solid var(--divider-color);
          border-radius: 999px;
          background: var(--card-background-color);
          color: var(--secondary-text-color);
          font-family: inherit;
          font-size: 12px;
          padding: 5px 12px;
          cursor: pointer;
        }

        .chip:hover {
          color: var(--primary-text-color);
        }

        .chip.on {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }

        th,
        td {
          text-align: left;
          padding: 8px 16px;
          border-top: 1px solid var(--divider-color);
        }

        th {
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          color: var(--secondary-text-color);
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
        }

        th:hover {
          color: var(--primary-text-color);
        }

        td.num,
        th.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .star-cell {
          width: 32px;
          padding-inline-end: 0;
        }

        .star {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 0;
          color: var(--secondary-text-color);
        }

        .star.on {
          color: #f5c839;
        }

        tbody tr {
          cursor: pointer;
        }

        tbody tr:hover {
          background: var(--secondary-background-color);
        }

        tbody tr.ignored {
          opacity: 0.45;
        }

        .name {
          font-weight: 500;
        }

        .hex {
          margin-inline-start: 8px;
          font-size: 12px;
          color: var(--secondary-text-color);
          font-family: var(--code-font-family, monospace);
        }

        .tag {
          margin-inline-start: 6px;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 11px;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        .tag.mqtt,
        .tag.muted {
          background: var(--secondary-text-color);
        }

        .dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          margin-inline-start: 6px;
          background: var(--primary-color);
          vertical-align: middle;
        }

        .scrim {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
          padding: 16px;
        }

        .dialog {
          width: min(560px, 100%);
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          background: var(--card-background-color);
          border-radius: 12px;
          border: 1px solid var(--divider-color);
          overflow: hidden;
        }

        .dialog-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 14px 16px;
          font-size: 16px;
          font-weight: 500;
          border-bottom: 1px solid var(--divider-color);
        }

        .close {
          background: none;
          border: none;
          font-size: 16px;
          cursor: pointer;
          color: var(--secondary-text-color);
        }

        .dialog-body {
          overflow-y: auto;
          padding: 8px 0;
        }

        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 8px 16px 12px;
          border-bottom: 1px solid var(--divider-color);
        }

        .action {
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 12px;
          padding: 6px 10px;
          cursor: pointer;
        }

        .action:hover:not([disabled]) {
          background: var(--secondary-background-color);
        }

        .action[disabled] {
          opacity: 0.5;
          cursor: default;
        }

        .action.primary {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        .action.danger {
          color: var(--error-color, #db4437);
        }

        .status {
          padding: 6px 16px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }

        .status.ok {
          color: var(--success-color, #4caf50);
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

        .route {
          padding: 4px 16px 8px;
        }

        .route-node {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
        }

        .route-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--secondary-text-color);
          flex: none;
        }

        .route-dot.start,
        .route-dot.end {
          background: var(--primary-color);
        }

        .route-link {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-inline-start: 4px;
          min-height: 22px;
        }

        .route-line {
          width: 1px;
          align-self: stretch;
          background: var(--divider-color);
          margin-inline-start: 4px;
        }

        .route-snr {
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          color: var(--secondary-text-color);
          padding-inline-start: 8px;
        }

        .route-snr.good {
          color: #4caf50;
        }

        .route-snr.fair {
          color: #f5c839;
        }

        .route-snr.poor {
          color: #e57373;
        }

        .route-note {
          padding: 0 16px 8px;
          font-size: 12px;
          color: var(--secondary-text-color);
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
      `,
    ];
  }
}

if (!customElements.get("mesh-nodes-tab")) {
  customElements.define("mesh-nodes-tab", MeshNodesTab);
}
