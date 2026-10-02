/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Ustawienia → Inne → Debugowanie: dwa osobne logi, tak jak w aplikacji Android.
 *
 *  - "Urządzenie"  — rekordy logu firmware (to samo, co radio wypisuje na porcie
 *    szeregowym). Linie wyglądają jak w aplikacji: "data  L/źródło: treść",
 *    gdzie L to T, D, I, W, E albo C. Przez Bluetooth działa z każdym firmware,
 *    przez Wi-Fi i USB tylko z firmware MT_SW, a radio wysyła logi dopiero po
 *    włączeniu "Logi debugowania" w ustawieniach zabezpieczeń.
 *  - "Integracja"  — logi Pythona samej integracji (custom_components.meshtastic).
 *
 * Logi zbiera integracja (bufory w pamięci, do 2000 wpisów); panel dopytuje
 * przyrostowo (since = id ostatniego wpisu) co ~2 s, ale tylko gdy widok jest
 * widoczny. Lista jest w kolejności chronologicznej (najnowsze na dole) i może
 * śledzić nowe wpisy (auto-przewijanie).
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { settingsStyles } from "./styles.js";
import "./components.js";

const POLL_MS = 2000;
const CAPACITY = 2000;

/* poziomy jak w aplikacji: litera pierwszego znaku nazwy poziomu */
const DEVICE_LEVELS = ["T", "D", "I", "W", "E", "C"];
const INTEGRATION_LEVELS = ["D", "I", "W", "E", "C"];
const LEVEL_NAMES = {
  T: "TRACE",
  D: "DEBUG",
  I: "INFO",
  W: "WARNING",
  E: "ERROR",
  C: "CRITICAL",
};

const DEVICE_EMPTY =
  "Brak logów urządzenia. Włącz „Logi debugowania” w ustawieniach zabezpieczeń urządzenia, aby radio wysyłało do aplikacji te same logi, które widać na porcie szeregowym. Przez Bluetooth działa to z każdym firmware, a przez Wi-Fi i USB tylko z firmware MT_SW.";
const INTEGRATION_EMPTY = "Brak logów integracji.";

const pad = (n) => String(n).padStart(2, "0");

