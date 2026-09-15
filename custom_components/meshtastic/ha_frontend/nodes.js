/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Węzły — sortowalna tabela z filtrem i dialogiem szczegółów.
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

class MeshNodesTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      nodes: { type: Array },
      _filter: { type: String },
      _sortKey: { type: String },
      _sortAsc: { type: Boolean },
      _detail: { type: Object },
    };
  }

  constructor() {
    super();
    this.nodes = [];
    this._filter = "";
    this._sortKey = "last_heard";
    this._sortAsc = false;
    this._detail = null;
  }

  _displayName(node) {
    return node.long_name || node.short_name || node.node_hex || String(node.node_id);
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
    let list = this.nodes || [];

    if (needle) {
      list = list.filter((node) => {
        const haystack = [node.long_name, node.short_name, node.node_hex, node.role]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      });
    }

    const direction = this._sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
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

  _renderRow(node) {
    return html`
      <tr @click=${() => (this._detail = node)}>
        <td>
          <span class="name">${this._displayName(node)}</span>
          ${node.is_gateway ? html`<span class="tag">${t(this.hass, "nodes.gateway")}</span>` : ""}
          ${node.via_mqtt ? html`<span class="tag mqtt">MQTT</span>` : ""}
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

  _renderDetail() {
    const node = this._detail;
    if (!node) {
      return html``;
    }

    return html`
      <div class="scrim" @click=${() => (this._detail = null)}>
        <div class="dialog" @click=${(e) => e.stopPropagation()}>
          <div class="dialog-header">
            <span>${this._displayName(node)}</span>
            <button class="close" @click=${() => (this._detail = null)}>✕</button>
          </div>
          <div class="dialog-body">
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
            ${node.latitude !== null && node.latitude !== undefined
              ? this._detailRow(
                  "nodes.position",
                  `${node.latitude.toFixed(5)}, ${node.longitude.toFixed(5)}` +
                    (node.altitude !== null && node.altitude !== undefined ? ` (${node.altitude} m)` : "")
                )
              : ""}

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

  _nameOf(nodeId) {
    const node = (this.nodes || []).find((n) => n.node_id === nodeId);
    if (node) {
      return this._displayName(node);
    }
    return `!${(nodeId >>> 0).toString(16).padStart(8, "0")}`;
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

        ${nodes.length === 0
          ? html`<div class="empty-state">${t(this.hass, "nodes.empty")}</div>`
          : html`
              <div class="card">
                <table>
                  <thead>
                    <tr>
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
          margin-bottom: 12px;
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

        tbody tr {
          cursor: pointer;
        }

        tbody tr:hover {
          background: var(--secondary-background-color);
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

        .tag.mqtt {
          background: var(--secondary-text-color);
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
          width: min(520px, 100%);
          max-height: 80vh;
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
