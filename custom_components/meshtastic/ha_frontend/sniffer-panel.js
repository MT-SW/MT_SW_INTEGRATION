/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Panel Sniffer w Ustawieniach → MT_SW: sterowanie snifferem, log przechwyconych
 * pakietów na żywo i eksport do pliku.
 *
 * Sniffer działa przez OnDemand (port 354), nie przez konfigurację modułu:
 * stan jest tylko w RAM radia (po restarcie zawsze wyłączony), a firmware
 * honoruje włączenie wyłącznie od lokalnie podłączonego klienta. Dlatego panel
 * pyta o stan przy każdym otwarciu, zamiast cokolwiek pamiętać.
 *
 * Log zbiera integracja (bufor w pamięci, do 5000 pakietów), panel go tylko
 * dopytuje przyrostowo. Eksport powstaje w przeglądarce z tego, co panel
 * widzi, z uwzględnieniem filtra.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { PL } from "./pl-settings.js";
import { settingsStyles, badgeStyles } from "./styles.js";
import "./components.js";
import { portLabel } from "./port-names.js";
import { MIN_FW_PLUS_VERSION } from "./firmware.js";

const POLL_MS = 2000;
const NAMES_REFRESH_MS = 30000;
const PAGE_ROWS = 300;
const BROADCAST = 0xffffffff;

const CSV_COLUMNS = [
  "source",
  "time",
  "seq",
  "from",
  "from_name",
  "to",
  "to_name",
  "channel",
  "id",
  "port",
  "info",
  "rx_snr",
  "rx_rssi",
  "hop_limit",
  "hop_start",
  "hops_away",
  "relay_node",
  "want_ack",
  "signed",
  "pki",
  "via_mqtt",
  "encrypted",
  "payload_size",
  "payload_hex",
];

const pad = (value) => String(value).padStart(2, "0");

function stamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function csvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

class MeshSettingsSniffer extends LitElement {
  static get properties() {
    return {
      wsCommand: { type: Object },
      config: { type: Object },
      _status: { type: Object, state: true },
      _checking: { type: Boolean, state: true },
      _busy: { type: Boolean, state: true },
      _error: { type: String, state: true },
      _confirmOpen: { type: Boolean, state: true },
      _entries: { type: Array, state: true },
      _meta: { type: Object, state: true },
      _paused: { type: Boolean, state: true },
      _filter: { type: String, state: true },
      _expanded: { type: Number, state: true },
      _names: { type: Object, state: true },
      _visible: { type: Number, state: true },
    };
  }

