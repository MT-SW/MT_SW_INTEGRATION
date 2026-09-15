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

/* Sekcje, które chcemy pokazać najwyżej — reszta leci alfabetycznie pod nimi. */
const PRIORITY_SECTIONS = ["lora", "device", "position", "power", "network", "bluetooth", "display"];

class MeshSettingsTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      localConfig: { type: Object },
      moduleConfig: { type: Object },
      configError: { type: Boolean },
      _open: { type: Object },
    };
  }

  constructor() {
    super();
    this.localConfig = null;
    this.moduleConfig = null;
    this.configError = false;
    this._open = {};
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

  _renderField(section, key, value) {
    return html`
      <div class="field">
        <span class="field-label">${fieldLabel(section, key) || this._humanize(key)}</span>
        <span class="field-value">${this._formatValue(value)}</span>
      </div>
    `;
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
              ${fields.length
                ? fields.map(([key, value]) => this._renderField(name, key, value))
                : html`<div class="empty-state">${t(this.hass, "settings.section_empty")}</div>`}
            </div>`
          : ""}
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
        <div class="notice">${t(this.hass, "settings.read_only")}</div>
        ${this._renderGroup("local", "settings.group.device", this.localConfig)}
        ${this._renderGroup("module", "settings.group.modules", this.moduleConfig)}
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

        .field {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 6px 16px;
        }

        .field-label {
          font-size: 13px;
          color: var(--secondary-text-color);
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
