/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Ustawienia — pełna konfiguracja czytana z urządzenia.
 *
 * Formularz budowany jest z deskryptorów protobufów, które backend wysyła
 * razem z konfiguracją. Dzięki temu widać wszystko, co radio faktycznie
 * zgłasza — łącznie z regionami i presetami dodanymi w nowszym firmware
 * oraz sekcjami własnymi MT_SW, których żadna ręcznie pisana lista nie zna.
 *
 * Kontrolki pochodzą z components.js (projekt meshtastic-ui-ha, MIT):
 * etykieta stoi nad polem, nie przy przeciwnej krawędzi karty.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { settingsStyles, formStyles, saveBarStyles, emptyStateStyles } from "./styles.js";
import { t } from "./i18n.js";
import { fieldLabel } from "./field-labels.js";
import { enumOptions } from "./enum-labels.js";
import "./components.js";

/* Kolejność jak w aplikacji: najpierw to, co się ustawia najczęściej. */
const SECTION_ORDER = [
  "lora",
  "device",
  "position",
  "power",
  "network",
  "bluetooth",
  "display",
  "security",
];

class MeshSettingsTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      entryId: { type: String },
      localConfig: { type: Object },
      moduleConfig: { type: Object },
      schema: { type: Object },
      configError: { type: Boolean },
      _active: { type: String },
      _drafts: { type: Object },
      _saving: { type: String },
      _status: { type: Object },
      _confirm: { type: Object },
    };
  }

  constructor() {
    super();
    this.localConfig = null;
    this.moduleConfig = null;
    this.schema = null;
    this.configError = false;
    this._active = null;
    this._drafts = {};
    this._saving = null;
    this._status = {};
    this._confirm = null;
  }

  _sections() {
    const out = [];
    for (const [group, config] of [
      ["local", this.localConfig],
      ["module", this.moduleConfig],
    ]) {
      const names = Object.keys(config || {});
      names.sort((a, b) => {
        const ia = SECTION_ORDER.indexOf(a);
        const ib = SECTION_ORDER.indexOf(b);
        if (ia !== -1 || ib !== -1) {
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        }
        return a.localeCompare(b);
      });
      for (const name of names) {
        out.push({ group, name, fields: config[name] || {} });
      }
    }
    return out;
  }

  _label(name) {
    const key = `settings.section.${name}`;
    const translated = t(this.hass, key);
    return translated === key ? name : translated;
  }

  _meta(group, section, key) {
    const table = this.schema && this.schema[group] && this.schema[group][section];
    return (table && table[key]) || null;
  }

  _id(group, section) {
    return `${group}.${section}`;
  }

  _value(group, section, key, current) {
    const draft = this._drafts[this._id(group, section)];
    if (draft && Object.prototype.hasOwnProperty.call(draft, key)) {
      return draft[key];
    }
    return current;
  }

  _setDraft(group, section, key, value) {
    const id = this._id(group, section);
    this._drafts = { ...this._drafts, [id]: { ...(this._drafts[id] || {}), [key]: value } };
  }

  _discard(group, section) {
    const id = this._id(group, section);
    const { [id]: _dropped, ...rest } = this._drafts;
    this._drafts = rest;
    this._status = { ...this._status, [id]: null };
  }

  async _save(group, section) {
    const id = this._id(group, section);
    const values = this._drafts[id];
    if (!values || !this.entryId || this._saving) {
      return;
    }
    this._saving = id;
    this._status = { ...this._status, [id]: null };
    try {
      await this.hass.callWS({
        type: "meshtastic/set_config",
        entry_id: this.entryId,
        group,
        section,
        values,
      });
      this._discard(group, section);
      this._status = { ...this._status, [id]: { ok: true } };
      this.dispatchEvent(new CustomEvent("mtsw-config-saved", { bubbles: true, composed: true }));
    } catch (err) {
      console.error("MT_SW: zapis konfiguracji nie powiódł się", err);
      this._status = { ...this._status, [id]: { ok: false, message: (err && err.message) || "" } };
    } finally {
      this._saving = null;
    }
  }

  /* LoRa dostaje osobne potwierdzenie: zmiana regionu, presetu czy
     częstotliwości na węźle zdalnym wyrzuca go z sieci bez drogi powrotnej. */
  _requestSave(group, section) {
    if (section === "lora") {
      this._confirm = { group, section };
      return;
    }
    this._save(group, section);
  }

  _renderControl(group, section, key, current) {
    const meta = this._meta(group, section, key);
    const label = fieldLabel(section, key) || key;
    const value = this._value(group, section, key, current);

    if (!meta || !meta.editable) {
      return html`
        <mesh-form-field .label=${label}>
          <div class="readonly">${this._display(current)}</div>
        </mesh-form-field>
      `;
    }

    if (meta.type === "bool") {
      return html`<mesh-toggle
        .label=${label}
        .checked=${Boolean(value)}
        @change=${(e) => this._setDraft(group, section, key, e.detail.checked)}
      ></mesh-toggle>`;
    }

    if (meta.type === "enum") {
      return html`<mesh-select
        .label=${label}
        .value=${value === null || value === undefined ? "" : String(value)}
        .options=${enumOptions(meta.enum, meta.options)}
        @change=${(e) => this._setDraft(group, section, key, e.detail.value)}
      ></mesh-select>`;
    }

    if (meta.type === "int" || meta.type === "float") {
      return html`<mesh-number-input
        .label=${label}
        .value=${typeof value === "number" ? value : 0}
        .step=${meta.type === "float" ? 0.01 : 1}
        @change=${(e) => this._setDraft(group, section, key, Number(e.detail.value))}
      ></mesh-number-input>`;
    }

    return html`<mesh-text-input
      .label=${label}
      .value=${value === null || value === undefined ? "" : String(value)}
      @change=${(e) => this._setDraft(group, section, key, e.detail.value)}
    ></mesh-text-input>`;
  }

  _display(value) {
    if (value === null || value === undefined || value === "") {
      return t(this.hass, "common.unknown");
    }
    if (typeof value === "boolean") {
      return value ? t(this.hass, "common.yes") : t(this.hass, "common.no");
    }
    if (Array.isArray(value)) {
      return value.length ? value.join(", ") : t(this.hass, "common.unknown");
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }

  _renderSaveBar(group, section) {
    const id = this._id(group, section);
    const dirty = Boolean(this._drafts[id] && Object.keys(this._drafts[id]).length);
    const status = this._status[id];
    if (!dirty && !status) {
      return html``;
    }
    return html`
      <div class="save-bar">
        ${dirty
          ? html`
              <span class="save-hint">${t(this.hass, "settings.unsaved")}</span>
              <button class="btn" ?disabled=${Boolean(this._saving)} @click=${() => this._discard(group, section)}>
                ${t(this.hass, "settings.discard")}
              </button>
              <button
                class="btn primary"
                ?disabled=${Boolean(this._saving)}
                @click=${() => this._requestSave(group, section)}
              >
                ${this._saving === id ? t(this.hass, "settings.saving") : t(this.hass, "settings.save")}
              </button>
            `
          : ""}
        ${status
          ? html`<span class="save-status ${status.ok ? "ok" : "error"}">
              ${status.ok
                ? t(this.hass, "settings.saved")
                : `${t(this.hass, "settings.save_failed")} ${status.message}`}
            </span>`
          : ""}
      </div>
    `;
  }

  _renderConfirm() {
    if (!this._confirm) {
      return html``;
    }
    const { group, section } = this._confirm;
    return html`
      <div class="scrim" @click=${() => (this._confirm = null)}>
        <div class="confirm" @click=${(e) => e.stopPropagation()}>
          <div class="confirm-title">${t(this.hass, "settings.lora_confirm_title")}</div>
          <div class="confirm-body">${t(this.hass, "settings.lora_confirm_body")}</div>
          <div class="confirm-actions">
            <button class="btn" @click=${() => (this._confirm = null)}>
              ${t(this.hass, "settings.discard_change")}
            </button>
            <button
              class="btn danger"
              @click=${() => {
                this._confirm = null;
                this._save(group, section);
              }}
            >
              ${t(this.hass, "settings.lora_confirm_ok")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.hass) {
      return html``;
    }
    if (this.configError) {
      return html`<div class="pane"><div class="empty-state">${t(this.hass, "settings.error")}</div></div>`;
    }
    if (this.localConfig === null && this.moduleConfig === null) {
      return html`<div class="pane"><div class="empty-state">${t(this.hass, "common.loading")}</div></div>`;
    }

    const sections = this._sections();
    const active = sections.find((s) => this._id(s.group, s.name) === this._active) || sections[0];

    return html`
      <div class="split">
        <aside class="sidebar">
          ${sections.map(
            (section) => html`
              <button
                class="side-item ${active && this._id(section.group, section.name) === this._id(active.group, active.name) ? "active" : ""}"
                @click=${() => (this._active = this._id(section.group, section.name))}
              >
                <span>${this._label(section.name)}</span>
                ${this._drafts[this._id(section.group, section.name)] ? html`<span class="dot"></span>` : ""}
              </button>
            `
          )}
        </aside>

        <section class="pane">
          ${active
            ? html`
                <div class="pane-title">${this._label(active.name)}</div>
                ${this._renderSaveBar(active.group, active.name)}
                ${Object.keys(active.fields).length
                  ? html`<div class="grid">
                      ${Object.entries(active.fields).map(
                        ([key, value]) => html`<div class="field">
                          ${this._renderControl(active.group, active.name, key, value)}
                        </div>`
                      )}
                    </div>`
                  : html`<div class="empty-state">${t(this.hass, "settings.section_empty")}</div>`}
              `
            : html`<div class="empty-state">${t(this.hass, "settings.error")}</div>`}
        </section>
      </div>
      ${this._renderConfirm()}
    `;
  }

  static get styles() {
    return [
      settingsStyles,
      formStyles,
      saveBarStyles,
      emptyStateStyles,
      css`
        :host {
          display: block;
        }

        /* Układ jak w aplikacji: lista sekcji po lewej, formularz po prawej,
           zamiast jednej długiej kolumny rozwijanych kart. */
        .split {
          display: grid;
          grid-template-columns: minmax(180px, 240px) 1fr;
          height: var(--mtsw-tab-height, calc(100vh - 105px));
        }

        @media (max-width: 700px) {
          .split {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
          }
          .sidebar {
            max-height: 150px;
            border-right: none;
            border-bottom: 1px solid var(--divider-color);
          }
        }

        .sidebar {
          overflow-y: auto;
          border-right: 1px solid var(--divider-color);
          background: var(--card-background-color);
        }

        .side-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          width: 100%;
          padding: 11px 16px;
          border: none;
          border-bottom: 1px solid var(--divider-color);
          background: none;
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 14px;
          text-align: start;
          cursor: pointer;
        }

        .side-item:hover {
          background: var(--secondary-background-color);
        }

        .side-item.active {
          background: var(--secondary-background-color);
          box-shadow: inset 3px 0 0 var(--primary-color);
        }

        .side-item .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--warning-color, #ffa600);
          flex: none;
        }

        .pane {
          overflow-y: auto;
          min-height: 0;
        }

        .pane-title {
          padding: 14px 16px 4px;
          font-size: 16px;
          font-weight: 500;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 14px 20px;
          padding: 14px 16px 24px;
        }

        .field {
          min-width: 0;
        }

        .readonly {
          padding: 7px 0;
          font-size: 13px;
          color: var(--secondary-text-color);
          overflow-wrap: anywhere;
        }

        .save-bar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 16px;
          border-bottom: 1px solid var(--divider-color);
        }

        .save-hint {
          flex: 1;
          font-size: 12px;
          color: var(--warning-color, #ffa600);
        }

        .btn {
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 12px;
          padding: 6px 12px;
          cursor: pointer;
        }

        .btn[disabled] {
          opacity: 0.5;
          cursor: default;
        }

        .btn.primary {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        .btn.danger {
          background: var(--error-color, #db4437);
          border-color: var(--error-color, #db4437);
          color: #fff;
        }

        .save-status {
          font-size: 12px;
        }

        .save-status.ok {
          color: var(--success-color, #4caf50);
        }

        .save-status.error {
          color: var(--error-color, #db4437);
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

        .confirm {
          width: min(480px, 100%);
          background: var(--card-background-color);
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          padding: 16px;
        }

        .confirm-title {
          font-size: 16px;
          font-weight: 500;
          margin-bottom: 8px;
        }

        .confirm-body {
          font-size: 13px;
          color: var(--secondary-text-color);
          margin-bottom: 16px;
        }

        .confirm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-tab")) {
  customElements.define("mesh-settings-tab", MeshSettingsTab);
}
