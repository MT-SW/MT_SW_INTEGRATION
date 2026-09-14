/*
 * SPDX-FileCopyrightText: 2024-2025 Pascal Brogle @broglep
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Powłoka panelu MT_SW_INTEGRATION — pasek zakładek, router po URL
 * i pobieranie danych przez WebSocket API integracji.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { t } from "./i18n.js";

import "./views.js";
import "./neighbors.js";

const POLL_MS = 10000;
const TABS = ["radio", "neighbors"];

function tabFromPath() {
  const parts = location.pathname.replace(/\/+$/, "").split("/");
  const tab = parts[parts.length - 1];
  return TABS.includes(tab) ? tab : TABS[0];
}

class MeshtasticPanel extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      narrow: { type: Boolean },
      route: { type: Object },
      panel: { type: Object },
      _activeTab: { type: String },
      _gateways: { type: Array },
      _channels: { type: Object },
      _channelsError: { type: Object },
    };
  }

  constructor() {
    super();
    this._activeTab = tabFromPath();
    this._gateways = [];
    this._channels = {};
    this._channelsError = {};
    this._pollTimer = null;
    this._onLocationChanged = () => {
      this._activeTab = tabFromPath();
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("location-changed", this._onLocationChanged);
    this._startPolling();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("location-changed", this._onLocationChanged);
    this._stopPolling();
  }

  updated(changed) {
    // hass wjeżdża do panelu już po pierwszym renderze, więc pierwsze
    // pobranie danych odpalamy dopiero tutaj.
    if (changed.has("hass") && !changed.get("hass") && this.hass) {
      this._refresh();
    }
  }

  _startPolling() {
    this._stopPolling();
    this._pollTimer = setInterval(() => this._refresh(), POLL_MS);
  }

  _stopPolling() {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _refresh() {
    if (!this.hass) {
      return;
    }
    try {
      const result = await this.hass.callWS({ type: "meshtastic/gateways" });
      this._gateways = result.gateways || [];
    } catch (err) {
      console.error("MT_SW: nie udało się pobrać bramek", err);
      this._gateways = [];
      return;
    }
    await Promise.all(this._gateways.map((gateway) => this._refreshChannels(gateway.entry_id)));
  }

  async _refreshChannels(entryId) {
    try {
      const result = await this.hass.callWS({ type: "meshtastic/channels", entry_id: entryId });
      this._channels = { ...this._channels, [entryId]: result.channels || [] };
      const { [entryId]: _dropped, ...rest } = this._channelsError;
      this._channelsError = rest;
    } catch (err) {
      console.warn("MT_SW: nie udało się pobrać kanałów", entryId, err);
      this._channelsError = { ...this._channelsError, [entryId]: true };
    }
  }

  _selectTab(tab) {
    if (tab === this._activeTab) {
      return;
    }
    this._activeTab = tab;
    const base = `/${this.panel && this.panel.url_path ? this.panel.url_path : "meshtastic"}`;
    history.pushState(null, "", `${base}/${tab}`);
    window.dispatchEvent(new CustomEvent("location-changed"));
  }

  _renderTab() {
    switch (this._activeTab) {
      case "neighbors":
        return html`<mesh-neighbors-tab .hass=${this.hass}></mesh-neighbors-tab>`;
      case "radio":
      default:
        return html`<mesh-radio-tab
          .hass=${this.hass}
          .gateways=${this._gateways}
          .channels=${this._channels}
          .channelsError=${this._channelsError}
        ></mesh-radio-tab>`;
    }
  }

  render() {
    if (!this.hass) {
      return html``;
    }
    return html`
      <ha-top-app-bar-fixed>
        <ha-menu-button slot="navigationIcon" .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>
        <div slot="title">${t(this.hass, "panel.title")}</div>
        <ha-icon-button
          slot="actionItems"
          .label=${t(this.hass, "common.refresh")}
          @click=${() => this._refresh()}
        >
          <ha-icon icon="mdi:refresh"></ha-icon>
        </ha-icon-button>

        <div class="tab-bar">
          ${TABS.map(
            (tab) => html`
              <button
                class="tab ${tab === this._activeTab ? "active" : ""}"
                @click=${() => this._selectTab(tab)}
              >
                ${t(this.hass, `tab.${tab}`)}
              </button>
            `
          )}
        </div>

        ${this._renderTab()}
      </ha-top-app-bar-fixed>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
        height: 100%;
        background: var(--primary-background-color);
        color: var(--primary-text-color);
      }

      .tab-bar {
        display: flex;
        gap: 4px;
        padding: 0 16px;
        border-bottom: 1px solid var(--divider-color);
        background: var(--card-background-color);
        overflow-x: auto;
      }

      .tab {
        appearance: none;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 14px 16px;
        font-family: inherit;
        font-size: 14px;
        font-weight: 500;
        color: var(--secondary-text-color);
        cursor: pointer;
        white-space: nowrap;
      }

      .tab:hover {
        color: var(--primary-text-color);
      }

      .tab.active {
        color: var(--primary-color);
        border-bottom-color: var(--primary-color);
      }
    `;
  }
}

if (!customElements.get("meshtastic-frontend")) {
  customElements.define("meshtastic-frontend", MeshtasticPanel);
}
