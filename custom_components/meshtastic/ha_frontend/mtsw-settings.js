/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Ustawienia → Funkcje MT_SW → Ustawienia MT_SW: ustawienia naszych własnych funkcji, które nie mają
 * jeszcze innego miejsca. Teraz: domyślny wygląd widoku Zdrowie sieci. Pozostałe nasze ustawienia
 * (Sniffer, Firmware, Pamięć, Czat, Debugowanie, Wsparcie) mają własne pozycje w tej samej grupie.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { settingsStyles } from "./styles.js";
import "./components.js";

const METRICS = [
  ["power", "Zasilanie"],
  ["signal", "Sygnał"],
  ["ether", "Eter"],
  ["environment", "Środowisko"],
  ["resources", "Zasoby"],
  ["traffic", "Ruch"],
  ["neighbors", "Sąsiedzi"],
];
const ACTIVITY = ["Wszystkie", "1 h", "6 h", "24 h", "2 dni", "7 dni", "30 dni"];
const RANGES = ["1 h", "24 h", "2 dni", "7 dni", "2 tyg.", "30 dni", "Wszystko"];
const DEFAULTS = { metric: "power", activity: 0, fav_top: true, hide_ignored: true, sort: "value", range: 3 };

class MeshSettingsMtsw extends LitElement {
  static get properties() {
    return {
      wsCommand: { type: Object },
      _d: { type: Object, state: true },
      _msg: { type: String, state: true },
    };
  }

  constructor() {
    super();
    this._d = { ...DEFAULTS };
    this._msg = "";
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    const r = await this.wsCommand("meshtastic_ui/ui_settings");
    if (r && r.ok !== false && r.settings) this._d = { ...DEFAULTS, ...(r.settings.health_defaults || {}) };
  }

  async _set(patch) {
    const previous = this._d;
    this._d = { ...this._d, ...patch };
    this._msg = "";
    const r = await this.wsCommand("meshtastic_ui/ui_settings_set", { settings: { health_defaults: this._d } });
    if (r && r.ok === false) {
      this._d = previous;
      this._msg = "Nie udało się zapisać ustawienia.";
    }
  }

  _select(label, value, options, onChange) {
    return html`<div class="row"><label>${label}</label>
      <select @change=${(e) => onChange(e.target.value)}>
        ${options.map(([v, text]) => html`<option value=${v} ?selected=${String(value) === String(v)}>${text}</option>`)}
      </select></div>`;
  }

  render() {
    const d = this._d;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>Ustawienia MT_SW</h3>
          <p>Nasze własne ustawienia w jednym miejscu. Sniffer, Firmware (OTA), Pamięć, Czat, Debugowanie oraz Wsparcie i zgłoszenia mają swoje pozycje w tej samej grupie.</p>
        </div>
        <div class="settings-panel-body">
          <h4>Zdrowie sieci — wygląd na start</h4>
          ${this._select("Domyślna zakładka", d.metric, METRICS, (v) => this._set({ metric: v }))}
          ${this._select("Domyślny czas aktywności", d.activity, ACTIVITY.map((t, i) => [i, t]), (v) => this._set({ activity: Number(v) }))}
          ${this._select("Domyślne sortowanie", d.sort, [["value", "Wg wartości"], ["heard", "Wg ostatnio słyszanych"]], (v) => this._set({ sort: v }))}
          ${this._select("Domyślny zakres wykresów", d.range, RANGES.map((t, i) => [i, t]), (v) => this._set({ range: Number(v) }))}
          <mesh-toggle .label=${"Ulubione na górze listy"} .description=${"Ulubione węzły są zawsze na początku listy, a dalej obowiązuje wybrane sortowanie."} .checked=${d.fav_top} @change=${(e) => this._set({ fav_top: e.detail.checked })}></mesh-toggle>
          <mesh-toggle .label=${"Ukryj ignorowane"} .description=${"Węzły oznaczone jako ignorowane nie pojawiają się na listach."} .checked=${d.hide_ignored} @change=${(e) => this._set({ hide_ignored: e.detail.checked })}></mesh-toggle>
          ${this._msg ? html`<div class="err">${this._msg}</div>` : ""}
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      settingsStyles,
      css`
        :host { display: block; }
        h4 { margin: 14px 0 8px; font-weight: 500; }
        .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; }
        select { padding: 6px 8px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
        .err { margin-top: 10px; padding: 8px 12px; border-radius: 8px; font-size: 13px; color: #f44336; background: rgba(244, 67, 54, 0.1); }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-mtsw")) customElements.define("mesh-settings-mtsw", MeshSettingsMtsw);
