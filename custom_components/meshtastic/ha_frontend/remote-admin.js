/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Sekcja "Administracja zdalna" w oknie szczegółów węzła: sesja administratora,
 * ulubione / ignorowanie / dodanie do bazy węzłów, sterowanie GPIO oraz pełne
 * ustawienia zdalnego węzła (to samo okno ustawień co dla bramki, tylko że
 * każdy odczyt i zapis idzie przez radio bramki do wybranego węzła).
 *
 * Wszystko jest wysyłane przez eter, więc nic nie dzieje się samo: każdy
 * przycisk to jedno świadome polecenie. Zmiany, które mogą odciąć węzeł od
 * sieci (LoRa, Bezpieczeństwo, wyłączenie, kasowanie), wymagają potwierdzenia.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import "./settings.js";

const TEXT = {
  pl: {
    title: "Administracja zdalna",
    open: "Otwórz",
    close: "Zamknij",
    session: "Sesja administratora",
    session_none: "brak — zostanie nawiązana przy pierwszej zmianie",
    session_active: "aktywna ({s} s temu)",
    session_btn: "Nawiąż / odnów",
    session_help:
      "Węzeł przyjmuje zmiany tylko z ważnym kluczem sesji (ok. 5 minut). Panel odnawia go sam, ale możesz to zrobić ręcznie. Bramka musi mieć klucz administratora tego węzła (zakładka Bezpieczeństwo → Klucze administratora).",
    node_db: "Baza węzłów i ulubione",
    fav_add: "Dodaj do ulubionych",
    fav_remove: "Zdejmij z ulubionych",
    ign_add: "Ignoruj",
    ign_remove: "Przestań ignorować",
    node_db_help: "Polecenie wykonuje się na tym węźle (nie na bramce) i dotyczy węzła o podanym numerze.",
    target: "Numer węzła (!hex)",
    on_this: "Ten węzeł",
    add_contact: "Dodaj kontakt do bazy tego węzła",
    long_name: "Nazwa długa",
    short_name: "Nazwa krótka (max 4)",
    add: "Dodaj",
    gpio: "GPIO (Remote Hardware)",
    pin: "Numer pinu",
    high: "Włącz (1)",
    low: "Wyłącz (0)",
    read: "Odczytaj",
    gpio_help:
      "Wymaga na węźle modułu Remote Hardware i kanału o nazwie „gpio” (albo drugiego kanału). Działa jak w aplikacji: pin = numer bitu w masce.",
    gpio_state: "Pin {p}: {v}",
    settings: "Ustawienia zdalnego węzła",
    settings_open: "Pobierz i edytuj ustawienia",
    settings_help:
      "Pobranie ustawień z odległego węzła przez radio może potrwać kilka minut. Zmiany zapisują się na tym węźle, nie na bramce.",
    loading: "Pobieram ustawienia zdalnego węzła… to może potrwać kilka minut.",
    load_failed: "Nie udało się pobrać ustawień zdalnego węzła.",
    missing: "Węzeł nie odpowiedział dla: {s}. Te sekcje mogą być puste.",
    risky_section:
      "UWAGA: zmiana ustawień „{s}” na zdalnym węźle może go trwale odciąć od sieci (np. węzeł na szczycie). Na pewno zapisać?",
    risky_action:
      "UWAGA: ta akcja na zdalnym węźle może go wyłączyć albo wyczyścić i nie będzie można go zdalnie uratować. Na pewno wykonać?",
    saved: "Zapisano na zdalnym węźle.",
    saved_reboot: "Zapisano na zdalnym węźle. Węzeł uruchomi się ponownie.",
    done: "Wykonano.",
    failed: "Nie udało się.",
    bad_id: "Nieprawidłowy numer węzła.",
    busy: "Wysyłam…",
    remote_banner: "Edytujesz ustawienia ZDALNEGO węzła:",
    back: "Wróć do szczegółów",
  },
  en: {
    title: "Remote administration",
    open: "Open",
    close: "Close",
    session: "Admin session",
    session_none: "none — it will be set up on the first change",
    session_active: "active ({s} s ago)",
    session_btn: "Start / renew",
    session_help:
      "The node accepts changes only with a valid session key (about 5 minutes). The panel renews it by itself, but you can do it by hand. The gateway must hold this node's admin key (Security → Admin keys).",
    node_db: "Node database and favorites",
    fav_add: "Add to favorites",
    fav_remove: "Remove from favorites",
    ign_add: "Ignore",
    ign_remove: "Stop ignoring",
    node_db_help: "The command runs on this node (not on the gateway) and applies to the node with the given ID.",
    target: "Node ID (!hex)",
    on_this: "This node",
    add_contact: "Add a contact to this node's database",
    long_name: "Long name",
    short_name: "Short name (max 4)",
    add: "Add",
    gpio: "GPIO (Remote Hardware)",
    pin: "Pin number",
    high: "Set high (1)",
    low: "Set low (0)",
    read: "Read",
    gpio_help:
      "Needs the Remote Hardware module on the node and a channel named “gpio” (or a secondary channel). Works like in the app: pin = bit number in the mask.",
    gpio_state: "Pin {p}: {v}",
    settings: "Remote node settings",
    settings_open: "Fetch and edit settings",
    settings_help:
      "Fetching settings from a distant node over the radio can take several minutes. Changes are saved on that node, not on the gateway.",
    loading: "Fetching remote node settings… this can take several minutes.",
    load_failed: "Could not fetch the remote node settings.",
    missing: "The node did not answer for: {s}. Those sections may be empty.",
    risky_section:
      "WARNING: changing “{s}” on a remote node can cut it off from the mesh for good (e.g. a hilltop node). Save anyway?",
    risky_action:
      "WARNING: this action on a remote node may shut it down or wipe it, and it cannot be rescued remotely. Proceed?",
    saved: "Saved on the remote node.",
    saved_reboot: "Saved on the remote node. It will restart.",
    done: "Done.",
    failed: "Failed.",
    bad_id: "Invalid node ID.",
    busy: "Sending…",
    remote_banner: "You are editing settings of the REMOTE node:",
    back: "Back to details",
  },
};

