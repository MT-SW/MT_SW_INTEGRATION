/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Radio — status bramki, uruchamianie klienta WWW i tabela kanałów.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { layoutStyles, emptyStateStyles, badgeStyles, channelStyles } from "./styles.js";
import { t, formatUptime } from "./i18n.js";
import "./chart.js";

class MeshRadioTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      gateways: { type: Array },
      channels: { type: Object },
      channelsError: { type: Object },
      timeseries: { type: Array },
    };
  }

  constructor() {
    super();
    this.gateways = [];
    this.channels = {};
    this.channelsError = {};
    this.timeseries = [];
  }

  _value(raw, suffix) {
    if (raw === null || raw === undefined) {
      return t(this.hass, "common.unknown");
    }
    return suffix ? `${raw}${suffix}` : String(raw);
  }

  /* "412 / 1024 kB" albo null, gdy bramka nie zgłasza tych liczb. */
  _formatBytes(value, total) {
    if (value === null || value === undefined) {
      return null;
    }
    const kb = (n) => Math.round(n / 1024);
    return total ? `${kb(value)} / ${kb(total)} kB` : `${kb(value)} kB`;
  }

  _renderStat(labelKey, raw, suffix) {
    return html`
      <div class="stat">
        <span class="stat-label">${t(this.hass, labelKey)}</span>
        <span class="stat-value">${this._value(raw, suffix)}</span>
      </div>
    `;
  }

  /* Wyrzutnia klienta WWW.
   *
   * Adres trasy to /meshtastic/web/<entity_id bez domeny>, więc źródłem prawdy
   * są encje bramek z rejestru, nie payload WS. Renderujemy je jako osobny blok
   * zamiast dopasowywać do kart bramek — dopasowanie po nazwie byłoby kruche.
   */
  /* Encja bramki nazywa się "Status połączenia", więc jej friendly_name to
     "<urządzenie> Status połączenia". Na wyrzutni klienta WWW interesuje nas
     samo urządzenie — status i tak widać na karcie bramki — więc bierzemy
     nazwę z rejestru urządzeń, a przy jego braku obcinamy końcówkę. */
  _gatewayDisplayName(entity, state) {
    const device = entity.device_id && this.hass.devices ? this.hass.devices[entity.device_id] : null;
    const deviceName = device && (device.name_by_user || device.name);
    if (deviceName) {
      return deviceName;
    }
    const friendly = (state && state.attributes.friendly_name) || entity.entity_id;
    return friendly.replace(/\s*(Status połączenia|Connection status)\s*$/i, "").trim() || friendly;
  }

  _gatewayEntities() {
    if (!this.hass || !this.hass.entities) {
      return [];
    }
    return Object.values(this.hass.entities)
      .filter((e) => e.platform === "meshtastic" && e.entity_id.startsWith("meshtastic."))
      .map((e) => {
        const state = this.hass.states[e.entity_id];
        return {
          entity_id: e.entity_id,
          gateway_id: e.entity_id.replace("meshtastic.", ""),
          name: this._gatewayDisplayName(e, state),
          device_class: state && state.attributes.device_class,
          unavailable: !state || state.state === "unavailable",
        };
      })
      .filter((e) => e.device_class === "gateway")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _renderWebClient() {
    // Panel działa też bez klienta webowego — wtedy nie ma dokąd prowadzić.
    if (!(this.gateways || []).some((gateway) => gateway.web_client)) {
      return html``;
    }
    const entities = this._gatewayEntities();
    if (!entities.length) {
      return html``;
    }
    return html`
      <div class="card">
        <div class="card-header">${t(this.hass, "radio.web_client")}</div>
        <div class="web-client-grid">
          ${entities.map(
            (gateway) => html`
              <div class="web-client-item">
                <img alt="" src="/meshtastic/web/icon.svg" />
                <span class="web-client-name">${gateway.name}</span>
                ${gateway.unavailable
                  ? html`<ha-button unelevated disabled>
                      ${t(this.hass, "radio.web_client.unavailable")}
                    </ha-button>`
                  : html`<a href="/meshtastic/web/${gateway.gateway_id}" target="_blank" rel="noopener">
                      <ha-button unelevated>${t(this.hass, "radio.web_client.open")}</ha-button>
                    </a>`}
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  /* Rola kanału przychodzi z radia jako nazwa enuma (PRIMARY, SECONDARY). */
  _roleLabel(role) {
    const key = `channel.role.${role}`;
    const label = t(this.hass, key);
    return label === key ? role : label;
  }

  _renderChannels(gateway) {
    const channels = this.channels[gateway.entry_id];
    const error = this.channelsError[gateway.entry_id];

    if (error) {
      return html`<div class="empty-state">${t(this.hass, "radio.channels.error")}</div>`;
    }
    if (channels === undefined) {
      return html`<div class="empty-state">${t(this.hass, "common.loading")}</div>`;
    }
    const usable = channels.filter((c) => c.role && c.role !== "DISABLED");
    if (!usable.length) {
      return html`<div class="empty-state">${t(this.hass, "radio.channels.empty")}</div>`;
    }

    return html`
      <table class="channel-table">
        <thead>
          <tr>
            <th class="num">${t(this.hass, "radio.channels.index")}</th>
            <th>${t(this.hass, "radio.channels.name")}</th>
            <th>${t(this.hass, "radio.channels.role")}</th>
            <th>${t(this.hass, "radio.channels.psk")}</th>
            <th>${t(this.hass, "radio.channels.uplink")}</th>
            <th>${t(this.hass, "radio.channels.downlink")}</th>
          </tr>
        </thead>
        <tbody>
          ${usable.map(
            (channel) => html`
              <tr>
                <td class="num">${channel.index}</td>
                <td>${channel.name || html`<span class="muted">${t(this.hass, "radio.channels.unnamed")}</span>`}</td>
                <td>${this._roleLabel(channel.role)}</td>
                <td>
                  ${channel.has_psk
                    ? t(this.hass, "radio.channels.encrypted")
                    : t(this.hass, "radio.channels.open")}
                </td>
                <td>${channel.uplink_enabled ? t(this.hass, "common.yes") : t(this.hass, "common.no")}</td>
                <td>${channel.downlink_enabled ? t(this.hass, "common.yes") : t(this.hass, "common.no")}</td>
              </tr>
            `
          )}
        </tbody>
      </table>
    `;
  }

  _renderCharts() {
    const points = this.timeseries || [];
    const empty = t(this.hass, "radio.chart.empty");

    return html`
      <div class="section-title">${t(this.hass, "radio.chart.airtime")}</div>
      <div class="chart-wrap">
        <mesh-line-chart
          .points=${points}
          .language=${this.hass.language}
          unit=" %"
          .emptyLabel=${empty}
          .series=${[
            { key: "channel_utilization", label: t(this.hass, "radio.chart.chutil"), color: "#F5C839" },
            { key: "air_util_tx", label: t(this.hass, "radio.chart.airutil"), color: "#4FC3F7" },
          ]}
        ></mesh-line-chart>
      </div>

      <div class="section-title">${t(this.hass, "radio.chart.packets")}</div>
      <div class="chart-wrap">
        <mesh-line-chart
          derivative
          .points=${points}
          .language=${this.hass.language}
          .emptyLabel=${empty}
          .series=${[
            { key: "packets_tx", label: t(this.hass, "radio.chart.tx"), color: "#81C784" },
            { key: "packets_rx", label: t(this.hass, "radio.chart.rx"), color: "#9575CD" },
            { key: "packets_rx_bad", label: t(this.hass, "radio.chart.rx_bad"), color: "#E57373" },
          ]}
        ></mesh-line-chart>
      </div>
    `;
  }

  _renderGateway(gateway) {
    const title = gateway.long_name || gateway.title || gateway.node_hex || "";
    return html`
      <div class="card">
        <div class="card-header">
          <span class="gateway-title">
            ${title}
            ${gateway.short_name ? html`<span class="muted">${gateway.short_name}</span>` : ""}
          </span>
          <span class="badge ${gateway.available ? "badge-ok" : "badge-error"}">
            ${gateway.available
              ? t(this.hass, "radio.status.available")
              : t(this.hass, "radio.status.unavailable")}
          </span>
        </div>

                ${gateway.stats_saved_at
          ? html`<div class="stale-note">
              ${t(this.hass, "radio.stats_saved_at", {
                time: new Date(gateway.stats_saved_at).toLocaleString(this.hass.language),
              })}
            </div>`
          : ""}

        <div class="section-title">${t(this.hass, "radio.section.device")}</div>
        <div class="stat-grid">
          ${this._renderStat("radio.hw_model", gateway.hw_model)}
          ${this._renderStat("radio.role", gateway.role)}
          ${this._renderStat("radio.firmware", gateway.firmware_version)}
          ${this._renderStat("radio.node_id", gateway.node_hex)}
          <div class="stat">
            <span class="stat-label">${t(this.hass, "radio.uptime")}</span>
            <span class="stat-value">${formatUptime(this.hass, gateway.uptime_seconds)}</span>
          </div>
        </div>

        <div class="section-title">${t(this.hass, "radio.section.power")}</div>
        <div class="stat-grid">
          ${this._renderStat("radio.battery", gateway.battery_level, " %")}
          ${this._renderStat("radio.voltage", gateway.voltage, " V")}
          ${this._renderStat("radio.channel_utilization", gateway.channel_utilization, " %")}
          ${this._renderStat("radio.air_util_tx", gateway.air_util_tx, " %")}
          ${this._renderStat("radio.noise_floor", gateway.noise_floor, " dB")}
        </div>

        <div class="section-title">${t(this.hass, "radio.section.packets")}</div>
        <div class="stat-grid">
          ${this._renderStat("radio.packets_tx", gateway.packets_tx)}
          ${this._renderStat("radio.packets_rx", gateway.packets_rx)}
          ${this._renderStat("radio.packets_rx_bad", gateway.packets_rx_bad)}
          ${this._renderStat("radio.packets_tx_relay", gateway.packets_tx_relay)}
          ${this._renderStat("radio.packets_tx_dropped", gateway.packets_tx_dropped)}
          ${this._renderStat("radio.packets_rx_dupe", gateway.packets_rx_dupe)}
          ${this._renderStat("radio.packets_tx_relay_canceled", gateway.packets_tx_relay_canceled)}
        </div>

        <div class="section-title">${t(this.hass, "radio.section.resources")}</div>
        <div class="stat-grid">
          ${this._renderStat("radio.cpu_usage", gateway.cpu_usage, " %")}
          ${this._renderStat("radio.heap", this._formatBytes(gateway.heap_free, gateway.heap_total))}
          ${this._renderStat("radio.flash", this._formatBytes(gateway.flash_used, gateway.flash_total))}
          ${this._renderStat("radio.psram", this._formatBytes(gateway.psram_free, gateway.psram_total))}
        </div>

        <div class="section-title">${t(this.hass, "radio.section.mesh")}</div>
        <div class="stat-grid">
          ${this._renderStat("radio.nodes_online", gateway.nodes_online)}
          ${this._renderStat("radio.nodes_total", gateway.nodes_total)}
          ${this._renderStat("radio.tracked_nodes", gateway.tracked_nodes)}
        </div>

        ${this._renderCharts()}

        <div class="section-title">${t(this.hass, "radio.section.channels")}</div>
        ${this._renderChannels(gateway)}
      </div>
    `;
  }

  render() {
    if (!this.hass) {
      return html``;
    }
    if (!this.gateways || !this.gateways.length) {
      return html`<div class="tab-content">
        <div class="empty-state">${t(this.hass, "radio.no_gateways")}</div>
      </div>`;
    }
    return html`
      <div class="tab-content">
        ${this.gateways.map((gateway) => this._renderGateway(gateway))} ${this._renderWebClient()}
      </div>
    `;
  }

  static get styles() {
    return [
      layoutStyles,
      emptyStateStyles,
      badgeStyles,
      channelStyles,
      css`
        .tab-content {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 16px;
        }

        .gateway-title {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .muted {
          color: var(--secondary-text-color);
          font-weight: 400;
          font-size: 14px;
        }

        .stale-note {
          padding: 0 16px 8px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }

        .section-title {
          padding: 12px 16px 4px;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--secondary-text-color);
          border-top: 1px solid var(--divider-color);
        }

        .stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 8px 16px;
          padding: 4px 16px 12px;
        }

        .stat {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .stat-label {
          font-size: 12px;
          color: var(--secondary-text-color);
        }

        .stat-value {
          font-size: 16px;
          font-variant-numeric: tabular-nums;
        }

        .channel-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }

        .channel-table th,
        .channel-table td {
          text-align: left;
          padding: 6px 16px;
          border-top: 1px solid var(--divider-color);
        }

        .channel-table th {
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          color: var(--secondary-text-color);
        }

        .channel-table td.num,
        .channel-table th.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .web-client-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 8px;
          padding: 12px 16px 16px;
        }

        .web-client-item {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .web-client-item img {
          width: 32px;
          height: 32px;
        }

        .web-client-name {
          flex: 1;
          font-size: 14px;
        }

        .chart-wrap {
          padding: 8px 16px 16px;
        }

        a {
          text-decoration: none;
        }
      `,
    ];
  }
}

if (!customElements.get("mtsw-radio-tab")) {
  customElements.define("mtsw-radio-tab", MeshRadioTab);
}
