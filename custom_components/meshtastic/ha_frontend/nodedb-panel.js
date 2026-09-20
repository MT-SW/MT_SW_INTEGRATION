/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Czyszczenie bazy węzłów radia w Ustawieniach → Pamięć, jak w aplikacji na
 * Androida: wybieramy, jak długo węzeł ma być nieaktywny (czas od ostatniego
 * odezwania się) i jakiego rodzaju węzły usunąć (wszystkie, nieznane albo
 * znane), widzimy, ile ich zostanie usuniętych, i dopiero potwierdzamy.
 * Do tego automatyczne czyszczenie: co N dni serwer usuwa węzły nieaktywne
 * dłużej niż M dni.
 *
 * Lista węzłów zawsze powstaje po stronie serwera z aktualnej bazy radia —
 * panel podaje tylko warunki, a usuwanie trwa w tle i odpytujemy je o postęp.
 * Ulubione, ignorowane, śledzone przez Home Assistanta węzły i własna bramka
 * nigdy nie są usuwane.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { PL } from "./pl-settings.js";
import { settingsStyles } from "./styles.js";
import "./components.js";

const MANUAL_DAYS = [1, 3, 7, 14, 30, 60, 90];
const AUTO_INACTIVITY_DAYS = [7, 14, 30, 60, 90, 180];
const AUTO_INTERVAL_DAYS = [1, 3, 7, 14, 30];
const POLL_MS = 2000;
const PREVIEW_DEBOUNCE_MS = 300;
const LIST_ROWS = 20;
const FEEDBACK_MS = 8000;

function daysLabel(count) {
  return count === 1 ? PL("1 day") : PL("{n} days").replace("{n}", String(count));
}

const daysOptions = (list) => list.map((n) => ({ value: String(n), label: daysLabel(n) }));

class MeshNodeDbCleanup extends LitElement {
  static get properties() {
    return {
      wsCommand: { type: Object },
      _inactive: { type: Number, state: true },
      _kind: { type: String, state: true },
      _preview: { type: Object, state: true },
      _previewLoading: { type: Boolean, state: true },
      _job: { type: Object, state: true },
      _auto: { type: Object, state: true },
      _confirmOpen: { type: Boolean, state: true },
      _error: { type: String, state: true },
      _feedback: { type: String, state: true },
    };
  }

  constructor() {
    super();
    this._inactive = 30;
    this._kind = "all";
    this._preview = null;
    this._previewLoading = false;
    this._job = null;
    this._auto = { enabled: false, inactivity_days: 30, interval_days: 7, last_run: null, last_removed: 0 };
    this._confirmOpen = false;
    this._error = "";
    this._feedback = "";
    this._pollTimer = null;
    this._previewTimer = null;
    this._feedbackTimer = null;
    this._previewSeq = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadStatus();
    this._refreshPreview();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopPolling();
    clearTimeout(this._previewTimer);
    clearTimeout(this._feedbackTimer);
  }

  /* ── dane ─────────────────────────────────────────────────── */

  _errorText(code) {
    if (code === "busy") {
      return PL("Cleaning is already in progress.");
    }
    if (code === "no_criteria") {
      return PL("Pick how long a node has been inactive or which kind of nodes to remove.");
    }
    if (code === "nodes_failed" || !code) {
      return PL("Could not reach the radio.");
    }
    return code;
  }

  _say(text) {
    this._feedback = text;
    clearTimeout(this._feedbackTimer);
    this._feedbackTimer = setTimeout(() => {
      this._feedback = "";
    }, FEEDBACK_MS);
  }

  async _loadStatus() {
    const res = await this.wsCommand("meshtastic_ui/nodedb_status");
    if (!res || !res.ok) {
      return;
    }
    this._job = res.job;
    this._auto = res.auto;
    if (res.job && res.job.state === "running") {
      this._startPolling();
    }
  }

  _hasCriteria() {
    return this._inactive > 0 || this._kind !== "all";
  }

