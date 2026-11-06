/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Zdrowie sieci — ocena każdego węzła (sygnał, bateria, aktywność,
 * zajętość kanału), podsumowanie sieci z rankingami i eksport wyników.
 * Pomysł i układ z aplikacji MT_SW_APP ("Zdrowie sieci" i "Podsumowanie").
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { signalInfo } from "./hops.js";

const TEXT = {
  pl: {
    title: "Zdrowie sieci",
    score: "Kondycja sieci",
    good: "Dobrze",
    ok: "Średnio",
    bad: "Źle",
    unknown: "Brak danych",
    nodes: "węzłów",
    only_fav: "Tylko ulubione",
    hide_ignored: "Ukryj ignorowane",
    only_active: "Tylko aktywne (24 h)",
    filter_all: "Wszystkie",
    search: "Szukaj węzła…",
    node: "Węzeł",
    rating: "Ocena",
    signal: "Sygnał",
    battery: "Bateria",
    activity: "Aktywność",
    channel: "Kanał",
    uptime: "Czas pracy",
    powered: "zasilanie",
    ago: "temu",
    never: "nigdy",
    summary: "Podsumowanie",
    best_signal: "Najlepszy sygnał",
    worst_signal: "Najsłabszy sygnał",
    low_battery: "Najniższa bateria",
    longest_uptime: "Najdłużej działają",
    busiest: "Najbardziej zajęty kanał",
    silent: "Najdłużej milczą",
    total: "Wszystkich węzłów",
    active: "Aktywne w 24 h",
    favorites: "Ulubione",
    export: "Zapisz wyniki",
    groups: "Grupy węzłów",
    group_all: "Wszystkie węzły",
    group_new: "Nazwa nowej grupy",
    group_create: "Utwórz z pokazanych",
    group_add: "Dodaj pokazane do grupy",
    group_remove: "Usuń pokazane z grupy",
    group_delete: "Usuń grupę",
    group_help: "Grupy są Twoje, zapisują się w Home Assistancie i służą do filtrowania oraz zbiorczego śledzenia. Wybierz grupę, a lista i wyniki pokażą tylko jej węzły.",
    group_saved: "Grupy zapisane.",
    group_failed: "Nie udało się zapisać grup.",
    charts: "Rozkłady",
    ch_snr: "Sygnał (SNR)",
    ch_battery: "Bateria",
    ch_activity: "Ostatnio słyszany",
    b_snr1: "poniżej −10 dB", b_snr2: "−10…0 dB", b_snr3: "0…5 dB", b_snr4: "powyżej 5 dB",
    b_bat1: "poniżej 20%", b_bat2: "20–50%", b_bat3: "50–100%", b_bat4: "zasilanie",
    b_act1: "do 2 h", b_act2: "do 24 h", b_act3: "do 7 dni", b_act4: "dawniej / nigdy",
    bulk: "Śledzenie w Home Assistancie",
    track_fav: "Śledź ulubione",
    track_shown: "Śledź pokazane",
    untrack_shown: "Przestań śledzić pokazane",
    bulk_done: "Zmieniono: {n}.",
    bulk_failed: "Nie udało się zmienić śledzenia.",
    empty: "Brak węzłów do oceny.",
    legend:
      "Ocena łączy sygnał (SNR), baterię, to jak dawno węzeł się odezwał i zajętość kanału. Węzeł bez żadnego z tych danych jest oceniany jako „brak danych”.",
  },
  en: {
    title: "Network health",
    score: "Network health",
    good: "Good",
    ok: "Fair",
    bad: "Poor",
    unknown: "No data",
    nodes: "nodes",
    only_fav: "Favorites only",
    hide_ignored: "Hide ignored",
    only_active: "Active only (24 h)",
    filter_all: "All",
    search: "Search node…",
    node: "Node",
    rating: "Rating",
    signal: "Signal",
    battery: "Battery",
    activity: "Activity",
    channel: "Channel",
    uptime: "Uptime",
    powered: "powered",
    ago: "ago",
    never: "never",
    summary: "Summary",
    best_signal: "Best signal",
    worst_signal: "Weakest signal",
    low_battery: "Lowest battery",
    longest_uptime: "Longest uptime",
    busiest: "Busiest channel",
    silent: "Silent the longest",
    total: "All nodes",
    active: "Active in 24 h",
    favorites: "Favorites",
    export: "Save results",
    groups: "Node groups",
    group_all: "All nodes",
    group_new: "New group name",
    group_create: "Create from shown",
    group_add: "Add shown to group",
    group_remove: "Remove shown from group",
    group_delete: "Delete group",
    group_help: "Groups are yours, are stored in Home Assistant and are used for filtering and bulk tracking. Pick a group and the list and results show only its nodes.",
    group_saved: "Groups saved.",
    group_failed: "Could not save groups.",
    charts: "Distributions",
    ch_snr: "Signal (SNR)",
    ch_battery: "Battery",
    ch_activity: "Last heard",
    b_snr1: "below −10 dB", b_snr2: "−10…0 dB", b_snr3: "0…5 dB", b_snr4: "above 5 dB",
    b_bat1: "below 20%", b_bat2: "20–50%", b_bat3: "50–100%", b_bat4: "powered",
    b_act1: "up to 2 h", b_act2: "up to 24 h", b_act3: "up to 7 days", b_act4: "older / never",
    bulk: "Tracking in Home Assistant",
    track_fav: "Track favorites",
    track_shown: "Track shown",
    untrack_shown: "Stop tracking shown",
    bulk_done: "Changed: {n}.",
    bulk_failed: "Could not change tracking.",
    empty: "No nodes to rate.",
    legend:
      "The rating combines signal (SNR), battery, how long ago the node was heard and channel utilization. A node with none of these is rated “no data”.",
  },
};

