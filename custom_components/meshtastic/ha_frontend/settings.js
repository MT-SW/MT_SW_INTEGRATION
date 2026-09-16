/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Ustawienia — podgląd konfiguracji bramki.
 *
 * Wyłącznie odczyt. Renderer jest generyczny: przechodzi po sekcjach
 * zwróconych przez radio zamiast mieć zaszyty na sztywno spis pól.
 * Dzięki temu pola dodane przez firmware MT_SW pojawią się same, bez
 * dopisywania czegokolwiek tutaj.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { layoutStyles, emptyStateStyles } from "./styles.js";
import { t } from "./i18n.js";
import { fieldLabel } from "./field-labels.js";
import { enumOptions } from "./enum-labels.js";
import "./components.js";

/* Sekcje, które chcemy pokazać najwyżej — reszta leci alfabetycznie pod nimi. */
const PRIORITY_SECTIONS = ["lora", "device", "position", "power", "network", "bluetooth", "display"];

class MeshSettingsTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      localConfig: { type: Object },
      moduleConfig: { type: Object },
      configError: { type: Boolean },
      schema: { type: Object },
      entryId: { type: String },
      _open: { type: Object },
      _drafts: { type: Object },
      _saving: { type: String },
      _status: { type: Object },
      _confirmSection: { type: Object },
    };
  }

  constructor() {
    super();
    this.localConfig = null;
    this.moduleConfig = null;
    this.configError = false;
    this.schema = null;
    this._open = {};
    this._drafts = {};
    this._saving = null;
    this._status = {};
    this._confirmSection = null;
  }

  /* camelCase -> "Camel case"; etykiety pól zostają w formie technicznej,
     bo dokładnie pod takimi nazwami występują w dokumentacji Meshtastica. */
  _humanize(key) {
    const spaced = key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .toLowerCase()
      .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  _sectionLabel(name) {
    const key = `settings.section.${name}`;
    const translated = t(this.hass, key);
    return translated === key ? this._humanize(name) : translated;
  }

  _formatValue(value) {
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

  _meta(groupId, section, key) {
    const group = groupId === "module" ? "module" : "local";
    return (this.schema && this.schema[group] && this.schema[group][section] && this.schema[group][section][key]) || null;
  }

  _draftKey(groupId, section) {
    return `${groupId}.${section}`;
  }

  _draftValue(groupId, section, key, current) {
    const draft = this._drafts[this._draftKey(groupId, section)];
    if (draft && Object.prototype.hasOwnProperty.call(draft, key)) {
      return draft[key];
    }
    return current;
  }

  _setDraft(groupId, section, key, value) {
    const id = this._draftKey(groupId, section);
    this._drafts = { ...this._drafts, [id]: { ...(this._drafts[id] || {}), [key]: value } };
  }

  _discard(groupId, section) {
    const id = this._draftKey(groupId, section);
    const { [id]: _dropped, ...rest } = this._drafts;
    this._drafts = rest;
    this._status = { ...this._status, [id]: null };
  }

  async _save(groupId, section) {
    const id = this._draftKey(groupId, section);
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
        group: groupId,
        section,
        values,
      });
      this._discard(groupId, section);
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
  _requestSave(groupId, section) {
    if (section === "lora") {
      this._confirmSection = { groupId, section };
      return;
    }
    this._save(groupId, section);
  }

  _renderControl(groupId, section, key, current) {
    const meta = this._meta(groupId, section, key);
    const value = this._draftValue(groupId, section, key, current);
    const label = fieldLabel(section, key) || this._humanize(key);

    if (!meta || !meta.editable) {
      return html`
        <mesh-form-field .label=${label}>
          <div class="readonly">${this._formatValue(current)}</div>
        </mesh-form-field>
      `;
    }

    if (meta.type === "bool") {
      return html`<mesh-toggle
        .label=${label}
        .checked=${Boolean(value)}
        @change=${(e) => this._setDraft(groupId, section, key, e.detail.checked)}
      ></mesh-toggle>`;
    }

    if (meta.type === "enum") {
      return html`<mesh-select
        .label=${label}
        .value=${value === null || value === undefined ? "" : String(value)}
        .options=${enumOptions(meta.enum, meta.options)}
        @change=${(e) => this._setDraft(groupId, section, key, e.detail.value)}
      ></mesh-select>`;
    }

    if (meta.type === "int" || meta.type === "float") {
      return html`<mesh-number-input
        .label=${label}
        .value=${typeof value === "number" ? value : 0}
        .step=${meta.type === "float" ? 0.01 : 1}
        @change=${(e) => this._setDraft(groupId, section, key, Number(e.detail.value))}
      ></mesh-number-input>`;
    }

    return html`<mesh-text-input
      .label=${label}
      .value=${value === null || value === undefined ? "" : String(value)}
      @change=${(e) => this._setDraft(groupId, section, key, e.detail.value)}
    ></mesh-text-input>`;
  }

  _renderField(groupId, section, key, value) {
    return html`<div class="field">${this._renderControl(groupId, section, key, value)}</div>`;
  }

  _renderSection(groupId, name, section) {
    const id = `${groupId}.${name}`;
    const expanded = Boolean(this._open[id]);
    const fields = Object.entries(section || {});

    return html`
      <div class="card">
        <button
          class="section-header"
          @click=${() => {
            this._open = { ...this._open, [id]: !expanded };
          }}
        >
          <span class="section-name">${this._sectionLabel(name)}</span>
          <span class="section-meta">
            ${t(this.hass, "settings.field_count", { n: fields.length })}
            <span class="chevron ${expanded ? "open" : ""}">▾</span>
          </span>
        </button>
        ${expanded
          ? html`<div class="section-body">
              ${this._renderSaveBar(groupId, name)}
              ${fields.length
                ? html`<div class="section-body-grid">
                    ${fields.map(([key, value]) => this._renderField(groupId, name, key, value))}
                  </div>`
                : html`<div class="empty-state">${t(this.hass, "settings.section_empty")}</div>`}
            </div>`
          : ""}
      </div>
    `;
  }

  _renderSaveBar(groupId, name) {
    const id = this._draftKey(groupId, name);
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
              <button class="btn" ?disabled=${Boolean(this._saving)} @click=${() => this._discard(groupId, name)}>
                ${t(this.hass, "settings.discard")}
              </button>
              <button
                class="btn primary"
                ?disabled=${Boolean(this._saving)}
                @click=${() => this._requestSave(groupId, name)}
              >
                ${this._saving === id ? t(this.hass, "settings.saving") : t(this.hass, "settings.save")}
              </button>
            `
          : ""}
        ${status
          ? html`<span class="save-status ${status.ok ? "ok" : "error"}">
              ${status.ok ? t(this.hass, "settings.saved") : `${t(this.hass, "settings.save_failed")} ${status.message}`}
            </span>`
          : ""}
      </div>
    `;
  }

  _renderConfirm() {
    if (!this._confirmSection) {
      return html``;
    }
    const { groupId, section } = this._confirmSection;
    return html`
      <div class="scrim" @click=${() => (this._confirmSection = null)}>
        <div class="confirm" @click=${(e) => e.stopPropagation()}>
          <div class="confirm-title">${t(this.hass, "settings.lora_confirm_title")}</div>
          <div class="confirm-body">${t(this.hass, "settings.lora_confirm_body")}</div>
          <div class="confirm-actions">
            <button class="btn" @click=${() => (this._confirmSection = null)}>
              ${t(this.hass, "settings.discard_change")}
            </button>
            <button
              class="btn danger"
              @click=${() => {
                this._confirmSection = null;
                this._save(groupId, section);
              }}
            >
              ${t(this.hass, "settings.lora_confirm_ok")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _renderGroup(groupId, titleKey, config) {
    const names = Object.keys(config || {});
    if (!names.length) {
      return html``;
    }

    names.sort((a, b) => {
      const ia = PRIORITY_SECTIONS.indexOf(a);
      const ib = PRIORITY_SECTIONS.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      }
      return a.localeCompare(b);
    });

    return html`
      <div class="group-title">${t(this.hass, titleKey)}</div>
      ${names.map((name) => this._renderSection(groupId, name, config[name]))}
    `;
  }

  render() {
    if (!this.hass) {
      return html``;
    }
    if (this.configError) {
      return html`<div class="tab-content">
        <div class="empty-state">${t(this.hass, "settings.error")}</div>
      </div>`;
    }
    if (this.localConfig === null && this.moduleConfig === null) {
      return html`<div class="tab-content">
        <div class="empty-state">${t(this.hass, "common.loading")}</div>
      </div>`;
    }

    return html`
      <div class="tab-content">
        <div class="notice">${t(this.hass, "settings.editable_notice")}</div>
        ${this._renderGroup("local", "settings.group.device", this.localConfig)}
        ${this._renderGroup("module", "settings.group.modules", this.moduleConfig)}
      </div>
      ${this._renderConfirm()}
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

        .notice {
          padding: 10px 14px;
          margin-bottom: 16px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          font-size: 13px;
        }

        .group-title {
          margin: 16px 0 8px;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--secondary-text-color);
        }

        .card {
          margin-bottom: 8px;
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          width: 100%;
          padding: 12px 16px;
          border: none;
          background: none;
          font-family: inherit;
          color: var(--primary-text-color);
          cursor: pointer;
          text-align: start;
        }

        .section-header:hover {
          background: var(--secondary-background-color);
        }

        .section-name {
          font-size: 15px;
          font-weight: 500;
        }

        .section-meta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--secondary-text-color);
          white-space: nowrap;
        }

        .chevron {
          display: inline-block;
          transition: transform 0.15s ease;
        }

        .chevron.open {
          transform: rotate(180deg);
        }

        .section-body {
          border-top: 1px solid var(--divider-color);
          padding: 4px 0 8px;
        }

        /* Etykieta stoi teraz nad kontrolką, więc pola układamy w siatkę —
           wcześniej etykieta była przy lewej, a kontrolka przy prawej krawędzi
           karty i przy szerokim oknie nie było wiadomo, co z czym się łączy. */
        .section-body-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 14px 20px;
          padding: 14px 16px;
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

        .field-label {
          font-size: 13px;
          color: var(--secondary-text-color);
        }

        .field-control {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          min-width: 180px;
        }

        .field-control input[type="text"],
        .field-control input[type="number"],
        .field-control select {
          width: 100%;
          max-width: 260px;
          padding: 5px 8px;
          border-radius: 6px;
          border: 1px solid var(--divider-color);
          background: var(--primary-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 13px;
          text-align: end;
        }

        .field-control .readonly {
          color: var(--secondary-text-color);
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

        .field-value {
          font-size: 14px;
          font-variant-numeric: tabular-nums;
          text-align: end;
          overflow-wrap: anywhere;
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-tab")) {
  customElements.define("mesh-settings-tab", MeshSettingsTab);
}