const SECTIONS_WITHOUT_REBOOT = new Set(["device_ui", "statusmessage", "mesh_beacon", "traffic_management"]);
const RISKY_SECTIONS = new Set(["lora", "security"]);
const RISKY_ACTIONS = new Set(["shutdown", "factory_reset", "factory_reset_device", "reboot_ota"]);
const DEVICE_ACTIONS = {
  reset_nodedb: "nodedb_reset",
  factory_reset_config: "factory_reset",
  factory_reset_device: "factory_reset_device",
  reboot_ota: "reboot_ota",
};

function toSnake(value) {
  if (Array.isArray(value)) {
    return value.map(toSnake);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()] = toSnake(inner);
    }
    return out;
  }
  return value;
}

const toCamel = (key) => key.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase());

/* "!1a2b3c4d", "1a2b3c4d" albo liczba dziesiętna → numer węzła albo null */
export /* Backend odsyła wynik akcji na węźle jako {confirmed, result: {...}} — rozpakowujemy go, żeby panel widział dane. */
function unwrapNodeResult(reply) {
  if (reply && typeof reply === "object" && "confirmed" in reply && reply.result && typeof reply.result === "object") {
    return { ...reply.result, confirmed: reply.confirmed };
  }
  return reply;
}

function parseNodeId(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }
  if (/^!?[0-9a-fA-F]{8}$/.test(raw)) {
    return parseInt(raw.replace("!", ""), 16);
  }
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n > 0 && n <= 0xffffffff ? n : null;
  }
  return null;
}