function formatTime(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fileStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/* "2026-10-02 14:03:11  I/źródło: treść" — jak wiersz logu w aplikacji */
function formatLine(entry) {
  return `${formatTime(entry.ts)}  ${entry.level}/${entry.source || "-"}: ${entry.message}`;
}

function newTabState() {
  return {
    entries: [],
    lastId: 0,
    epoch: null,
    meta: null,
    levels: null, // null = wszystkie
    query: "",
  };
}

class MeshSettingsDebugLogs extends LitElement {
  static get properties() {
    return {
      wsCommand: { type: Object },
      _tab: { type: String, state: true },
      _status: { type: Object, state: true },
      _error: { type: String, state: true },
      _busy: { type: Boolean, state: true },
      _autoScroll: { type: Boolean, state: true },
      _copied: { type: Boolean, state: true },
      _clearConfirm: { type: Boolean, state: true },
      _rev: { type: Number, state: true },
    };
  }

  constructor() {
    super();
    this._tab = "device";
    this._status = null;
    this._error = "";
    this._busy = false;
    this._autoScroll = true;
    this._copied = false;
    this._clearConfirm = false;
    this._rev = 0;
    this._state = { device: newTabState(), integration: newTabState() };
    this._timer = null;
    this._polling = false;
    this._inView = true;
    this._observer = null;
    this._onVisibility = () => this._syncPolling();
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this._onVisibility);
    if (typeof IntersectionObserver !== "undefined") {
      this._observer = new IntersectionObserver((records) => {
        const last = records[records.length - 1];
        this._inView = Boolean(last && last.isIntersecting);
        this._syncPolling();
      });
      this._observer.observe(this);
    }
    if (this.wsCommand) this._syncPolling();
  }

  firstUpdated() {
    // wsCommand jest już ustawione; dopiero teraz można pytać integrację
    this._loadStatus();
    this._syncPolling();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this._onVisibility);
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._stopPolling();
  }

  /* ── odpytywanie: tylko gdy widok widać ─────────────────── */

  _syncPolling() {
    if (this.isConnected && this._inView && !document.hidden) {
      if (!this._timer) {
        this._poll();
        this._timer = setInterval(() => this._poll(), POLL_MS);
      }
    } else {
      this._stopPolling();
    }
  }

  _stopPolling() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async _poll() {
    if (this._polling || !this.wsCommand) return;
    this._polling = true;
    const source = this._tab;
    const st = this._state[source];
    try {
      const res = await this.wsCommand("meshtastic_ui/debug_logs_list", { source, since: st.lastId });
      if (!res || !res.ok) return;
      if (st.epoch !== null && res.epoch !== st.epoch) {
        // integracja została przeładowana — numeracja zaczęła się od nowa
        st.entries = [];
        st.lastId = 0;
        st.epoch = res.epoch;
        st.meta = res;
        this._rev += 1;
        return;
      }
      const countChanged = !st.meta || st.meta.count !== res.count;
      st.epoch = res.epoch;
      st.meta = res;
      if (countChanged || res.entries.length) this._rev += 1;
      if (res.entries.length) {
        const merged = st.entries.concat(res.entries);
        st.entries = merged.length > CAPACITY ? merged.slice(merged.length - CAPACITY) : merged;
        st.lastId = res.entries[res.entries.length - 1].id;
      }
    } finally {
      this._polling = false;
    }
  }

  async _loadStatus() {
    if (!this.wsCommand) return;
    const res = await this.wsCommand("meshtastic_ui/debug_logs_status");
    if (res && res.ok) {
      this._status = res;
    } else if (res && res.error) {
      this._error = res.error;
    }
  }

  /* ── akcje ────────────────────────────────────────────────── */

  async _run(type, data, onOk) {
    if (this._busy) return;
    this._busy = true;
    this._error = "";
    const res = await this.wsCommand(type, data);
    this._busy = false;
    if (!res || !res.ok) {
      this._error = (res && res.error) || "Operacja nie powiodła się.";
      return;
    }
    onOk(res);
  }

  _setCollecting(enabled) {
    return this._run("meshtastic_ui/debug_logs_collect", { enabled }, (res) => {
      this._status = { ...(this._status || {}), device: res };
    });
  }

  _setFirmwareApi(enabled) {
    return this._run("meshtastic_ui/debug_logs_firmware_api", { enabled }, (res) => {
      this._status = { ...(this._status || {}), device: res };
    });
  }

  _setDebugCapture(enabled) {
    return this._run("meshtastic_ui/debug_logs_capture_debug", { enabled }, (res) => {
      this._status = { ...(this._status || {}), integration: res };
      this._poll();
    });
  }

  async _clear() {
    const source = this._tab;
    await this._run("meshtastic_ui/debug_logs_clear", { source }, () => {
      const st = this._state[source];
      st.entries = [];
      this._rev += 1;
    });
    this._loadStatus();
  }

  _switchTab(tab) {
    if (tab === this._tab) return;
    this._tab = tab;
    this._copied = false;
    this._poll();
  }

  /* ── filtry ───────────────────────────────────────────────── */

  _allLevels() {
    return this._tab === "device" ? DEVICE_LEVELS : INTEGRATION_LEVELS;
  }

  _toggleLevel(level) {
    const st = this._state[this._tab];
    const current = new Set(st.levels || this._allLevels());
    if (current.has(level)) current.delete(level);
    else current.add(level);
    st.levels = current.size === this._allLevels().length ? null : current;
    this._rev += 1;
  }

  /* jak w aplikacji: ukrywamy tylko znany, odznaczony poziom — nieznane zostają */
  _filtered() {
    const st = this._state[this._tab];
    const known = new Set(this._allLevels());
    const query = st.query.trim().toLowerCase();
    return st.entries.filter((entry) => {
      if (st.levels && known.has(entry.level) && !st.levels.has(entry.level)) return false;
      if (query && !formatLine(entry).toLowerCase().includes(query)) return false;
      return true;
    });
  }

  _text() {
    return this._filtered().map(formatLine).join("\n");
  }

  async _copy() {
    const text = this._text();
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // bez HTTPS przeglądarka nie daje dostępu do schowka — plik zamiast tego
      this._download();
      return;
    }
    this._copied = true;
    setTimeout(() => {
      this._copied = false;
    }, 1500);
  }

  _download() {
    const name = this._tab === "device" ? "mt_sw_device_log" : "mt_sw_integration_log";
    const blob = new Blob([this._text() + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}_${fileStamp(new Date())}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  updated() {
    if (!this._autoScroll) return;
    const list = this.renderRoot.querySelector(".log-list");
    if (list) list.scrollTop = list.scrollHeight;
  }

  /* ── widok ────────────────────────────────────────────────── */

  _levelClass(level) {
    if (level === "E" || level === "C") return "lvl-error";
    if (level === "W") return "lvl-warn";
    return "";
  }

  _renderDeviceControls() {
    const dev = (this._status && this._status.device) || {};
    const api = dev.firmware_api_enabled;
    return html`
      <div class="controls">
        <mesh-toggle
          .label=${"Zbieranie logów urządzenia"}
          .description=${"Gdy włączone, integracja zapisuje w pamięci rekordy logu wysyłane przez radio (do 2000 ostatnich). Przez Bluetooth włącza też odbiór logów z radia."}
          .checked=${dev.collecting !== false}
          @change=${(e) => this._setCollecting(e.detail.checked)}
        ></mesh-toggle>
        <mesh-toggle
          .label=${"Logi debugowania w radiu"}
          .description=${"Ustawienie „Logi debugowania” (API dziennika debugowania) w konfiguracji zabezpieczeń radia. Bez niego radio nie wysyła logów. Zmiana zapisuje konfigurację i może zrestartować radio."}
          .checked=${api === true}
          @change=${(e) => this._setFirmwareApi(e.detail.checked)}
        ></mesh-toggle>
        <div class="note ${dev.any_firmware === false ? "note-warn" : ""}">
          ${dev.any_firmware === true
            ? "To połączenie Bluetooth — logi urządzenia działają z każdym firmware."
            : dev.any_firmware === false
              ? "To połączenie Wi-Fi/TCP lub USB (port szeregowy) — logi urządzenia działają tylko z firmware MT_SW. Przez Bluetooth działają z każdym firmware."
              : "Przez Bluetooth logi działają z każdym firmware, a przez Wi-Fi i USB tylko z firmware MT_SW."}
        </div>
      </div>
    `;
  }

  _renderIntegrationControls() {
    const info = (this._status && this._status.integration) || {};
    return html`
      <div class="controls">
        <mesh-toggle
          .label=${"Zbieraj także poziom DEBUG"}
          .description=${"Domyślnie widać wpisy zapisywane przez Home Assistant (zwykle od poziomu INFO). Włączenie podnosi poziom logowania integracji do DEBUG — te wpisy trafią też do głównego logu Home Assistanta. Ustawienie znika po przeładowaniu integracji."}
          .checked=${info.debug_capture === true}
          @change=${(e) => this._setDebugCapture(e.detail.checked)}
        ></mesh-toggle>
      </div>
    `;
  }

  _renderList(lines) {
    const st = this._state[this._tab];
    if (!lines.length) {
      const hasEntries = st.entries.length > 0;
      return html`<div class="empty">
        ${hasEntries
          ? "Żaden wpis nie pasuje do filtrów."
          : this._tab === "device"
            ? DEVICE_EMPTY
            : INTEGRATION_EMPTY}
      </div>`;
    }
    return html`<div class="log-list" @scroll=${() => this._userScrolled()}>
      ${lines.map(
        (entry) => html`<div class="line ${this._levelClass(entry.level)}">${formatLine(entry)}</div>`
      )}
    </div>`;
  }

  /* ręczne przewinięcie wyłącza śledzenie, żeby lista nie uciekała spod palca */
  _userScrolled() {
    const list = this.renderRoot.querySelector(".log-list");
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
    if (!atBottom && this._autoScroll) this._autoScroll = false;
  }

  render() {
    const st = this._state[this._tab];
    const levels = this._allLevels();
    const active = st.levels || new Set(levels);
    const lines = this._filtered();
    const meta = st.meta || {};
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>Debugowanie</h3>
          <p>Dwa osobne logi: z urządzenia (firmware radia) i z samej integracji.</p>
        </div>
        <div class="settings-panel-body">
          <div class="segments">
            <button class="seg ${this._tab === "device" ? "on" : ""}" @click=${() => this._switchTab("device")}>Urządzenie</button>
            <button class="seg ${this._tab === "integration" ? "on" : ""}" @click=${() => this._switchTab("integration")}>Integracja</button>
          </div>

          ${this._error ? html`<div class="error">${this._error}</div>` : ""}
          ${this._tab === "device" ? this._renderDeviceControls() : this._renderIntegrationControls()}

          <div class="toolbar">
            <input
              class="search"
              type="search"
              placeholder="Szukaj w logach"
              .value=${st.query}
              @input=${(e) => {
                st.query = e.target.value;
                this._rev += 1;
              }}
            />
            <div class="chips">
              ${levels.map(
                (level) => html`<button
                  class="chip ${active.has(level) ? "on" : ""}"
                  title=${LEVEL_NAMES[level]}
                  @click=${() => this._toggleLevel(level)}
                >${level}</button>`
              )}
            </div>
          </div>

          <div class="toolbar">
            <label class="check">
              <input
                type="checkbox"
                .checked=${this._autoScroll}
                @change=${(e) => {
                  this._autoScroll = e.target.checked;
                }}
              />
              Przewijaj automatycznie
            </label>
            <span class="count">${lines.length} / ${meta.count ?? st.entries.length} (maks. ${meta.capacity ?? CAPACITY})</span>
            <span class="spacer"></span>
            <button class="btn" ?disabled=${!lines.length} @click=${() => this._copy()}>
              <ha-icon icon=${this._copied ? "mdi:check" : "mdi:content-copy"}></ha-icon>${this._copied ? "Skopiowano" : "Kopiuj"}
            </button>
            <button class="btn" ?disabled=${!lines.length} @click=${() => this._download()}>
              <ha-icon icon="mdi:download"></ha-icon>Pobierz .txt
            </button>
            <button class="btn danger" ?disabled=${!st.entries.length} @click=${() => { this._clearConfirm = true; }}>
              <ha-icon icon="mdi:trash-can-outline"></ha-icon>Wyczyść logi
            </button>
          </div>

          ${this._renderList(lines)}
          ${this._tab === "device" && lines.length
            ? html`<div class="note">Eksport i kopia zawierają to, co widać na liście. Log urządzenia może zawierać szczegóły węzłów i fragmenty wiadomości — sprawdź go przed publicznym udostępnieniem.</div>`
            : ""}
        </div>
      </div>

      <mesh-confirm-dialog
        .open=${this._clearConfirm}
        .title=${"Wyczyścić logi?"}
        .message=${"Wszystkie zebrane wpisy tego logu zostaną usunięte z pamięci integracji. Zbieranie trwa dalej."}
        .confirmLabel=${"Wyczyść logi"}
        .danger=${true}
        @confirm=${() => { this._clearConfirm = false; this._clear(); }}
        @cancel=${() => { this._clearConfirm = false; }}
      ></mesh-confirm-dialog>
    `;
  }

  static get styles() {
    return [
      settingsStyles,
      css`
        :host { display: block; }
        .segments { display: flex; gap: 0; margin-bottom: 12px; }
        .seg {
          flex: 1; padding: 8px 12px; cursor: pointer; font-size: 14px;
          border: 1px solid var(--divider-color); background: transparent;
          color: var(--primary-text-color);
        }
        .seg:first-child { border-radius: 8px 0 0 8px; }
        .seg:last-child { border-radius: 0 8px 8px 0; border-left: none; }
        .seg.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
        .controls { margin-bottom: 8px; }
        .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
        .spacer { flex: 1; }
        .search {
          flex: 1; min-width: 160px; padding: 8px 10px; font-size: 14px;
          border: 1px solid var(--divider-color); border-radius: 8px;
          background: var(--card-background-color); color: var(--primary-text-color);
        }
        .chips { display: flex; gap: 4px; }
        .chip {
          min-width: 32px; padding: 6px 8px; cursor: pointer; font-size: 12px; font-weight: 600;
          border: 1px solid var(--divider-color); border-radius: 16px; background: transparent;
          color: var(--secondary-text-color);
        }
        .chip.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        .check { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
        .count { font-size: 12px; color: var(--secondary-text-color); }
        .btn {
          display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; cursor: pointer;
          font-size: 13px; border: 1px solid var(--divider-color); border-radius: 8px;
          background: transparent; color: var(--primary-text-color);
        }
        .btn ha-icon { --mdc-icon-size: 18px; }
        .btn[disabled] { opacity: 0.5; cursor: default; }
        .btn.danger { color: var(--error-color, #f44336); }
        .log-list {
          height: calc(var(--mtsw-tab-height, calc(100vh - 105px)) - 330px);
          min-height: 240px;
          overflow: auto;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          user-select: text;
        }
        .line {
          padding: 2px 8px;
          font-family: var(--code-font-family, monospace);
          font-size: 11px;
          white-space: pre-wrap;
          word-break: break-word;
          border-bottom: 1px solid var(--divider-color);
        }
        .line.lvl-error { color: var(--error-color, #f44336); }
        .line.lvl-warn { color: var(--warning-color, #ff9800); }
        .empty { padding: 24px 16px; text-align: center; font-size: 13px; color: var(--secondary-text-color); border: 1px dashed var(--divider-color); border-radius: 8px; }
        .note { margin-top: 6px; font-size: 12px; color: var(--secondary-text-color); }
        .note-warn { color: var(--warning-color, #ff9800); }
        .error {
          background: rgba(244,67,54,0.1); border: 1px solid rgba(244,67,54,0.3);
          border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; color: #f44336; font-size: 13px;
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-debug-logs")) {
  customElements.define("mesh-settings-debug-logs", MeshSettingsDebugLogs);
}
