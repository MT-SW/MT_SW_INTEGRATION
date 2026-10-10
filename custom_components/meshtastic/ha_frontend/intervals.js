/*
 * Listy wyboru czasu w ustawieniach — te same wartości i nazwy co w aplikacji
 * Meshtastic na Androida ("1 godzina", "2 godziny"…), zamiast wpisywania sekund.
 *
 * Odblokowanie (5 kliknięć w numer wersji) znosi dolne limity, tak jak w apce:
 * stan trzymamy tylko w pamięci strony, nie zapisujemy go nigdzie.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";

const H = 3600;
const LONG = [10800, 14400, 18000, 21600, 43200, 64800, 86400, 129600, 172800, 259200];
const BROADCAST_SHORT = [300, 600, 900, 1800, 3600, 7200, ...LONG];

/* Wartości w sekundach, jak IntervalConfiguration.allowedIntervals w aplikacji. */
export const INTERVAL_LISTS = {
  broadcast_short: BROADCAST_SHORT,
  broadcast_medium: BROADCAST_SHORT,
  broadcast_long: LONG,
  mesh_beacon: [H, 7200, ...LONG],
  node_info: [0, ...LONG],
  detection_minimum: [0, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, ...LONG],
  detection_state: [0, 900, 1800, 3600, 7200, ...LONG],
  nag_timeout: [0, 1, 5, 10, 15, 30, 60],
  pax_counter: [900, 1800, 3600, 7200, ...LONG],
  position_broadcast: [0, 60, 90, 300, 900, 3600, 7200, ...LONG],
  neighbor_info: [14400, 18000, 21600, 28800, 36000, 43200, 64800, 86400],
  gps_update: [0, 8, 20, 40, 60, 80, 120, 300, 600, 900, 1800, 3600, 21600, 43200, 86400],
  range_test_sender: [0, 15, 30, 45, 60, 300, 600, 900, 1800, 3600],
  smart_minimum: [15, 30, 45, 60, 300, 600, 900, 1800, 3600],
  screen_on: [15, 30, 60, 300, 600, 900, 1800, 3600, 2147483647],
  screen_carousel: [0, 15, 30, 60, 300, 600, 900],
  all: [
    0, 1, 2, 3, 4, 5, 8, 10, 15, 20, 30, 40, 45, 80, 90,
    60, 120, 300, 600, 900, 1800,
    3600, 7200, 10800, 14400, 18000, 21600, 28800, 36000, 43200, 64800, 86400, 129600, 172800, 259200,
    2147483647,
  ],
};

export const MIN_DEVICE_METRICS_SECS = 2 * H;
export const MIN_BROADCAST_SECS = 6 * H;

const ALWAYS_ON = 2147483647;

const TEXT = {
  pl: {
    unset: "Nieustawiony",
    always: "Zawsze włączone",
    custom: "Własna",
    unit: {
      s: ["sekunda", "sekundy", "sekund"],
      m: ["minuta", "minuty", "minut"],
      h: ["godzina", "godziny", "godzin"],
    },
  },
  en: {
    unset: "Unset",
    always: "Always on",
    custom: "Custom",
    unit: { s: ["second", "seconds", "seconds"], m: ["minute", "minutes", "minutes"], h: ["hour", "hours", "hours"] },
  },
};

export function formatInterval(seconds, language = "pl") {
  const text = TEXT[language === "en" ? "en" : "pl"];
  const value = Number(seconds) || 0;
  if (value === 0) {
    return text.unset;
  }
  if (value === ALWAYS_ON) {
    return text.always;
  }
  let amount = value;
  let unit = "s";
  if (value >= H && value % H === 0) {
    amount = value / H;
    unit = "h";
  } else if (value >= 60 && value % 60 === 0) {
    amount = value / 60;
    unit = "m";
  }
  const forms = text.unit[unit];
  const category = new Intl.PluralRules(language === "en" ? "en" : "pl").select(amount);
  const word = category === "one" ? forms[0] : category === "few" ? forms[1] : forms[2];
  return `${amount} ${word}`;
}

