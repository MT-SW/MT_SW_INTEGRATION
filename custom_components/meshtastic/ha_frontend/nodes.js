/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Węzły — pełna lista z bazy urządzenia, filtry i akcje.
 *
 * Źródłem jest baza węzłów radia, a nie coordinator.data. Opcja "nodes"
 * wpisu konfiguracyjnego decyduje wyłącznie o tym, dla których węzłów
 * powstają encje Home Assistanta — panel pokazuje wszystko, co widzi radio,
 * tak jak klient WWW. Węzły z encjami są oznaczone, żeby nadal było wiadomo,
 * które trafiają do automatyzacji.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { layoutStyles, emptyStateStyles } from "./styles.js";
import { t, formatUptime, formatRelative, formatHops } from "./i18n.js";
import { viaInfo, relayLabel, signalInfo, formatSignal } from "./hops.js";
import "./chart.js";
import { buildTelemetryCharts } from "./telemetry-charts.js";
import "./node-stats.js";;
import "./node-ondemand.js";

/* Kategorie danych w szczegółach węzła, nazwane jak w aplikacji na Androida.
   ask: polecenie WS wysyłane przyciskiem "Poproś"; telemetry: rodzaj telemetrii
   dla request_telemetry. Kategoria bez ask/telemetry ma tylko historię —
   jakość sygnału, pakiety i zasoby węzeł zgłasza sam. */
const CATEGORIES = [
  { id: "neighbors", ask: "request_neighbors" },
  { id: "signal" },
  { id: "device", telemetry: "device_metrics" },
  { id: "environment", telemetry: "environment_metrics" },
  { id: "power", telemetry: "power_metrics" },
  { id: "packets" },
  { id: "resources" },
  { id: "position", ask: "request_position" },
  { id: "traceroute", ask: "traceroute" },
];

const TELEMETRY_KINDS = {
  device: "device_metrics",
  environment: "environment_metrics",
  power: "power_metrics",
};

const COLUMNS = [
  { key: "short_name", labelKey: "nodes.col.short_name", numeric: false },
  { key: "name", labelKey: "nodes.col.name", numeric: false },
  { key: "signal", labelKey: "nodes.col.signal", numeric: true },
  { key: "hops_away", labelKey: "nodes.col.hops", numeric: true },
  { key: "battery_level", labelKey: "nodes.col.battery", numeric: true },
  { key: "uptime_seconds", labelKey: "nodes.col.uptime", numeric: true },
  { key: "last_heard", labelKey: "nodes.col.last_heard", numeric: true },
];

const FILTERS = [
  { key: "favorites", labelKey: "nodes.filter.favorites" },
  { key: "direct", labelKey: "nodes.filter.direct" },
  { key: "positioned", labelKey: "nodes.filter.positioned" },
  { key: "tracked", labelKey: "nodes.filter.tracked" },
  { key: "hideMqtt", labelKey: "nodes.filter.hide_mqtt" },
  { key: "showIgnored", labelKey: "nodes.filter.show_ignored" },
];

class MeshNodesTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      entryId: { type: String },
      nodes: { type: Array },
      _filter: { type: String },
      _toggles: { type: Object },
      _sortKey: { type: String },
      _sortAsc: { type: Boolean },
      _detail: { type: Object },
      _busy: { type: String },
      _error: { type: String },
      _notice: { type: String },
      _traceroute: { type: Object },
      _traceHistory: { type: Array },
      _neighborHistory: { type: Array },
      _positionHistory: { type: Array },
      _telemetryHistory: { type: Object },
      _statsRequest: { type: Object },
      _ondemandOpen: { type: Boolean },
      _activeCategory: { type: String },
      _mtsw: { type: Boolean },
      _neighborsShown: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.nodes = [];
    this._filter = "";
    this._toggles = {};
    this._sortKey = "last_heard";
    this._sortAsc = false;
    this._detail = null;
    this._busy = null;
    this._error = null;
    this._notice = null;
    this._traceroute = null;
    this._traceHistory = [];
    this._neighborHistory = [];
    this._positionHistory = [];
    this._telemetryHistory = null;
    this._statsRequest = null;
    this._ondemandOpen = false;
    this._activeCategory = null;
    this._mtsw = null;
    this._mtswRequested = false;
    this._neighborsShown = false;
  }

  _displayName(node) {
    return node.long_name || node.short_name || node.node_hex || String(node.node_id);
  }

  _current() {
    // Dialog trzyma kopię sprzed odświeżenia, więc szukamy aktualnej wersji.
    if (!this._detail) {
      return null;
    }
    return (this.nodes || []).find((n) => n.node_id === this._detail.node_id) || this._detail;
  }

  _sortValue(node, key) {
    if (key === "name") {
      return this._displayName(node).toLowerCase();
    }
    if (key === "short_name") {
      return (node.short_name || "").toLowerCase();
    }
    if (key === "hops_away") {
      const { hops } = viaInfo(node);
      return hops === null ? -Infinity : hops;
    }
    if (key === "signal") {
      const info = signalInfo(node);
      return info && info.snr !== null ? info.snr : -Infinity;
    }
    const value = node[key];
    return value === null || value === undefined ? -Infinity : value;
  }

  _visibleNodes() {
    const needle = (this._filter || "").trim().toLowerCase();
    const on = this._toggles;
    let list = this.nodes || [];

    list = list.filter((node) => {
      if (node.is_ignored && !on.showIgnored) return false;
      if (on.favorites && !node.is_favorite) return false;
      if (on.direct && viaInfo(node).hops !== 0) return false;
      if (on.positioned && typeof node.latitude !== "number") return false;
      if (on.tracked && !node.is_tracked) return false;
      if (on.hideMqtt && node.via_mqtt) return false;
      if (needle) {
        const haystack = [node.long_name, node.short_name, node.node_hex, node.role]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const direction = this._sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      // Ulubione zawsze na górze, niezależnie od wybranego sortowania.
      if (a.is_favorite !== b.is_favorite) {
        return a.is_favorite ? -1 : 1;
      }
      const va = this._sortValue(a, this._sortKey);
      const vb = this._sortValue(b, this._sortKey);
      if (va < vb) return -1 * direction;
      if (va > vb) return 1 * direction;
      return 0;
    });
  }

  _toggleSort(key) {
    if (this._sortKey === key) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortKey = key;
      this._sortAsc = key === "name";
    }
  }

  _toggleFilter(key) {
    this._toggles = { ...this._toggles, [key]: !this._toggles[key] };
  }

  _formatValue(value, suffix, digits) {
    if (value === null || value === undefined) {
      return t(this.hass, "common.unknown");
    }
    const shown = typeof value === "number" && digits !== undefined ? value.toFixed(digits) : value;
    return suffix ? `${shown}${suffix}` : String(shown);
  }

  /* lastHeard przychodzi z radia jako uniksowy czas w sekundach.
     Na liście liczy się "jak dawno", nie "kiedy dokładnie" — pełna data
     zostaje w tooltipie i w szczegółach węzła. */
  _formatLastHeard(seconds) {
    return formatRelative(this.hass, seconds ? seconds * 1000 : null);
  }

  _absoluteTime(seconds) {
    return seconds ? new Date(seconds * 1000).toLocaleString(this.hass.language) : "";
  }

  async _call(kind, payload) {
    if (!this.entryId || this._busy) {
      return;
    }
    this._busy = kind;
    this._error = null;
    this._notice = null;
    try {
      const result = await this.hass.callWS({
        type: `meshtastic/${kind}`,
        entry_id: this.entryId,
        ...payload,
      });
      // Radio potrafi przyjąć polecenie bez potwierdzenia — wtedy nic się nie
      // stało i nie wolno tego meldować jako sukcesu.
      if (result && result.confirmed === false) {
        this._error = t(this.hass, "nodes.action.unconfirmed");
        return false;
      }
      this._notice = t(
        this.hass,
        kind === "remove_node" ? "nodes.action.removed" : "nodes.action.sent"
      );
      // Lista węzłów aktualizuje się sama (subskrypcja na żywo) — pełne
      // odświeżenie panelu jest potrzebne tylko dla pozostałych danych.
      if (kind !== "remove_node") {
        this.dispatchEvent(new CustomEvent("mtsw-refresh", { bubbles: true, composed: true }));
      }
      return result && result.result !== undefined ? result.result || true : true;
    } catch (err) {
      console.error("MT_SW: akcja nie powiodła się", kind, err);
      this._error = (err && err.message) || t(this.hass, "nodes.action.failed");
      return false;
    } finally {
      this._busy = null;
    }
  }

  /* Zmiana węzła w liście panelu od razu, zanim radio potwierdzi —
     jak w aplikacji. Przy błędzie wracamy do poprzedniego stanu. */
  _patchNode(nodeId, patch, removed = false) {
    this.dispatchEvent(
      new CustomEvent("mtsw-node-patch", {
        detail: { nodeId, patch, removed },
        bubbles: true,
        composed: true,
      })
    );
  }

  async _toggleFlag(node, kind, payload, patch) {
    if (!this.entryId) {
      return;
    }
    const revert = {};
    for (const key of Object.keys(patch)) {
      revert[key] = node[key];
    }
    this._patchNode(node.node_id, patch);
    this._error = null;
    try {
      const result = await this.hass.callWS({
        type: `meshtastic/${kind}`,
        entry_id: this.entryId,
        node_id: node.node_id,
        ...payload,
      });
      if (result && result.confirmed === false) {
        throw new Error(t(this.hass, "nodes.action.unconfirmed"));
      }
    } catch (err) {
      console.error("MT_SW: akcja nie powiodła się", kind, err);
      this._patchNode(node.node_id, revert);
      this._error = (err && err.message) || t(this.hass, "nodes.action.failed");
    }
  }

  _toggleFavorite(node) {
    const favorite = !node.is_favorite;
    return this._toggleFlag(node, "set_favorite", { favorite }, { is_favorite: favorite });
  }

  _toggleIgnored(node) {
    const ignored = !node.is_ignored;
    // firmware zdejmuje ulubienie z ignorowanego węzła
    const patch = ignored ? { is_ignored: true, is_favorite: false } : { is_ignored: false };
    return this._toggleFlag(node, "set_ignored", { ignored }, patch);
  }

  _openDm(node) {
    this.dispatchEvent(
      new CustomEvent("mtsw-open-dm", {
        detail: { nodeId: node.node_id },
        bubbles: true,
        composed: true,
      })
    );
  }

  async _confirmRemove(node) {
    const message = t(this.hass, "nodes.action.remove_confirm", { name: this._displayName(node) });
    // eslint-disable-next-line no-alert
    if (!window.confirm(message)) {
      return;
    }
    const removed = await this._call("remove_node", { node_id: node.node_id });
    if (removed) {
      // Usuwamy też z listy panelu, żeby wiersz zniknął natychmiast.
      this._patchNode(node.node_id, null, true);
      this.nodes = (this.nodes || []).filter((n) => n.node_id !== node.node_id);
      this._detail = null;
    }
  }

  _renderStar(node) {
    return html`
      <button
        class="star ${node.is_favorite ? "on" : ""}"
        title=${t(this.hass, node.is_favorite ? "nodes.action.unfavorite" : "nodes.action.favorite")}
        @click=${(e) => {
          e.stopPropagation();
          this._toggleFavorite(node);
        }}
      >
        ${node.is_favorite ? "★" : "☆"}
      </button>
    `;
  }

  _renderRow(node) {
    return html`
      <tr class=${node.is_ignored ? "ignored" : ""} @click=${() => {
        this._detail = node;
        this._traceHistory = [];
        this._neighborHistory = [];
        this._positionHistory = [];
        this._telemetryHistory = null;
        this._statsRequest = null;
        this._ondemandOpen = false;
        this._activeCategory = null;
        this._neighborsShown = false;
        this._ensureCapabilities();
      }}>
        <td class="star-cell">${this._renderStar(node)}</td>
        <td class="short" data-label=${t(this.hass, "nodes.col.short_name")}>${node.short_name || "—"}</td>
        <td>
          <span class="name">${this._displayName(node)}</span>
          ${node.is_gateway ? html`<span class="tag">${t(this.hass, "nodes.gateway")}</span>` : ""}
          ${node.via_mqtt ? html`<span class="tag mqtt">MQTT</span>` : ""}
          ${node.is_ignored ? html`<span class="tag muted">${t(this.hass, "nodes.ignored")}</span>` : ""}
          ${node.is_tracked ? html`<span class="dot" title=${t(this.hass, "nodes.tracked_hint")}></span>` : ""}
          ${node.signed ? html`<ha-icon class="row-icon" icon="mdi:shield-check" title=${t(this.hass, "nodes.signed_hint")}></ha-icon>` : ""}
          ${typeof node.latitude === "number" ? html`<ha-icon class="row-icon" icon="mdi:earth" title=${t(this.hass, "nodes.positioned_hint")}></ha-icon>` : ""}
          <span class="hex">${node.node_hex}</span>
        </td>
        <td class="num" data-label=${t(this.hass, "nodes.col.signal")}>
          ${this._renderSignal(node)}
        </td>
        <td class="num" data-label=${t(this.hass, "nodes.col.hops")}>
          ${this._renderHops(node)}
        </td>
        <td class="num" data-label=${t(this.hass, "nodes.col.battery")}>
          ${this._formatValue(node.battery_level, " %")}
        </td>
        <td class="num" data-label=${t(this.hass, "nodes.col.uptime")}>
          ${typeof node.uptime_seconds === "number" && node.uptime_seconds > 0
            ? formatUptime(this.hass, node.uptime_seconds)
            : t(this.hass, "common.unknown")}
        </td>
        <td class="num" data-label=${t(this.hass, "nodes.col.last_heard")} title=${this._absoluteTime(node.last_heard)}>
          ${this._formatLastHeard(node.last_heard)}
        </td>
      </tr>
    `;
  }

  /* "2 skoki via (ABCD)": liczba skoków z odmianą i — dla połączenia
     wieloskokowego — krótka nazwa przekaźnika, który ostatni przekazał pakiet. */
  _hopsText(node) {
    const { hops, relay } = viaInfo(node);
    if (hops === null) {
      return t(this.hass, "common.unknown");
    }
    if (hops === 0) {
      return t(this.hass, "hops.direct");
    }
    const via = relay ? ` ${t(this.hass, "nodes.via")} (${relayLabel(this.nodes, node, relay)})` : "";
    return `${formatHops(this.hass, hops)}${via}`;
  }

  /* SNR nad RSSI w jednej kolumnie — węższa tabela; tylko dla połączenia
     bezpośredniego (przy skokach oba odczyty dotyczą przekaźnika). */
  _renderSignal(node) {
    const info = signalInfo(node);
    if (!info || (info.snr === null && info.rssi === null)) {
      return t(this.hass, "common.unknown");
    }
    return html`${info.snr !== null ? html`<div>${info.snr.toFixed(1)} dB</div>` : ""}${info.rssi !== null
      ? html`<div class="rssi">${info.rssi} dBm</div>`
      : ""}`;
  }

  _renderHops(node) {
    const { hops, relay } = viaInfo(node);
    if (hops === null) {
      return t(this.hass, "common.unknown");
    }
    if (hops === 0) {
      return t(this.hass, "hops.direct");
    }
    return html`${formatHops(this.hass, hops)}${relay
      ? html`<span class="via">${t(this.hass, "nodes.via")} (${relayLabel(this.nodes, node, relay)})</span>`
      : ""}`;
  }

  /* Wiadomość statusu, którą węzeł rozgłasza po sieci (moduł Status Message), i kiedy
     ją ostatnio odebraliśmy. Własna bramka nie ma czasu odbioru — status bierzemy z jej konfiguracji. */
  _statusText(node) {
    if (!node.status_message) {
      return "";
    }
    return html`${node.status_message}${node.status_ts
      ? html`<span class="via">${formatRelative(this.hass, node.status_ts)}</span>`
      : ""}`;
  }

  _detailRow(labelKey, value) {
    if (value === null || value === undefined || value === "") {
      return html``;
    }
    return html`
      <div class="detail-row">
        <span class="detail-label">${t(this.hass, labelKey)}</span>
        <span class="detail-value">${value}</span>
      </div>
    `;
  }

  _nameOf(nodeId) {
    const node = (this.nodes || []).find((n) => n.node_id === nodeId);
    if (node) {
      return this._displayName(node);
    }
    return `!${(nodeId >>> 0).toString(16).padStart(8, "0")}`;
  }

  _renderActions(node) {
    const busy = Boolean(this._busy);
    const tr = (key) => t(this.hass, key);

    return html`
      <div class="actions">
        <button class="action primary" ?disabled=${busy} @click=${() => this._openDm(node)}>
          ${tr("nodes.action.message")}
        </button>
        <button
          class="action"
          @click=${() => this._toggleFavorite(node)}
        >
          ${tr(node.is_favorite ? "nodes.action.unfavorite" : "nodes.action.favorite")}
        </button>
        <button
          class="action"
          @click=${() => this._toggleIgnored(node)}
        >
          ${tr(node.is_ignored ? "nodes.action.unignore" : "nodes.action.ignore")}
        </button>
        <button class="action danger" ?disabled=${busy} @click=${() => this._confirmRemove(node)}>
          ${tr("nodes.action.remove")}
        </button>
      </div>

      <div class="categories">
        ${CATEGORIES.map(
          (category) => html`
            <div class="category ${this._activeCategory === category.id ? "active" : ""}">
              <span class="category-name">${tr(`nodes.cat.${category.id}`)}</span>
              <span class="category-buttons">
                <button class="action" ?disabled=${busy} @click=${() => this._showHistory(node, category.id)}>
                  ${tr("nodes.cat.history")}
                </button>
                ${category.ask || category.telemetry
                  ? html`<button
                      class="action"
                      title=${tr(`nodes.cat.ask.${category.id}`)}
                      ?disabled=${busy}
                      @click=${() => this._askNode(node, category)}
                    >
                      ${tr("nodes.cat.ask")}
                    </button>`
                  : html`<span class="action-placeholder"></span>`}
              </span>
            </div>
          `
        )}
        ${this._mtsw
          ? html`<div class="category ${this._ondemandOpen ? "active" : ""}">
              <span class="category-name">${tr("nodes.cat.ondemand")}</span>
              <span class="category-buttons">
                <button class="action" ?disabled=${busy} @click=${() => (this._ondemandOpen = !this._ondemandOpen)}>
                  ${tr(this._ondemandOpen ? "nodes.cat.close" : "nodes.cat.open")}
                </button>
                <span class="action-placeholder"></span>
              </span>
            </div>`
          : ""}
      </div>
      ${this._busy ? html`<div class="status">${tr("nodes.action.working")}</div>` : ""}
      ${this._notice ? html`<div class="status ok">${this._notice}</div>` : ""}
      ${this._error ? html`<div class="status error">${this._error}</div>` : ""}
    `;
  }

  /* Funkcje MT_SW (diagnostyka na żądanie) mają sens tylko na firmware MT_SW_FW w wersji 2 lub nowszej.
     Pytamy bramkę raz, przy pierwszym otwarciu szczegółów węzła — backend pamięta wynik,
     a na starym firmware nie zaczynamy od zbędnego pakietu do radia przy starcie panelu. */
  async _ensureCapabilities() {
    if (this._mtswRequested || !this.hass || !this.entryId) {
      return;
    }
    this._mtswRequested = true;
    try {
      const result = await this.hass.callWS({ type: "meshtastic/capabilities", entry_id: this.entryId });
      this._mtsw = Boolean(result && result.supported);
    } catch (err) {
      // bramka jeszcze niegotowa — spróbujemy przy następnym otwarciu
      this._mtswRequested = false;
      this._mtsw = false;
    }
  }

  /* Widok jednej kategorii naraz — po wybraniu następnej poprzednia znika,
     żeby okno nie rosło z każdym kliknięciem. */
  _resetViews() {
    this._traceroute = null;
    this._traceHistory = [];
    this._neighborHistory = [];
    this._positionHistory = [];
    this._telemetryHistory = null;
    this._statsRequest = null;
    this._neighborsShown = false;
    this._activeCategory = null;
  }

  async _showHistory(node, id) {
    this._resetViews();
    this._activeCategory = id;
    switch (id) {
      case "neighbors":
        await this._loadNeighborHistory(node);
        break;
      case "signal": {
        const [signal, stats] = await Promise.all([
          this._loadNodeHistory(node, "signal"),
          this._loadNodeHistory(node, "local_stats"),
        ]);
        this._telemetryHistory = { titleKey: "nodes.cat.signal", noteKey: "nodes.signal.note", hist: { signal, stats } };
        break;
      }
      case "device":
      case "environment":
      case "power": {
        const points = await this._loadNodeHistory(node, TELEMETRY_KINDS[id]);
        this._telemetryHistory = { titleKey: `nodes.cat.${id}`, hist: { [id]: points } };
        break;
      }
      case "packets":
        this._statsRequest = { mode: "packets" };
        break;
      case "resources":
        this._statsRequest = { mode: "resources" };
        break;
      case "position":
        await this._loadPositionHistory(node);
        break;
      case "traceroute":
        await this._loadTraceHistory(node);
        break;
      default:
        break;
    }
  }

  /* "Poproś": wysyła zapytanie do węzła, a po udanej odpowiedzi od razu
     pokazuje historię tej kategorii, żeby nowy odczyt było widać bez drugiego
     kliknięcia. Trasa pokazuje sam wynik. */
  async _askNode(node, category) {
    const payload = { node_id: node.node_id };
    if (category.id === "traceroute") {
      this._resetViews();
      this._activeCategory = "traceroute";
      const route = await this._call("traceroute", payload);
      if (route && typeof route === "object") {
        this._traceroute = route;
      }
      return;
    }
    const done = category.telemetry
      ? await this._call("request_telemetry", { ...payload, telemetry_type: category.telemetry })
      : await this._call(category.ask, payload);
    if (!done) {
      return;
    }
    // Odpowiedź trafia do historii osobnym zdarzeniem — dajemy jej chwilę.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await this._showHistory(node, category.id);
  }

  /* Kategoria wybrana, a w niej pusto — bez tej wzmianki kliknięcie wyglądałoby na martwe. */
  _renderEmptyNote(node) {
    const id = this._activeCategory;
    const empty =
      (id === "neighbors" && (this._neighborHistory || []).length < 2 && !(node.neighbors && node.neighbors.length)) ||
      (id === "position" && !(this._positionHistory || []).length) ||
      (id === "traceroute" && !(this._traceHistory || []).length && !this._traceroute);
    if (!empty) {
      return html``;
    }
    return html`
      <div class="detail-section">${t(this.hass, `nodes.cat.${id}`)}</div>
      <div class="route-note">${t(this.hass, "nodes.history.empty")}</div>
    `;
  }

  /* RouteDiscovery niesie same przeskoki pośrednie — bez nadawcy i celu.
     Żeby trasa dała się przeczytać, doklejamy oba końce i budujemy łańcuch:
     bramka -> przeskok -> ... -> cel. SNR dotyczy odcinków, więc jest ich
     o jeden mniej niż węzłów; wartości są w czwartych częściach decybela. */
  _closeDetail() {
    this._detail = null;
    this._traceroute = null;
    this._traceHistory = [];
    this._neighborHistory = [];
    this._positionHistory = [];
    this._telemetryHistory = null;
    this._statsRequest = null;
    this._ondemandOpen = false;
    this._activeCategory = null;
    this._neighborsShown = false;
    this._notice = null;
    this._error = null;
  }

  async _loadTraceHistory(node) {
    if (!this.entryId) {
      return;
    }
    try {
      const result = await this.hass.callWS({
        type: "meshtastic/traceroute_history",
        entry_id: this.entryId,
        node_id: node.node_id,
      });
      this._traceHistory = (result && result.routes) || [];
    } catch (err) {
      console.error("MT_SW: nie udało się pobrać historii tras", err);
      this._traceHistory = [];
    }
  }

  async _loadNodeHistory(node, kind) {
    try {
      const result = await this.hass.callWS({
        type: "meshtastic/node_history",
        entry_id: this.entryId,
        node_id: node.node_id,
        kind,
      });
      return (result && result.points) || [];
    } catch (err) {
      console.error("MT_SW: nie udało się pobrać historii", kind, err);
      return [];
    }
  }

  async _loadNeighborHistory(node) {
    if (!this.entryId) {
      return;
    }
    this._neighborHistory = await this._loadNodeHistory(node, "neighbor_count");
    this._neighborsShown = true;
  }

  async _loadPositionHistory(node) {
    if (!this.entryId) {
      return;
    }
    this._positionHistory = await this._loadNodeHistory(node, "position");
  }

  _gatewayId() {
    const gateway = (this.nodes || []).find((n) => n.is_gateway);
    return gateway ? gateway.node_id : null;
  }

  _snrClass(db) {
    if (db === null) return "";
    if (db >= 0) return "good";
    if (db >= -8) return "fair";
    return "poor";
  }

  _renderChain(labelKey, chain, snrs) {
    if (!chain || chain.length < 2) {
      return html``;
    }
    return html`
      <div class="detail-section">${t(this.hass, labelKey)}</div>
      <div class="route">
        ${chain.map((hop, index) => {
          const raw = snrs && snrs[index] !== undefined ? snrs[index] / 4 : null;
          return html`
            <div class="route-node">
              <span class="route-dot ${index === 0 ? "start" : ""}${index === chain.length - 1 ? "end" : ""}"></span>
              <span class="route-name">${this._nameOf(hop)}</span>
            </div>
            ${index < chain.length - 1
              ? html`<div class="route-link">
                  <span class="route-line"></span>
                  <span class="route-snr ${this._snrClass(raw)}">
                    ${raw === null ? t(this.hass, "common.unknown") : `${raw.toFixed(2)} dB`}
                  </span>
                </div>`
              : ""}
          `;
        })}
      </div>
    `;
  }

  _renderTraceroute(node) {
    const route = this._traceroute;
    if (!route) {
      return html``;
    }
    const gateway = this._gatewayId();
    const towards = [gateway, ...(route.route || []), node.node_id].filter(
      (id) => id !== null && id !== undefined
    );
    const back = [node.node_id, ...(route.routeBack || []), gateway].filter(
      (id) => id !== null && id !== undefined
    );

    const direct = (route.route || []).length === 0;

    return html`
      ${this._renderChain("nodes.traceroute.towards", towards, route.snrTowards)}
      ${route.routeBack ? this._renderChain("nodes.traceroute.back", back, route.snrBack) : ""}
      ${direct
        ? html`<div class="route-note">${t(this.hass, "nodes.traceroute.direct")}</div>`
        : ""}
    `;
  }

  /* Liczba skoków w kolejnych pomiarach trasy: jedna oś czasu dla całej historii,
     dwie linie — w przód (route) i powrotna (routeBack). Skoki to pośrednie węzły
     z RouteDiscovery, tak samo jak w opisie trasy ("bez skoków" = pusta lista). */
  _traceHopPoints() {
    return (this._traceHistory || []).map((entry) => {
      const route = entry.route || {};
      return {
        ts: entry.ts,
        towards: (route.route || []).length,
        back: Array.isArray(route.routeBack) ? route.routeBack.length : null,
      };
    });
  }

  _renderTraceHistory() {
    if (!this._traceHistory || !this._traceHistory.length) {
      return html``;
    }
    const points = this._traceHopPoints();
    return html`
      <div class="detail-section">${t(this.hass, "nodes.traceroute.history")}</div>
      ${points.length >= 2
        ? html`
            <div class="route-note">${t(this.hass, "nodes.traceroute.chart_note")}</div>
            <div class="chart-wrap">
              <mesh-line-chart
                .points=${points}
                .language=${this.hass.language}
                .unit=${""}
                .height=${140}
                .fit=${true}
                .emptyLabel=${t(this.hass, "nodes.history.empty")}
                .series=${[
                  { key: "towards", label: t(this.hass, "nodes.traceroute.hops_towards"), color: "#4FC3F7" },
                  { key: "back", label: t(this.hass, "nodes.traceroute.hops_back"), color: "#F5C839" },
                ]}
              ></mesh-line-chart>
            </div>
          `
        : ""}
      <div class="trace-history">
        ${this._traceHistory
          .slice()
          .reverse()
          .map(
            (entry) => html`
              <button class="trace-history-item" @click=${() => (this._traceroute = entry.route)}>
                ${this._absoluteTime(entry.ts / 1000)}
              </button>
            `
          )}
      </div>
    `;
  }

  _renderNeighborHistory() {
    if (!this._neighborHistory || this._neighborHistory.length < 2) {
      return html``;
    }
    return html`
      <div class="detail-section">${t(this.hass, "nodes.cat.neighbors")}</div>
      <div class="chart-wrap">
        <mesh-line-chart
          .points=${this._neighborHistory}
          .language=${this.hass.language}
          .emptyLabel=${t(this.hass, "nodes.history.empty")}
          .series=${[{ key: "count", label: t(this.hass, "nodes.history.neighbor_count"), color: "#4FC3F7" }]}
        ></mesh-line-chart>
      </div>
    `;
  }

  _renderPositionHistory() {
    if (!this._positionHistory || !this._positionHistory.length) {
      return html``;
    }
    return html`
      <div class="detail-section">${t(this.hass, "nodes.cat.position")}</div>
      <div class="position-history">
        ${this._positionHistory
          .slice()
          .reverse()
          .slice(0, 20)
          .map(
            (p) => html`
              <div class="position-history-row">
                <span>${this._absoluteTime(p.ts / 1000)}</span>
                <span>${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}</span>
                <span>${p.altitude !== null && p.altitude !== undefined ? `${p.altitude} m` : "—"}</span>
              </div>
            `
          )}
      </div>
    `;
  }

  _renderTelemetryHistory() {
    const view = this._telemetryHistory;
    if (!view) {
      return html``;
    }
    const title = html`<div class="detail-section">${t(this.hass, view.titleKey)}</div>`;
    const note = view.noteKey ? html`<div class="route-note">${t(this.hass, view.noteKey)}</div>` : "";
    // Osobny wykres z własną skalą dla każdego parametru; napięcie i prąd
    // z pakietu środowiskowego, urządzenia i mocy trafiają na wspólny wykres
    // tej samej wielkości (jako osobne linie).
    const charts = buildTelemetryCharts(view.hist, (key) => t(this.hass, key));

    if (!charts.length) {
      return html`${title}${note}<div class="route-note">${t(this.hass, "nodes.history.empty")}</div>`;
    }

    return html`
      ${title}${note}
      ${charts.map(
        (chart) => html`
          <div class="chart-wrap">
            <mesh-line-chart
              .points=${chart.points}
              .language=${this.hass.language}
              .unit=${chart.unit}
              .height=${140}
              .fit=${true}
              .emptyLabel=${t(this.hass, "nodes.history.empty")}
              .series=${chart.series}
            ></mesh-line-chart>
          </div>
        `
      )}
    `;
  }

  _renderDetail() {
    const node = this._current();
    if (!node) {
      return html``;
    }

    return html`
      <div class="scrim" @click=${() => this._closeDetail()}>
        <div class="dialog" @click=${(e) => e.stopPropagation()}>
          <div class="dialog-header">
            <span>${this._renderStar(node)} ${this._displayName(node)}</span>
            <button class="close" @click=${() => this._closeDetail()}>✕</button>
          </div>
          <div class="dialog-body">
            ${this._renderActions(node)}

            ${this._detailRow("nodes.status_message", this._statusText(node))}
            ${this._detailRow("nodes.col.id", node.node_hex)}
            ${this._detailRow("radio.hw_model", node.hw_model)}
            ${this._detailRow("radio.role", node.role)}
            ${this._detailRow("nodes.col.signal", formatSignal(signalInfo(node)))}
            ${this._detailRow("nodes.col.hops", this._hopsText(node))}
            ${this._detailRow("nodes.col.last_heard", this._absoluteTime(node.last_heard))}
            ${this._detailRow("radio.battery", this._formatValue(node.battery_level, " %"))}
            ${this._detailRow("radio.voltage", this._formatValue(node.voltage, " V", 2))}
            ${this._detailRow(
              "radio.channel_utilization",
              this._formatValue(node.channel_utilization, " %", 1)
            )}
            ${this._detailRow("radio.air_util_tx", this._formatValue(node.air_util_tx, " %", 1))}
            ${node.uptime_seconds
              ? this._detailRow("radio.uptime", formatUptime(this.hass, node.uptime_seconds))
              : ""}
            ${this._detailRow("nodes.temperature", this._formatValue(node.temperature, " °C", 1))}
            ${this._detailRow("nodes.humidity", this._formatValue(node.humidity, " %", 0))}
            ${this._detailRow("nodes.pressure", this._formatValue(node.pressure, " hPa", 0))}
            ${typeof node.latitude === "number"
              ? this._detailRow(
                  "nodes.position",
                  `${node.latitude.toFixed(5)}, ${node.longitude.toFixed(5)}` +
                    (node.altitude !== null && node.altitude !== undefined ? ` (${node.altitude} m)` : "")
                )
              : ""}
            ${this._detailRow("nodes.tracked", node.is_tracked ? t(this.hass, "common.yes") : t(this.hass, "common.no"))}

            ${this._renderTraceroute(node)}
            ${this._renderTraceHistory()}
            ${this._renderNeighborHistory()}
            ${this._renderPositionHistory()}
            ${this._renderTelemetryHistory()}
            ${this._renderEmptyNote(node)}
            ${this._statsRequest
              ? html`<mesh-node-stats
                  .hass=${this.hass}
                  .entryId=${this.entryId}
                  .nodeId=${node.node_id}
                  .request=${this._statsRequest}
                ></mesh-node-stats>`
              : ""}
            ${this._ondemandOpen && this._mtsw
              ? html`<mesh-node-ondemand
                  .hass=${this.hass}
                  .entryId=${this.entryId}
                  .nodeId=${node.node_id}
                  .nodes=${this.nodes}
                ></mesh-node-ondemand>`
              : ""}

            ${this._neighborsShown && node.neighbors && node.neighbors.length
              ? html`
                  <div class="detail-section">${t(this.hass, "tab.neighbors")}</div>
                  ${node.neighbors.map(
                    (neighbor) => html`
                      <div class="detail-row">
                        <span class="detail-label">${this._nameOf(neighbor.node_id)}</span>
                        <span class="detail-value">${this._formatValue(neighbor.snr, " dB", 2)}</span>
                      </div>
                    `
                  )}
                `
              : ""}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.hass) {
      return html``;
    }
    const nodes = this._visibleNodes();

    return html`
      <div class="tab-content">
        <div class="toolbar">
          <input
            type="search"
            .value=${this._filter}
            placeholder=${t(this.hass, "nodes.filter")}
            @input=${(e) => {
              this._filter = e.target.value;
            }}
          />
          <span class="count">${t(this.hass, "nodes.count", { n: nodes.length })}</span>
        </div>

        <div class="chips">
          ${FILTERS.map(
            (filter) => html`
              <button
                class="chip ${this._toggles[filter.key] ? "on" : ""}"
                @click=${() => this._toggleFilter(filter.key)}
              >
                ${t(this.hass, filter.labelKey)}
              </button>
            `
          )}
        </div>

        ${nodes.length === 0
          ? html`<div class="empty-state">${t(this.hass, "nodes.empty")}</div>`
          : html`
              <div class="card">
                <table>
                  <thead>
                    <tr>
                      <th class="star-cell"></th>
                      ${COLUMNS.map(
                        (column) => html`
                          <th
                            class=${column.numeric ? "num" : ""}
                            @click=${() => this._toggleSort(column.key)}
                          >
                            ${t(this.hass, column.labelKey)}
                            ${this._sortKey === column.key ? (this._sortAsc ? " ▲" : " ▼") : ""}
                          </th>
                        `
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    ${nodes.map((node) => this._renderRow(node))}
                  </tbody>
                </table>
              </div>
            `}
      </div>
      ${this._renderDetail()}
    `;
  }

  static get styles() {
    return [
      layoutStyles,
      emptyStateStyles,
      css`
        .tab-content {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 16px;
        }

        .toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
        }

        input[type="search"] {
          flex: 1;
          max-width: 360px;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 14px;
        }

        .count {
          font-size: 13px;
          color: var(--secondary-text-color);
        }

        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }

        .chip {
          border: 1px solid var(--divider-color);
          border-radius: 999px;
          background: var(--card-background-color);
          color: var(--secondary-text-color);
          font-family: inherit;
          font-size: 12px;
          padding: 5px 12px;
          cursor: pointer;
        }

        .chip:hover {
          color: var(--primary-text-color);
        }

        .chip.on {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        .card {
          overflow-x: auto;
        }

        table {
          width: 100%;
          min-width: 560px;
          border-collapse: collapse;
          font-size: 14px;
        }

        /* Jak w oryginalnym meshtastic-ui-ha: tabela zostaje tabelą,
           tylko przewija się poziomo (.card { overflow-x: auto } już
           jest domyślne), z mniejszą czcionką i węższym paddingiem. */
        @media (max-width: 640px) {
          th,
          td {
            padding: 8px 6px;
            font-size: 13px;
          }
        }

        th,
        td {
          text-align: left;
          padding: 8px 16px;
          border-top: 1px solid var(--divider-color);
        }

        th {
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
          color: var(--secondary-text-color);
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
        }

        th:hover {
          color: var(--primary-text-color);
        }

        td.num,
        th.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .star-cell {
          width: 32px;
          padding-inline-end: 0;
        }

        .star {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 0;
          color: var(--secondary-text-color);
        }

        .star.on {
          color: #f5c839;
        }

        tbody tr {
          cursor: pointer;
        }

        tbody tr:hover {
          background: var(--secondary-background-color);
        }

        tbody tr.ignored {
          opacity: 0.45;
        }

        .name {
          font-weight: 500;
        }

        td.short {
          font-weight: 600;
          white-space: nowrap;
        }

        .via {
          margin-inline-start: 6px;
          font-size: 12px;
          font-weight: 400;
          color: var(--secondary-text-color);
        }

        .hex {
          margin-inline-start: 8px;
          font-size: 12px;
          color: var(--secondary-text-color);
          font-family: var(--code-font-family, monospace);
          overflow-wrap: anywhere;
        }

        .tag {
          margin-inline-start: 6px;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 11px;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        .tag.mqtt,
        .tag.muted {
          background: var(--secondary-text-color);
        }

        .dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          margin-inline-start: 6px;
          background: var(--primary-color);
          vertical-align: middle;
        }

        .row-icon {
          --mdc-icon-size: 14px;
          color: var(--secondary-text-color);
          vertical-align: middle;
          margin-inline-start: 6px;
        }

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

        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 8px 16px 12px;
          border-bottom: 1px solid var(--divider-color);
        }

        .categories {
          padding: 0 16px 8px;
          border-bottom: 1px solid var(--divider-color);
        }

        .category {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 6px 0;
          border-top: 1px solid var(--divider-color);
        }

        .category:first-child {
          border-top: none;
        }

        .category-name {
          font-size: 14px;
        }

        .category.active .category-name {
          color: var(--primary-color);
          font-weight: 600;
        }

        .category-buttons {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .category-buttons .action,
        .action-placeholder {
          min-width: 78px;
          box-sizing: border-box;
        }

        .action-placeholder {
          display: inline-block;
        }

        .rssi {
          font-size: 11px;
          color: var(--secondary-text-color);
        }

        .action {
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 12px;
          padding: 6px 10px;
          cursor: pointer;
        }

        .action:hover:not([disabled]) {
          background: var(--secondary-background-color);
        }

        .trace-history {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }

        .trace-history-item {
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color);
          color: var(--secondary-text-color);
          font-family: inherit;
          font-size: 11px;
          padding: 4px 8px;
          cursor: pointer;
        }

        .trace-history-item:hover {
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
        }

        .chart-wrap {
          background: var(--card-background-color);
          border-radius: 8px;
          padding: 8px;
          margin-bottom: 12px;
        }

        .position-history {
          margin-bottom: 12px;
        }

        .position-history-row {
          display: flex;
          gap: 16px;
          padding: 6px 0;
          border-top: 1px solid var(--divider-color);
          font-size: 12px;
        }

        .position-history-row:first-child {
          border-top: none;
        }

        .action[disabled] {
          opacity: 0.5;
          cursor: default;
        }

        .action.primary {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        .action.danger {
          color: var(--error-color, #db4437);
        }

        .status {
          padding: 6px 16px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }

        .status.ok {
          color: var(--success-color, #4caf50);
        }

        .status.error {
          color: var(--error-color, #db4437);
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

        .route {
          padding: 4px 16px 8px;
        }

        .route-node {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
        }

        .route-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--secondary-text-color);
          flex: none;
        }

        .route-dot.start,
        .route-dot.end {
          background: var(--primary-color);
        }

        .route-link {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-inline-start: 4px;
          min-height: 22px;
        }

        .route-line {
          width: 1px;
          align-self: stretch;
          background: var(--divider-color);
          margin-inline-start: 4px;
        }

        .route-snr {
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          color: var(--secondary-text-color);
          padding-inline-start: 8px;
        }

        .route-snr.good {
          color: #4caf50;
        }

        .route-snr.fair {
          color: #f5c839;
        }

        .route-snr.poor {
          color: #e57373;
        }

        .route-note {
          padding: 0 16px 8px;
          font-size: 12px;
          color: var(--secondary-text-color);
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
      `,
    ];
  }
}

if (!customElements.get("mesh-nodes-tab")) {
  customElements.define("mesh-nodes-tab", MeshNodesTab);
}
