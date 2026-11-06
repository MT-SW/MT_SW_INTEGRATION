/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Ustawienia → Funkcje MT_SW: jedno miejsce z listą wszystkich naszych funkcji
 * (jak „Funkcje MT_SW” w aplikacji) i przyciskiem, który każdą otwiera.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";

const ITEMS = [
  { id: "health", where: "tab:health", icon: "mdi:heart-pulse", pl: ["Zdrowie sieci", "Oceny, rankingi, rozkłady, grupy węzłów i eksport (CSV, MD, HTML, TXT, PDF)."], en: ["Network health", "Ratings, rankings, distributions, node groups and export (CSV, MD, HTML, TXT, PDF)."] },
  { id: "nodes", where: "tab:nodes", icon: "mdi:radio-tower", pl: ["Śledzenie węzłów w HA", "Włączanie i wyłączanie encji węzłów jednym przyciskiem, także hurtem."], en: ["Tracking nodes in HA", "Turn node entities on and off with one button, also in bulk."] },
  { id: "antenna", where: "map:antenna", icon: "mdi:antenna", pl: ["Kalkulator anten", "13 typów anten: wymiary, zysk, impedancja, straty w kablu i złączach, limity pasm (na mapie)."], en: ["Antenna calculator", "13 antenna types: dimensions, gain, impedance, cable and connector losses, band limits (on the map)."] },
  { id: "horizon", where: "map:horizon", icon: "mdi:image-filter-hdr", pl: ["Panorama terenu", "Widok horyzontu z wybranego punktu z węzłami na tle terenu (na mapie)."], en: ["Terrain panorama", "Horizon view from a chosen point with nodes against the terrain (on the map)."] },
  { id: "planner", where: "tab:map", icon: "mdi:map-marker-path", pl: ["Planer zasięgu", "Profil terenu, budżet łącza, pokrycie, kable i zasilanie na mapie."], en: ["Coverage planner", "Terrain profile, link budget, coverage, cables and feeders on the map."] },
  { id: "ota", where: "settings:ota", icon: "mdi:update", pl: ["Firmware (OTA)", "Aktualizacja radia przez Wi-Fi lub Bluetooth oraz czasowe odłączenie integracji od radia."], en: ["Firmware (OTA)", "Update the radio over Wi-Fi or Bluetooth and temporarily disconnect the integration from the radio."] },
  { id: "quick", where: "tab:radio", icon: "mdi:flash", pl: ["Szybkie komendy i zdalne funkcje", "Gotowe komendy dla zdalnego węzła oraz zdalna administracja."], en: ["Quick commands and remote functions", "Ready-made commands for a remote node and remote administration."] },
  { id: "support", where: "settings:support", icon: "mdi:heart-outline", pl: ["Wsparcie i zgłoszenia", "Dobrowolne wsparcie projektu, zgłaszanie błędów i pomysłów (Discord, WhatsApp, Signal) z logami oraz przełącznik zbierania logów."], en: ["Support and reports", "Voluntary support of the project, reporting bugs and ideas (Discord, WhatsApp, Signal) with logs, and a log collection switch."] },
];

class MtswFunctionsTab extends LitElement {
  static get properties() {
    return { hass: { type: Object } };
  }

  _lang() {
    return ((this.hass && this.hass.language) || "pl").startsWith("pl") ? "pl" : "en";
  }

  _go(where) {
    this.dispatchEvent(new CustomEvent("mtsw-goto", { detail: { where }, bubbles: true, composed: true }));
  }

  render() {
    const lang = this._lang();
    return html`
      <div class="wrap">
        <h3>${lang === "pl" ? "Funkcje MT_SW" : "MT_SW functions"}</h3>
        <p class="legend">${lang === "pl" ? "Wszystkie nasze funkcje w jednym miejscu. Kliknij, żeby otworzyć." : "All our functions in one place. Click to open."}</p>
        <div class="list">
          ${ITEMS.map(
            (i) => html`<button class="item" @click=${() => this._go(i.where)}>
              <ha-icon icon=${i.icon}></ha-icon>
              <span><b>${i[lang][0]}</b><small>${i[lang][1]}</small></span>
            </button>`
          )}
        </div>
      </div>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; }
      .wrap { padding: 8px 16px 24px; max-width: 900px; }
      h3 { margin: 14px 0 6px; font-weight: 500; }
      .legend { font-size: 12px; color: var(--secondary-text-color); }
      .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
      .item { display: flex; gap: 12px; align-items: center; text-align: left; font: inherit; color: var(--primary-text-color); background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 12px; padding: 12px 14px; cursor: pointer; }
      .item:hover { background: var(--secondary-background-color); }
      ha-icon { color: var(--secondary-text-color); flex: none; }
      span { display: flex; flex-direction: column; gap: 2px; }
      small { color: var(--secondary-text-color); font-size: 12px; }
    `;
  }
}

if (!customElements.get("mtsw-functions-tab")) {
  customElements.define("mtsw-functions-tab", MtswFunctionsTab);
}