/* ── Odblokowanie (jak HiddenFeaturesUnlock w aplikacji) ── */
const UNLOCK_CLICKS = 5;
const UNLOCKED_CLICKS = 3;
const UNLOCK_RESET_MS = 1000;
const UNLOCK_EVENT = "mtsw-intervals-unlock-changed";

let unlocked = false;
let clicks = 0;
let resetTimer = null;

export function intervalsUnlocked() {
  return unlocked;
}

/* Zwraca komunikat do pokazania (albo null), gdy kliknięcie nic nie zmienia. */
export function registerVersionClick() {
  clicks += 1;
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
  if (!unlocked && clicks >= UNLOCK_CLICKS) {
    unlocked = true;
    clicks = 0;
    window.dispatchEvent(new CustomEvent(UNLOCK_EVENT));
    return "unlocked";
  }
  if (unlocked && clicks >= UNLOCKED_CLICKS) {
    clicks = 0;
    return "already";
  }
  resetTimer = setTimeout(() => {
    clicks = 0;
    resetTimer = null;
  }, UNLOCK_RESET_MS);
  return null;
}

/* ── <mesh-interval-select> ── */
export class MeshIntervalSelect extends LitElement {
  static get properties() {
    return {
      label: { type: String },
      description: { type: String },
      value: { type: Number },
      kind: { type: String },
      minSecs: { type: Number },
      language: { type: String },
      _unlocked: { state: true },
    };
  }

  constructor() {
    super();
    this.value = 0;
    this.kind = "all";
    this.minSecs = 0;
    this.language = "pl";
    this._unlocked = unlocked;
    this._onUnlock = () => {
      this._unlocked = unlocked;
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(UNLOCK_EVENT, this._onUnlock);
    this._unlocked = unlocked;
  }

  disconnectedCallback() {
    window.removeEventListener(UNLOCK_EVENT, this._onUnlock);
    super.disconnectedCallback();
  }

  static get styles() {
    return css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      label {
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      select {
        padding: 8px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        background: var(--primary-background-color);
        color: var(--primary-text-color);
        font-size: 14px;
        outline: none;
      }
      select:focus {
        border-color: var(--primary-color);
      }
      .description {
        font-size: 11px;
        color: var(--secondary-text-color);
        opacity: 0.8;
      }
    `;
  }

  /* Wartość spoza listy (np. ustawiona wcześniej w sekundach) nie może zniknąć —
     pokazujemy ją jako "Własna", żeby zapis formularza jej nie zmienił. */
  _options() {
    const base = INTERVAL_LISTS[this.kind] || INTERVAL_LISTS.all;
    const current = Number(this.value) || 0;
    const min = Number(this.minSecs) || 0;
    const list = base.filter((v) => this._unlocked || v >= min || v === current);
    const out = list.map((v) => ({ value: v, label: formatInterval(v, this.language) }));
    if (!list.includes(current)) {
      const text = TEXT[this.language === "en" ? "en" : "pl"];
      out.push({ value: current, label: `${text.custom}: ${formatInterval(current, this.language)} (${current} s)` });
      out.sort((a, b) => a.value - b.value);
    }
    return out;
  }

  render() {
    const label = this.label ? this.label.replace(/\s*\((s|secs?|sek\.?)\)\s*$/i, "") : "";
    const current = Number(this.value) || 0;
    return html`
      ${label ? html`<label>${label}</label>` : ""}
      <select @change=${this._onChange}>
        ${this._options().map(
          (opt) => html`<option value=${opt.value} ?selected=${opt.value === current}>${opt.label}</option>`
        )}
      </select>
      ${this.description ? html`<span class="description">${this.description}</span>` : ""}
    `;
  }

  _onChange(e) {
    this.value = Number(e.target.value);
    this.dispatchEvent(new CustomEvent("change", { detail: { value: this.value }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("mesh-interval-select")) {
  customElements.define("mesh-interval-select", MeshIntervalSelect);
}
