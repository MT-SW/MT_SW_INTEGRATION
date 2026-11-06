/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Ustawienia → Inne → Wsparcie i zgłoszenia: „Wesprzyj projekt” (dobrowolna wpłata, link do strony
 * dewelopera) oraz „Zgłoś błąd lub pomysł” — jak w aplikacji: wybór grupy (Discord, WhatsApp, Signal),
 * opcjonalny opis i paczka z logami integracji, a także przełącznik zbierania logów debugowania.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { settingsStyles } from "./styles.js";
import { IdIndex, collectChunks } from "./log-index.js";
import "./components.js";

const SUPPORT_URL = "https://ko-fi.com/spontanicznemajsterkowanie";
const GROUPS = [
  { id: "discord", name: "Discord", icon: "mdi:forum", url: "https://discord.gg/EJqUHpvVKN", pl: "Nasz serwer: błędy, pomysły i rozmowy", en: "Our server: bugs, ideas and chat" },
  { id: "whatsapp", name: "WhatsApp", icon: "mdi:whatsapp", url: "https://chat.whatsapp.com/HNrO14NTKTx0xiQGKDVX7N", pl: "Nasza grupa na WhatsAppie", en: "Our WhatsApp group" },
  { id: "signal", name: "Signal", icon: "mdi:message-lock", url: "https://signal.group/#CjQKIJrjVtcmsLIgJre9nmpUlTwLMpZnvvIXZUH3LSC9yGDtEhCOjGRHVeloUHeC9rTvL--l", pl: "Nasza grupa na Signalu", en: "Our Signal group" },
];

const TXT = {
  pl: {
    title: "Wsparcie i zgłoszenia",
    sup_h: "Wesprzyj projekt",
    sup_d: "MT_SW jest darmowe i tworzy je społeczność, po godzinach. Jeśli chcesz pomóc, możesz dobrowolnie wesprzeć utrzymanie i rozwój aplikacji, MT_SW_FIRMWARE i tej integracji z Home Assistant. Wpłaty trafiają na konto dewelopera (spontanicznemajsterkowanie), który rozdziela je na potrzeby całej ekipy. Integracja zawsze zostaje darmowa.",
    sup_b: "Wesprzyj projekt",
    rep_h: "Zgłoś błąd lub pomysł",
    rep_d: "Poinformuj nas o tym! Możesz zgłaszać błędy i propozycje nowych funkcji — każde zgłoszenie pomaga nam ulepszać integrację.",
    rep_tips: "Zgłaszając błąd, napisz najlepiej, co dokładnie się stało, jakiej wersji integracji używasz, jakie masz radio i jaką wersję firmware.",
    note: "Co się stało? (opcjonalnie)",
    logs: "Dołącz logi integracji",
    logs_hint: "Logi nie opuszczają Twojego komputera: zapiszą się jako plik, który sam dołączysz w wybranej grupie.",
    send_to: "Dokąd wysłać zgłoszenie?",
    mesh: "Możesz też napisać do nas przez samą sieć mesh w województwie świętokrzyskim.",
    preparing: "Przygotowuję paczkę ze zgłoszeniem…",
    done: "Plik ze zgłoszeniem zapisał się w Pobranych. Grupa otworzyła się w nowej karcie: dołącz tam ten plik.",
    failed: "Nie udało się przygotować logów. Grupa się otwiera, opisz tam problem słowami.",
    cap_h: "Zbieranie logów",
    cap_d: "Włącz zbieranie logów debugowania przed odtworzeniem błędu, żeby w zgłoszeniu było więcej szczegółów. Pełny podgląd i zapis logów jest w Ustawienia → Inne → Debugowanie.",
    cap_t: "Zbieraj logi debugowania integracji",
    cap_s: "Wyłączone domyślnie. Logi są tylko w pamięci i znikają po restarcie.",
  },
  en: {
    title: "Support and reports",
    sup_h: "Support the project",
    sup_d: "MT_SW is free and built by the community in their spare time. If you want to help, you can voluntarily support the upkeep and development of the app, MT_SW_FIRMWARE and this Home Assistant integration. Donations go to the developer's account (spontanicznemajsterkowanie), who shares them among the whole team. The integration always stays free.",
    sup_b: "Support the project",
    rep_h: "Report a bug or idea",
    rep_d: "Let us know! You can report bugs and suggest new features — every report helps us improve the integration.",
    rep_tips: "When reporting a bug, it helps if you write what exactly happened, which integration version you use, which radio and which firmware version you have.",
    note: "What happened? (optional)",
    logs: "Attach integration logs",
    logs_hint: "Logs never leave your computer: they are saved as a file that you attach yourself in the chosen group.",
    send_to: "Where do you want to send the report?",
    mesh: "You can also write to us over the mesh network itself in the Świętokrzyskie region.",
    preparing: "Preparing the report package…",
    done: "The report file was saved to Downloads. The group opened in a new tab: attach the file there.",
    failed: "The logs could not be prepared. The group is opening, describe the problem there in words.",
    cap_h: "Log collection",
    cap_d: "Turn on debug log collection before reproducing a bug so the report has more detail. The full viewer and export are in Settings → Other → Debug.",
    cap_t: "Collect integration debug logs",
    cap_s: "Off by default. Logs are kept in memory only and disappear after a restart.",
  },
};

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const lineTime = (ts) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const fmt = (e) => `${lineTime(e.ts)}  ${e.level}/${e.source || "-"}: ${e.message}`;

