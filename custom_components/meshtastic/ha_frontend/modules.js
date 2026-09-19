import {
  LitElement,
  html,
  css,
} from "./vendor/lit/lit-element.js";
import "./components.js";
import { PL } from "./pl-settings.js";
import {
  settingsStyles,
  formStyles,
  saveBarStyles,
} from "./styles.js";

/* ── Enum maps ── */

const SERIAL_BAUD_RATES = [
  { value: "BAUD_DEFAULT", label: PL("Default") },
  { value: "BAUD_110", label: PL("110") },
  { value: "BAUD_300", label: PL("300") },
  { value: "BAUD_600", label: PL("600") },
  { value: "BAUD_1200", label: PL("1200") },
  { value: "BAUD_2400", label: PL("2400") },
  { value: "BAUD_4800", label: PL("4800") },
  { value: "BAUD_9600", label: PL("9600") },
  { value: "BAUD_19200", label: PL("19200") },
  { value: "BAUD_38400", label: PL("38400") },
  { value: "BAUD_57600", label: PL("57600") },
  { value: "BAUD_115200", label: PL("115200") },
  { value: "BAUD_230400", label: PL("230400") },
  { value: "BAUD_460800", label: PL("460800") },
  { value: "BAUD_576000", label: PL("576000") },
  { value: "BAUD_921600", label: PL("921600") },
];

const SERIAL_MODES = [
  { value: "DEFAULT", label: PL("Default") },
  { value: "SIMPLE", label: PL("Simple") },
  { value: "PROTO", label: PL("Protobuf") },
  { value: "TEXTMSG", label: PL("Text Message") },
  { value: "NMEA", label: PL("NMEA") },
  { value: "CALTOPO", label: PL("CalTopo") },
];

const CANNED_MSG_INPUT_EVENTS = [
  { value: "NONE", label: PL("None") },
  { value: "UP_DOWN_SELECT", label: PL("Up/Down/Select") },
  { value: "ROTARY", label: PL("Rotary Encoder") },
];

const CODEC2_RATES = [
  { value: "CODEC2_DEFAULT", label: PL("Default") },
  { value: "CODEC2_3200", label: PL("3200 bps") },
  { value: "CODEC2_2400", label: PL("2400 bps") },
  { value: "CODEC2_1600", label: PL("1600 bps") },
  { value: "CODEC2_1400", label: PL("1400 bps") },
  { value: "CODEC2_1300", label: PL("1300 bps") },
  { value: "CODEC2_1200", label: PL("1200 bps") },
  { value: "CODEC2_700B", label: PL("700B bps") },
  { value: "CODEC2_700", label: PL("700 bps") },
];

/* ── Base class for module config panels ── */

class ModuleConfigPanel extends LitElement {
  static get properties() {
    return {
      config: { type: Object },
      wsCommand: { type: Object },
    };
  }

  constructor() {
    super();
    this._draft = {};
    this._dirty = false;
    this._saving = false;
  }

