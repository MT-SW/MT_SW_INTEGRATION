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
import "./messages.js";
import "./nodes.js";
import "./map.js";
import "./settings.js";

const POLL_MS = 10000;
const TABS = ["radio", "messages", "nodes", "map", "settings"];

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
      _nodes: { type: Array },
      _messages: { type: Array },
      _timeseries: { type: Array },
      _selectedEntryId: { type: String },
      _selectedConversation: { type: String },
      _pending: { type: Object },
      _localConfig: { type: Object },
      _moduleConfig: { type: Object },
      _configError: { type: Boolean },
      _configSchema: { type: Object },
    };
  }

  constructor() {
    super();
    this._activeTab = tabFromPath();
    this._gateways = [];
    this._channels = {};
    this._channelsError = {};
    this._nodes = [];
    this._messages = [];
    this._timeseries = [];
    this._selectedEntryId = null;
    this._selectedConversation = null;
    this._pending = {};
    this._localConfig = null;
    this._moduleConfig = null;
    this._configError = false;
    this._configSchema = null;
    this._pollTimer = null;
    this._unsubscribe = null;
    this._subscribedEntryId = null;
    this._onLocationChanged = () => {
      this._activeTab = tabFromPath();
    };
    // Akcja na węźle zmienia stan po stronie radia, więc po niej dociągamy
    // świeże dane zamiast czekać na kolejny cykl odpytywania.
    this._onRefreshRequest = () => this._refresh();
    this._onConfigSaved = () => {
      // Radio mogło znormalizować zapisane wartości, więc czytamy je od nowa.
      this._configEntryId = null;
      this._refresh();
    };
    this._onOpenDm = (event) => {
      this._dmKey = `dm:${event.detail.nodeId}`;
      this._selectTab("messages");
      this.requestUpdate();
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("location-changed", this._onLocationChanged);
    this.addEventListener("mtsw-refresh", this._onRefreshRequest);
    this.addEventListener("mtsw-config-saved", this._onConfigSaved);
    this.addEventListener("mtsw-open-dm", this._onOpenDm);
    this._startPolling();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("location-changed", this._onLocationChanged);
    this.removeEventListener("mtsw-refresh", this._onRefreshRequest);
    this.removeEventListener("mtsw-config-saved", this._onConfigSaved);
    this.removeEventListener("mtsw-open-dm", this._onOpenDm);
    this._stopPolling();
    this._unsubscribeMessages();
  }

  updated(changed) {
    // hass wjeżdża do panelu już po pierwszym renderze, więc pierwsze
    // pobranie danych odpalamy dopiero tutaj.
    if (changed.has("hass") && !changed.get("hass") && this.hass) {
      this._refresh();
    }
  }

  /* Wpis, którego dotyczą wiadomości, węzły, mapa i wykresy.
     Wybór użytkownika wygrywa; gdy wybrana bramka zniknie, wracamy do pierwszej. */
  get _primaryEntryId() {
    if (!this._gateways.length) {
      return null;
    }
    const chosen = this._gateways.find((g) => g.entry_id === this._selectedEntryId);
    return chosen ? chosen.entry_id : this._gateways[0].entry_id;
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

  _unsubscribeMessages() {
    if (this._unsubscribe) {
      try {
        this._unsubscribe();
      } catch (err) {
        console.debug("MT_SW: odsubskrybowanie nie powiodło się", err);
      }
      this._unsubscribe = null;
      this._subscribedEntryId = null;
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

    const entryId = this._primaryEntryId;
    if (!entryId) {
      return;
    }
    await Promise.all([
      this._refreshNodes(entryId),
      this._refreshTimeseries(entryId),
      this._ensureSubscription(entryId),
      this._refreshConfig(entryId),
    ]);
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

  async _refreshNodes(entryId) {
    try {
      const result = await this.hass.callWS({ type: "meshtastic/nodes", entry_id: entryId });
      this._nodes = result.nodes || [];
    } catch (err) {
      console.warn("MT_SW: nie udało się pobrać węzłów", err);
    }
  }

  async _refreshTimeseries(entryId) {
    try {
      const result = await this.hass.callWS({ type: "meshtastic/timeseries", entry_id: entryId });
      this._timeseries = result.points || [];
    } catch (err) {
      console.warn("MT_SW: nie udało się pobrać szeregu czasowego", err);
    }
  }

  /* Konfiguracja zmienia się rzadko i każdy odczyt to round trip do radia,
     więc pobieramy ją raz na wpis, a nie w cyklu odpytywania. */
  async _refreshConfig(entryId) {
    if (this._configEntryId === entryId) {
      return;
    }
    try {
      const result = await this.hass.callWS({ type: "meshtastic/config", entry_id: entryId });
      this._localConfig = result.local_config || {};
      this._moduleConfig = result.module_config || {};
      this._configSchema = result.schema || null;
      this._configError = false;
      this._configEntryId = entryId;
    } catch (err) {
      console.warn("MT_SW: nie udało się pobrać konfiguracji", err);
      this._configError = true;
    }
  }

  /* Historię pobieramy raz, potem utrzymuje ją subskrypcja — odpytywanie
     co 10 s przewijałoby czat pod palcami przy każdym odświeżeniu. */
  async _ensureSubscription(entryId) {
    if (this._subscribedEntryId === entryId && this._unsubscribe) {
      return;
    }
    this._unsubscribeMessages();

    try {
      const result = await this.hass.callWS({
        type: "meshtastic/messages",
        entry_id: entryId,
      });
      this._messages = result.messages || [];
    } catch (err) {
      console.warn("MT_SW: nie udało się pobrać historii wiadomości", err);
      this._messages = [];
      return;
    }

    try {
      this._unsubscribe = await this.hass.connection.subscribeMessage(
        (event) => this._onStoreEvent(event),
        { type: "meshtastic/subscribe_messages", entry_id: entryId }
      );
      this._subscribedEntryId = entryId;
    } catch (err) {
      console.warn("MT_SW: subskrypcja wiadomości nie powiodła się", err);
    }
  }

  _onStoreEvent(event) {
    if (!event) {
      return;
    }
    if (event.kind === "cleared") {
      this._messages = [];
      return;
    }
    const incoming = event.message;
    if (!incoming) {
      return;
    }
    if (event.kind === "ack") {
      this._messages = this._messages.map((m) =>
        m.id === incoming.id && m.direction === "out" ? { ...m, ...incoming } : m
      );
      return;
    }
    this._messages = [...this._messages, incoming];
  }

  /* Mostek do przeniesionej zakładki ustawień.
   *
   * Jej komponenty wołają polecenia pod nazwami z projektu źródłowego
   * (meshtastic_ui/...). Zamiast przepisywać kilka tysięcy linii ich kodu,
   * tłumaczymy nazwy i kształt odpowiedzi tutaj — pliki settings.js
   * i modules.js zostają nietknięte, więc kolejne ich wydania da się
   * podmienić jeden do jednego.
   */
  async _settingsWs(type, data = {}) {
    const entryId = this._primaryEntryId;
    if (!entryId || !this.hass) {
      return null;
    }
    const name = String(type).replace(/^meshtastic_ui\//, "");

    try {
      switch (name) {
        case "get_config": {
          const result = await this.hass.callWS({ type: "meshtastic/config", entry_id: entryId });
          this._localConfig = result.local_config || {};
          this._moduleConfig = result.module_config || {};
          return result;
        }
        case "set_config": {
          // Grupę rozpoznajemy po tym, w której części konfiguracji leży
          // sekcja — ich komponenty przekazują samą nazwę sekcji.
          const group = Object.prototype.hasOwnProperty.call(this._localConfig || {}, data.section)
            ? "local"
            : "module";
          await this.hass.callWS({
            type: "meshtastic/set_config",
            entry_id: entryId,
            group,
            section: data.section,
            values: data.values || {},
          });
          this._configEntryId = null;
          return { success: true };
        }
        case "set_owner":
          await this.hass.callWS({
            type: "meshtastic/set_owner",
            entry_id: entryId,
            long_name: data.long_name ?? data.longName ?? "",
            short_name: data.short_name ?? data.shortName ?? "",
            is_licensed: Boolean(data.is_licensed ?? data.isLicensed),
          });
          return { success: true };
        case "set_channel":
          await this.hass.callWS({
            type: "meshtastic/set_channel",
            entry_id: entryId,
            channel: data.channel || data,
          });
          return { success: true };
        case "device_action":
          await this.hass.callWS({
            type: "meshtastic/device_action",
            entry_id: entryId,
            action: data.action,
          });
          return { success: true };
        case "storage_stats": {
          // Nasz magazyn trzyma historię wiadomości i telemetrię bramki.
          const messages = await this.hass.callWS({
            type: "meshtastic/messages",
            entry_id: entryId,
            limit: 2000,
          });
          const points = await this.hass.callWS({ type: "meshtastic/timeseries", entry_id: entryId });
          return {
            success: true,
            messages: (messages.messages || []).length,
            nodes: (this._nodes || []).length,
            telemetry: (points.points || []).length,
          };
        }
        default:
          console.warn("MT_SW: nieobsługiwane polecenie ustawień", name);
          return null;
      }
    } catch (err) {
      console.error("MT_SW: polecenie ustawień nie powiodło się", name, err);
      return null;
    }
  }

  /* ── Obsługa zdarzeń przeniesionych zakładek ──────────────────────────
     Ich komponenty emitują zdarzenia w swoim własnym słownictwie
     ("trace-route", "unfavorite", klucze rozmów "ch_0" / "dm_!hex").
     Tłumaczymy je tutaj na nasze komendy, żeby ui-views.js pozostał
     nietknięty i dał się podmieniać na nowsze wydania. */

  _conversationId(conversation) {
    if (!conversation) {
      return null;
    }
    return typeof conversation === "string" ? conversation : conversation.id || null;
  }

  /* "ch_0" -> { channel_index: 0 }, "dm_!7feb2bc5" -> { node_id: … } */
  _targetFromConversation(id) {
    if (!id) {
      return null;
    }
    if (id.startsWith("ch_")) {
      return { channel_index: Number(id.slice(3)) };
    }
    if (id.startsWith("dm_")) {
      const node = numId(id.slice(3));
      return node === null ? null : { node_id: node };
    }
    return null;
  }

  /* Klucz rozmowy w postaci używanej przez nasz magazyn. */
  _storeKeyFromConversation(id) {
    if (!id) {
      return null;
    }
    if (id.startsWith("ch_")) {
      return `ch:${id.slice(3)}`;
    }
    if (id.startsWith("dm_")) {
      const node = numId(id.slice(3));
      return node === null ? null : `dm:${node}`;
    }
    return null;
  }

  _onSelectConversation(event) {
    this._selectedConversation = this._conversationId(event.detail.conversation);
  }

  async _onSendMessage(event) {
    const entryId = this._primaryEntryId;
    const id = this._conversationId(event.detail.conversation) || this._selectedConversation;
    const target = this._targetFromConversation(id);
    if (!entryId || !target || !event.detail.text) {
      return;
    }
    try {
      await this.hass.callWS({
        type: "meshtastic/send_message",
        entry_id: entryId,
        text: event.detail.text,
        ...target,
      });
    } catch (err) {
      console.error("MT_SW: wysyłka nie powiodła się", err);
    }
  }

  async _onClearConversation(event) {
    const entryId = this._primaryEntryId;
    const key = this._storeKeyFromConversation(this._conversationId(event.detail.conversation));
    if (!entryId || !key) {
      return;
    }
    try {
      await this.hass.callWS({
        type: "meshtastic/delete_conversation",
        entry_id: entryId,
        key,
      });
    } catch (err) {
      console.error("MT_SW: nie udało się usunąć rozmowy", err);
    }
  }

  async _onNodeAction(event) {
    const entryId = this._primaryEntryId;
    const { action } = event.detail;
    const nodeId = numId(event.detail.nodeId);
    if (!entryId || nodeId === null) {
      return;
    }

    // Akcje czysto nawigacyjne nie jadą do radia.
    if (action === "send-message") {
      this._selectedConversation = `dm_${hexId(nodeId)}`;
      this._selectTab("messages");
      return;
    }
    if (action === "view-node") {
      this._selectTab("nodes");
      return;
    }

    const calls = {
      favorite: { type: "meshtastic/set_favorite", favorite: true },
      unfavorite: { type: "meshtastic/set_favorite", favorite: false },
      ignore: { type: "meshtastic/set_ignored", ignored: true },
      unignore: { type: "meshtastic/set_ignored", ignored: false },
      remove: { type: "meshtastic/remove_node" },
      "request-position": { type: "meshtastic/request_position", pending: "pendingPosition" },
      "request-nodeinfo": { type: "meshtastic/request_neighbors", pending: "pendingNodeinfo" },
      "trace-route": { type: "meshtastic/traceroute", pending: "pendingTraceroute" },
    };
    const call = calls[action];
    if (!call) {
      console.warn("MT_SW: nieobsługiwana akcja węzła", action);
      return;
    }

    const { type, pending, ...payload } = call;
    if (pending) {
      this._pending = { ...this._pending, [pending]: hexId(nodeId) };
    }
    try {
      await this.hass.callWS({ type, entry_id: entryId, node_id: nodeId, ...payload });
      await this._refresh();
    } catch (err) {
      console.error("MT_SW: akcja węzła nie powiodła się", action, err);
    } finally {
      if (pending) {
        const { [pending]: _done, ...rest } = this._pending;
        this._pending = rest;
      }
    }
  }

  _onWaypointCreate() {
    // Punkty trasy wymagają dopisania obsługi po stronie api.py — na razie
    // nie udajemy, że działają.
    console.warn("MT_SW: tworzenie punktów trasy nie jest jeszcze obsługiwane");
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
    const entryId = this._primaryEntryId;

    switch (this._activeTab) {
      case "messages":
        return html`<mesh-messages-tab
          .hass=${this.hass}
          .entryId=${entryId}
          .messages=${this._messages}
          .nodes=${this._nodes}
          .channels=${entryId ? this._channels[entryId] || [] : []}
          .selectKey=${this._dmKey || null}
        ></mesh-messages-tab>`;
      case "nodes":
        return html`<mesh-nodes-tab
          .hass=${this.hass}
          .entryId=${entryId}
          .nodes=${this._nodes}
        ></mesh-nodes-tab>`;
      case "map":
        return html`<mesh-map-tab .hass=${this.hass} .nodes=${this._nodes}></mesh-map-tab>`;
      case "settings":
        return html`<mesh-settings-tab
          .hass=${this.hass}
          .wsCommand=${(type, data) => this._settingsWs(type, data)}
        ></mesh-settings-tab>`;
      case "radio":
      default:
        return html`<mtsw-radio-tab
          .hass=${this.hass}
          .gateways=${this._gateways}
          .channels=${this._channels}
          .channelsError=${this._channelsError}
          .timeseries=${this._timeseries}
        ></mtsw-radio-tab>`;
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
        ${this._gateways.length > 1
          ? html`<select
              slot="actionItems"
              class="gateway-select"
              @change=${(e) => {
                this._selectedEntryId = e.target.value;
                this._refresh();
              }}
            >
              ${this._gateways.map(
                (gateway) => html`<option
                  value=${gateway.entry_id}
                  ?selected=${gateway.entry_id === this._primaryEntryId}
                >
                  ${gateway.long_name || gateway.title}
                </option>`
              )}
            </select>`
          : ""}
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
        display: flex;
        flex-direction: column;
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

      .gateway-select {
        margin-inline-end: 8px;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color);
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 13px;
      }
    `;
  }
}

if (!customElements.get("meshtastic-frontend")) {
  customElements.define("meshtastic-frontend", MeshtasticPanel);
}
