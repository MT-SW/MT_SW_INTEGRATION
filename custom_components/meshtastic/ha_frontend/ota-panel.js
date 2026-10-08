/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Ustawienia → Inne → Firmware (OTA): aktualizacja firmware radia z ESP32 przez Wi-Fi albo Bluetooth
 * (jak w aplikacji) oraz czasowe odłączenie integracji od radia, np. żeby zrobić OTA inną aplikacją.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { settingsStyles } from "./styles.js";

const TEXT = {
  pl: {
    title: "Firmware (OTA)",
    intro: "Aktualizacja firmware radia podłączonego do Home Assistanta oraz czasowe odłączenie integracji od radia.",
    no_gateway: "Brak połączonej bramki.",
    pause_title: "Odłączenie od radia",
    pause_help:
      "Na wybrany czas integracja zamyka połączenie z radiem i go nie wznawia — radio jest wtedy wolne dla innej aplikacji (np. do aktualizacji OTA telefonem). Po upływie czasu integracja łączy się sama.",
    pause_active: "Integracja jest odłączona. Wróci za {s}.",
    pause_idle: "Integracja jest połączona z radiem.",
    pause_down: "Brak połączenia z radiem.",
    minutes: "{n} min",
    resume: "Połącz teraz",
    ota_title: "Aktualizacja firmware",
    ota_help:
      "Działa dla radia z ESP32 (np. Heltec V3, T-Beam, T-Deck…). Potrzebny jest zwykły plik firmware-…-wersja.bin dokładnie dla Twojej płytki (nie „factory”). Przy Wi-Fi radio musi mieć zapisane dane sieci Wi-Fi, przy Bluetooth musi być w zasięgu Bluetooth serwera Home Assistanta. Dla radia nRF52 (RAK4631, T-Echo…) wybierz „nRF52 (DFU)” i wyślij paczkę DFU (plik …-ota.zip) — wszystko idzie przez Bluetooth, radio musi być w zasięgu Bluetooth serwera Home Assistanta, a w polu poniżej podaj jego adres BLE.",
    files: "Pliki firmware na serwerze",
    no_files: "Brak plików. Wyślij plik albo pobierz go z adresu.",
    upload: "Wyślij plik (.bin lub .zip)",
    fetch: "Pobierz z adresu (https://…)",
    fetch_btn: "Pobierz",
    delete: "Usuń",
    mode: "Sposób",
    mode_wifi: "Wi-Fi",
    mode_ble: "Bluetooth",
    mode_dfu: "nRF52 (DFU)",
    address_wifi: "Adres IP radia w trybie OTA (puste = wykryj automatycznie)",
    address_ble: "Adres BLE radia (AA:BB:CC:DD:EE:FF)",
    start: "Rozpocznij aktualizację",
    confirm:
      "Zaczynam aktualizację firmware z pliku {f}.\n\nPlik musi być dokładnie dla tej płytki. Podczas aktualizacji radio jest niedostępne kilka minut, a integracja się od niego odłącza. Nie wyłączaj radia ani serwera.\n\nKontynuować?",
    running: "Trwa aktualizacja",
    done: "Zakończono",
    failed: "Błąd",
    state_idle: "",
    uploading_file: "Wysyłam plik na serwer…",
    saved: "Zapisano plik {f}.",
    busy: "Pracuję…",
    select_file: "Wybierz plik.",
  },
  en: {
    title: "Firmware (OTA)",
    intro: "Update the firmware of the radio connected to Home Assistant, and temporarily disconnect the integration from the radio.",
    no_gateway: "No connected gateway.",
    pause_title: "Disconnect from the radio",
    pause_help:
      "For the chosen time the integration closes its connection to the radio and does not reopen it — the radio is then free for another app (e.g. an OTA update from your phone). When the time is up the integration reconnects by itself.",
    pause_active: "The integration is disconnected. It will be back in {s}.",
    pause_idle: "The integration is connected to the radio.",
    pause_down: "No connection to the radio.",
    minutes: "{n} min",
    resume: "Reconnect now",
    ota_title: "Firmware update",
    ota_help:
      "Works for ESP32 radios (e.g. Heltec V3, T-Beam, T-Deck…). You need the plain firmware-…-version.bin for exactly your board (not “factory”). For Wi-Fi the radio must have its Wi-Fi network saved; for Bluetooth it must be within the Bluetooth range of the Home Assistant server. For nRF52 radios (RAK4631, T-Echo…) choose “nRF52 (DFU)” and upload the DFU package (…-ota.zip) — everything goes over Bluetooth, the radio must be within Bluetooth range of the Home Assistant server, and you enter its BLE address below.",
    files: "Firmware files on the server",
    no_files: "No files. Upload one or fetch it from a URL.",
    upload: "Upload a file (.bin or .zip)",
    fetch: "Fetch from URL (https://…)",
    fetch_btn: "Fetch",
    delete: "Delete",
    mode: "Method",
    mode_wifi: "Wi-Fi",
    mode_ble: "Bluetooth",
    mode_dfu: "nRF52 (DFU)",
    address_wifi: "Radio IP address in OTA mode (empty = detect automatically)",
    address_ble: "Radio BLE address (AA:BB:CC:DD:EE:FF)",
    start: "Start the update",
    confirm:
      "Starting a firmware update from file {f}.\n\nThe file must be exactly for this board. During the update the radio is unavailable for a few minutes and the integration disconnects from it. Do not power off the radio or the server.\n\nContinue?",
    running: "Update in progress",
    done: "Finished",
    failed: "Error",
    state_idle: "",
    uploading_file: "Uploading the file to the server…",
    saved: "Saved file {f}.",
    busy: "Working…",
    select_file: "Select a file.",
  },
};

