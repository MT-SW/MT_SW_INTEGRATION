/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Okno szczegółów wiadomości w zakładce Wiadomości.
 *
 * Wysłana: status, przekaźniki, które usłyszały wiadomość (z SNR i RSSI każdego)
 * oraz — dla wiadomości prywatnej — potwierdzenie od adresata z drogą, którą
 * wróciło. Odebrana: czy dotarła bezpośrednio, czy przez ile skoków i przez jaki
 * przekaźnik, oraz poziom sygnału (SNR i RSSI) — także po skokach, wtedy jako
 * sygnał do ostatniego przekaźnika.
 *
 * Firmware podaje przekaźnik tylko jako ostatni bajt numeru węzła
 * (relay_node), więc nazwę dobieramy z bazy węzłów. Przekaźnik, którego
 * retransmisję słyszymy bezpośrednio, musi być naszym sąsiadem, dlatego
 * najpierw sprawdzamy węzły z hops_away == 0.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { t, resolveLanguage } from "./i18n.js";

class MeshMessageInfo extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      message: { attribute: false },
      nodes: { attribute: false },
    };
  }

  _close() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  _nodeName(nodeId) {
    if (nodeId === null || nodeId === undefined) {
      return t(this.hass, "common.unknown");
    }
    const node = (this.nodes || []).find((n) => n.node_id === nodeId);
    if (node) {
      return node.long_name || node.short_name || node.node_hex;
    }
    return `!${(nodeId >>> 0).toString(16).padStart(8, "0")}`;
  }

  _relayName(byte) {
    if (!byte) {
      return t(this.hass, "messages.info.relay_unknown");
    }
    const candidates = (this.nodes || []).filter(
      (n) => typeof n.node_id === "number" && (n.node_id & 0xff) === byte
    );
    const direct = candidates.filter((n) => n.hops_away === 0);
    const pool = direct.length ? direct : candidates;
    if (!pool.length) {
      return `0x${byte.toString(16).padStart(2, "0")}`;
    }
    const names = pool.slice(0, 3).map((n) => n.long_name || n.short_name || n.node_hex);
    return names.join(" / ") + (pool.length > 3 ? " …" : "");
  }

  _hops(count) {
    const polish = resolveLanguage(this.hass) === "pl";
    const few = polish && count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14);
    const form = count === 1 ? "one" : few ? "few" : "many";
    return t(this.hass, `messages.info.hops.${form}`, { n: count });
  }

  _time(ts) {
    return new Date(ts).toLocaleString(this.hass.language);
  }

  _row(label, value) {
    return html`
      <div class="detail-row">
        <span class="detail-label">${label}</span>
        <span class="detail-value">${value}</span>
      </div>
    `;
  }

  _signal(info) {
    const parts = [];
    if (typeof info.rx_snr === "number") {
      parts.push(`SNR ${info.rx_snr.toFixed(1)} dB`);
    }
    if (typeof info.rx_rssi === "number" && info.rx_rssi !== 0) {
      parts.push(`RSSI ${info.rx_rssi} dBm`);
    }
    return parts.length ? parts.join(" · ") : t(this.hass, "common.unknown");
  }

  /* Trasa (bezpośrednio albo liczba skoków i przekaźnik, przez który doleciało)
     oraz poziom sygnału. Po skokach SNR i RSSI opisują ostatni odcinek — do
     przekaźnika — więc dostają osobną etykietę. */
  _routeRows(info) {
    const hops = info.hops_away;
    const relayed = typeof hops === "number" && hops > 0;
    return html`
      ${hops === 0
        ? this._row(t(this.hass, "messages.info.route"), t(this.hass, "messages.info.direct"))
        : ""}
      ${relayed
        ? html`
            ${this._row(t(this.hass, "messages.info.route"), this._hops(hops))}
            ${this._row(
              t(this.hass, "messages.info.via"),
              info.relay_node ? this._relayName(info.relay_node) : t(this.hass, "messages.info.relay_unknown")
            )}
          `
        : ""}
      ${this._row(
        t(this.hass, relayed ? "messages.info.signal_relay" : "messages.info.signal"),
        this._signal(info)
      )}
    `;
  }

  _statusText(message) {
    if (!message.ack) {
      return t(this.hass, "messages.ack.pending");
    }
    if (message.ack === "SENT") {
      return t(this.hass, "messages.ack.sent");
    }
    if (message.ack === "ACK") {
      return t(this.hass, "messages.ack.ok");
    }
    const failed = t(this.hass, "messages.ack.failed");
    return message.ack_error ? `${failed} (${message.ack_error})` : failed;
  }

  _renderOut(message) {
    const relays = message.relays || [];
    const isDm = message.to_node !== null && message.to_node !== undefined;
    return html`
      ${this._row(t(this.hass, "messages.info.status"), this._statusText(message))}
      ${this._row(t(this.hass, "messages.info.sent_at"), this._time(message.ts))}
      ${isDm ? this._row(t(this.hass, "messages.info.to"), this._nodeName(message.to_node)) : ""}

      <div class="detail-section">${t(this.hass, "messages.info.relays")}</div>
      ${relays.length
        ? html`
            ${this._row(t(this.hass, "messages.info.relays_count"), relays.length)}
            ${relays.map((relay) => this._row(this._relayName(relay.relay_node), this._signal(relay)))}
          `
        : html`<div class="note">${t(this.hass, "messages.info.relays_none")}</div>`}

      ${message.ack === "ACK" && message.ack_info
        ? html`
            <div class="detail-section">${t(this.hass, "messages.info.ack_from")}</div>
            ${this._row(t(this.hass, "messages.info.from"), this._nodeName(message.ack_info.from))}
            ${this._routeRows(message.ack_info)}
          `
        : ""}
    `;
  }

  _renderIn(message) {
    return html`
      ${this._row(t(this.hass, "messages.info.from"), message.from_name || this._nodeName(message.from))}
      ${this._row(t(this.hass, "messages.info.received_at"), this._time(message.ts))}
      ${this._routeRows(message)}
      ${typeof message.xeddsa_signed === "boolean"
        ? this._row(
            t(this.hass, "messages.info.signature"),
            message.xeddsa_signed ? t(this.hass, "common.yes") : t(this.hass, "common.no")
          )
        : ""}
    `;
  }

  render() {
    if (!this.hass || !this.message) {
      return html``;
    }
    return html`
      <div class="scrim" @click=${() => this._close()}>
        <div class="dialog" @click=${(e) => e.stopPropagation()}>
          <div class="dialog-header">
            <span>${t(this.hass, "messages.info.title")}</span>
            <button class="close" @click=${() => this._close()}>✕</button>
          </div>
          <div class="dialog-body">
            ${this.message.direction === "out" ? this._renderOut(this.message) : this._renderIn(this.message)}
          </div>
        </div>
      </div>
    `;
  }

  static get styles() {
    return css`
      .scrim {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
        padding: 16px;
      }

      .dialog {
        width: min(560px, 100%);
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        border-radius: 12px;
        border: 1px solid var(--divider-color);
        overflow: hidden;
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 14px 16px;
        font-size: 16px;
        font-weight: 500;
        border-bottom: 1px solid var(--divider-color);
      }

      .close {
        background: none;
        border: none;
        font-size: 16px;
        cursor: pointer;
        color: var(--secondary-text-color);
      }

      .dialog-body {
        overflow-y: auto;
        padding: 8px 0;
      }

      .detail-section {
        padding: 12px 16px 4px;
        margin-top: 8px;
        border-top: 1px solid var(--divider-color);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--secondary-text-color);
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 6px 16px;
      }

      .detail-label {
        color: var(--secondary-text-color);
        font-size: 13px;
      }

      .detail-value {
        font-size: 14px;
        font-variant-numeric: tabular-nums;
        text-align: end;
      }

      .note {
        padding: 0 16px 8px;
        font-size: 12px;
        color: var(--secondary-text-color);
      }
    `;
  }
}

if (!customElements.get("mesh-message-info")) {
  customElements.define("mesh-message-info", MeshMessageInfo);
}