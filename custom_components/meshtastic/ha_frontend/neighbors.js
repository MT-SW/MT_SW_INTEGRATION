/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Sąsiedzi — tabele NeighborInfo per węzeł.
 *
 * Dane pochodzą z atrybutu `neighbors` sensorów, wypełnianego przez
 * coordinator.py (EVENT_MESHTASTIC_API_NEIGHBOR_INFO), więc czytamy je
 * wprost z hass.states — bez dodatkowej komendy WS.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { layoutStyles, emptyStateStyles } from "./styles.js";
import { t } from "./i18n.js";

class MeshNeighborsTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
    };
  }

  _neighborNodes() {
    if (!this.hass || !this.hass.states) {
      return [];
    }
    return Object.values(this.hass.states)
      .filter((s) => s.entity_id.startsWith("sensor.") && Array.isArray(s.attributes.neighbors))
      .map((s) => ({
        entity_id: s.entity_id,
        name: s.attributes.friendly_name || s.entity_id,
        count: s.state,
        neighbors: s.attributes.neighbors,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _renderNode(node) {
    return html`
      <div class="card">
        <div class="card-header">
          <span class="node-name">${node.name}</span>
          <span class="node-count">${t(this.hass, "neighbors.count", { count: node.count })}</span>
        </div>
        ${node.neighbors.length === 0
          ? html`<div class="empty-state">${t(this.hass, "neighbors.none_in_frame")}</div>`
          : html`
              <table>
                <thead>
                  <tr>
                    <th>${t(this.hass, "neighbors.col.neighbor")}</th>
                    <th>${t(this.hass, "neighbors.col.id")}</th>
                    <th class="num">${t(this.hass, "neighbors.col.snr")}</th>
                    <th>${t(this.hass, "neighbors.col.last_heard")}</th>
                  </tr>
                </thead>
                <tbody>
                  ${node.neighbors.map(
                    (n) => html`
                      <tr>
                        <td>
                          <span class="short">${n.short_name}</span>
                          <span class="long">${n.long_name}</span>
                        </td>
                        <td><code>${n.id}</code></td>
                        <td class="num">${Number(n.snr ?? 0).toFixed(2)} dB</td>
                        <td>
                          ${n.last_heard
                            ? new Date(n.last_heard).toLocaleString(this.hass.language)
                            : t(this.hass, "common.unknown")}
                        </td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            `}
      </div>
    `;
  }

  render() {
    if (!this.hass) {
      return html``;
    }
    const nodes = this._neighborNodes();
    if (!nodes.length) {
      return html`<div class="tab-content">
        <div class="empty-state">${t(this.hass, "neighbors.empty")}</div>
      </div>`;
    }
    return html`
      <div class="tab-content">
        <div class="neighbor-grid">${nodes.map((node) => this._renderNode(node))}</div>
      </div>
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

        .neighbor-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
          gap: 16px;
        }

        .node-name {
          font-size: 16px;
          font-weight: 500;
        }

        .node-count {
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
          padding: 6px 16px;
          border-top: 1px solid var(--divider-color);
        }

        th {
          font-weight: 500;
          color: var(--secondary-text-color);
          font-size: 12px;
          text-transform: uppercase;
        }

        td.num,
        th.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .short {
          font-weight: 500;
        }

        .long {
          color: var(--secondary-text-color);
          margin-inline-start: 8px;
        }

        code {
          font-family: var(--code-font-family, monospace);
          color: var(--secondary-text-color);
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-neighbors-tab")) {
  customElements.define("mesh-neighbors-tab", MeshNeighborsTab);
}
