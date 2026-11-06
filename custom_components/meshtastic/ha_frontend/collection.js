/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Ustawienia → Zbieranie danych: osobna część integracji, niezależna od panelu.
 * Tu wybierasz, które węzły zbiera integracja (encje w Home Assistant), dodajesz
 * i usuwasz je oraz scalasz duplikaty (ten sam węzeł pod nowym numerem).
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";

class MtswCollectionTab extends LitElement {
  static get properties() {
    return {
      wsCommand: { attribute: false },
      _state: { state: true },
      _busy: { state: true },
      _msg: { state: true },
      _pick: { state: true },
      _filter: { state: true },
    };
  }

  constructor() {
    super();
    this._state = null;
    this._busy = false;
    this._msg = "";
    this._pick = new Set();
    this._filter = "";
    this._keep = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    try {
      const r = await this.wsCommand("meshtastic_ui/collection_state", {});
      if (!r || r.success === false || !r.tracked) throw new Error((r && r.error) || "brak odpowiedzi");
      this._state = r;
    } catch (err) {
      this._msg = `Błąd: ${err && err.message ? err.message : err}`;
    }
  }

  async _run(fn, okMsg) {
    this._busy = true;
    this._msg = "";
    try {
      const r = await fn();
      if (r && r.success === false) throw new Error(r.error || "nie udało się");
      this._msg = okMsg;
    } catch (err) {
      this._msg = `Błąd: ${err && err.message ? err.message : err}`;
    }
    this._busy = false;
    await this._load();
  }

  _add() {
    const ids = [...this._pick];
    if (!ids.length) return;
    this._pick = new Set();
    this._run(() => this.wsCommand("meshtastic_ui/collection_track", { node_ids: ids, tracked: true }), `Dodano do zbierania: ${ids.length}`);
  }

  _remove(item) {
    if (!window.confirm(`Przestać zbierać dane węzła ${item.label}?\n\nWęzeł zostanie też usunięty z radia, więc zniknie z listy w panelu. Tej operacji nie da się cofnąć.`)) return;
    this._run(() => this.wsCommand("meshtastic_ui/collection_track", { node_ids: [item.id], tracked: false }), "Usunięto ze zbierania i z radia");
  }

  _merge(group) {
    const keep = this._keep[group.survivor_id] ?? group.nodes[0].id;
    const others = group.nodes.filter((n) => n.id !== keep && !n.gateway).length;
    if (!window.confirm(`Scalić „${group.name}”?\n\nZostanie jeden węzeł. Pozostałe (${others}) znikną ze zbierania i z radia.`)) return;
    this._run(() => this.wsCommand("meshtastic_ui/merge_apply", { survivor_id: group.survivor_id, keep, remove_from_radio: true }), "Scalono");
  }

  render() {
    const s = this._state;
    if (!s) return html`<div class="settings-panel"><p class="hint">${this._msg || "Ładowanie…"}</p></div>`;
    const q = this._filter.trim().toLowerCase();
    const avail = s.available.filter((n) => !q || n.label.toLowerCase().includes(q)).slice(0, 100);
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>Zbieranie danych</h3>
          <p>Osobna część integracji: zbiera dane wybranych węzłów do encji Home Assistanta. Działa niezależnie od panelu i klienta web. Panel zawsze widzi wszystko, co jest w radiu.</p>
        </div>
        <div class="settings-panel-body">
          ${this._msg ? html`<p class="hint msg">${this._msg}</p>` : ""}

          <h4>Zbierane węzły (${s.tracked.length})</h4>
          ${s.tracked.length === 0 ? html`<p class="hint">Żaden węzeł nie jest zbierany.</p>` : ""}
          ${s.tracked.map(
            (n) => html`<div class="row">
              <span class="lbl">${n.label}${n.live ? "" : html` <em>(nie ma go w radiu)</em>`}</span>
              <button ?disabled=${this._busy} @click=${() => this._remove(n)}>Usuń</button>
            </div>`
          )}
          ${s.waiting ? html`<p class="hint">Węzły usunięte z radia, które integracja pamięta i wznowi zbieranie, gdy wrócą: ${s.waiting}.</p>` : ""}

          <h4>Dodaj węzły</h4>
          <input type="search" placeholder="Szukaj" .value=${this._filter} @input=${(e) => (this._filter = e.target.value)} />
          <div class="list">
            ${avail.map(
              (n) => html`<label class="row">
                <input type="checkbox" .checked=${this._pick.has(n.id)} @change=${(e) => {
                  const next = new Set(this._pick);
                  e.target.checked ? next.add(n.id) : next.delete(n.id);
                  this._pick = next;
                }} />
                <span class="lbl">${n.label}</span>
              </label>`
            )}
            ${avail.length === 0 ? html`<p class="hint">Brak węzłów do dodania.</p>` : ""}
          </div>
          <button ?disabled=${this._busy || !this._pick.size} @click=${() => this._add()}>Dodaj zaznaczone (${this._pick.size})</button>

          <h4>Duplikaty (${s.duplicates.length})</h4>
          <p class="hint">Ten sam węzeł pod kilkoma numerami (np. po zmianie klucza albo numeru). Wybierz, który zostaje. Pozostałe znikną ze zbierania i z radia, a encje i historia przejdą na wybrany.</p>
          ${s.duplicates.length === 0 ? html`<p class="hint">Nie znaleziono duplikatów.</p>` : ""}
          ${s.duplicates.map(
            (g) => html`<div class="group">
              <strong>${g.name}</strong>
              ${g.nodes.map(
                (n, i) => html`<label class="row">
                  <input type="radio" name=${"k" + g.survivor_id} .checked=${(this._keep[g.survivor_id] ?? g.nodes[0].id) === n.id}
                    @change=${() => { this._keep = { ...this._keep, [g.survivor_id]: n.id }; this.requestUpdate(); }} />
                  <span class="lbl">${n.label}${n.gateway ? " (bramka)" : ""}${n.live ? "" : " — nie ma go w radiu"}</span>
                </label>`
              )}
              <button ?disabled=${this._busy} @click=${() => this._merge(g)}>Scal</button>
            </div>`
          )}
        </div>
      </div>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; }
      .settings-panel-header h3 { margin: 0 0 4px; }
      .settings-panel-header p, .hint { color: var(--secondary-text-color); font-size: 13px; margin: 4px 0 8px; }
      h4 { margin: 18px 0 6px; }
      .row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--divider-color); }
      .lbl { flex: 1; word-break: break-word; }
      .list { max-height: 260px; overflow: auto; margin-bottom: 8px; }
      .group { border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
      input[type="search"] { width: 100%; box-sizing: border-box; padding: 8px; margin-bottom: 6px; }
      button { cursor: pointer; padding: 6px 12px; }
      .msg { color: var(--primary-text-color); }
    `;
  }
}
if (!customElements.get("mtsw-collection-tab")) customElements.define("mtsw-collection-tab", MtswCollectionTab);