class MeshRemoteAdmin extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      entryId: { type: String },
      nodeId: { type: Number },
      nodeHex: { type: String },
      _session: { type: Object, state: true },
      _busy: { type: String, state: true },
      _notice: { type: String, state: true },
      _error: { type: String, state: true },
      _target: { type: String, state: true },
      _longName: { type: String, state: true },
      _shortName: { type: String, state: true },
      _pin: { type: Number, state: true },
      _pinState: { type: String, state: true },
      _settings: { type: Boolean, state: true },
      _missing: { type: Array, state: true },
    };
  }

  constructor() {
    super();
    this._session = null;
    this._busy = "";
    this._notice = "";
    this._error = "";
    this._target = "";
    this._longName = "";
    this._shortName = "";
    this._pin = 0;
    this._pinState = "";
    this._settings = false;
    this._missing = [];
    this._bridge = (type, data) => this._settingsWs(type, data);
  }

  _tr(key, vars = {}) {
    const lang = String(this.hass?.language || "pl").toLowerCase().startsWith("pl") ? "pl" : "en";
    let text = TEXT[lang][key] ?? TEXT.pl[key] ?? key;
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(`{${name}}`, value);
    }
    return text;
  }

  updated(changed) {
    if (changed.has("nodeId") && changed.get("nodeId") !== undefined) {
      this._session = null;
      this._notice = "";
      this._error = "";
      this._pinState = "";
      this._settings = false;
    }
    if (changed.has("nodeId") || changed.has("entryId")) {
      this._loadSession();
    }
  }

  async _loadSession() {
    if (!this.hass || !this.entryId || typeof this.nodeId !== "number") {
      return;
    }
    try {
      this._session = unwrapNodeResult(
        await this.hass.callWS({
          type: "meshtastic/admin_session_status",
          entry_id: this.entryId,
          node_id: this.nodeId,
        })
      );
    } catch (err) {
      // stan sesji jest tylko informacją — brak odpowiedzi nie blokuje reszty
      console.warn("MT_SW: stan sesji administratora", err);
    }
  }

  async _ws(type, extra = {}, label = "") {
    if (this._busy) {
      return null;
    }
    this._busy = label || type;
    this._error = "";
    this._notice = "";
    try {
      return unwrapNodeResult(
        await this.hass.callWS({
          type: `meshtastic/${type}`,
          entry_id: this.entryId,
          node_id: this.nodeId,
          ...extra,
        })
      );
    } catch (err) {
      console.error("MT_SW: polecenie zdalne nie powiodło się", type, err);
      this._error = (err && err.message) || this._tr("failed");
      return null;
    } finally {
      this._busy = "";
    }
  }

  async _startSession() {
    const result = await this._ws("admin_session", { force: true }, "session");
    if (result) {
      this._session = { ...(this._session || {}), ...result, active: true };
      this._notice = this._tr("done");
    }
  }

  async _flag(kind, value) {
    const target = parseNodeId(this._target) ?? (this._target.trim() === "" ? this.nodeId : null);
    if (target === null) {
      this._error = this._tr("bad_id");
      return;
    }
    const payload = { dest_node_id: this.nodeId, node_id: target };
    payload[kind === "fav" ? "favorite" : "ignored"] = value;
    const result = await this._ws(kind === "fav" ? "set_favorite" : "set_ignored", payload, kind);
    if (result) {
      if (result.confirmed === false) {
        this._error = this._tr("failed");
      } else {
        this._notice = this._tr("done");
      }
    }
  }

  async _addContact() {
    const target = parseNodeId(this._target);
    if (target === null || !this._longName.trim()) {
      this._error = this._tr("bad_id");
      return;
    }
    const result = await this._ws(
      "add_contact",
      {
        dest_node_id: this.nodeId,
        node_id: target,
        long_name: this._longName.trim(),
        short_name: this._shortName.trim(),
      },
      "contact"
    );
    if (result) {
      this._notice = this._tr("done");
    }
  }

  async _gpioWrite(high) {
    const result = await this._ws("gpio_write", { pin: Number(this._pin), high }, "gpio");
    if (result) {
      this._pinState = this._tr("gpio_state", { p: result.pin, v: result.high ? "1" : "0" });
      this._notice = this._tr("done");
    }
  }

  async _gpioRead() {
    const result = await this._ws("gpio_read", { pin: Number(this._pin) }, "gpio");
    if (result) {
      this._pinState = this._tr("gpio_state", { p: result.pin, v: result.high ? "1" : "0" });
    }
  }

  /* Most dla okna ustawień: ta sama składnia poleceń co dla bramki, ale każde
     trafia do zdalnego węzła. */
  async _settingsWs(type, data = {}) {
    const name = String(type).replace(/^meshtastic_ui\//, "");
    const base = { entry_id: this.entryId, dest_node_id: this.nodeId };
    try {
      switch (name) {
        case "get_config": {
          // Szkielet bez ruchu w eterze — dane każdej zakładki wczytuje "load_part".
          this._remoteLocal = {};
          this._missing = [];
          return {
            local_config: {},
            module_config: {},
            channels: [],
            owner: { longName: "", shortName: "", isLicensed: false, isUnmessagable: false },
          };
        }
        case "load_part": {
          let result;
          try {
            result = await this.hass.callWS({
              type: "meshtastic/remote_config",
              entry_id: this.entryId,
              node_id: this.nodeId,
              sections: data.sections || [],
              channels: Boolean(data.channels),
              owner: Boolean(data.owner),
              canned: Boolean(data.canned),
            });
          } catch (err) {
            // Cała prośba padła (np. brak sesji administratora) — oddajemy przyczynę, żeby panel ją pokazał.
            const reason = (err && err.message) || String(err);
            return { fetched: [], errors: { session: reason }, local_config: {}, module_config: {}, channels: [], owner: null, missing: [] };
          }
          result = unwrapNodeResult(result) || {};
          // zapamiętujemy, które sekcje należą do części "local", żeby zapis trafił do właściwej grupy
          for (const name of data.sections || []) {
            if (result.local_config && Object.prototype.hasOwnProperty.call(result.local_config, name)) {
              this._remoteLocal = { ...(this._remoteLocal || {}), [name]: true };
            }
          }
          const missing = result.missing || [];
          return {
            fetched: result.fetched || [],
            errors: result.errors || {},
            local_config: toSnake(result.local_config || {}),
            module_config: toSnake(result.module_config || {}),
            channels: result.channels || [],
            owner: result.owner,
            missing,
          };
        }
        case "set_config": {
          const section = data.section;
          if (RISKY_SECTIONS.has(section) && !window.confirm(this._tr("risky_section", { s: section }))) {
            return { success: false };
          }
          const group = Object.prototype.hasOwnProperty.call(this._remoteLocal || {}, section) ? "local" : "module";
          const values = {};
          for (const [key, value] of Object.entries(data.values || {})) {
            values[toCamel(key)] = value;
          }
          await this.hass.callWS({
            type: "meshtastic/set_config",
            ...base,
            node_id: this.nodeId,
            group,
            section,
            values,
            confirm_risky: RISKY_SECTIONS.has(section),
          });
          this._notice = SECTIONS_WITHOUT_REBOOT.has(section) ? this._tr("saved") : this._tr("saved_reboot");
          return { success: true };
        }
        case "set_owner":
          await this.hass.callWS({
            type: "meshtastic/set_owner",
            ...base,
            long_name: data.long_name ?? data.longName ?? "",
            short_name: data.short_name ?? data.shortName ?? "",
            is_licensed: Boolean(data.is_licensed ?? data.isLicensed),
            ...(data.is_unmessagable === undefined && data.isUnmessagable === undefined
              ? {}
              : { is_unmessagable: Boolean(data.is_unmessagable ?? data.isUnmessagable) }),
          });
          this._notice = this._tr("saved");
          return { success: true };
        case "set_channel":
          await this.hass.callWS({
            type: "meshtastic/set_channel",
            ...base,
            channel: data.channel || data,
          });
          this._notice = this._tr("saved");
          return { success: true };
        case "device_action": {
          const action = DEVICE_ACTIONS[data.action] || data.action;
          const risky = RISKY_ACTIONS.has(action);
          if (risky && !window.confirm(this._tr("risky_action"))) {
            return { success: false };
          }
          await this.hass.callWS({
            type: "meshtastic/device_action",
            ...base,
            action,
            confirm_risky: risky,
          });
          this._notice = this._tr("done");
          return { success: true };
        }
        case "node_names":
          return { ok: true, names: {}, long_names: {} };
        default:
          // narzędzia lokalne (sniffer, pamięć, czat, logi) nie mają sensu dla zdalnego węzła
          return { ok: false, error: "local-only" };
      }
    } catch (err) {
      console.error("MT_SW: zdalne ustawienia", name, err);
      this._error = (err && err.message) || this._tr("failed");
      return null;
    }
  }

  _renderSession() {
    const s = this._session;
    const status = s && s.active ? this._tr("session_active", { s: Math.round(s.age || 0) }) : this._tr("session_none");
    return html`
      <div class="row">
        <span class="label">${this._tr("session")}</span>
        <span class="value">${status}</span>
        <button ?disabled=${Boolean(this._busy)} @click=${() => this._startSession()}>${this._tr("session_btn")}</button>
      </div>
      <div class="help">${this._tr("session_help")}</div>
    `;
  }

  _renderNodeDb() {
    const busy = Boolean(this._busy);
    return html`
      <div class="sub">${this._tr("node_db")}</div>
      <div class="row">
        <input
          class="grow"
          placeholder=${`${this._tr("target")} — ${this._tr("on_this")}: ${this.nodeHex || ""}`}
          .value=${this._target}
          @input=${(e) => (this._target = e.target.value)}
        />
      </div>
      <div class="buttons">
        <button ?disabled=${busy} @click=${() => this._flag("fav", true)}>${this._tr("fav_add")}</button>
        <button ?disabled=${busy} @click=${() => this._flag("fav", false)}>${this._tr("fav_remove")}</button>
        <button ?disabled=${busy} @click=${() => this._flag("ign", true)}>${this._tr("ign_add")}</button>
        <button ?disabled=${busy} @click=${() => this._flag("ign", false)}>${this._tr("ign_remove")}</button>
      </div>
      <div class="help">${this._tr("node_db_help")}</div>
      <div class="sub">${this._tr("add_contact")}</div>
      <div class="row">
        <input
          class="grow"
          placeholder=${this._tr("long_name")}
          maxlength="39"
          .value=${this._longName}
          @input=${(e) => (this._longName = e.target.value)}
        />
        <input
          class="short"
          placeholder=${this._tr("short_name")}
          maxlength="4"
          .value=${this._shortName}
          @input=${(e) => (this._shortName = e.target.value)}
        />
        <button ?disabled=${busy} @click=${() => this._addContact()}>${this._tr("add")}</button>
      </div>
    `;
  }

  _renderGpio() {
    const busy = Boolean(this._busy);
    return html`
      <div class="sub">${this._tr("gpio")}</div>
      <div class="row">
        <input
          class="short"
          type="number"
          min="0"
          max="62"
          placeholder=${this._tr("pin")}
          .value=${String(this._pin)}
          @input=${(e) => (this._pin = Number(e.target.value))}
        />
        <button ?disabled=${busy} @click=${() => this._gpioWrite(true)}>${this._tr("high")}</button>
        <button ?disabled=${busy} @click=${() => this._gpioWrite(false)}>${this._tr("low")}</button>
        <button ?disabled=${busy} @click=${() => this._gpioRead()}>${this._tr("read")}</button>
        ${this._pinState ? html`<span class="value">${this._pinState}</span>` : ""}
      </div>
      <div class="help">${this._tr("gpio_help")}</div>
    `;
  }

  _renderSettings() {
    if (!this._settings) {
      return html`
        <div class="sub">${this._tr("settings")}</div>
        <div class="buttons">
          <button ?disabled=${Boolean(this._busy)} @click=${() => (this._settings = true)}>
            ${this._tr("settings_open")}
          </button>
        </div>
        <div class="help">${this._tr("settings_help")}</div>
      `;
    }
    return html`
      <div class="sub">${this._tr("remote_banner")} ${this.nodeHex || ""}</div>
      <div class="buttons">
        <button @click=${() => (this._settings = false)}>${this._tr("back")}</button>
      </div>
      <div class="help">${this._tr("loading")}</div>
      <mesh-settings-tab
        .hass=${this.hass}
        .remote=${true}
        .wsCommand=${this._bridge}
      ></mesh-settings-tab>
    `;
  }

  render() {
    return html`
      <div class="detail-section">${this._tr("title")}</div>
      ${this._busy ? html`<div class="status">${this._tr("busy")}</div>` : ""}
      ${this._notice ? html`<div class="status ok">${this._notice}</div>` : ""}
      ${this._error ? html`<div class="status err">${this._error}</div>` : ""}
      ${this._renderSession()} ${this._renderNodeDb()} ${this._renderGpio()} ${this._renderSettings()}
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
      .sub {
        padding: 10px 16px 2px;
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary-text-color);
      }
      .row,
      .buttons {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 4px 16px;
      }
      .label {
        font-size: 14px;
      }
      .value {
        font-size: 14px;
        color: var(--secondary-text-color);
      }
      .help {
        padding: 0 16px 6px;
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      .help.warn {
        color: var(--warning-color, #ff9800);
      }
      input {
        padding: 6px 8px;
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        background: var(--card-background-color, transparent);
        color: var(--primary-text-color);
        font: inherit;
        min-width: 0;
      }
      input.grow {
        flex: 1 1 200px;
      }
      input.short {
        width: 110px;
      }
      button {
        padding: 6px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        background: transparent;
        color: var(--primary-text-color);
        font: inherit;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .status {
        margin: 4px 16px;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 13px;
        background: var(--secondary-background-color);
      }
      .status.ok {
        color: var(--success-color, #4caf50);
      }
      .status.err {
        color: var(--error-color, #f44336);
      }
    `;
  }
}

customElements.define("mesh-remote-admin", MeshRemoteAdmin);
