/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Sekcja "Historia pakietów" / "Historia zasobów" w oknie szczegółów węzła.
 *
 * Element pobiera dane sam, na żądanie: nodes.js podaje mu węzeł i rodzaj
 * widoku, a przy każdym nowym `request` (także ponownym kliknięciu tego samego
 * przycisku) dane są odświeżane. Liczenie procentów i wykresów siedzi w
 * stats-history.js.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { t } from "./i18n.js";
import "./chart.js";
import {
  PACKET_COLUMNS,
  RESOURCE_IDS,
  buildPacketRows,
  buildResourceCharts,
  buildResourceRows,
  formatKb,
  formatNumber,
  latestResources,
} from "./stats-history.js";

const MAX_TABLE_ROWS = 100;

class MeshNodeStats extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      entryId: { type: String },
      nodeId: { type: Number },
      /* { mode: "packets" | "resources" } — nowy obiekt = nowe pobranie */
      request: { type: Object },
      _data: { type: Object },
    };
  }

  constructor() {
    super();
    this.request = null;
    this._data = null;
    this._seq = 0;
  }

  updated(changed) {
    if (
      this.request &&
      this.entryId &&
      (changed.has("request") || changed.has("nodeId") || changed.has("entryId"))
    ) {
      this._load();
    }
  }

  async _history(kind) {
    try {
      const result = await this.hass.callWS({
        type: "meshtastic/node_history",
        entry_id: this.entryId,
        node_id: this.nodeId,
        kind,
      });
      return (result && result.points) || [];
    } catch (err) {
      console.error("MT_SW: nie udało się pobrać historii", kind, err);
      return [];
    }
  }

  async _load() {
    const seq = (this._seq += 1);
    const mode = this.request.mode;
    let data;
    if (mode === "packets") {
      data = { mode, stats: await this._history("local_stats") };
    } else {
      const [stats, extended] = await Promise.all([
        this._history("local_stats"),
        this._history("local_stats_extended"),
      ]);
      data = { mode, stats, extended };
    }
    // odpowiedź po późniejszym kliknięciu wygrywa z tą, która przyszła wolniej
    if (seq === this._seq) {
      this._data = data;
    }
  }

  _absoluteTime(ts) {
    return new Date(ts).toLocaleString(this.hass.language);
  }

  _row(labelKey, value) {
    return html`
      <div class="detail-row">
        <span class="detail-label">${t(this.hass, labelKey)}</span>
        <span class="detail-value">${value}</span>
      </div>
    `;
  }

  _renderPackets(data) {
    const title = html`<div class="detail-section">${t(this.hass, "nodes.action.packet_history")}</div>`;
    const rows = buildPacketRows(data.stats);
    if (!rows.length) {
      return html`${title}<div class="route-note">${t(this.hass, "nodes.packets.empty")}</div>`;
    }
    const lang = this.hass.language;
    return html`
      ${title}
      <div class="route-note">${t(this.hass, "nodes.packets.hint")}</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>${t(this.hass, "nodes.packets.time")}</th>
              ${PACKET_COLUMNS.map((col) => html`<th>${t(this.hass, col.labelKey)}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${rows.slice(0, MAX_TABLE_ROWS).map(
              (row) => html`
                <tr>
                  <td class="time">${this._absoluteTime(row.ts)}</td>
                  ${row.cells.map(
                    (cell) => html`
                      <td>
                        ${cell.value === null ? "—" : formatNumber(cell.value, lang, 0)}
                        ${cell.pct === null
                          ? ""
                          : html`<span class="pct">(${formatNumber(cell.pct, lang, 1)}%)</span>`}
                      </td>
                    `
                  )}
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderResources(data) {
    const title = html`<div class="detail-section">${t(this.hass, "nodes.action.resource_history")}</div>`;
    const rows = buildResourceRows(data);
    if (!rows.length) {
      return html`${title}<div class="route-note">${t(this.hass, "nodes.resources.empty")}</div>`;
    }

    const lang = this.hass.language;
    const latest = latestResources(rows);
    const summary = RESOURCE_IDS.map((res) => {
      const item = latest[res.id];
      if (!item) {
        return "";
      }
      const value =
        res.id === "cpu"
          ? `${formatNumber(item.value, lang, 0)}%`
          : `${formatKb(item.used, lang)} / ${formatKb(item.total, lang)} (${formatNumber(item.pct, lang, 1)}%)`;
      return this._row(res.labelKey, value);
    });
    const charts = buildResourceCharts(rows, (key) => t(this.hass, key));

    return html`
      ${title} ${this._row("nodes.resources.sampled", this._absoluteTime(rows[rows.length - 1].ts))}
      ${summary}
      ${charts.length
        ? charts.map(
            (chart) => html`
              <div class="chart-wrap">
                <mesh-line-chart
                  .points=${chart.points}
                  .language=${lang}
                  .unit=${chart.unit}
                  .height=${140}
                  .fit=${true}
                  .emptyLabel=${t(this.hass, "nodes.history.empty")}
                  .series=${chart.series}
                ></mesh-line-chart>
              </div>
            `
          )
        : html`<div class="route-note">${t(this.hass, "nodes.resources.need_more")}</div>`}
    `;
  }

  render() {
    if (!this.hass || !this.request || !this._data) {
      return html``;
    }
    return this._data.mode === "packets" ? this._renderPackets(this._data) : this._renderResources(this._data);
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

      .route-note {
        padding: 0 16px 8px;
        font-size: 12px;
        color: var(--secondary-text-color);
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
        margin-bottom: 12px;
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
      td.time {
        position: sticky;
        left: 0;
        text-align: start;
        background: var(--card-background-color);
      }

      th:first-child {
        z-index: 2;
      }

      .pct {
        color: var(--secondary-text-color);
        margin-inline-start: 2px;
      }
    `;
  }
}

if (!customElements.get("mesh-node-stats")) {
  customElements.define("mesh-node-stats", MeshNodeStats);
}