  constructor() {
    super();
    this._status = null;
    this._mqttBusy = false;
    this._checking = false;
    this._busy = false;
    this._error = "";
    this._confirmOpen = false;
    this._entries = [];
    this._meta = null;
    this._paused = false;
    this._filter = "";
    this._expanded = null;
    this._names = {};
    this._visible = PAGE_ROWS;
    this._lastSeq = 0;
    this._polling = false;
    this._pollTimer = null;
    this._namesTimer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._checkStatus();
    this._loadNames();
    this._pollLog();
    this._pollTimer = setInterval(() => this._pollLog(), POLL_MS);
    this._namesTimer = setInterval(() => this._loadNames(), NAMES_REFRESH_MS);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._pollTimer);
    clearInterval(this._namesTimer);
    this._pollTimer = null;
    this._namesTimer = null;
  }

  /* ── dane ─────────────────────────────────────────────────── */

  /* force pomija zapamiętany wynik — przycisk "Sprawdź ponownie" ma naprawdę zapytać radio. */
  async _checkStatus(force = false) {
    this._checking = true;
    this._error = "";
    const res = await this.wsCommand("meshtastic_ui/sniffer_state", { force });
    this._checking = false;
    if (res && res.ok) {
      this._status = res;
    } else {
      this._status = null;
      this._error = this._errorText(res && res.error);
    }
  }

  async _loadNames() {
    const res = await this.wsCommand("meshtastic_ui/node_names");
    if (res && res.names) {
      this._names = res.names;
    }
  }

  async _pollLog() {
    if (this._polling || this._paused) {
      return;
    }
    this._polling = true;
    try {
      const res = await this.wsCommand("meshtastic_ui/sniffer_log", { since: this._lastSeq });
      if (!res || !res.ok) {
        return;
      }
      if (res.last_seq < this._lastSeq) {
        // integracja została przeładowana — numeracja zaczęła się od nowa
        this._entries = [];
        this._lastSeq = 0;
        this._expanded = null;
        return;
      }
      this._meta = { count: res.count, capacity: res.capacity, enabled: res.enabled };
      if (res.entries.length) {
        const merged = this._entries.concat(res.entries);
        this._entries = merged.length > res.capacity ? merged.slice(merged.length - res.capacity) : merged;
        this._lastSeq = res.entries[res.entries.length - 1].seq;
      }
    } finally {
      this._polling = false;
    }
  }

  async _setSniffer(enabled) {
    this._busy = true;
    this._error = "";
    const res = await this.wsCommand("meshtastic_ui/sniffer_set", { enabled });
    this._busy = false;
    if (!res || !res.ok) {
      this._error = this._errorText(res && res.error);
      return;
    }
    this._status = res;
    if (res.enabled !== enabled) {
      this._error = PL("The radio kept the previous sniffer state.");
    }
    this._pollLog();
  }

  async _setMqttSniffer(enabled) {
    this._mqttBusy = true;
    this._error = "";
    const res = await this.wsCommand("meshtastic_ui/sniffer_mqtt_set", { enabled });
    this._mqttBusy = false;
    if (!res || !res.ok) {
      this._error = this._errorText(res && res.error);
      return;
    }
    this._status = res;
    this._pollLog();
  }

  async _clearLog() {
    const res = await this.wsCommand("meshtastic_ui/sniffer_clear");
    if (res && res.ok) {
      this._entries = [];
      this._expanded = null;
      this._visible = PAGE_ROWS;
      this._meta = this._meta ? { ...this._meta, count: 0 } : this._meta;
    }
  }

  _errorText(code) {
    if (!code) {
      return PL("Could not reach the radio.");
    }
    if (code === "timeout") {
      return PL("The radio did not answer in time.");
    }
    if (code === "not_connected") {
      return PL("The radio is not connected.");
    }
    if (code === "unsupported") {
      return PL("Sniffer is not supported by this firmware.");
    }
    return code;
  }

  /* ── nazwy i formatowanie ─────────────────────────────────── */

  _label(id) {
    if (id === null || id === undefined) {
      return "—";
    }
    if (id === BROADCAST) {
      return "*";
    }
    const hex = `!${(id >>> 0).toString(16).padStart(8, "0")}`;
    const name = this._names[id];
    return name ? `${hex} (${name})` : hex;
  }

  _signal(entry) {
    const parts = [];
    if (typeof entry.rx_snr === "number") {
      parts.push(`${entry.rx_snr.toFixed(1)} dB`);
    }
    if (typeof entry.rx_rssi === "number" && entry.rx_rssi !== 0) {
      parts.push(`${entry.rx_rssi} dBm`);
    }
    return parts.length ? parts.join(" / ") : "—";
  }

  _portText(entry) {
    return entry.port === "ENCRYPTED" ? PL("Encrypted") : portLabel("pl", entry.port);
  }

  _time(ts) {
    const date = new Date(ts);
    return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
  }

  _filtered() {
    const needle = (this._filter || "").trim().toLowerCase();
    if (!needle) {
      return this._entries;
    }
    return this._entries.filter((entry) =>
      [this._label(entry.from), this._label(entry.to), entry.port, this._portText(entry), entry.info]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }

  /* ── eksport ──────────────────────────────────────────────── */

  _download(filename, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  _exportRows() {
    return this._filtered().map((entry) => ({
      ...entry,
      time: new Date(entry.ts).toISOString(),
      from_name: this._names[entry.from] || "",
      to_name: entry.to === BROADCAST ? "broadcast" : this._names[entry.to] || "",
    }));
  }

  _exportJson() {
    const rows = this._exportRows();
    const body = JSON.stringify({ exported_at: new Date().toISOString(), count: rows.length, entries: rows }, null, 2);
    this._download(`sniffer-${stamp(new Date())}.json`, "application/json", body);
  }

  _exportCsv() {
    const rows = this._exportRows();
    const lines = [CSV_COLUMNS.join(";")];
    for (const row of rows) {
      lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(";"));
    }
    // BOM, żeby Excel poprawnie odczytał polskie znaki
    this._download(`sniffer-${stamp(new Date())}.csv`, "text/csv;charset=utf-8", `\ufeff${lines.join("\r\n")}`);
  }

  /* ── widok ────────────────────────────────────────────────── */

  _statusBadge() {
    const status = this._status;
    if (!status) {
      return html`<span class="badge secondary">${PL("Unknown")}</span>`;
    }
    if (!status.supported) {
      return html`<span class="badge danger">${PL("Not supported")}</span>`;
    }
    return html`<span class="badge success">${PL("Supported")} · MT_SW_FW v${status.fw_plus_version}</span>`;
  }

  _supportNote() {
    const status = this._status;
    if (!status || status.supported) {
      return "";
    }
    if (status.reason === "old_firmware") {
      const minimum = status.min_fw_plus_version || MIN_FW_PLUS_VERSION;
      return PL("Firmware is too old: MT_SW_FW version {n} or newer is required.").replace("{n}", minimum);
    }
    if (status.reason === "timeout") {
      return PL("The radio did not answer. Firmware other than MT_SW_FW does not support the sniffer.");
    }
    return this._errorText(status.reason);
  }

  _renderControls() {
    const status = this._status;
    const supported = Boolean(status && status.supported);
    const enabled = status ? status.enabled : null;

    return html`
      <div class="settings-section">
        <div class="row">
          <span class="row-label">${PL("Firmware support")}</span>
          <span>${this._checking ? html`<span class="badge secondary">${PL("Checking…")}</span>` : this._statusBadge()}</span>
        </div>
        ${this._supportNote() ? html`<div class="note">${this._supportNote()}</div>` : ""}
        <div class="row">
          <span class="row-label">${PL("Sniffer state")}</span>
          <span>
            ${enabled === true
              ? html`<span class="badge success">${PL("On")}</span>`
              : enabled === false
                ? html`<span class="badge secondary">${PL("Off")}</span>`
                : html`<span class="badge secondary">${PL("Unknown")}</span>`}
          </span>
        </div>
        <div class="buttons">
          ${supported && enabled !== true
            ? html`<button class="btn primary" ?disabled=${this._busy} @click=${() => { this._confirmOpen = true; }}>
                ${PL("Enable sniffer")}
              </button>`
            : ""}
          ${supported && enabled === true
            ? html`<button class="btn" ?disabled=${this._busy} @click=${() => this._setSniffer(false)}>
                ${PL("Disable sniffer")}
              </button>`
            : ""}
          <button class="btn" ?disabled=${this._busy || this._checking} @click=${() => this._checkStatus(true)}>
            ${PL("Check again")}
          </button>
        </div>
        ${this._error ? html`<div class="error">${this._error}</div>` : ""}
      </div>

      <div class="settings-section">
        <div class="row">
          <span class="row-label">${PL("MQTT sniffer")}</span>
          <span>
            ${this._status && this._status.mqtt_connected
              ? html`<span class="badge success">${PL("Connected")}</span>`
              : html`<span class="badge secondary">${PL("Not connected")}</span>`}
          </span>
        </div>
        <div class="note">
          ${PL("Subscribes directly to the MQTT broker your gateway's MQTT module uses, so it also sees traffic from other gateways on the same broker/channel — not only your own radio. Runs entirely in Home Assistant and keeps its setting across restarts.")}
        </div>
        ${this._status && this._status.mqtt_error
          ? html`<div class="note">${this._status.mqtt_error}</div>`
          : ""}
        <div class="buttons">
          ${this._status && this._status.mqtt_enabled
            ? html`<button class="btn" ?disabled=${this._mqttBusy} @click=${() => this._setMqttSniffer(false)}>
                ${PL("Disable MQTT sniffer")}
              </button>`
            : html`<button class="btn primary" ?disabled=${this._mqttBusy} @click=${() => this._setMqttSniffer(true)}>
                ${PL("Enable MQTT sniffer")}
              </button>`}
        </div>
      </div>
    `;
  }

  _renderDetails(entry) {
    const flags = [
      entry.want_ack ? PL("Wants ACK") : null,
      entry.signed ? PL("Signed") : null,
      entry.pki ? "PKI" : null,
      entry.via_mqtt ? "MQTT" : null,
      entry.encrypted ? PL("Encrypted") : null,
      entry.broadcast ? PL("Broadcast") : null,
    ].filter(Boolean);
    const relay = entry.relay_node ? `0x${entry.relay_node.toString(16).padStart(2, "0")}` : "—";
    const hops =
      entry.hop_start !== null && entry.hop_start !== undefined
        ? `${entry.hop_limit ?? "—"} / ${entry.hop_start}`
        : "—";
    return html`
      <div class="details">
        <div><span class="k">${PL("Packet ID")}</span> ${entry.id ?? "—"}</div>
        <div><span class="k">${PL("Channel")}</span> ${entry.mqtt_channel_name || entry.channel || "—"}</div>
        <div><span class="k">${PL("Source")}</span> ${entry.source === "mqtt" ? "MQTT" : PL("Radio")}</div>
        <div><span class="k">${PL("Hop limit / start")}</span> ${hops}</div>
        <div><span class="k">${PL("Relay")}</span> ${relay}</div>
        <div><span class="k">${PL("Flags")}</span> ${flags.length ? flags.join(", ") : "—"}</div>
        <div><span class="k">${PL("Payload size")}</span> ${entry.payload_size} B</div>
        <div class="hex"><span class="k">${PL("Payload (hex)")}</span> ${entry.payload_hex || "—"}</div>
      </div>
    `;
  }

  _renderLog() {
    const rows = this._filtered();
    const shown = rows.slice(-this._visible).reverse();
    const meta = this._meta;
    const enabled = meta ? meta.enabled : null;

    return html`
      <div class="settings-section">
        <div class="log-title">
          <h4>${PL("Sniffer log")}</h4>
          <span class="badge ${enabled ? "success" : "secondary"}">
            ${enabled ? PL("Collecting") : PL("Not collecting")}
          </span>
          <span class="count">
            ${rows.length}${this._filter ? ` / ${this._entries.length}` : ""} ${PL("packets")}${meta ? ` · ${PL("buffer")} ${meta.count}/${meta.capacity}` : ""}
          </span>
        </div>

        <div class="toolbar">
          <input
            class="filter"
            type="search"
            .value=${this._filter}
            placeholder=${PL("Filter by node, port or content")}
            @input=${(e) => { this._filter = e.target.value; this._visible = PAGE_ROWS; }}
          />
          <button class="btn" @click=${() => { this._paused = !this._paused; if (!this._paused) this._pollLog(); }}>
            ${this._paused ? PL("Resume") : PL("Pause")}
          </button>
          <button class="btn" ?disabled=${!rows.length} @click=${() => this._exportJson()}>${PL("Export JSON")}</button>
          <button class="btn" ?disabled=${!rows.length} @click=${() => this._exportCsv()}>${PL("Export CSV")}</button>
          <button class="btn danger" ?disabled=${!this._entries.length} @click=${() => this._clearLog()}>${PL("Clear log")}</button>
        </div>

        ${rows.length
          ? html`
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>${PL("Time")}</th>
                      <th>${PL("From")}</th>
                      <th>${PL("To")}</th>
                      <th>${PL("Source")}</th>
                      <th>${PL("Port")}</th>
                      <th>${PL("Info")}</th>
                      <th>${PL("Signal")}</th>
                      <th>${PL("Hops")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${shown.map(
                      (entry) => html`
                        <tr class="entry ${entry.from_us ? "own" : ""}" @click=${() => { this._expanded = this._expanded === entry.seq ? null : entry.seq; }}>
                          <td class="time">${this._time(entry.ts)}</td>
                          <td>${this._label(entry.from)}</td>
                          <td>${this._label(entry.to)}</td>
                          <td>${entry.source === "mqtt" ? "MQTT" : PL("Radio")}</td>
                          <td title=${entry.port}>${this._portText(entry)}</td>
                          <td class="info">${entry.info || (entry.encrypted ? PL("Encrypted") : "")}</td>
                          <td>${this._signal(entry)}</td>
                          <td>${entry.hops_away ?? "—"}</td>
                        </tr>
                        ${this._expanded === entry.seq
                          ? html`<tr class="expanded"><td colspan="7">${this._renderDetails(entry)}</td></tr>`
                          : ""}
                      `
                    )}
                  </tbody>
                </table>
              </div>
              ${rows.length > this._visible
                ? html`<button class="btn more" @click=${() => { this._visible += PAGE_ROWS; }}>${PL("Show more")}</button>`
                : ""}
            `
          : html`<div class="note">
              ${enabled ? PL("Waiting for packets…") : PL("Enable the sniffer to start collecting packets.")}
            </div>`}
      </div>
    `;
  }

  render() {
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Sniffer")}</h3>
          <p>${PL("MT_SW firmware extension: forward packets overheard but not addressed to this node.")}</p>
        </div>
        <div class="settings-panel-body">
          <div class="info-banner">
            ${PL("The sniffer works only on the radio connected to Home Assistant. Its state lives in the radio's RAM, so it is always off after a reboot.")}
          </div>
          ${this._renderControls()} ${this._renderLog()}
        </div>
      </div>

      <mesh-confirm-dialog
        .open=${this._confirmOpen}
        .title=${PL("Enable sniffer?")}
        .message=${PL("Enabling the sniffer can delay or drop some chat and telemetry messages, because sniffed packets share the queue to Home Assistant with them.")}
        .confirmLabel=${PL("Enable sniffer")}
        .danger=${false}
        @confirm=${() => { this._confirmOpen = false; this._setSniffer(true); }}
        @cancel=${() => { this._confirmOpen = false; }}
      ></mesh-confirm-dialog>
    `;
  }

  static get styles() {
    return [
      settingsStyles,
      badgeStyles,
      css`
        :host { display: block; }

        .info-banner {
          background: var(--secondary-background-color);
          border-left: 3px solid var(--info-color, #2196f3);
          padding: 10px 12px;
          border-radius: 4px;
          font-size: 12px;
          line-height: 1.5;
          margin-bottom: 12px;
        }

        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 6px 0;
        }

        .row-label { font-size: 14px; }

        .note {
          font-size: 12px;
          color: var(--secondary-text-color);
          padding: 4px 0 8px;
        }

        .error {
          margin-top: 8px;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
          color: #f44336;
          background: rgba(244, 67, 54, 0.1);
          border: 1px solid rgba(244, 67, 54, 0.3);
        }

        .buttons, .toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .btn {
          padding: 6px 12px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 13px;
          cursor: pointer;
        }

        .btn:hover:not([disabled]) { background: var(--secondary-background-color); }
        .btn[disabled] { opacity: 0.5; cursor: default; }

        .btn.primary {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        .btn.danger { color: var(--error-color, #db4437); }
        .btn.more { margin-top: 8px; }

        .log-title {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .log-title h4 { margin: 0; font-size: 15px; }
        .count { font-size: 12px; color: var(--secondary-text-color); }

        .filter {
          flex: 1 1 200px;
          min-width: 160px;
          padding: 6px 10px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 13px;
        }

        .table-wrap {
          margin-top: 12px;
          max-height: 460px;
          overflow: auto;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
        }

        table {
          border-collapse: collapse;
          width: 100%;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }

        th, td {
          padding: 6px 10px;
          text-align: start;
          white-space: nowrap;
          border-top: 1px solid var(--divider-color);
        }

        th {
          position: sticky;
          top: 0;
          z-index: 1;
          border-top: none;
          background: var(--card-background-color);
          color: var(--secondary-text-color);
          font-weight: 500;
        }

        td.info {
          max-width: 260px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        tr.expanded td { white-space: normal; }

        tr.entry { cursor: pointer; }
        tr.entry:hover { background: var(--secondary-background-color); }
        tr.entry.own td { color: var(--secondary-text-color); }

        .details {
          display: grid;
          gap: 4px;
          padding: 4px 4px 8px;
          font-size: 12px;
        }

        .details .k {
          display: inline-block;
          min-width: 130px;
          color: var(--secondary-text-color);
        }

        .details .hex {
          word-break: break-all;
          font-family: var(--code-font-family, monospace);
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-sniffer")) {
  customElements.define("mesh-settings-sniffer", MeshSettingsSniffer);
}
