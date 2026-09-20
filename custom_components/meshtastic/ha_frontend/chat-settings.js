/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Ustawienia czatu (Ustawienia → Inne → Czat): czy obrazki z linków w wiadomościach
 * ładują się same. Jak w aplikacji na Androida jest jeden tryb — od razu pełna
 * rozdzielczość, bez osobnego "lekkiego" podglądu — a przełącznik siedzi w
 * Ustawieniach, nie w oknie czatu. Wartość zapisuje serwer, więc jest ta sama we
 * wszystkich przeglądarkach; zakładka Wiadomości czyta ją przy każdym otwarciu.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { PL } from "./pl-settings.js";
import { settingsStyles } from "./styles.js";
import "./components.js";

class MeshSettingsChat extends LitElement {
  static get properties() {
    return {
      wsCommand: { type: Object },
      _autoImages: { type: Boolean, state: true },
      _error: { type: String, state: true },
    };
  }

  constructor() {
    super();
    // Domyślnie włączone: panel działa na urządzeniu na stałe podłączonym do sieci, nie na telefonie.
    this._autoImages = true;
    this._error = "";
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    const result = await this.wsCommand("meshtastic_ui/ui_settings");
    if (result && result.ok && result.settings) {
      this._autoImages = result.settings.auto_load_images !== false;
    }
  }

  async _setAutoImages(enabled) {
    const previous = this._autoImages;
    this._autoImages = enabled;
    this._error = "";
    const result = await this.wsCommand("meshtastic_ui/ui_settings_set", { settings: { auto_load_images: enabled } });
    if (!result || !result.ok) {
      this._autoImages = previous;
      this._error = PL("Could not save the setting.");
    }
  }

  render() {
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Chat")}</h3>
          <p>${PL("How the chat shows links and images.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle
            .label=${PL("Automatically load images from links in chat")}
            .description=${PL("Images from links are downloaded in full resolution and shown under the message text. The server behind a link sees this browser's IP address. When off, an image loads after you click \"Load image\".")}
            .checked=${this._autoImages}
            @change=${(e) => this._setAutoImages(e.detail.checked)}
          ></mesh-toggle>
          ${this._error ? html`<div class="error">${this._error}</div>` : ""}
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      settingsStyles,
      css`
        :host { display: block; }
        .error {
          margin-top: 10px;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
          color: #f44336;
          background: rgba(244, 67, 54, 0.1);
          border: 1px solid rgba(244, 67, 54, 0.3);
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-chat")) {
  customElements.define("mesh-settings-chat", MeshSettingsChat);
}