class MeshSettingsSupport extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      wsCommand: { type: Object },
      _note: { type: String, state: true },
      _withLogs: { type: Boolean, state: true },
      _busy: { type: Boolean, state: true },
      _msg: { type: String, state: true },
      _capture: { type: Boolean, state: true },
    };
  }

  constructor() {
    super();
    this._note = "";
    this._withLogs = true;
    this._busy = false;
    this._msg = "";
    this._capture = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadCapture();
  }

  _t() {
    const lang = ((this.hass && this.hass.language) || "pl").startsWith("pl") ? "pl" : "en";
    return { ...TXT[lang], lang };
  }

  async _loadCapture() {
    if (!this.wsCommand) return;
    try {
      const res = await this.wsCommand("meshtastic_ui/debug_logs_status");
      if (res && res.ok && res.integration) this._capture = res.integration.debug_capture === true;
    } catch (err) {
      console.warn("MT_SW: stan zbierania logów", err);
    }
  }

  async _setCapture(enabled) {
    const previous = this._capture;
    this._capture = enabled;
    try {
      const res = await this.wsCommand("meshtastic_ui/debug_logs_capture_debug", { enabled });
      if (!res || !res.ok) this._capture = previous;
    } catch (err) {
      console.warn("MT_SW: przełączenie zbierania logów", err);
      this._capture = previous;
    }
  }

  async _logText() {
    const res = await this.wsCommand("meshtastic_ui/debug_logs_index", {
      source: "integration",
      since: 0,
      hide_levels: [],
      query: "",
      tz_offset: 0,
      tail: 0,
    });
    if (!res || !res.ok) throw new Error("index");
    const index = new IdIndex();
    index.apply(res);
    const chunks = await collectChunks(index, {
      chunkSize: 500,
      fetchEntries: async (ids) => {
        const r = await this.wsCommand("meshtastic_ui/debug_logs_get", { source: "integration", ids });
        if (!r || !r.ok) throw new Error("get");
        return r.entries || [];
      },
      format: fmt,
    });
    return chunks.join("");
  }

  _save(text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mt_sw_zgloszenie_${stamp(new Date())}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async _send(group) {
    const x = this._t();
    this._busy = true;
    this._msg = x.preparing;
    let ok = true;
    if (this._withLogs) {
      try {
        const head = [
          "MT_SW_INTEGRATION — zgłoszenie / report",
          `Data / date: ${new Date().toString()}`,
          `Home Assistant: ${(this.hass && this.hass.config && this.hass.config.version) || "?"}`,
          `Opis / note: ${this._note || "-"}`,
          "",
          "--- logi integracji / integration logs ---",
          "",
        ].join("\n");
        this._save(head + (await this._logText()));
      } catch (err) {
        console.warn("MT_SW: paczka ze zgłoszeniem", err);
        ok = false;
      }
    }
    window.open(group.url, "_blank", "noopener");
    this._msg = this._withLogs ? (ok ? x.done : x.failed) : "";
    this._busy = false;
  }

  render() {
    const x = this._t();
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header"><h3>${x.title}</h3></div>
        <div class="settings-panel-body">
          <h4>${x.sup_h}</h4>
          <p class="d">${x.sup_d}</p>
          <button class="btn" @click=${() => window.open(SUPPORT_URL, "_blank", "noopener")}>
            <ha-icon icon="mdi:heart-outline"></ha-icon> ${x.sup_b}
          </button>

          <h4>${x.rep_h}</h4>
          <p class="d">${x.rep_d}</p>
          <p class="d">${x.rep_tips}</p>
          <textarea rows="3" placeholder=${x.note} .value=${this._note} @input=${(e) => (this._note = e.target.value)}></textarea>
          <mesh-toggle
            .label=${x.logs}
            .description=${x.logs_hint}
            .checked=${this._withLogs}
            @change=${(e) => (this._withLogs = e.detail.checked)}
          ></mesh-toggle>
          <p class="d"><b>${x.send_to}</b></p>
          <div class="groups">
            ${GROUPS.map(
              (g) => html`<button class="btn" ?disabled=${this._busy} @click=${() => this._send(g)}>
                <ha-icon icon=${g.icon}></ha-icon> <span><b>${g.name}</b><small>${g[x.lang]}</small></span>
              </button>`
            )}
          </div>
          ${this._msg ? html`<p class="d">${this._msg}</p>` : ""}
          <p class="d">${x.mesh}</p>

          <h4>${x.cap_h}</h4>
          <p class="d">${x.cap_d}</p>
          <mesh-toggle .label=${x.cap_t} .description=${x.cap_s} .checked=${this._capture} @change=${(e) => this._setCapture(e.detail.checked)}></mesh-toggle>
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      settingsStyles,
      css`
        :host { display: block; }
        h4 { margin: 18px 0 6px; font-weight: 500; }
        .d { font-size: 13px; color: var(--secondary-text-color); margin: 6px 0; }
        textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; margin: 6px 0; }
        .groups { display: flex; flex-wrap: wrap; gap: 8px; }
        .btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; cursor: pointer; text-align: left; }
        .btn:disabled { opacity: 0.5; cursor: default; }
        .btn small { display: block; font-size: 11px; color: var(--secondary-text-color); }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-support")) customElements.define("mesh-settings-support", MeshSettingsSupport);
