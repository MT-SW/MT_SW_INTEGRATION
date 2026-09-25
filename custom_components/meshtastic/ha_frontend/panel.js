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

/* Nazwy akcji urządzenia z przeniesionego panelu ustawień -> nazwy w naszym
   backendzie (websocket_api.ws_device_action). */
/* sekcje zapisywane bez restartu radia — po pozostałych integracja restartuje radio,
   żeby zmiana na pewno weszła (patrz _REBOOT_AFTER_CONFIG w interface.py) */
const SECTIONS_WITHOUT_REBOOT = new Set(["device_ui", "statusmessage", "mesh_beacon", "traffic_management"]);

const DEVICE_ACTIONS = {
  reset_nodedb: "nodedb_reset",
  factory_reset_config: "factory_reset",
  factory_reset_device: "factory_reset_device",
  reboot_ota: "reboot_ota",
};
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
      _linkUp: { type: Boolean },
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
    // Lista węzłów na żywo: migawka + zmiany z meshtastic/subscribe_nodes
    this._nodeMap = new Map();
    this._unsubscribeNodes = null;
    this._nodeSubEntryId = null;
    this._nodeSubSession = null;
    this._linkUp = null;
    this._onNodePatch = (event) => this._applyNodePatch(event.detail || {});
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
    this.addEventListener("mtsw-node-patch", this._onNodePatch);
    this._startPolling();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("location-changed", this._onLocationChanged);
    this.removeEventListener("mtsw-refresh", this._onRefreshRequest);
    this.removeEventListener("mtsw-config-saved", this._onConfigSaved);
    this.removeEventListener("mtsw-open-dm", this._onOpenDm);
    this.removeEventListener("mtsw-node-patch", this._onNodePatch);
    this._stopPolling();
    this._unsubscribeMessages();
    this._unsubscribeNodesNow();
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
      this._ensureNodeSubscription(entryId),
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

  /* Zapasowe jednorazowe pobranie listy — używane tylko, gdy subskrypcja
     na żywo się nie uda. */
  async _refreshNodes(entryId) {
    try {
      const result = await this.hass.callWS({ type: "meshtastic/nodes", entry_id: entryId });
      this._nodeMap = new Map((result.nodes || []).map((node) => [node.node_id, node]));
      this._publishNodes();
    } catch (err) {
      console.warn("MT_SW: nie udało się pobrać węzłów", err);
    }
  }

  /* Subskrypcja listy węzłów — odnawiana, gdy zmieni się bramka albo sesja
     połączenia (przeładowanie integracji tworzy nowego klienta). */
  async _ensureNodeSubscription(entryId) {
    const gateway = (this._gateways || []).find((g) => g.entry_id === entryId);
    const session = gateway ? gateway.session || null : null;
    if (
      this._unsubscribeNodes &&
      this._nodeSubEntryId === entryId &&
      this._nodeSubSession === session
    ) {
      return;
    }
    this._unsubscribeNodesNow();
    this._nodeSubEntryId = entryId;
    this._nodeSubSession = session;
    try {
      this._unsubscribeNodes = await this.hass.connection.subscribeMessage(
        (event) => this._onNodesEvent(entryId, event),
        { type: "meshtastic/subscribe_nodes", entry_id: entryId }
      );
    } catch (err) {
      console.warn("MT_SW: subskrypcja węzłów nie powiodła się, pobieram jednorazowo", err);
      this._nodeSubEntryId = null;
      this._nodeSubSession = null;
      await this._refreshNodes(entryId);
    }
  }

  _unsubscribeNodesNow() {
    if (this._unsubscribeNodes) {
      try {
        this._unsubscribeNodes();
      } catch (err) {
        console.debug("MT_SW: odsubskrybowanie węzłów nie powiodło się", err);
      }
    }
    this._unsubscribeNodes = null;
    this._nodeSubEntryId = null;
    this._nodeSubSession = null;
  }

  _onNodesEvent(entryId, event) {
    if (!event || entryId !== this._nodeSubEntryId) {
      return;
    }
    switch (event.kind) {
      case "snapshot":
        this._nodeMap = new Map((event.nodes || []).map((node) => [node.node_id, node]));
        this._linkUp = event.connected !== false;
        this._publishNodes();
        break;
      case "delta":
        for (const node of event.upsert || []) {
          this._nodeMap.set(node.node_id, node);
        }
        for (const nodeId of event.remove || []) {
          this._nodeMap.delete(nodeId);
        }
        this._publishNodes();
        break;
      case "connection":
        this._linkUp = Boolean(event.connected);
        if (event.state === "stopped") {
          // integracja się przeładowuje — ten klient już nie wróci
          this._unsubscribeNodesNow();
          setTimeout(() => this._refresh(), 3000);
        }
        break;
      default:
        break;
    }
  }

  _publishNodes() {
    const list = Array.from(this._nodeMap.values());
    const key = (node) => (node.long_name || node.node_hex || "").toLowerCase();
    list.sort((a, b) => key(a).localeCompare(key(b)));
    this._nodes = list;
  }

  _applyNodePatch({ nodeId, patch, removed }) {
    if (nodeId === undefined || nodeId === null) {
      return;
    }
    if (removed) {
      this._nodeMap.delete(nodeId);
    } else {
      const current = this._nodeMap.get(nodeId);
      if (!current) {
        return;
      }
      this._nodeMap.set(nodeId, { ...current, ...(patch || {}) });
    }
    this._publishNodes();
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
     Jej komponenty wołają polecenia pod nazwami z projektu źródłowego
     (meshtastic_ui/...). Tłumaczymy nazwy i kształt odpowiedzi tutaj, żeby
     settings.js i modules.js zostały nietknięte poza przepuszczeniem napisów
     przez PL() — i dały się podmieniać na nowsze ich wydania. */
  /* Ich komponenty ustawień czytają nazwy pól w snake_case (d.modem_preset),
     a nasze MessageToDict zwraca camelCase (modemPreset) — ich backend
     oddawał pierwszą postać. Bez tej konwersji każda sekcja wyglądała na
     pustą, mimo że dane z radia dochodziły poprawnie. */
  _toSnake(value) {
    if (Array.isArray(value)) {
      return value.map((item) => this._toSnake(item));
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, inner] of Object.entries(value)) {
        const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
        out[snake] = this._toSnake(inner);
      }
      return out;
    }
    return value;
  }

  /* Polecenia, po których panel ma pokazać przyczynę porażki (a nie tylko
     "coś poszło nie tak"): zamiast null oddajemy { ok:false, error }. */
  async _softWs(message) {
    try {
      const result = await this.hass.callWS(message);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }

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
          // Ich edytor kanałów czyta config.channels, czego nasza komenda
          // konfiguracji nie zwraca — dokładamy je z osobnej komendy.
          let channels = [];
          try {
            const raw = await this.hass.callWS({ type: "meshtastic/channels", entry_id: entryId });
            channels = (raw.channels || []).map((channel) => ({
              index: channel.index,
              role: channel.role,
              // nazwa z presetu LoRa dla kanału bez własnej nazwy (np. „MediumFast”)
              preset_name: channel.preset_name || "",
              settings: {
                name: channel.name || "",
                psk: channel.psk || "",
                uplink_enabled: Boolean(channel.uplink_enabled),
                downlink_enabled: Boolean(channel.downlink_enabled),
                // is_muted też — bez niego zapis kanału po cichu zdejmował wyciszenie
                module_settings: {
                  position_precision: channel.position_precision ?? 0,
                  is_muted: Boolean(channel.is_muted),
                },
              },
            }));
          } catch (err) {
            console.warn("MT_SW: nie udało się pobrać kanałów", err);
          }
          // Sekcja Użytkownik czyta config.owner, którego nasza komenda
          // konfiguracji nie zwraca — bramka ma tę informację w gateway
          // node (patrz ws_gateways), więc czytamy ją stamtąd.
          const gateway = (this._gateways || []).find((g) => g.entry_id === entryId);
          return {
            local_config: this._toSnake(result.local_config || {}),
            module_config: this._toSnake(result.module_config || {}),
            channels,
            owner: {
              longName: gateway?.long_name || "",
              shortName: gateway?.short_name || "",
              isLicensed: Boolean(gateway?.is_licensed),
              isUnmessagable: Boolean(gateway?.is_unmessagable),
            },
          };
        }
        case "set_config": {
          // Ich komponenty podają samą nazwę sekcji, więc grupę rozpoznajemy
          // po tym, w której części konfiguracji ta sekcja występuje.
          const group = Object.prototype.hasOwnProperty.call(this._localConfig || {}, data.section)
            ? "local"
            : "module";
          // Radio przyjmuje nazwy pól w camelCase, a ich formularz oddaje je
          // w snake_case — zamieniamy z powrotem przed zapisem.
          const values = {};
          for (const [key, value] of Object.entries(data.values || {})) {
            values[key.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase())] = value;
          }
          await this.hass.callWS({
            type: "meshtastic/set_config",
            entry_id: entryId,
            group,
            section: data.section,
            values,
          });
          this._configEntryId = null;
          this._toast(
            !SECTIONS_WITHOUT_REBOOT.has(data.section)
              ? t(this.hass, "settings.saved_reboot")
              : t(this.hass, "settings.saved")
          );
          return { success: true };
        }
        case "set_owner":
          await this.hass.callWS({
            type: "meshtastic/set_owner",
            entry_id: entryId,
            long_name: data.long_name ?? data.longName ?? "",
            short_name: data.short_name ?? data.shortName ?? "",
            is_licensed: Boolean(data.is_licensed ?? data.isLicensed),
            // pomijamy, gdy panel go nie podał — wtedy radio zostawia dotychczasową wartość
            ...(data.is_unmessagable === undefined && data.isUnmessagable === undefined
              ? {}
              : { is_unmessagable: Boolean(data.is_unmessagable ?? data.isUnmessagable) }),
          });
          return { success: true };
        case "set_channel":
          await this.hass.callWS({
            type: "meshtastic/set_channel",
            entry_id: entryId,
            channel: data.channel || data,
          });
          this._toast(t(this.hass, "settings.channel_saved"));
          return { success: true };
        case "device_action":
          await this.hass.callWS({
            type: "meshtastic/device_action",
            entry_id: entryId,
            // ich nazwy akcji różnią się od naszych
            action: DEVICE_ACTIONS[data.action] || data.action,
          });
          return { success: true };
        case "storage_stats": {
          const stats = await this.hass.callWS({ type: "meshtastic/storage_stats", entry_id: entryId });
          return { success: true, ...stats, nodes: (this._nodes || []).length };
        }
        case "clear_messages":
        case "clear_nodes":
        case "clear_all": {
          await this.hass.callWS({
            type: "meshtastic/storage_clear",
            entry_id: entryId,
            kind: name.replace("clear_", ""),
          });
          await this._refresh();
          return { success: true };
        }
        case "node_names": {
          const names = {};
          for (const node of this._nodes || []) {
            if (node.short_name) {
              names[node.node_id] = node.short_name;
            }
          }
          return { ok: true, names };
        }
        case "sniffer_state":
          return this._softWs({ type: "meshtastic/sniffer_state", entry_id: entryId, force: Boolean(data.force) });
        case "sniffer_set":
          return this._softWs({ type: "meshtastic/sniffer_set", entry_id: entryId, enabled: Boolean(data.enabled) });
        case "sniffer_log":
          return this._softWs({ type: "meshtastic/sniffer_log", entry_id: entryId, since: data.since || 0 });
        case "sniffer_clear":
          return this._softWs({ type: "meshtastic/sniffer_clear", entry_id: entryId });
        case "sniffer_mqtt_set":
          return this._softWs({ type: "meshtastic/sniffer_mqtt_set", entry_id: entryId, enabled: Boolean(data.enabled) });
        case "ui_settings":
          return this._softWs({ type: "meshtastic/ui_settings" });
        case "ui_settings_set":
          return this._softWs({ type: "meshtastic/ui_settings_set", settings: data.settings || {} });
        case "nodedb_status":
          return this._softWs({ type: "meshtastic/nodedb_status", entry_id: entryId });
        case "nodedb_preview":
        case "nodedb_clean":
          return this._softWs({
            type: `meshtastic/${name}`,
            entry_id: entryId,
            inactive_days: data.inactive_days || 0,
            kind: data.kind || "all",
          });
        case "nodedb_auto_set":
          return this._softWs({
            type: "meshtastic/nodedb_auto_set",
            entry_id: entryId,
            enabled: Boolean(data.enabled),
            inactivity_days: data.inactivity_days,
            interval_days: data.interval_days,
          });
        default:
          console.warn("MT_SW: nieobsługiwane polecenie ustawień", name);
          return null;
      }
    } catch (err) {
      console.error("MT_SW: polecenie ustawień nie powiodło się", name, err);
      // Wcześniej błąd znikał po cichu — przycisk „Zapisz” po prostu przestawał
      // się kręcić i nie było wiadomo, że radio niczego nie przyjęło.
      if (name.startsWith("set_") || name === "device_action") {
        this._toast(`${t(this.hass, "settings.save_failed")}: ${(err && err.message) || err}`);
      }
      return { success: false, error: (err && err.message) || String(err) };
    }
  }

  _toast(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
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
        return entryId
          ? html`<mesh-settings-tab
              .hass=${this.hass}
              .wsCommand=${(type, data) => this._settingsWs(type, data)}
            ></mesh-settings-tab>`
          : html`<div class="tab-placeholder">${t(this.hass, "common.loading")}</div>`;
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

  /* Stan łącza i warstwy statystyk — pływający pasek, żeby nie zmieniać
     wysokości zakładek (--mtsw-tab-height). */
  _renderStatusBanner() {
    const entryId = this._primaryEntryId;
    const gateway = (this._gateways || []).find((g) => g.entry_id === entryId);
    if (!gateway) {
      return "";
    }
    const linkUp = this._linkUp === null ? gateway.connected !== false : this._linkUp;
    const lines = [];
    if (!linkUp) {
      lines.push(t(this.hass, "panel.link_down"));
    }
    if (gateway.stats_ok === false) {
      lines.push(t(this.hass, "panel.stats_degraded"));
    }
    if (!lines.length) {
      return "";
    }
    return html`<div class="status-banner ${linkUp ? "warn" : "error"}">
      ${lines.map((line) => html`<div>${line}</div>`)}
    </div>`;
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
        ${this._renderStatusBanner()}
      </ha-top-app-bar-fixed>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
        height: 100%;
        /* Wysokość obszaru zakładki, liczona z nagłówka Home Assistanta
           i naszego paska zakładek, zamiast zgadywanej stałej. Definiowana
           tutaj, bo własności niestandardowe dziedziczą się przez granicę
           shadow DOM — sięga więc każdej zakładki, także mapy, która
           renderuje do light DOM. */
        --mtsw-tab-height: calc(100vh - var(--header-height, 56px) - 49px);
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

      .tab-placeholder {
        padding: 24px 16px;
        color: var(--secondary-text-color);
        font-size: 14px;
      }

      .tab.active {
        color: var(--primary-color);
        border-bottom-color: var(--primary-color);
      }

      .status-banner {
        position: fixed;
        left: 50%;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        transform: translateX(-50%);
        z-index: 5;
        max-width: min(560px, calc(100vw - 32px));
        padding: 10px 16px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.4;
        color: var(--text-primary-color, #fff);
        background: var(--warning-color, #ff9800);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        pointer-events: none;
      }

      .status-banner.error {
        background: var(--error-color, #db4437);
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