class MeshSettingsOta extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      wsCommand: { type: Object },
      _status: { type: Object, state: true },
      _file: { type: String, state: true },
      _mode: { type: String, state: true },
      _address: { type: String, state: true },
      _url: { type: String, state: true },
      _busy: { type: String, state: true },
      _error: { type: String, state: true },
      _notice: { type: String, state: true },
    };
  }

  constructor() {
    super();
    this._status = null;
    this._file = "";
    this._mode = "wifi";
    this._address = "";
    this._url = "";
    this._busy = "";
    this._error = "";
    this._notice = "";
    this._timer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._refresh();
    this._schedule();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._timer);
    this._timer = null;
  }

  _schedule() {
    clearTimeout(this._timer);
    const running = this._status?.job?.running;
    const paused = this._status?.link?.paused;
    this._timer = setTimeout(async () => {
      await this._refresh();
      this._schedule();
    }, running ? 1500 : paused ? 5000 : 10000);
  }

  _tr(key, vars = {}) {
    const lang = String(this.hass?.language || "pl").toLowerCase().startsWith("pl") ? "pl" : "en";
    let text = TEXT[lang][key] ?? TEXT.pl[key] ?? key;
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(`{${name}}`, value);
    }
    return text;
  }

  /* Polecenia idą przez most ustawień (jak reszta zakładek); błąd wraca jako { ok: false, error }. */
  async _ws(type, extra = {}) {
    const result = await this.wsCommand(`meshtastic_ui/${type}`, extra);
    if (!result || result.ok === false) {
      throw new Error((result && result.error) || "Brak odpowiedzi");
    }
    return result;
  }

  async _refresh() {
    if (!this.hass || !this.wsCommand) {
      return;
    }
    try {
      this._status = await this._ws("ota_status");
      if (!this._file && this._status.files?.length) {
        this._file = this._status.files[0].name;
      }
      if (this._status.connection_type === "bluetooth" && this._mode === "wifi" && !this._touchedMode) {
        this._mode = "ble";
      }
    } catch (err) {
      console.warn("MT_SW: stan OTA", err);
    }
  }

  async _act(label, fn) {
    if (this._busy) {
      return;
    }
    this._busy = label;
    this._error = "";
    this._notice = "";
    try {
      await fn();
    } catch (err) {
      this._error = (err && err.message) || String(err);
    } finally {
      this._busy = "";
      await this._refresh();
      this._schedule();
    }
  }

  _pause(minutes) {
    return this._act("pause", () => this._ws("link_pause", { minutes }));
  }

  _resume() {
    return this._act("resume", () => this._ws("link_resume"));
  }

  _fetchUrl() {
    return this._act("fetch", async () => {
      const result = await this._ws("ota_fetch", { url: this._url.trim() });
      this._file = result.name;
      this._url = "";
      this._notice = this._tr("saved", { f: result.name });
    });
  }

  _delete(name) {
    return this._act("delete", async () => {
      await this._ws("ota_delete", { file: name });
      if (this._file === name) {
        this._file = "";
      }
    });
  }

  async _onFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    await this._act("upload", async () => {
      this._notice = this._tr("uploading_file");
      const response = await this.hass.fetchWithAuth(
        `/api/meshtastic/ota_upload?name=${encodeURIComponent(file.name)}`,
        { method: "POST", body: await file.arrayBuffer(), headers: { "Content-Type": "application/octet-stream" } }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message || `HTTP ${response.status}`);
      }
      this._file = body.name;
      this._notice = this._tr("saved", { f: body.name });
    });
  }

  _start() {
    if (this._file && this._file.toLowerCase().endsWith(".zip")) {
      this._mode = "dfu";
    }
    if (!this._file) {
      this._error = this._tr("select_file");
      return undefined;
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(this._tr("confirm", { f: this._file }))) {
      return undefined;
    }
    return this._act("start", () =>
      this._ws("ota_start", { file: this._file, mode: this._mode, address: this._address.trim() })
    );
  }

  _remaining(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m ? `${m} min ${s} s` : `${s} s`;
  }

  _renderPause() {
    const link = this._status?.link;
    const busy = Boolean(this._busy);
    let state = this._tr("pause_idle");
    if (link?.paused) {
      state = this._tr("pause_active", { s: this._remaining(link.remaining) });
    } else if (link && !link.up) {
      state = this._tr("pause_down");
    }
    return html`
      <div class="settings-section">
        <h4>${this._tr("pause_title")}</h4>
        <p class="help">${this._tr("pause_help")}</p>
        <p class="state">${state}</p>
        <div class="row">
          ${[5, 10, 15, 30].map(
            (n) => html`<button ?disabled=${busy || this._status?.job?.running} @click=${() => this._pause(n)}>
              ${this._tr("minutes", { n })}
            </button>`
          )}
          ${link?.paused
            ? html`<button class="primary" ?disabled=${busy} @click=${() => this._resume()}>${this._tr("resume")}</button>`
            : ""}
        </div>
      </div>
    `;
  }

  _renderJob() {
    const job = this._status?.job;
    if (!job || job.state === "idle") {
      return "";
    }
    const title = job.running ? this._tr("running") : job.state === "done" ? this._tr("done") : this._tr("failed");
    return html`
      <div class="job ${job.state === "error" ? "err" : job.state === "done" ? "ok" : ""}">
        <strong>${title}</strong>${job.file ? html` — ${job.file}` : ""}${job.address ? html` (${job.address})` : ""}
        <div>${job.message}</div>
        ${job.running || job.state === "done"
          ? html`<progress max="1" .value=${job.progress}></progress>`
          : ""}
      </div>
    `;
  }

  _renderOta() {
    const files = this._status?.files || [];
    const running = Boolean(this._status?.job?.running);
    const busy = Boolean(this._busy) || running;
    return html`
      <div class="settings-section">
        <h4>${this._tr("ota_title")}</h4>
        <p class="help">${this._tr("ota_help")}</p>

        <div class="sub">${this._tr("files")}</div>
        ${files.length
          ? files.map(
              (f) => html`<label class="file">
                <input
                  type="radio"
                  name="fw"
                  .checked=${this._file === f.name}
                  @change=${() => (this._file = f.name)}
                />
                <span>${f.name} <small>(${Math.round(f.size / 1024)} kB)</small></span>
                <button ?disabled=${busy} @click=${() => this._delete(f.name)}>${this._tr("delete")}</button>
              </label>`
            )
          : html`<p class="help">${this._tr("no_files")}</p>`}

        <div class="row">
          <label class="upload">
            ${this._tr("upload")}
            <input type="file" accept=".bin,.zip" ?disabled=${busy} @change=${(e) => this._onFile(e)} />
          </label>
        </div>
        <div class="row">
          <input
            class="grow"
            placeholder=${this._tr("fetch")}
            .value=${this._url}
            @input=${(e) => (this._url = e.target.value)}
          />
          <button ?disabled=${busy || !this._url.trim()} @click=${() => this._fetchUrl()}>${this._tr("fetch_btn")}</button>
        </div>

        <div class="sub">${this._tr("mode")}</div>
        <div class="row">
          <label
            ><input
              type="radio"
              name="mode"
              .checked=${this._mode === "wifi"}
              @change=${() => {
                this._mode = "wifi";
                this._touchedMode = true;
              }}
            />
            ${this._tr("mode_wifi")}</label
          >
          <label
            ><input
              type="radio"
              name="mode"
              .checked=${this._mode === "ble"}
              @change=${() => {
                this._mode = "ble";
                this._touchedMode = true;
              }}
            />
            ${this._tr("mode_ble")}</label
          >
          <label
            ><input
              type="radio"
              name="mode"
              .checked=${this._mode === "dfu"}
              @change=${() => {
                this._mode = "dfu";
                this._touchedMode = true;
              }}
            />
            ${this._tr("mode_dfu")}</label
          >
        </div>
        <div class="row">
          <input
            class="grow"
            placeholder=${this._mode === "ble" || this._mode === "dfu" ? this._tr("address_ble") : this._tr("address_wifi")}
            .value=${this._address}
            @input=${(e) => (this._address = e.target.value)}
          />
        </div>
        <div class="row">
          <button class="primary" ?disabled=${busy || !this._file} @click=${() => this._start()}>
            ${this._tr("start")}
          </button>
        </div>
        ${this._renderJob()}
      </div>
    `;
  }

  render() {
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${this._tr("title")}</h3>
          <p>${this._tr("intro")}</p>
        </div>
        <div class="settings-panel-body">
          ${this._busy ? html`<div class="msg">${this._tr("busy")}</div>` : ""}
          ${this._notice ? html`<div class="msg ok">${this._notice}</div>` : ""}
          ${this._error ? html`<div class="msg err">${this._error}</div>` : ""}
          ${this._renderPause()} ${this._renderOta()}
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      settingsStyles,
      css`
        :host {
          display: block;
        }
        .help {
          font-size: 13px;
          color: var(--secondary-text-color);
          margin: 4px 0 8px;
        }
        .state {
          font-weight: 600;
          margin: 4px 0 8px;
        }
        .sub {
          margin: 14px 0 4px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--secondary-text-color);
        }
        .row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          margin: 6px 0;
        }
        .file {
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 4px 0;
        }
        .file span {
          flex: 1;
          word-break: break-all;
        }
        input.grow {
          flex: 1 1 240px;
        }
        input:not([type="radio"]):not([type="file"]) {
          padding: 6px 8px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color, transparent);
          color: var(--primary-text-color);
          font: inherit;
          min-width: 0;
        }
        button,
        .upload {
          padding: 6px 12px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: transparent;
          color: var(--primary-text-color);
          font: inherit;
          cursor: pointer;
        }
        button.primary {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color);
        }
        button:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .upload input {
          display: none;
        }
        .msg {
          padding: 6px 10px;
          border-radius: 6px;
          margin-bottom: 8px;
          background: var(--secondary-background-color);
        }
        .msg.ok {
          color: var(--success-color, #4caf50);
        }
        .msg.err {
          color: var(--error-color, #f44336);
        }
        .job {
          margin-top: 12px;
          padding: 10px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
        }
        .job.err {
          border-color: var(--error-color, #f44336);
        }
        .job.ok {
          border-color: var(--success-color, #4caf50);
        }
        progress {
          width: 100%;
          margin-top: 6px;
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-ota")) {
  customElements.define("mesh-settings-ota", MeshSettingsOta);
}
