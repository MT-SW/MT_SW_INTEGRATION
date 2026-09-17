/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Wiadomości — lista rozmów, wątek i pole nadawania.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { layoutStyles, emptyStateStyles } from "./styles.js";
import { t, formatRelative } from "./i18n.js";

const MAX_TEXT_LENGTH = 228;

class MeshMessagesTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      entryId: { type: String },
      selectKey: { type: String },
      messages: { type: Array },
      nodes: { type: Array },
      channels: { type: Array },
      _selected: { type: String },
      _draft: { type: String },
      _sending: { type: Boolean },
      _error: { type: String },
      _deleting: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.messages = [];
    this.nodes = [];
    this.channels = [];
    this._selected = null;
    this._draft = "";
    this._sending = false;
    this._error = null;
    this._deleting = false;
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

  /* Klucz rozmowy: "ch:<index>" dla kanału, "dm:<node_id>" dla rozmowy prywatnej. */
  _conversationKey(message) {
    if (message.to_channel !== null && message.to_channel !== undefined) {
      return `ch:${message.to_channel}`;
    }
    const peer = message.direction === "out" ? message.to_node : message.from;
    return peer === null || peer === undefined ? null : `dm:${peer}`;
  }

  _conversations() {
    const map = new Map();

    for (const channel of this.channels || []) {
      if (!channel.role || channel.role === "DISABLED") {
        continue;
      }
      map.set(`ch:${channel.index}`, {
        key: `ch:${channel.index}`,
        kind: "channel",
        channelIndex: channel.index,
        name: channel.name || `${t(this.hass, "messages.channel")} ${channel.index}`,
        messages: [],
      });
    }

    for (const message of this.messages || []) {
      const key = this._conversationKey(message);
      if (key === null) {
        continue;
      }
      if (!map.has(key)) {
        const isChannel = key.startsWith("ch:");
        const id = Number(key.slice(3));
        map.set(key, {
          key,
          kind: isChannel ? "channel" : "dm",
          channelIndex: isChannel ? id : null,
          nodeId: isChannel ? null : id,
          name: isChannel ? `${t(this.hass, "messages.channel")} ${id}` : this._nodeName(id),
          messages: [],
        });
      }
      map.get(key).messages.push(message);
    }

    if (this._selected && this._selected.startsWith("dm:") && !map.has(this._selected)) {
      const peer = Number(this._selected.slice(3));
      map.set(this._selected, {
        key: this._selected,
        kind: "dm",
        channelIndex: null,
        nodeId: peer,
        name: this._nodeName(peer),
        messages: [],
      });
    }

    const list = [...map.values()];
    for (const conversation of list) {
      const last = conversation.messages[conversation.messages.length - 1];
      conversation.lastTs = last ? last.ts : 0;
      conversation.preview = last ? last.text : "";
    }
    list.sort((a, b) => b.lastTs - a.lastTs);
    return list;
  }

  _activeConversation(conversations) {
    if (!conversations.length) {
      return null;
    }
    return conversations.find((c) => c.key === this._selected) || conversations[0];
  }

  async _send(conversation) {
    const text = (this._draft || "").trim();
    if (!text || this._sending || !conversation) {
      return;
    }
    this._sending = true;
    this._error = null;

    const payload = { type: "meshtastic/send_message", entry_id: this.entryId, text };
    if (conversation.kind === "channel") {
      payload.channel_index = conversation.channelIndex;
    } else {
      payload.node_id = conversation.nodeId;
    }

    try {
      await this.hass.callWS(payload);
      this._draft = "";
    } catch (err) {
      console.error("MT_SW: wysyłka nie powiodła się", err);
      this._error = (err && err.message) || t(this.hass, "messages.send_failed");
    } finally {
      this._sending = false;
    }
  }

  async _deleteMessage(message) {
    if (this._deleting) {
      return;
    }
    this._deleting = true;
    try {
      await this.hass.callWS({
        type: "meshtastic/delete_message",
        entry_id: this.entryId,
        ts: message.ts,
        message_id: message.id ?? null,
      });
    } catch (err) {
      console.error("MT_SW: nie udało się usunąć wiadomości", err);
      this._error = (err && err.message) || t(this.hass, "messages.delete_failed");
    } finally {
      this._deleting = false;
    }
  }

  async _deleteConversation(conversation) {
    const question = t(this.hass, "messages.delete_conversation_confirm", { name: conversation.name });
    // eslint-disable-next-line no-alert
    if (!window.confirm(question) || this._deleting) {
      return;
    }
    this._deleting = true;
    try {
      await this.hass.callWS({
        type: "meshtastic/delete_conversation",
        entry_id: this.entryId,
        key: conversation.key,
      });
      if (this._selected === conversation.key) {
        this._selected = null;
      }
    } catch (err) {
      console.error("MT_SW: nie udało się usunąć rozmowy", err);
      this._error = (err && err.message) || t(this.hass, "messages.delete_failed");
    } finally {
      this._deleting = false;
    }
  }

  _onKeyDown(event, conversation) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this._send(conversation);
    }
  }

  _renderAck(message) {
    if (message.direction !== "out") {
      return html``;
    }
    if (!message.ack) {
      return html`<span class="ack pending" title=${t(this.hass, "messages.ack.pending")}>○</span>`;
    }
    if (message.ack === "ACK") {
      return html`<span class="ack ok" title=${t(this.hass, "messages.ack.ok")}>✓</span>`;
    }
    return html`<span class="ack nak" title=${message.ack_error || t(this.hass, "messages.ack.failed")}>✗</span>`;
  }

  _renderMessage(message) {
    const meta = [];
    if (typeof message.rx_snr === "number") {
      meta.push(`SNR ${message.rx_snr.toFixed(1)} dB`);
    }
    if (typeof message.hops_away === "number") {
      meta.push(t(this.hass, "messages.hops", { n: message.hops_away }));
    }

    return html`
      <div class="bubble-row ${message.direction}">
        <div class="bubble">
          ${message.direction === "in"
            ? html`<div class="sender">${message.from_name || this._nodeName(message.from)}</div>`
            : ""}
          <button
            class="bubble-delete"
            title=${t(this.hass, "messages.delete")}
            ?disabled=${this._deleting}
            @click=${() => this._deleteMessage(message)}
          >
            <ha-icon icon="mdi:trash-can-outline"></ha-icon>
          </button>
          <div class="text">${message.text}</div>
          <div class="meta">
            <span title=${new Date(message.ts).toLocaleString(this.hass.language)}>
              ${formatRelative(this.hass, message.ts)}
            </span>
            ${meta.length ? html`<span class="dot">·</span><span>${meta.join(" · ")}</span>` : ""}
            ${this._renderAck(message)}
          </div>
        </div>
      </div>
    `;
  }

  updated(changed) {
    // Przejście z listy węzłów: rozmowa może jeszcze nie istnieć w historii,
    // więc tworzymy ją pusto przy pierwszym wyborze.
    if (changed.has("selectKey") && this.selectKey) {
      this._selected = this.selectKey;
    }
    if (changed.has("messages") || changed.has("_selected") || changed.has("selectKey")) {
      const thread = this.renderRoot && this.renderRoot.querySelector(".thread");
      if (thread) {
        thread.scrollTop = thread.scrollHeight;
      }
    }
  }

  _renderConversationItem(conversation, active) {
    return html`
      <button
        class="conversation ${active && conversation.key === active.key ? "active" : ""}"
        @click=${() => {
          this._selected = conversation.key;
          this._error = null;
        }}
      >
        <span class="conversation-name">
          ${conversation.kind === "channel" ? "#" : ""}${conversation.name}
        </span>
        <span
          class="conversation-delete"
          title=${t(this.hass, "messages.delete_conversation")}
          @click=${(e) => {
            e.stopPropagation();
            this._deleteConversation(conversation);
          }}
        >
          <ha-icon icon="mdi:trash-can-outline"></ha-icon>
        </span>
      </button>
    `;
  }

  render() {
    if (!this.hass) {
      return html``;
    }

    const conversations = this._conversations();
    const active = this._activeConversation(conversations);

    if (!conversations.length) {
      return html`<div class="tab-content">
        <div class="empty-state">${t(this.hass, "messages.empty")}</div>
      </div>`;
    }

    const remaining = MAX_TEXT_LENGTH - (this._draft || "").length;

    return html`
      <div class="split">
        <aside class="sidebar">
          ${conversations.filter((c) => c.kind === "channel").length ? html`
            <div class="sidebar-header">${t(this.hass, "messages.channels_header")}</div>
            ${conversations.filter((c) => c.kind === "channel").map((c) => this._renderConversationItem(c, active))}
          ` : ""}
          ${conversations.filter((c) => c.kind === "dm").length ? html`
            <div class="sidebar-header">${t(this.hass, "messages.dms_header")}</div>
            ${conversations.filter((c) => c.kind === "dm").map((c) => this._renderConversationItem(c, active))}
          ` : ""}
        </aside>

        <section class="pane">
          <div class="thread">
            ${active && active.messages.length
              ? active.messages.map((message) => this._renderMessage(message))
              : html`<div class="empty-state">${t(this.hass, "messages.no_messages")}</div>`}
          </div>

          <div class="composer">
            <textarea
              rows="2"
              maxlength=${MAX_TEXT_LENGTH}
              .value=${this._draft}
              placeholder=${t(this.hass, "messages.placeholder")}
              ?disabled=${this._sending}
              @input=${(e) => {
                this._draft = e.target.value;
              }}
              @keydown=${(e) => this._onKeyDown(e, active)}
            ></textarea>
            <div class="composer-side">
              <span class="counter ${remaining < 20 ? "low" : ""}">${remaining}</span>
              <ha-button
                unelevated
                ?disabled=${this._sending || !(this._draft || "").trim()}
                @click=${() => this._send(active)}
              >
                ${this._sending ? t(this.hass, "messages.sending") : t(this.hass, "messages.send")}
              </ha-button>
            </div>
          </div>
          ${this._error ? html`<div class="error">${this._error}</div>` : ""}
        </section>
      </div>
    `;
  }

  static get styles() {
    return [
      layoutStyles,
      emptyStateStyles,
      css`
        .tab-content {
          padding: 16px;
        }

        .split {
          display: grid;
          grid-template-columns: minmax(200px, 280px) 1fr;
          height: var(--mtsw-tab-height, calc(100vh - 105px));
          border-top: 1px solid var(--divider-color);
        }

        /* Poniżej tej szerokości lista rozmów przestaje być pionową kolumną
           obok wątku (nie mieści się) — zamienia się w poziomy pasek pigułek
           u góry, jak zakładki, a wątek zajmuje resztę ekranu pod spodem. */
        @media (max-width: 700px) {
          .split {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
          }

          .sidebar {
            display: flex;
            flex-direction: row;
            overflow-x: auto;
            overflow-y: hidden;
            border-right: none;
            border-bottom: 1px solid var(--divider-color);
            -webkit-overflow-scrolling: touch;
          }

          .sidebar-header {
            display: none;
          }

          .conversation {
            flex: 0 0 auto;
            width: auto;
            max-width: 160px;
            margin: 6px 4px;
          }

          .conversation-name {
            max-width: 120px;
          }
        }

        .sidebar-header {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--secondary-text-color);
          padding: 12px 16px 6px;
        }

        .sidebar {
          overflow-y: auto;
          border-right: 1px solid var(--divider-color);
          background: var(--card-background-color);
        }

        .conversation {
          position: relative;
          display: flex;
          align-items: center;
          gap: 6px;
          width: calc(100% - 16px);
          margin: 2px 8px;
          padding: 10px 12px;
          border: none;
          border-radius: 8px;
          background: none;
          font-family: inherit;
          text-align: start;
          cursor: pointer;
          color: var(--primary-text-color);
        }

        .conversation:hover {
          background: var(--secondary-background-color);
        }

        .conversation.active {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        .conversation-name {
          flex: 1;
          min-width: 0;
          font-weight: 500;
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .conversation-delete {
          flex-shrink: 0;
          opacity: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 2px;
          border-radius: 4px;
          color: inherit;
        }

        .conversation:hover .conversation-delete {
          opacity: 0.6;
        }

        .conversation-delete:hover {
          opacity: 1;
        }

        @media (hover: none) {
          .conversation-delete {
            opacity: 0.5;
          }
        }

        .pane {
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .thread {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .bubble-row {
          display: flex;
        }

        .bubble-row.out {
          justify-content: flex-end;
        }

        .bubble {
          position: relative;
          max-width: min(560px, 80%);
          padding: 8px 12px;
          border-radius: 12px;
          background: var(--card-background-color);
          border: 1px solid var(--divider-color);
        }

        .bubble-row.out .bubble {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          border-color: transparent;
        }

        .bubble-delete {
          position: absolute;
          top: 4px;
          inset-inline-end: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: rgba(0, 0, 0, 0.15);
          border-radius: 50%;
          color: inherit;
          cursor: pointer;
          width: 22px;
          height: 22px;
          padding: 0;
          opacity: 0;
        }

        .bubble-delete ha-icon {
          --mdc-icon-size: 14px;
        }

        .bubble:hover .bubble-delete {
          opacity: 0.6;
        }

        .bubble-delete:hover {
          opacity: 1;
        }

        .meta {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-top: 4px;
          font-size: 11px;
          opacity: 0.7;
        }

        .sender {
          font-size: 12px;
          font-weight: 500;
          color: var(--secondary-text-color);
          margin-bottom: 2px;
        }

        .text {
          font-size: 14px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .meta {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-top: 4px;
          font-size: 11px;
          opacity: 0.7;
        }

        .ack {
          margin-inline-start: 4px;
          font-weight: 700;
        }

        .ack.nak {
          color: var(--error-color, #db4437);
        }

        .composer {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid var(--divider-color);
          background: var(--card-background-color);
        }

        textarea {
          flex: 1;
          resize: none;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--primary-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 14px;
        }

        .composer-side {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          justify-content: space-between;
          gap: 4px;
        }

        .counter {
          font-size: 11px;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
        }

        .counter.low {
          color: var(--warning-color, #ffa600);
        }

        .error {
          padding: 8px 16px;
          color: var(--error-color, #db4437);
          font-size: 13px;
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-messages-tab")) {
  customElements.define("mesh-messages-tab", MeshMessagesTab);
}