const DAY = 24 * 3600;

function level(score) {
  if (score === null) return "unknown";
  if (score >= 1.5) return "good";
  if (score >= 0.75) return "ok";
  return "bad";
}

/* Ocena jednej cechy: 2 dobrze, 1 średnio, 0 źle, null brak danych. */
function rateSnr(snr) {
  if (snr === null || snr === undefined) return null;
  return snr >= 0 ? 2 : snr >= -10 ? 1 : 0;
}
function rateBattery(level) {
  if (typeof level !== "number") return null;
  return level > 100 || level >= 50 ? 2 : level >= 20 ? 1 : 0;
}
function rateAge(seconds) {
  if (seconds === null) return null;
  return seconds < 2 * 3600 ? 2 : seconds < DAY ? 1 : 0;
}
function rateChannel(util) {
  if (typeof util !== "number") return null;
  return util < 25 ? 2 : util < 50 ? 1 : 0;
}

class MeshHealthTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      entryId: { type: String },
      nodes: { type: Array },
      _filter: { type: String },
      _search: { type: String },
      _onlyFav: { type: Boolean },
      _hideIgnored: { type: Boolean },
      _onlyActive: { type: Boolean },
      _notice: { type: String },
      _groups: { type: Object },
      _group: { type: String },
      _groupName: { type: String },
    };
  }

  constructor() {
    super();
    this.nodes = [];
    this._filter = "all";
    this._search = "";
    this._onlyFav = false;
    this._hideIgnored = true;
    this._onlyActive = false;
    this._notice = "";
    this._groups = {};
    this._group = "";
    this._groupName = "";
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadGroups();
  }

  async _loadGroups() {
    try {
      const r = await this.hass.callWS({ type: "meshtastic/ui_settings" });
      this._groups = (r && r.settings && r.settings.node_groups) || {};
    } catch (err) {
      console.warn("MT_SW: grupy węzłów", err);
    }
  }

  async _saveGroups(groups) {
    try {
      const r = await this.hass.callWS({ type: "meshtastic/ui_settings_set", settings: { node_groups: groups } });
      this._groups = (r && r.settings && r.settings.node_groups) || groups;
      this._notice = this._tr("group_saved");
    } catch (err) {
      this._notice = (err && err.message) || this._tr("group_failed");
    }
  }

  _shownIds() {
    return this._rows().map((r) => r.node.node_id);
  }

  _createGroup() {
    const name = this._groupName.trim().slice(0, 40);
    if (!name) return;
    const groups = { ...this._groups, [name]: [...new Set(this._shownIds())].slice(0, 1000) };
    this._groupName = "";
    this._group = name;
    return this._saveGroups(groups);
  }

  _editGroup(add) {
    if (!this._group || !this._groups[this._group]) return;
    const ids = new Set(this._groups[this._group]);
    this._shownIds().forEach((id) => (add ? ids.add(id) : ids.delete(id)));
    return this._saveGroups({ ...this._groups, [this._group]: [...ids].slice(0, 1000) });
  }

  _deleteGroup() {
    if (!this._group) return;
    const groups = { ...this._groups };
    delete groups[this._group];
    this._group = "";
    return this._saveGroups(groups);
  }

  _tr(key) {
    const lang = (this.hass && this.hass.language) || "pl";
    return (TEXT[lang.startsWith("pl") ? "pl" : "en"] || TEXT.pl)[key] || key;
  }

  _name(node) {
    return node.long_name || node.short_name || node.node_hex || String(node.node_id);
  }

  _age(node) {
    return node.last_heard ? Math.max(0, Date.now() / 1000 - node.last_heard) : null;
  }

  _fmtAge(seconds) {
    if (seconds === null) return this._tr("never");
    if (seconds < 90) return `${Math.round(seconds)} s`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
    if (seconds < 2 * DAY) return `${Math.round(seconds / 3600)} h`;
    return `${Math.round(seconds / DAY)} d`;
  }

  _fmtUptime(seconds) {
    if (typeof seconds !== "number") return "–";
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 2 * DAY) return `${Math.round(seconds / 3600)} h`;
    return `${Math.round(seconds / DAY)} d`;
  }

  /* Jeden wiersz z ocenami cząstkowymi i oceną ogólną. */
  _row(node) {
    const sig = signalInfo(node);
    const snr = sig && typeof sig.snr === "number" ? sig.snr : null;
    const age = this._age(node);
    const parts = [
      rateSnr(snr),
      rateBattery(node.battery_level),
      rateAge(age),
      rateChannel(node.channel_utilization),
    ].filter((v) => v !== null);
    const score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
    return {
      node,
      name: this._name(node),
      snr,
      battery: typeof node.battery_level === "number" ? node.battery_level : null,
      age,
      channel: typeof node.channel_utilization === "number" ? node.channel_utilization : null,
      uptime: typeof node.uptime_seconds === "number" ? node.uptime_seconds : null,
      score,
      rating: level(score),
    };
  }

  _rows() {
    const q = this._search.trim().toLowerCase();
    const members = this._group && this._groups[this._group] ? new Set(this._groups[this._group]) : null;
    return (this.nodes || [])
      .filter((n) => !members || members.has(n.node_id))
      .filter((n) => !(this._onlyFav && !n.is_favorite))
      .filter((n) => !(this._hideIgnored && n.is_ignored))
      .map((n) => this._row(n))
      .filter((r) => !(this._onlyActive && (r.age === null || r.age > DAY)))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.node.node_hex || "").toLowerCase().includes(q));
  }

  _counts(rows) {
    const c = { good: 0, ok: 0, bad: 0, unknown: 0 };
    rows.forEach((r) => (c[r.rating] += 1));
    return c;
  }

  _top(rows, key, dir, filter = (v) => v !== null) {
    return rows
      .filter((r) => filter(r[key]))
      .sort((a, b) => (dir === "asc" ? a[key] - b[key] : b[key] - a[key]))
      .slice(0, 3);
  }

  /* Zbiorcze śledzenie: encje Home Assistanta powstają tylko dla śledzonych węzłów. */
  async _bulkTrack(nodeIds, tracked) {
    const entryId = this.entryId;
    if (!entryId || !nodeIds.length) {
      return;
    }
    if (!tracked) {
      const pl = ((this.hass && this.hass.language) || "pl").startsWith("pl");
      const text = pl
        ? `Przestać zbierać dane ${nodeIds.length} węzłów? Zostaną też usunięte z urządzenia, a więc z listy.`
        : `Stop collecting data for ${nodeIds.length} nodes? They will also be removed from the device and from the list.`;
      // eslint-disable-next-line no-alert
      if (!window.confirm(text)) {
        return;
      }
    }
    this._notice = "";
    try {
      const result = await this.hass.callWS({
        type: "meshtastic/set_tracked",
        entry_id: entryId,
        node_ids: nodeIds.slice(0, 500),
        tracked,
      });
      this._notice = this._tr("bulk_done").replace("{n}", String(result.changed.length));
    } catch (err) {
      this._notice = (err && err.message) || this._tr("bulk_failed");
    }
  }

  /* ── eksport ── */

  _exportRows(rows) {
    return rows.map((r) => ({
      name: r.name,
      id: r.node.node_hex || r.node.node_id,
      rating: this._tr(r.rating),
      snr: r.snr === null ? "" : r.snr.toFixed(1),
      battery: r.battery === null ? "" : r.battery > 100 ? "100+" : r.battery,
      last_heard: r.age === null ? "" : this._fmtAge(r.age),
      channel: r.channel === null ? "" : r.channel.toFixed(1),
      uptime: r.uptime === null ? "" : this._fmtUptime(r.uptime),
    }));
  }

  _download(name, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  _export(kind) {
    const rows = this._exportRows(this._rows());
    const head = [
      this._tr("node"),
      "ID",
      this._tr("rating"),
      "SNR [dB]",
      `${this._tr("battery")} [%]`,
      this._tr("activity"),
      `${this._tr("channel")} [%]`,
      this._tr("uptime"),
    ];
    const cells = rows.map((r) => [r.name, r.id, r.rating, r.snr, r.battery, r.last_heard, r.channel, r.uptime]);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `mtsw-zdrowie-sieci-${stamp}`;
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    if (kind === "csv") {
      const text = [head, ...cells].map((r) => r.map(esc).join(";")).join("\n");
      this._download(`${base}.csv`, "text/csv", `﻿${text}`);
    } else if (kind === "md") {
      const line = (r) => `| ${r.join(" | ")} |`;
      const text = `# ${this._tr("title")} (${stamp})\n\n${line(head)}\n${line(head.map(() => "---"))}\n${cells.map(line).join("\n")}\n`;
      this._download(`${base}.md`, "text/markdown", text);
    } else if (kind === "html") {
      const h = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const text = `<!doctype html><meta charset="utf-8"><title>${h(this._tr("title"))}</title><style>body{font-family:sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}th{background:#eee}</style><h1>${h(this._tr("title"))} (${stamp})</h1><table><tr>${head.map((x) => `<th>${h(x)}</th>`).join("")}</tr>${cells.map((r) => `<tr>${r.map((x) => `<td>${h(x)}</td>`).join("")}</tr>`).join("")}</table>`;
      this._download(`${base}.html`, "text/html", text);
    } else if (kind === "pdf") {
      const h = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${h(this._tr("title"))}</title><style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:3px 6px;text-align:left}th{background:#eee}</style><h1>${h(this._tr("title"))} (${stamp})</h1><table><tr>${head.map((x) => `<th>${h(x)}</th>`).join("")}</tr>${cells.map((r) => `<tr>${r.map((x) => `<td>${h(x)}</td>`).join("")}</tr>`).join("")}</table>`);
      w.document.close();
      w.focus();
      w.print();
    } else {
      const text = `${this._tr("title")} (${stamp})\n\n${cells.map((r) => r.join(" | ")).join("\n")}\n`;
      this._download(`${base}.txt`, "text/plain", text);
    }
  }

  /* ── widok ── */

  _ring(rows, counts) {
    const rated = rows.length - counts.unknown;
    const pct = rated ? Math.round(((counts.good * 2 + counts.ok) / (rated * 2)) * 100) : 0;
    const r = 52;
    const circ = 2 * Math.PI * r;
    const seg = (n, color, offset) => {
      const len = rated ? (n / rated) * circ : 0;
      return html`<circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="14"
        stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"></circle>`;
    };
    const g = rated ? (counts.good / rated) * circ : 0;
    const o = rated ? (counts.ok / rated) * circ : 0;
    return html`
      <svg viewBox="0 0 140 140" class="ring" role="img" aria-label="${this._tr("score")} ${pct}%">
        <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--divider-color)" stroke-width="14"></circle>
        ${seg(counts.good, "var(--success-color, #43a047)", 0)}
        ${seg(counts.ok, "var(--warning-color, #ffa000)", g)}
        ${seg(counts.bad, "var(--error-color, #db4437)", g + o)}
        <text x="70" y="68" text-anchor="middle" class="pct">${pct}%</text>
        <text x="70" y="88" text-anchor="middle" class="sub">${this._tr("score")}</text>
      </svg>
    `;
  }

  /* Rozkład w czterech przedziałach, jako poziome słupki. */
  _dist(titleKey, labels, counts) {
    const max = Math.max(1, ...counts);
    return html`
      <div class="rank">
        <div class="rank-title">${this._tr(titleKey)}</div>
        ${labels.map(
          (l, i) => html`<div class="bar-row">
            <span class="bl">${this._tr(l)}</span>
            <span class="bt"><i style="width:${(counts[i] / max) * 100}%"></i></span>
            <b>${counts[i]}</b>
          </div>`
        )}
      </div>
    `;
  }

  _distributions(rows) {
    const bucket = (values, fn) => {
      const c = [0, 0, 0, 0];
      values.forEach((v) => (c[fn(v)] += 1));
      return c;
    };
    const snr = bucket(rows.filter((r) => r.snr !== null).map((r) => r.snr), (v) => (v < -10 ? 0 : v < 0 ? 1 : v < 5 ? 2 : 3));
    const bat = bucket(rows.filter((r) => r.battery !== null).map((r) => r.battery), (v) => (v > 100 ? 3 : v < 20 ? 0 : v < 50 ? 1 : 2));
    const act = bucket(rows.map((r) => r.age), (v) => (v === null ? 3 : v < 7200 ? 0 : v < DAY ? 1 : v < 7 * DAY ? 2 : 3));
    return html`<div class="ranks">
      ${this._dist("ch_snr", ["b_snr1", "b_snr2", "b_snr3", "b_snr4"], snr)}
      ${this._dist("ch_battery", ["b_bat1", "b_bat2", "b_bat3", "b_bat4"], bat)}
      ${this._dist("ch_activity", ["b_act1", "b_act2", "b_act3", "b_act4"], act)}
    </div>`;
  }

  _groupBar() {
    const names = Object.keys(this._groups).sort((a, b) => a.localeCompare(b));
    return html`
      <h4>${this._tr("groups")}</h4>
      <div class="bar">
        <button class="chip ${this._group === "" ? "on" : ""}" @click=${() => (this._group = "")}>${this._tr("group_all")}</button>
        ${names.map(
          (n) => html`<button class="chip ${this._group === n ? "on" : ""}" @click=${() => (this._group = n)}>${n} <b>${this._groups[n].length}</b></button>`
        )}
      </div>
      <div class="bar">
        <input class="search" placeholder="${this._tr("group_new")}" maxlength="40" .value=${this._groupName}
          @input=${(e) => (this._groupName = e.target.value)} />
        <button class="chip" @click=${() => this._createGroup()}>${this._tr("group_create")}</button>
        ${this._group
          ? html`<button class="chip" @click=${() => this._editGroup(true)}>${this._tr("group_add")}</button>
              <button class="chip" @click=${() => this._editGroup(false)}>${this._tr("group_remove")}</button>
              <button class="chip" @click=${() => this._deleteGroup()}>${this._tr("group_delete")}</button>`
          : ""}
      </div>
      <p class="legend">${this._tr("group_help")}</p>
    `;
  }

  _rank(titleKey, items, fmt) {
    if (!items.length) return "";
    return html`
      <div class="rank">
        <div class="rank-title">${this._tr(titleKey)}</div>
        ${items.map((r, i) => html`<div class="rank-row"><span>${i + 1}. ${r.name}</span><b>${fmt(r)}</b></div>`)}
      </div>
    `;
  }

  _chip(key, label, count) {
    return html`<button class="chip ${this._filter === key ? "on" : ""}" @click=${() => (this._filter = key)}>
      ${label}${count !== undefined ? html` <b>${count}</b>` : ""}
    </button>`;
  }

  _toggle(prop, label) {
    return html`<label class="tog"><input type="checkbox" .checked=${this[prop]} @change=${(e) => (this[prop] = e.target.checked)} />${label}</label>`;
  }

  render() {
    const rows = this._rows();
    if (!rows.length && !(this.nodes || []).length) {
      return html`<div class="empty">${this._tr("empty")}</div>`;
    }
    const counts = this._counts(rows);
    const shown = rows
      .filter((r) => this._filter === "all" || r.rating === this._filter)
      .sort((a, b) => (a.score ?? 99) - (b.score ?? 99) || a.name.localeCompare(b.name));
    const all = this.nodes || [];
    const active = all.filter((n) => this._age(n) !== null && this._age(n) <= DAY).length;
    return html`
      <div class="wrap">
        <h3>${this._tr("title")}</h3>
        <div class="top">
          ${this._ring(rows, counts)}
          <div class="tiles">
            <div class="tile"><b>${all.length}</b><span>${this._tr("total")}</span></div>
            <div class="tile"><b>${active}</b><span>${this._tr("active")}</span></div>
            <div class="tile"><b>${all.filter((n) => n.is_favorite).length}</b><span>${this._tr("favorites")}</span></div>
          </div>
        </div>

        <h4>${this._tr("summary")}</h4>
        <div class="ranks">
          ${this._rank("best_signal", this._top(rows, "snr", "desc"), (r) => `${r.snr.toFixed(1)} dB`)}
          ${this._rank("worst_signal", this._top(rows, "snr", "asc"), (r) => `${r.snr.toFixed(1)} dB`)}
          ${this._rank("low_battery", this._top(rows, "battery", "asc", (v) => v !== null && v <= 100), (r) => `${r.battery}%`)}
          ${this._rank("longest_uptime", this._top(rows, "uptime", "desc"), (r) => this._fmtUptime(r.uptime))}
          ${this._rank("busiest", this._top(rows, "channel", "desc"), (r) => `${r.channel.toFixed(1)}%`)}
          ${this._rank("silent", this._top(rows, "age", "desc"), (r) => this._fmtAge(r.age))}
        </div>

        <h4>${this._tr("charts")}</h4>
        ${this._distributions(rows)}
        ${this._groupBar()}

        <div class="bar">
          ${this._chip("all", this._tr("filter_all"), rows.length)}
          ${this._chip("good", this._tr("good"), counts.good)}
          ${this._chip("ok", this._tr("ok"), counts.ok)}
          ${this._chip("bad", this._tr("bad"), counts.bad)}
          ${this._chip("unknown", this._tr("unknown"), counts.unknown)}
        </div>
        <div class="bar">
          <input class="search" placeholder="${this._tr("search")}" .value=${this._search}
            @input=${(e) => (this._search = e.target.value)} />
          ${this._toggle("_onlyFav", this._tr("only_fav"))}
          ${this._toggle("_hideIgnored", this._tr("hide_ignored"))}
          ${this._toggle("_onlyActive", this._tr("only_active"))}
        </div>

        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>${this._tr("node")}</th><th>${this._tr("rating")}</th><th>${this._tr("signal")}</th>
              <th>${this._tr("battery")}</th><th>${this._tr("activity")}</th><th>${this._tr("channel")}</th><th>${this._tr("uptime")}</th>
            </tr></thead>
            <tbody>
              ${shown.map(
                (r) => html`<tr>
                  <td>${r.name}</td>
                  <td><span class="dot ${r.rating}"></span>${this._tr(r.rating)}</td>
                  <td>${r.snr === null ? "–" : `${r.snr.toFixed(1)} dB`}</td>
                  <td>${r.battery === null ? "–" : r.battery > 100 ? this._tr("powered") : `${r.battery}%`}</td>
                  <td>${r.age === null ? this._tr("never") : `${this._fmtAge(r.age)} ${this._tr("ago")}`}</td>
                  <td>${r.channel === null ? "–" : `${r.channel.toFixed(1)}%`}</td>
                  <td>${this._fmtUptime(r.uptime)}</td>
                </tr>`
              )}
            </tbody>
          </table>
        </div>

        <div class="bar">
          <span class="lbl">${this._tr("export")}:</span>
          ${["csv", "md", "html", "txt", "pdf"].map(
            (k) => html`<button class="chip" @click=${() => this._export(k)}>${k.toUpperCase()}</button>`
          )}
        </div>
        <div class="bar">
          <span class="lbl">${this._tr("bulk")}:</span>
          <button class="chip" @click=${() => this._bulkTrack(all.filter((n) => n.is_favorite).map((n) => n.node_id), true)}>${this._tr("track_fav")}</button>
          <button class="chip" @click=${() => this._bulkTrack(shown.map((r) => r.node.node_id), true)}>${this._tr("track_shown")}</button>
          <button class="chip" @click=${() => this._bulkTrack(shown.map((r) => r.node.node_id), false)}>${this._tr("untrack_shown")}</button>
          ${this._notice ? html`<span class="lbl">${this._notice}</span>` : ""}
        </div>
        <p class="legend">${this._tr("legend")}</p>
      </div>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; height: var(--mtsw-tab-height, 100%); overflow: auto; }
      .wrap { padding: 8px 16px 24px; max-width: 1100px; margin: 0 auto; }
      h3, h4 { margin: 12px 0 8px; font-weight: 500; }
      .top { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
      .ring { width: 150px; height: 150px; }
      .ring .pct { font-size: 28px; font-weight: 600; fill: var(--primary-text-color); }
      .ring .sub { font-size: 10px; fill: var(--secondary-text-color); }
      .tiles { display: flex; gap: 12px; flex-wrap: wrap; }
      .tile { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 12px; padding: 12px 18px; min-width: 110px; display: flex; flex-direction: column; }
      .tile b { font-size: 24px; }
      .tile span { font-size: 12px; color: var(--secondary-text-color); }
      .ranks { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
      .rank { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px 14px; }
      .rank-title { font-size: 12px; color: var(--secondary-text-color); margin-bottom: 4px; }
      .rank-row { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; padding: 2px 0; }
      .rank-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bar-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 2px 0; }
      .bl { width: 110px; flex: none; color: var(--secondary-text-color); }
      .bt { flex: 1; height: 10px; background: var(--divider-color); border-radius: 5px; overflow: hidden; }
      .bt i { display: block; height: 100%; background: var(--primary-color); }
      .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
      .chip { appearance: none; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); border-radius: 16px; padding: 4px 12px; font: inherit; font-size: 13px; cursor: pointer; }
      .chip.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
      .search { flex: 1; min-width: 160px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
      .tog { font-size: 13px; display: flex; gap: 4px; align-items: center; }
      .lbl { font-size: 13px; color: var(--secondary-text-color); }
      .table-wrap { overflow-x: auto; border: 1px solid var(--divider-color); border-radius: 12px; background: var(--card-background-color); }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--divider-color); white-space: nowrap; }
      th { font-size: 12px; color: var(--secondary-text-color); font-weight: 500; }
      .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; background: var(--disabled-text-color, #999); }
      .dot.good { background: var(--success-color, #43a047); }
      .dot.ok { background: var(--warning-color, #ffa000); }
      .dot.bad { background: var(--error-color, #db4437); }
      .legend, .empty { font-size: 12px; color: var(--secondary-text-color); }
      .empty { padding: 24px 16px; font-size: 14px; }
    `;
  }
}

if (!customElements.get("mtsw-health-tab")) {
  customElements.define("mtsw-health-tab", MeshHealthTab);
}