  _scheduleSelectionChange() {
    this._preview = null;
    this._error = "";
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._refreshPreview(), PREVIEW_DEBOUNCE_MS);
  }

  async _refreshPreview() {
    if (!this._hasCriteria()) {
      this._preview = null;
      this._previewLoading = false;
      return;
    }
    const seq = ++this._previewSeq;
    this._previewLoading = true;
    const res = await this.wsCommand("meshtastic_ui/nodedb_preview", { inactive_days: this._inactive, kind: this._kind });
    if (seq !== this._previewSeq) {
      return; // w międzyczasie zmieniono wybór — ta odpowiedź jest nieaktualna
    }
    this._previewLoading = false;
    if (res && res.ok) {
      this._preview = res;
      this._error = "";
    } else {
      this._preview = null;
      this._error = this._errorText(res && res.error);
    }
  }

  async _startClean() {
    this._confirmOpen = false;
    this._error = "";
    const res = await this.wsCommand("meshtastic_ui/nodedb_clean", { inactive_days: this._inactive, kind: this._kind });
    if (!res || !res.ok) {
      this._error = this._errorText(res && res.error);
      return;
    }
    if (!res.started) {
      this._say(PL("No nodes match these choices."));
      return;
    }
    this._job = { state: "running", source: "manual", total: res.total, processed: 0, removed: 0, failed: 0 };
    this._startPolling();
  }

  _startPolling() {
    if (this._pollTimer) {
      return;
    }
    this._pollTimer = setInterval(() => this._poll(), POLL_MS);
  }

  _stopPolling() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  async _poll() {
    const res = await this.wsCommand("meshtastic_ui/nodedb_status");
    if (!res || !res.ok) {
      return;
    }
    const wasManual = this._job && this._job.source === "manual";
    this._job = res.job;
    this._auto = res.auto;
    if (res.job.state !== "running") {
      this._stopPolling();
      if (wasManual || res.job.source === "manual") {
        this._say(
          PL("Cleaning finished: removed {removed}, failed {failed}.")
            .replace("{removed}", String(res.job.removed))
            .replace("{failed}", String(res.job.failed))
        );
      }
      this._refreshPreview();
      this.dispatchEvent(new CustomEvent("nodedb-cleaned", { bubbles: true, composed: true }));
    }
  }

  async _saveAuto(patch) {
    const next = {
      enabled: this._auto.enabled,
      inactivity_days: this._auto.inactivity_days,
      interval_days: this._auto.interval_days,
      ...patch,
    };
    const res = await this.wsCommand("meshtastic_ui/nodedb_auto_set", next);
    if (res && res.ok) {
      this._auto = res.auto;
      this._error = "";
    } else {
      this._error = this._errorText(res && res.error);
    }
  }

  /* ── widok ────────────────────────────────────────────────── */

  _nodeName(node) {
    const name = node.long_name || node.node_hex || `#${node.node_id}`;
    return node.short_name ? `${name} (${node.short_name})` : name;
  }

  _lastHeard(node) {
    return node.last_heard ? new Date(node.last_heard * 1000).toLocaleDateString() : PL("never heard");
  }

  _renderPreview() {
    if (!this._hasCriteria()) {
      return html`<div class="note">${PL("Pick how long a node has been inactive or which kind of nodes to remove.")}</div>`;
    }
    if (this._previewLoading && !this._preview) {
      return html`<div class="note">${PL("Checking…")}</div>`;
    }
    const preview = this._preview;
    if (!preview) {
      return "";
    }
    if (preview.count === 0) {
      return html`<div class="note">${PL("No nodes match these choices.")}</div>`;
    }
    const shown = preview.nodes.slice(0, LIST_ROWS);
    const hidden = preview.count - shown.length;
    return html`
      <div class="queued">${PL("Queued for deletion")}: <b>${preview.count}</b></div>
      <ul class="node-list">
        ${shown.map(
          (node) => html`
            <li>
              <span class="node-name">${this._nodeName(node)}</span>
              <span class="node-meta">${node.known ? "" : `${PL("unknown")} · `}${this._lastHeard(node)}</span>
            </li>
          `
        )}
      </ul>
      ${hidden > 0 ? html`<div class="note">${PL("and {n} more").replace("{n}", String(hidden))}</div>` : ""}
    `;
  }

  _renderProgress() {
    const job = this._job;
    if (!job || job.state !== "running") {
      return "";
    }
    return html`
      <div class="progress">
        <div>
          ${job.source === "auto" ? `${PL("Automatic cleaning")}: ` : ""}${PL("Removing")}: ${job.processed} / ${job.total}
          ${job.failed ? html` · <span class="bad">${PL("Failed: {n}").replace("{n}", String(job.failed))}</span>` : ""}
        </div>
        <progress max=${job.total || 1} value=${job.processed}></progress>
      </div>
    `;
  }

  _renderAuto() {
    const auto = this._auto;
    return html`
      <div class="section">
        <h4>${PL("Automatic cleaning")}</h4>
        <p class="note">${PL("Automatically remove nodes after a period of inactivity.")}</p>
        <mesh-toggle
          .label=${PL("Enable automatic cleaning")}
          .description=${PL("The first check happens after the chosen interval.")}
          .checked=${Boolean(auto.enabled)}
          @change=${(e) => this._saveAuto({ enabled: e.detail.checked })}
        ></mesh-toggle>
        <div class="form-grid">
          <mesh-select
            .label=${PL("Remove nodes inactive for longer than")}
            .value=${String(auto.inactivity_days)}
            .options=${daysOptions(AUTO_INACTIVITY_DAYS)}
            @change=${(e) => this._saveAuto({ inactivity_days: Number(e.detail.value) })}
          ></mesh-select>
          <mesh-select
            .label=${PL("Check every")}
            .value=${String(auto.interval_days)}
            .options=${daysOptions(AUTO_INTERVAL_DAYS)}
            @change=${(e) => this._saveAuto({ interval_days: Number(e.detail.value) })}
          ></mesh-select>
        </div>
        ${auto.last_run
          ? html`<div class="note">
              ${PL("Last check")}: ${new Date(auto.last_run * 1000).toLocaleString()} · ${PL("Removed: {n}").replace("{n}", String(auto.last_removed || 0))}
            </div>`
          : ""}
      </div>
    `;
  }

  render() {
    const running = Boolean(this._job && this._job.state === "running");
    const count = this._preview ? this._preview.count : 0;
    return html`
      <div class="section">
        <h4>${PL("Clean Node Database")}</h4>
        <p class="note">
          ${PL("Warning: this removes nodes from the radio's node database and from the panel. Favorite, ignored and Home Assistant-tracked nodes and your own gateway are skipped.")}
        </p>
        <div class="form-grid">
          <mesh-select
            .label=${PL("Inactive for longer than")}
            .value=${String(this._inactive)}
            .options=${[{ value: "0", label: PL("Any time") }, ...daysOptions(MANUAL_DAYS)]}
            @change=${(e) => {
              this._inactive = Number(e.detail.value);
              this._scheduleSelectionChange();
            }}
          ></mesh-select>
          <mesh-select
            .label=${PL("Node kind")}
            .value=${this._kind}
            .options=${[
              { value: "all", label: PL("All nodes") },
              { value: "unknown", label: PL("Only unknown") },
              { value: "known", label: PL("Only known") },
            ]}
            @change=${(e) => {
              this._kind = e.detail.value;
              this._scheduleSelectionChange();
            }}
          ></mesh-select>
        </div>

        ${this._renderPreview()} ${this._renderProgress()}
        ${this._error ? html`<div class="error">${this._error}</div>` : ""}
        ${this._feedback ? html`<div class="feedback">${this._feedback}</div>` : ""}

        <div class="buttons">
          <button
            class="btn danger"
            ?disabled=${running || this._previewLoading || count === 0}
            @click=${() => { this._confirmOpen = true; }}
          >
            ${PL("Clean now")}
          </button>
        </div>
      </div>

      ${this._renderAuto()}

      <mesh-confirm-dialog
        .open=${this._confirmOpen}
        .title=${PL("Clean Node Database")}
        .message=${PL("You are about to remove nodes from the database: {n}. This cannot be undone.").replace("{n}", String(count))}
        .confirmLabel=${PL("Clean now")}
        .danger=${true}
        @confirm=${() => this._startClean()}
        @cancel=${() => { this._confirmOpen = false; }}
      ></mesh-confirm-dialog>
    `;
  }

  static get styles() {
    return [
      settingsStyles,
      css`
        :host { display: block; }

        .section {
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--divider-color);
        }

        h4 { margin: 0 0 6px; font-size: 15px; }

        .note {
          font-size: 12px;
          color: var(--secondary-text-color);
          line-height: 1.5;
          margin: 6px 0;
        }

        .queued { margin: 10px 0 4px; font-size: 14px; }

        .node-list {
          list-style: none;
          margin: 4px 0 8px;
          padding: 0;
          max-height: 220px;
          overflow: auto;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
        }

        .node-list li {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 6px 10px;
          font-size: 13px;
          border-top: 1px solid var(--divider-color);
        }

        .node-list li:first-child { border-top: none; }
        .node-meta { color: var(--secondary-text-color); white-space: nowrap; }

        .progress { margin: 10px 0; font-size: 13px; }
        .progress progress { width: 100%; height: 8px; margin-top: 4px; }
        .bad { color: var(--error-color, #db4437); }

        .error {
          margin: 8px 0;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
          color: #f44336;
          background: rgba(244, 67, 54, 0.1);
          border: 1px solid rgba(244, 67, 54, 0.3);
        }

        .feedback {
          margin: 8px 0;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
          color: #4caf50;
          background: rgba(76, 175, 80, 0.1);
          border: 1px solid rgba(76, 175, 80, 0.3);
        }

        .buttons { display: flex; gap: 8px; margin-top: 10px; }

        .btn {
          padding: 6px 14px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 13px;
          cursor: pointer;
        }

        .btn.danger { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437); }
        .btn[disabled] { opacity: 0.5; cursor: default; }
      `,
    ];
  }
}

if (!customElements.get("mesh-nodedb-cleanup")) {
  customElements.define("mesh-nodedb-cleanup", MeshNodeDbCleanup);
}