  static get styles() {
    return [
      settingsStyles,
      formStyles,
      saveBarStyles,
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
          color: var(--primary-text-color);
        }
        .info-banner code {
          background: var(--code-editor-background-color, rgba(0,0,0,0.15));
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 11px;
          font-family: var(--code-font-family, monospace);
        }
        .quick-presets {
          margin-top: 8px;
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .quick-preset {
          padding: 3px 10px;
          border-radius: 12px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .quick-preset:hover {
          background: var(--primary-color);
          color: var(--text-primary-color);
          border-color: var(--primary-color);
        }
      `,
    ];
  }

  /** Subclasses override — the config section name for set_config */
  get _section() { return ""; }

  /** Path in module_config to read from */
  get _configPath() { return this._section; }

  updated(changedProps) {
    if (changedProps.has("config") && this.config && !this._dirty) {
      this._resetDraft();
    }
  }

  _resetDraft() {
    const src = this.config?.module_config?.[this._configPath] || {};
    this._draft = { ...src };
    this._dirty = false;
    this.requestUpdate();
  }

  _updateField(field, value) {
    this._draft = { ...this._draft, [field]: value };
    this._dirty = true;
    this.requestUpdate();
  }

  async _save() {
    this._saving = true;
    this.requestUpdate();

    const result = await this.wsCommand("meshtastic_ui/set_config", {
      section: this._section,
      values: this._draft,
    });

    this._saving = false;
    if (result?.success) {
      this._dirty = false;
      this.dispatchEvent(new CustomEvent("config-saved", { bubbles: true, composed: true }));
    }
    this.requestUpdate();
  }

  /** Helper: section title */
  _sectionTitle(text) {
    return html`<div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--secondary-text-color); letter-spacing: 0.5px; margin-bottom: 12px;">${text}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-mqtt>
   ══════════════════════════════════════════════════════════ */

/* Dokładność pozycji w raporcie mapy: liczba bitów współrzędnych, które
   węzeł zostawia (im mniej, tym większy kwadrat niepewności). Wartości jak
   w wyborze dokładności kanału w aplikacji. 0 = domyślna firmware (14 bitów). */
function mapReportPrecisions() {
  return [
    { value: "0", label: PL("Default") },
    { value: "10", label: PL("±23 km") },
    { value: "11", label: PL("±12 km") },
    { value: "12", label: PL("±5.8 km") },
    { value: "13", label: PL("±2.9 km") },
    { value: "14", label: PL("±1.5 km") },
    { value: "15", label: PL("±730 m") },
    { value: "16", label: PL("±360 m") },
    { value: "17", label: PL("±180 m") },
    { value: "18", label: PL("±90 m") },
    { value: "19", label: PL("±45 m") },
    { value: "32", label: PL("Precise location") },
  ];
}

class MeshSettingsMqtt extends ModuleConfigPanel {
  get _section() { return "mqtt"; }

  /* Ustawienia raportu mapy siedzą w zagnieżdżonym obiekcie map_report_settings. */
  _updateMapReport(field, value) {
    this._updateField("map_report_settings", { ...(this._draft.map_report_settings || {}), [field]: value });
  }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("MQTT Configuration")}</h3>
          <p>${PL("Configure MQTT broker connection, encryption, and map reporting.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle
            .label=${PL("MQTT Enabled")}
            .description=${PL("Enable MQTT client on this device")}
            .checked=${d.enabled === true}
            @change=${(e) => this._updateField("enabled", e.detail.checked)}
          ></mesh-toggle>

          ${d.enabled ? html`
            <div class="settings-section">
              ${this._sectionTitle(PL("Broker"))}
              <div class="form-grid">
                <mesh-text-input .label=${PL("Address")} .description=${PL("MQTT broker hostname or IP")}
                  .value=${d.address || ""} placeholder="mqtt.meshtastic.org"
                  @change=${(e) => this._updateField("address", e.detail.value)}></mesh-text-input>
                <mesh-number-input .label=${PL("Port")} .value=${d.port ?? 1883} .min=${1} .max=${65535}
                  @change=${(e) => this._updateField("port", e.detail.value)}></mesh-number-input>
                <mesh-text-input .label=${PL("Username")} .value=${d.username || ""}
                  @change=${(e) => this._updateField("username", e.detail.value)}></mesh-text-input>
                <mesh-text-input .label=${PL("Password")} type="password" .value=${d.password || ""}
                  @change=${(e) => this._updateField("password", e.detail.value)}></mesh-text-input>
                <mesh-text-input .label=${PL("Root Topic")} .description=${PL("MQTT root topic")}
                  .value=${d.root || ""} placeholder="msh"
                  @change=${(e) => this._updateField("root", e.detail.value)}></mesh-text-input>
              </div>
            </div>

            <div class="settings-section">
              ${this._sectionTitle(PL("Options"))}
              <mesh-toggle .label=${PL("Encryption Enabled")} .description=${PL("Encrypt MQTT traffic")}
                .checked=${d.encryption_enabled === true}
                @change=${(e) => this._updateField("encryption_enabled", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("JSON Enabled")} .description=${PL("Send JSON-formatted messages to MQTT")}
                .checked=${d.json_enabled === true}
                @change=${(e) => this._updateField("json_enabled", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("TLS Enabled")} .description=${PL("Use TLS for broker connection")}
                .checked=${d.tls_enabled === true}
                @change=${(e) => this._updateField("tls_enabled", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Proxy to Client Enabled")} .description=${PL("Proxy MQTT traffic through connected client")}
                .checked=${d.proxy_to_client_enabled === true}
                @change=${(e) => this._updateField("proxy_to_client_enabled", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Map Reporting Enabled")} .description=${PL("Report position to the Meshtastic map")}
                .checked=${d.map_reporting_enabled === true}
                @change=${(e) => this._updateField("map_reporting_enabled", e.detail.checked)}></mesh-toggle>
            </div>

            ${d.map_reporting_enabled ? html`
              <div class="settings-section">
                ${this._sectionTitle(PL("Map Reporting"))}
                <div class="info-banner">
                  ${PL("Your node will periodically send an unencrypted map report packet to the configured MQTT server. It includes the node id, long and short name, approximate location, hardware model, role, firmware version, LoRa region, modem preset and primary channel name.")}
                </div>
                <div class="form-grid">
                  <mesh-number-input
                    .label=${PL("Map Reporting Interval (secs)")}
                    .description=${PL("How often the node reports to the map (0 = firmware default, 3600 s)")}
                    .value=${d.map_report_settings?.publish_interval_secs ?? 0}
                    .min=${0}
                    @change=${(e) => this._updateMapReport("publish_interval_secs", e.detail.value)}
                  ></mesh-number-input>
                  <mesh-select
                    .label=${PL("Map Report Precision")}
                    .description=${PL("How precisely the location is reported to the map. Fewer bits means a larger uncertainty area.")}
                    .value=${String(d.map_report_settings?.position_precision ?? 0)}
                    .options=${mapReportPrecisions()}
                    @change=${(e) => this._updateMapReport("position_precision", Number(e.detail.value))}
                  ></mesh-select>
                </div>
                <mesh-toggle
                  .label=${PL("Location Reporting Consent")}
                  .description=${PL("I consent to sending this node's location unencrypted over MQTT (used for the live map, device tracking and related telemetry).")}
                  .checked=${d.map_report_settings?.should_report_location === true}
                  @change=${(e) => this._updateMapReport("should_report_location", e.detail.checked)}
                ></mesh-toggle>
              </div>
            ` : ""}
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-mqtt")) {
  customElements.define("mesh-settings-mqtt", MeshSettingsMqtt);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-serial>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsSerial extends ModuleConfigPanel {
  get _section() { return "serial"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Serial Module")}</h3>
          <p>${PL("Configure the serial interface module for external device communication.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("Enabled")} .description=${PL("Enable serial module")}
            .checked=${d.enabled === true}
            @change=${(e) => this._updateField("enabled", e.detail.checked)}></mesh-toggle>

          ${d.enabled ? html`
            <div class="settings-section">
              <div class="form-grid">
                <mesh-select .label=${PL("Baud Rate")} .value=${String(d.baud || "BAUD_DEFAULT")}
                  .options=${SERIAL_BAUD_RATES}
                  @change=${(e) => this._updateField("baud", e.detail.value)}></mesh-select>
                <mesh-select .label=${PL("Mode")} .description=${PL("Serial communication protocol")}
                  .value=${String(d.mode || "DEFAULT")}
                  .options=${SERIAL_MODES}
                  @change=${(e) => this._updateField("mode", e.detail.value)}></mesh-select>
                <mesh-number-input .label=${PL("RX GPIO")} .value=${d.rxd ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("rxd", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("TX GPIO")} .value=${d.txd ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("txd", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Timeout (ms)")} .description=${PL("Serial timeout in milliseconds")}
                  .value=${d.timeout ?? 0} .min=${0}
                  @change=${(e) => this._updateField("timeout", e.detail.value)}></mesh-number-input>
              </div>
              <mesh-toggle .label=${PL("Echo")} .description=${PL("Echo received serial data back")}
                .checked=${d.echo === true}
                @change=${(e) => this._updateField("echo", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Override Console Serial Port")}
                .description=${PL("Use the main serial port for this module")}
                .checked=${d.override_console_serial_port === true}
                @change=${(e) => this._updateField("override_console_serial_port", e.detail.checked)}></mesh-toggle>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-serial")) {
  customElements.define("mesh-settings-serial", MeshSettingsSerial);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-ext-notification>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsExtNotification extends ModuleConfigPanel {
  get _section() { return "external_notification"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("External Notification")}</h3>
          <p>${PL("Configure buzzer, vibration motor, and LED notifications.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("Enabled")} .description=${PL("Enable external notification module")}
            .checked=${d.enabled === true}
            @change=${(e) => this._updateField("enabled", e.detail.checked)}></mesh-toggle>

          ${d.enabled ? html`
            <div class="settings-section">
              ${this._sectionTitle(PL("Output"))}
              <div class="form-grid">
                <mesh-number-input .label=${PL("Output GPIO")} .description=${PL("GPIO pin for notification output")}
                  .value=${d.output ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("output", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Output Vibra GPIO")} .description=${PL("GPIO for vibration motor")}
                  .value=${d.output_vibra ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("output_vibra", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Output Buzzer GPIO")} .description=${PL("GPIO for piezo buzzer")}
                  .value=${d.output_buzzer ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("output_buzzer", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Nag Timeout (secs)")} .description=${PL("Repeat notification interval (0 = once)")}
                  .value=${d.nag_timeout ?? 0} .min=${0}
                  @change=${(e) => this._updateField("nag_timeout", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Output Duration (ms)")} .description=${PL("Notification pulse duration")}
                  .value=${d.output_ms ?? 0} .min=${0}
                  @change=${(e) => this._updateField("output_ms", e.detail.value)}></mesh-number-input>
              </div>
            </div>

            <div class="settings-section">
              ${this._sectionTitle(PL("Triggers"))}
              <mesh-toggle .label=${PL("Alert on Message")} .description=${PL("Notify on incoming messages")}
                .checked=${d.alert_message === true}
                @change=${(e) => this._updateField("alert_message", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Alert on Message Buzzer")} .description=${PL("Use buzzer for message alerts")}
                .checked=${d.alert_message_buzzer === true}
                @change=${(e) => this._updateField("alert_message_buzzer", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Alert on Message Vibra")} .description=${PL("Use vibration for message alerts")}
                .checked=${d.alert_message_vibra === true}
                @change=${(e) => this._updateField("alert_message_vibra", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Alert on Bell")} .description=${PL("Notify on bell character")}
                .checked=${d.alert_bell === true}
                @change=${(e) => this._updateField("alert_bell", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Alert on Bell Buzzer")}
                .checked=${d.alert_bell_buzzer === true}
                @change=${(e) => this._updateField("alert_bell_buzzer", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Alert on Bell Vibra")}
                .checked=${d.alert_bell_vibra === true}
                @change=${(e) => this._updateField("alert_bell_vibra", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Use PWM Buzzer")} .description=${PL("Drive buzzer with PWM for tones")}
                .checked=${d.use_pwm === true}
                @change=${(e) => this._updateField("use_pwm", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Active High")} .description=${PL("Output is active-high (vs active-low)")}
                .checked=${d.active === true}
                @change=${(e) => this._updateField("active", e.detail.checked)}></mesh-toggle>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-ext-notification")) {
  customElements.define("mesh-settings-ext-notification", MeshSettingsExtNotification);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-store-forward>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsStoreForward extends ModuleConfigPanel {
  get _section() { return "store_forward"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Store & Forward")}</h3>
          <p>${PL("Store messages and forward them to nodes that come online later.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("Enabled")} .description=${PL("Enable Store & Forward module")}
            .checked=${d.enabled === true}
            @change=${(e) => this._updateField("enabled", e.detail.checked)}></mesh-toggle>

          ${d.enabled ? html`
            <div class="settings-section">
              <div class="form-grid">
                <mesh-number-input .label=${PL("Records")} .description=${PL("Number of messages to store (0 = auto)")}
                  .value=${d.records ?? 0} .min=${0}
                  @change=${(e) => this._updateField("records", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("History Return Max")}
                  .description=${PL("Max messages to return on request")}
                  .value=${d.history_return_max ?? 0} .min=${0}
                  @change=${(e) => this._updateField("history_return_max", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("History Return Window (secs)")}
                  .description=${PL("Time window for history requests")}
                  .value=${d.history_return_window ?? 0} .min=${0}
                  @change=${(e) => this._updateField("history_return_window", e.detail.value)}></mesh-number-input>
              </div>
              <mesh-toggle .label=${PL("Heartbeat")} .description=${PL("Send periodic heartbeat to clients")}
                .checked=${d.heartbeat === true}
                @change=${(e) => this._updateField("heartbeat", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Is Server")} .description=${PL("Act as the S&F server for the mesh")}
                .checked=${d.is_server === true}
                @change=${(e) => this._updateField("is_server", e.detail.checked)}></mesh-toggle>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-store-forward")) {
  customElements.define("mesh-settings-store-forward", MeshSettingsStoreForward);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-range-test>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsRangeTest extends ModuleConfigPanel {
  get _section() { return "range_test"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Range Test")}</h3>
          <p>${PL("Send periodic test messages to measure range and link quality.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("Enabled")} .description=${PL("Enable Range Test module")}
            .checked=${d.enabled === true}
            @change=${(e) => this._updateField("enabled", e.detail.checked)}></mesh-toggle>

          ${d.enabled ? html`
            <div class="settings-section">
              <div class="form-grid">
                <mesh-number-input .label=${PL("Sender Interval (secs)")}
                  .description=${PL("Seconds between test messages (0 = receive only)")}
                  .value=${d.sender ?? 0} .min=${0}
                  @change=${(e) => this._updateField("sender", e.detail.value)}></mesh-number-input>
              </div>
              <mesh-toggle .label=${PL("Save to File")} .description=${PL("Save received test data to file")}
                .checked=${d.save === true}
                @change=${(e) => this._updateField("save", e.detail.checked)}></mesh-toggle>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-range-test")) {
  customElements.define("mesh-settings-range-test", MeshSettingsRangeTest);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-telemetry>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsTelemetry extends ModuleConfigPanel {
  get _section() { return "telemetry"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Telemetry")}</h3>
          <p>${PL("Configure device metrics, environment, air quality, and power telemetry intervals.")}</p>
        </div>
        <div class="settings-panel-body">
          <div class="settings-section">
            ${this._sectionTitle(PL("Device Metrics"))}
            <div class="info-banner">
              <strong>${PL("Charts not updating?")}</strong>
              ${PL("Firmware 2.7.x defaults this to 3600 (1 hour), which is why battery / channel utilization / airtime graphs may look frozen. For a live dashboard, set this to 300 (5 min) or 600 (10 min).")}
              <div class="quick-presets">
                <button class="quick-preset" type="button"
                  @click=${() => this._updateField("device_update_interval", 300)}>5 min</button>
                <button class="quick-preset" type="button"
                  @click=${() => this._updateField("device_update_interval", 600)}>10 min</button>
                <button class="quick-preset" type="button"
                  @click=${() => this._updateField("device_update_interval", 1800)}>30 min</button>
              </div>
            </div>
            <div class="form-grid">
              <mesh-number-input .label=${PL("Update Interval (secs)")}
                .description=${PL("How often the radio broadcasts device metrics. 0 uses the firmware default (3600s on fw 2.7.x).")}
                .value=${d.device_update_interval ?? 0} .min=${0}
                @change=${(e) => this._updateField("device_update_interval", e.detail.value)}></mesh-number-input>
            </div>
          </div>

          <div class="settings-section">
            ${this._sectionTitle(PL("Environment"))}
            <mesh-toggle .label=${PL("Environment Measurement Enabled")}
              .description=${PL("Enable environment sensor readings")}
              .checked=${d.environment_measurement_enabled === true}
              @change=${(e) => this._updateField("environment_measurement_enabled", e.detail.checked)}></mesh-toggle>
            ${d.environment_measurement_enabled ? html`
              <div class="form-grid" style="margin-top: 8px;">
                <mesh-number-input .label=${PL("Environment Update Interval (secs)")}
                  .value=${d.environment_update_interval ?? 0} .min=${0}
                  @change=${(e) => this._updateField("environment_update_interval", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Environment Screen Enabled")}
                  .description=${PL("Show on screen (1 = yes)")}
                  .value=${d.environment_screen_enabled ? 1 : 0} .min=${0} .max=${1}
                  @change=${(e) => this._updateField("environment_screen_enabled", e.detail.value === 1)}></mesh-number-input>
              </div>
            ` : ""}
          </div>

          <div class="settings-section">
            ${this._sectionTitle(PL("Air Quality"))}
            <mesh-toggle .label=${PL("Air Quality Enabled")}
              .description=${PL("Enable air quality sensor readings")}
              .checked=${d.air_quality_enabled === true}
              @change=${(e) => this._updateField("air_quality_enabled", e.detail.checked)}></mesh-toggle>
            ${d.air_quality_enabled ? html`
              <div class="form-grid" style="margin-top: 8px;">
                <mesh-number-input .label=${PL("Air Quality Interval (secs)")}
                  .value=${d.air_quality_interval ?? 0} .min=${0}
                  @change=${(e) => this._updateField("air_quality_interval", e.detail.value)}></mesh-number-input>
              </div>
            ` : ""}
          </div>

          <div class="settings-section">
            ${this._sectionTitle(PL("Power Metrics"))}
            <mesh-toggle .label=${PL("Power Measurement Enabled")}
              .description=${PL("Enable power sensor readings (INA sensors)")}
              .checked=${d.power_measurement_enabled === true}
              @change=${(e) => this._updateField("power_measurement_enabled", e.detail.checked)}></mesh-toggle>
            ${d.power_measurement_enabled ? html`
              <div class="form-grid" style="margin-top: 8px;">
                <mesh-number-input .label=${PL("Power Update Interval (secs)")}
                  .value=${d.power_update_interval ?? 0} .min=${0}
                  @change=${(e) => this._updateField("power_update_interval", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Power Screen Enabled")}
                  .description=${PL("Show on screen (1 = yes)")}
                  .value=${d.power_screen_enabled ? 1 : 0} .min=${0} .max=${1}
                  @change=${(e) => this._updateField("power_screen_enabled", e.detail.value === 1)}></mesh-number-input>
              </div>
            ` : ""}
          </div>
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-telemetry")) {
  customElements.define("mesh-settings-telemetry", MeshSettingsTelemetry);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-canned-message>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsCannedMessage extends ModuleConfigPanel {
  get _section() { return "canned_message"; }

  static get styles() {
    return [
      settingsStyles,
      formStyles,
      saveBarStyles,
      css`
        :host { display: block; }
        textarea {
          width: 100%;
          min-height: 120px;
          padding: 10px 12px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--primary-background-color);
          color: var(--primary-text-color);
          font-size: 14px;
          font-family: monospace;
          outline: none;
          resize: vertical;
          box-sizing: border-box;
        }
        textarea:focus { border-color: var(--primary-color); }
      `,
    ];
  }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Canned Messages")}</h3>
          <p>${PL("Pre-defined messages that can be sent quickly using hardware input.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("Enabled")} .description=${PL("Enable Canned Message module")}
            .checked=${d.enabled === true}
            @change=${(e) => this._updateField("enabled", e.detail.checked)}></mesh-toggle>

          ${d.enabled ? html`
            <div class="settings-section">
              ${this._sectionTitle(PL("Messages"))}
              <div style="margin-bottom: 4px; font-size: 12px; color: var(--secondary-text-color);">
                One message per line. Use | to separate messages. Available on device input.
              </div>
              <textarea
                .value=${d.messages || ""}
                @input=${(e) => this._updateField("messages", e.target.value)}
                placeholder="Hello|On my way|Be right there"
              ></textarea>
            </div>

            <div class="settings-section">
              ${this._sectionTitle(PL("Input Source"))}
              <div class="form-grid">
                <mesh-select .label=${PL("Input Event Source")}
                  .value=${String(d.inputbroker_event_cw || "NONE")}
                  .options=${CANNED_MSG_INPUT_EVENTS}
                  @change=${(e) => this._updateField("inputbroker_event_cw", e.detail.value)}></mesh-select>
                <mesh-number-input .label=${PL("Input Pin A")} .description=${PL("GPIO for rotary encoder / button A")}
                  .value=${d.inputbroker_pin_a ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("inputbroker_pin_a", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Input Pin B")} .description=${PL("GPIO for rotary encoder B")}
                  .value=${d.inputbroker_pin_b ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("inputbroker_pin_b", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Input Pin Press")} .description=${PL("GPIO for press/select")}
                  .value=${d.inputbroker_pin_press ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("inputbroker_pin_press", e.detail.value)}></mesh-number-input>
              </div>
              <mesh-toggle .label=${PL("Rotary Encoder Enabled")}
                .checked=${d.rotary1_enabled === true}
                @change=${(e) => this._updateField("rotary1_enabled", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Up/Down Enabled")}
                .checked=${d.updown1_enabled === true}
                @change=${(e) => this._updateField("updown1_enabled", e.detail.checked)}></mesh-toggle>
            </div>

            <div class="settings-section">
              <div class="form-grid">
                <mesh-number-input .label=${PL("Send to Channel")} .description=${PL("Channel index to send on")}
                  .value=${d.send_bell ?? 0} .min=${0} .max=${7}
                  @change=${(e) => this._updateField("send_bell", e.detail.value)}></mesh-number-input>
              </div>
              <mesh-toggle .label=${PL("Allow Input Source")} .description=${PL("Allow message input from hardware")}
                .checked=${d.allow_input_source === true}
                @change=${(e) => this._updateField("allow_input_source", e.detail.checked)}></mesh-toggle>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-canned-message")) {
  customElements.define("mesh-settings-canned-message", MeshSettingsCannedMessage);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-audio>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsAudio extends ModuleConfigPanel {
  get _section() { return "audio"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Audio / Codec2")}</h3>
          <p>${PL("Configure audio codec settings for voice communication over mesh.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("Codec2 Enabled")} .description=${PL("Enable Codec2 audio module")}
            .checked=${d.codec2_enabled === true}
            @change=${(e) => this._updateField("codec2_enabled", e.detail.checked)}></mesh-toggle>

          ${d.codec2_enabled ? html`
            <div class="settings-section">
              <div class="form-grid">
                <mesh-select .label=${PL("Bitrate")} .description=${PL("Codec2 bitrate setting")}
                  .value=${String(d.bitrate || "CODEC2_DEFAULT")}
                  .options=${CODEC2_RATES}
                  @change=${(e) => this._updateField("bitrate", e.detail.value)}></mesh-select>
                <mesh-number-input .label=${PL("PTT GPIO")} .description=${PL("GPIO for push-to-talk button")}
                  .value=${d.ptt_pin ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("ptt_pin", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("I2S WS GPIO")}
                  .value=${d.i2s_ws ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("i2s_ws", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("I2S SD GPIO")}
                  .value=${d.i2s_sd ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("i2s_sd", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("I2S DIN GPIO")}
                  .value=${d.i2s_din ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("i2s_din", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("I2S SCK GPIO")}
                  .value=${d.i2s_sck ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("i2s_sck", e.detail.value)}></mesh-number-input>
              </div>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-audio")) {
  customElements.define("mesh-settings-audio", MeshSettingsAudio);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-neighbor-info>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsNeighborInfo extends ModuleConfigPanel {
  get _section() { return "neighbor_info"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Neighbor Info")}</h3>
          <p>${PL("Broadcast information about direct neighbors for mesh topology mapping.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("Enabled")} .description=${PL("Enable Neighbor Info module")}
            .checked=${d.enabled === true}
            @change=${(e) => this._updateField("enabled", e.detail.checked)}></mesh-toggle>

          ${d.enabled ? html`
            <div class="settings-section">
              <div class="form-grid">
                <mesh-number-input .label=${PL("Update Interval (secs)")}
                  .description=${PL("How often to broadcast neighbor info (0 = default)")}
                  .value=${d.update_interval ?? 0} .min=${0}
                  @change=${(e) => this._updateField("update_interval", e.detail.value)}></mesh-number-input>
              </div>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-neighbor-info")) {
  customElements.define("mesh-settings-neighbor-info", MeshSettingsNeighborInfo);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-ambient-lighting>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsAmbientLighting extends ModuleConfigPanel {
  get _section() { return "ambient_lighting"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Ambient Lighting")}</h3>
          <p>${PL("Configure onboard LED color and brightness.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("LED State")} .description=${PL("Turn the LED on or off")}
            .checked=${d.led_state === true}
            @change=${(e) => this._updateField("led_state", e.detail.checked)}></mesh-toggle>

          ${d.led_state ? html`
            <div class="settings-section">
              <div class="form-grid">
                <mesh-number-input .label=${PL("Red")} .description=${PL("Red channel (0-255)")}
                  .value=${d.red ?? 0} .min=${0} .max=${255}
                  @change=${(e) => this._updateField("red", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Green")} .description=${PL("Green channel (0-255)")}
                  .value=${d.green ?? 0} .min=${0} .max=${255}
                  @change=${(e) => this._updateField("green", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Blue")} .description=${PL("Blue channel (0-255)")}
                  .value=${d.blue ?? 0} .min=${0} .max=${255}
                  @change=${(e) => this._updateField("blue", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Current")} .description=${PL("LED brightness / current limit (0-31)")}
                  .value=${d.current ?? 0} .min=${0} .max=${31}
                  @change=${(e) => this._updateField("current", e.detail.value)}></mesh-number-input>
              </div>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-ambient-lighting")) {
  customElements.define("mesh-settings-ambient-lighting", MeshSettingsAmbientLighting);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-detection-sensor>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsDetectionSensor extends ModuleConfigPanel {
  get _section() { return "detection_sensor"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Detection Sensor")}</h3>
          <p>${PL("Configure a GPIO-based detection sensor that sends alerts on the mesh.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("Enabled")} .description=${PL("Enable Detection Sensor module")}
            .checked=${d.enabled === true}
            @change=${(e) => this._updateField("enabled", e.detail.checked)}></mesh-toggle>

          ${d.enabled ? html`
            <div class="settings-section">
              <div class="form-grid">
                <mesh-number-input .label=${PL("Monitor Pin")} .description=${PL("GPIO pin to monitor for detection")}
                  .value=${d.monitor_pin ?? 0} .min=${0} .max=${48}
                  @change=${(e) => this._updateField("monitor_pin", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("Minimum Broadcast Secs")}
                  .description=${PL("Min interval between alert broadcasts")}
                  .value=${d.minimum_broadcast_secs ?? 0} .min=${0}
                  @change=${(e) => this._updateField("minimum_broadcast_secs", e.detail.value)}></mesh-number-input>
                <mesh-number-input .label=${PL("State Broadcast Secs")}
                  .description=${PL("Periodic state broadcast interval")}
                  .value=${d.state_broadcast_secs ?? 0} .min=${0}
                  @change=${(e) => this._updateField("state_broadcast_secs", e.detail.value)}></mesh-number-input>
                <mesh-text-input .label=${PL("Detection Triggered High")}
                  .description=${PL("Message when pin goes HIGH")}
                  .value=${d.detection_triggered_high || ""}
                  @change=${(e) => this._updateField("detection_triggered_high", e.detail.value)}></mesh-text-input>
                <mesh-text-input .label=${PL("Detection Triggered Low")}
                  .description=${PL("Message when pin goes LOW")}
                  .value=${d.detection_triggered_low || ""}
                  @change=${(e) => this._updateField("detection_triggered_low", e.detail.value)}></mesh-text-input>
              </div>
              <mesh-toggle .label=${PL("Send Bell")} .description=${PL("Send a bell notification with alerts")}
                .checked=${d.send_bell === true}
                @change=${(e) => this._updateField("send_bell", e.detail.checked)}></mesh-toggle>
              <mesh-toggle .label=${PL("Use Pullup")} .description=${PL("Enable internal pullup resistor")}
                .checked=${d.use_pullup === true}
                @change=${(e) => this._updateField("use_pullup", e.detail.checked)}></mesh-toggle>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-detection-sensor")) {
  customElements.define("mesh-settings-detection-sensor", MeshSettingsDetectionSensor);
}

/* ══════════════════════════════════════════════════════════
   <mesh-settings-paxcounter>
   ══════════════════════════════════════════════════════════ */

class MeshSettingsPaxcounter extends ModuleConfigPanel {
  get _section() { return "paxcounter"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Paxcounter")}</h3>
          <p>${PL("Count nearby WiFi and BLE devices and broadcast counts on the mesh.")}</p>
        </div>
        <div class="settings-panel-body">
          <mesh-toggle .label=${PL("Enabled")} .description=${PL("Enable Paxcounter module")}
            .checked=${d.enabled === true}
            @change=${(e) => this._updateField("enabled", e.detail.checked)}></mesh-toggle>

          ${d.enabled ? html`
            <div class="settings-section">
              <div class="form-grid">
                <mesh-number-input .label=${PL("Update Interval (secs)")}
                  .description=${PL("How often to broadcast pax count (0 = default)")}
                  .value=${d.paxcounter_update_interval ?? 0} .min=${0}
                  @change=${(e) => this._updateField("paxcounter_update_interval", e.detail.value)}></mesh-number-input>
              </div>
              <mesh-toggle .label=${PL("WiFi Threshold")}
                .description=${PL("Enable WiFi device counting")}
                .checked=${d.wifi_threshold !== 0}
                @change=${(e) => this._updateField("wifi_threshold", e.detail.checked ? -80 : 0)}></mesh-toggle>
              <mesh-toggle .label=${PL("BLE Threshold")}
                .description=${PL("Enable BLE device counting")}
                .checked=${d.ble_threshold !== 0}
                @change=${(e) => this._updateField("ble_threshold", e.detail.checked ? -80 : 0)}></mesh-toggle>
            </div>
          ` : ""}
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-paxcounter")) {
  customElements.define("mesh-settings-paxcounter", MeshSettingsPaxcounter);
}

/* ══════════════════════════════════════════════════════════
   MT_SW firmware extensions — nieobecne w oficjalnym Meshtastic,
   ale zwracane przez firmware MT_SW i widoczne w aplikacji MT_SW_APP.
   ══════════════════════════════════════════════════════════ */

const MESH_BEACON_REGIONS = [
  { value: "UNSET", label: PL("None") },
  { value: "US", label: "US" },
  { value: "EU_433", label: "EU 433" },
  { value: "EU_868", label: "EU 868" },
  { value: "CN", label: "CN" },
  { value: "JP", label: "JP" },
  { value: "ANZ", label: "ANZ" },
  { value: "KR", label: "KR" },
  { value: "TW", label: "TW" },
  { value: "RU", label: "RU" },
  { value: "IN", label: "IN" },
];

const MESH_BEACON_PRESETS = [
  { value: "LONG_FAST", label: "LONG_FAST" },
  { value: "MEDIUM_FAST", label: "MEDIUM_FAST" },
  { value: "SHORT_FAST", label: "SHORT_FAST" },
  { value: "SHORT_TURBO", label: "SHORT_TURBO" },
];

class MeshSettingsTrafficManagement extends ModuleConfigPanel {
  get _section() { return "traffic_management"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Traffic Management")}</h3>
          <p>${PL("MT_SW firmware extension for shaping mesh traffic — not part of stock Meshtastic.")}</p>
        </div>
        <div class="settings-panel-body">
          <div class="settings-section">
            <div class="form-grid">
              <mesh-number-input
                .label=${PL("Position Min Interval (secs)")}
                .value=${d.position_min_interval_secs ?? 0}
                .min=${0}
                @change=${(e) => this._updateField("position_min_interval_secs", e.detail.value)}
              ></mesh-number-input>
              <mesh-number-input
                .label=${PL("NodeInfo Direct Response Max Hops")}
                .value=${d.nodeinfo_direct_response_max_hops ?? 0}
                .min=${0}
                @change=${(e) => this._updateField("nodeinfo_direct_response_max_hops", e.detail.value)}
              ></mesh-number-input>
              <mesh-number-input
                .label=${PL("Rate Limit Window (secs)")}
                .value=${d.rate_limit_window_secs ?? 0}
                .min=${0}
                @change=${(e) => this._updateField("rate_limit_window_secs", e.detail.value)}
              ></mesh-number-input>
              <mesh-number-input
                .label=${PL("Rate Limit Max Packets")}
                .value=${d.rate_limit_max_packets ?? 0}
                .min=${0}
                @change=${(e) => this._updateField("rate_limit_max_packets", e.detail.value)}
              ></mesh-number-input>
              <mesh-number-input
                .label=${PL("Unknown Packet Threshold")}
                .value=${d.unknown_packet_threshold ?? 0}
                .min=${0}
                @change=${(e) => this._updateField("unknown_packet_threshold", e.detail.value)}
              ></mesh-number-input>
            </div>
          </div>
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-traffic-management")) {
  customElements.define("mesh-settings-traffic-management", MeshSettingsTrafficManagement);
}

class MeshSettingsMeshBeacon extends ModuleConfigPanel {
  get _section() { return "mesh_beacon"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Mesh Beacon")}</h3>
          <p>${PL("MT_SW firmware extension: periodically announces this mesh to nearby networks.")}</p>
        </div>
        <div class="settings-panel-body">
          <div class="info-banner">
            ${PL("Channel and target offers are configured on the device and are not editable here yet.")}
          </div>
          <div class="settings-section">
            <div class="form-grid">
              <mesh-text-input
                .label=${PL("Beacon Message")}
                .value=${d.broadcast_message || ""}
                .maxlength=${64}
                @change=${(e) => this._updateField("broadcast_message", e.detail.value)}
              ></mesh-text-input>
              <mesh-number-input
                .label=${PL("Broadcast Interval (secs)")}
                .value=${d.broadcast_interval_secs ?? 0}
                .min=${0}
                @change=${(e) => this._updateField("broadcast_interval_secs", e.detail.value)}
              ></mesh-number-input>
              <mesh-select
                .label=${PL("Offered Region")}
                .value=${String(d.broadcast_offer_region || "UNSET")}
                .options=${MESH_BEACON_REGIONS}
                @change=${(e) => this._updateField("broadcast_offer_region", e.detail.value)}
              ></mesh-select>
              <mesh-select
                .label=${PL("Offered Preset")}
                .value=${String(d.broadcast_offer_preset || "LONG_FAST")}
                .options=${MESH_BEACON_PRESETS}
                @change=${(e) => this._updateField("broadcast_offer_preset", e.detail.value)}
              ></mesh-select>
            </div>
          </div>
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-mesh-beacon")) {
  customElements.define("mesh-settings-mesh-beacon", MeshSettingsMeshBeacon);
}

/* Panel Sniffera mieszka w sniffer-panel.js — steruje snifferem przez OnDemand,
   a nie przez konfigurację modułu (upstreamowe protobufy nie mają nodemodadmin). */

class MeshSettingsStatusMessage extends ModuleConfigPanel {
  get _section() { return "statusmessage"; }

  render() {
    const d = this._draft;
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>${PL("Status Message")}</h3>
          <p>${PL("MT_SW firmware extension: a custom status text broadcast to the mesh.")}</p>
        </div>
        <div class="settings-panel-body">
          <div class="settings-section">
            <mesh-text-input
              .label=${PL("Status Text")}
              .description=${PL("Shown to other nodes on the node list")}
              .value=${d.node_status || ""}
              .maxlength=${40}
              @change=${(e) => this._updateField("node_status", e.detail.value)}
            ></mesh-text-input>
          </div>
        </div>
        <mesh-save-bar .dirty=${this._dirty} .saving=${this._saving}
          @save=${this._save} @discard=${this._resetDraft}></mesh-save-bar>
      </div>
    `;
  }
}
if (!customElements.get("mesh-settings-status-message")) {
  customElements.define("mesh-settings-status-message", MeshSettingsStatusMessage);
}
