/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Panel Sniffer w Ustawieniach → Inne: sterowanie snifferem radiowym i MQTT,
 * log przechwyconych pakietów na żywo i eksport do pliku.
 *
 * Sniffer radiowy działa przez OnDemand (port 354), nie przez konfigurację
 * modułu: stan jest tylko w RAM radia (po restarcie zawsze wyłączony), a
 * firmware honoruje włączenie wyłącznie od lokalnie podłączonego klienta.
 * Dlatego panel pyta o stan przy każdym otwarciu, zamiast cokolwiek pamiętać.
 * Sniffer MQTT działa w całości w Home Assistancie i jest sterowany wyłącznie
 * stąd (nie ma go już w opcjach integracji).
 *
 * Log wygląda jak Sniffer Log w aplikacji: karty pakietów, najnowsze na
 * górze, nadawca → odbiorca z krótkimi nazwami, czas z sekundami, szczegóły
 * po kliknięciu, przycisk "Na żywo" / "N nowych". Dodatkowo ten sam pakiet
 * (ten sam nadawca i ID) usłyszany kilka razy — z różnych bram MQTT albo
 * przez różne przekaźniki — jest zbierany w jedną kartę z listą odbiorów.
 * Szczegóły to czytelne widoki (sąsiedzi jako lista, traceroute jako lista
 * skoków, pozycja / telemetria jako tabele), patrz sniffer-details.js.
 *
 * Log zbiera integracja (bufor w pamięci, domyślnie 25 000 wpisów; rozmiar
 * 5 000 / 10 000 / 25 000 wybiera się tutaj). Panel NIE trzyma całego bufora:
 * grupowanie i filtrowanie robi serwer (sniffer_query), a lista jest
 * wirtualna — w DOM są tylko widoczne karty z zapasem, kolejne strony grup
 * dociągają się przy przewijaniu. Przewinięcie w dół zamraża widok na numerze
 * wpisu (upto), więc napływające pakiety nie przesuwają listy. Eksport
 * (JSON/CSV) pobiera cały przefiltrowany bufor porcjami po 1000 wpisów
 * i składa plik w kawałkach, żeby nie zawiesić karty przeglądarki.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { PL } from "./pl-settings.js";
import { settingsStyles, badgeStyles } from "./styles.js";
import "./components.js";
import { portLabel } from "./port-names.js";
import { MIN_FW_PLUS_VERSION } from "./firmware.js";
import { signalStyle } from "./signal-quality.js";
import { HeightMap, computeWindow, pagesForRange } from "./virtual-list.js";
import { streamPages } from "./log-index.js";
import {
  BROADCAST,
  CSV_COLUMNS,
  buildDetailSections,
  csvLine,
  exportRow,
  gatewayNum,
  hexId,
  jsonChunk,
  jsonFooter,
  jsonHeader,
  matchingNodeIds,
  matchingPorts,
  stamp,
} from "./sniffer-format.js";
import { renderSections, detailStyles } from "./sniffer-details.js";

const POLL_MS = 2000;
const NAMES_REFRESH_MS = 30000;
/* grup w jednej stronie z serwera */
const PAGE = 60;
/* szacowana wysokość zwiniętej karty, zanim ją zmierzymy */
const ROW_ESTIMATE = 118;
const OVERSCAN_PX = 360;
const FILTER_DEBOUNCE_MS = 300;
const EXPORT_CHUNK = 1000;
/* odsunięcie listy od góry, po którym przestajemy dokładać nowe karty na górę */
const LIVE_SCROLL_THRESHOLD = 40;
const CAPACITY_CHOICES = [5000, 10000, 25000];

/* kolor paska karty wg rodzaju pakietu — jak kolorowe etykiety portów w aplikacji */
const PORT_COLORS = {
  TEXT_MESSAGE_APP: "#2196f3",
  TEXT_MESSAGE_COMPRESSED_APP: "#2196f3",
  POSITION_APP: "#4caf50",
  TELEMETRY_APP: "#ff9800",
  NODEINFO_APP: "#9c27b0",
  ROUTING_APP: "#78909c",
  TRACEROUTE_APP: "#009688",
  NEIGHBORINFO_APP: "#00bcd4",
  ADMIN_APP: "#f44336",
  ON_DEMAND_APP: "#795548",
  MAP_REPORT_APP: "#8bc34a",
  WAYPOINT_APP: "#cddc39",
  ENCRYPTED: "#9e9e9e",
  PKI: "#9e9e9e",
};

const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

class MeshSettingsSniffer extends LitElement {
  static get properties() {
    return {
      wsCommand: { type: Object },
      config: { type: Object },
      _status: { type: Object, state: true },
      _checking: { type: Boolean, state: true },
      _busy: { type: Boolean, state: true },
      _mqttBusy: { type: Boolean, state: true },
      _error: { type: String, state: true },
      _confirmOpen: { type: Boolean, state: true },
      _clearConfirmOpen: { type: Boolean, state: true },
      _capConfirm: { type: Number, state: true },
      _capacity: { type: Number, state: true },
      _meta: { type: Object, state: true },
      _paused: { type: Boolean, state: true },
      _scrolledAway: { type: Boolean, state: true },
      _filter: { type: String, state: true },
      _source: { type: String, state: true },
      _grouped: { type: Boolean, state: true },
      _expanded: { type: String, state: true },
      _names: { type: Object, state: true },
      _total: { type: Number, state: true },
      _receptionsTotal: { type: Number, state: true },
      _newCount: { type: Number, state: true },
      _loaded: { type: Boolean, state: true },
      _exporting: { type: Object, state: true },
      _copied: { type: String, state: true },
    };
  }

  constructor() {
    super();
    this._status = null;
    this._checking = false;
    this._busy = false;
    this._mqttBusy = false;
    this._error = "";
    this._confirmOpen = false;
    this._clearConfirmOpen = false;
    this._capConfirm = null;
    this._capacity = null;
    this._meta = null;
    this._paused = false;
    this._scrolledAway = false;
    this._filter = "";
    this._source = "all";
    this._grouped = true;
    this._expanded = null;
    this._names = {};
    this._longNames = {};
    this._total = 0;
    this._receptionsTotal = 0;
    this._newCount = 0;
    this._loaded = false;
    this._exporting = null;
    this._copied = null;
    // stan zapytania: wiersze (grupy) wczytywane stronami, migawka widoku (upto)
    this._rows = [];
    this._pages = new Set();
    this._inflight = new Set();
    this._gen = 0;
    this._upto = null;
    this._lastSeq = 0;
    this._filterApplied = "";
    this._filterTimer = null;
    this._polling = false;
    this._pollTimer = null;
    this._namesTimer = null;
    // lista wirtualna
    this._heights = new HeightMap(ROW_ESTIMATE);
    this._scrollTop = 0;
    this._viewport = 560;
    this._win = { start: 0, end: 0, offset: 0, total: 0 };
  }

  connectedCallback() {
    super.connectedCallback();
    this._checkStatus();
    this._loadNames();
    this._loadCapacity();
    this._pollLog();
    this._pollTimer = setInterval(() => this._pollLog(), POLL_MS);
    this._namesTimer = setInterval(() => this._loadNames(), NAMES_REFRESH_MS);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._pollTimer);
    clearInterval(this._namesTimer);
    clearTimeout(this._filterTimer);
    this._pollTimer = null;
    this._namesTimer = null;
    this._filterTimer = null;
  }

  /* ── dane ─────────────────────────────────────────────────── */

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
      this._longNames = res.long_names || {};
    }
  }

  async _loadCapacity() {
    const res = await this.wsCommand("meshtastic_ui/log_capacity_get");
    if (res && res.ok && res.sniffer) {
      this._capacity = res.sniffer.capacity;
    }
  }

  /* Parametry zapytania do serwera. Nazwy węzłów i portów zna tylko panel, więc
     do tekstu filtra dokładamy numery węzłów i porty, których nazwa pasuje. */
  _queryParams() {
    const needle = (this._filterApplied || "").trim();
    return {
      filter: needle,
      node_ids: matchingNodeIds(needle, this._names, this._longNames),
      ports: matchingPorts(needle),
      source: this._source,
      grouped: this._grouped,
    };
  }

  _query(extra) {
    return this.wsCommand("meshtastic_ui/sniffer_query", { ...this._queryParams(), ...extra });
  }

  /* Pierwsza strona (najnowsze grupy) i nowa migawka: wołane na żywo, po zmianie filtra, po wyczyszczeniu. */
  async _reload({ fresh = false } = {}) {
    const gen = ++this._gen;
    const topKey = !fresh && this._rows[0] ? this._rows[0].key : null;
    const res = await this._query({ offset: 0, limit: PAGE });
    if (gen !== this._gen || !res || !res.ok) {
      return;
    }
    // Ten sam filtr: nowe grupy dochodzą od góry, więc zmierzone wysokości przesuwamy o ich liczbę
    // (dzięki temu lista nie skacze przy każdym nowym pakiecie). Inaczej — mierzymy od nowa.
    const shift = topKey ? res.groups.findIndex((group) => group.key === topKey) : -1;
    if (shift >= 0) {
      this._heights.shift(shift);
      this._heights.setCount(res.total);
    } else {
      this._heights.reset(res.total);
    }
    this._rows = new Array(res.total);
    res.groups.forEach((group, index) => {
      this._rows[index] = group;
    });
    this._pages = new Set([0]);
    this._inflight.clear();
    this._upto = res.upto;
    this._lastSeq = res.last_seq;
    this._total = res.total;
    this._receptionsTotal = res.receptions;
    this._newCount = 0;
    this._applyMeta(res);
    this._loaded = true;
  }

  async _fetchPage(page) {
    if (this._pages.has(page) || this._inflight.has(page)) {
      return;
    }
    this._inflight.add(page);
    const gen = this._gen;
    try {
      const res = await this._query({ offset: page * PAGE, limit: PAGE, upto: this._upto });
      if (gen !== this._gen) {
        return;
      }
      if (res && res.ok) {
        res.groups.forEach((group, index) => {
          this._rows[page * PAGE + index] = group;
        });
        this._pages.add(page);
        this.requestUpdate();
      }
    } finally {
      this._inflight.delete(page);
    }
  }

  _applyMeta(res) {
    this._meta = {
      count: res.count,
      capacity: res.capacity,
      enabled: res.enabled,
      mqtt_enabled: res.mqtt_enabled,
    };
    if (res.capacity && res.capacity !== this._capacity) {
      this._capacity = res.capacity;
    }
  }

  /* Sondaż jest tani (sam stan bufora, bez wpisów): dopiero zmiana numeru ostatniego
     wpisu uruchamia pobranie pierwszej strony, i to tylko na żywo. Pauza zatrzymuje
     widok, nie zbieranie. */
  async _pollLog() {
    if (this._polling) {
      return;
    }
    this._polling = true;
    try {
      const res = await this.wsCommand("meshtastic_ui/sniffer_log", { since: this._lastSeq, limit: 0 });
      if (!res || !res.ok) {
        return;
      }
      const restarted = res.last_seq < this._lastSeq;
      if (restarted) {
        // integracja została przeładowana — numeracja zaczęła się od nowa
        this._expanded = null;
        this._lastSeq = 0;
      }
      const changed =
        restarted ||
        !this._loaded ||
        res.last_seq !== this._lastSeq ||
        !this._meta ||
        res.count !== this._meta.count ||
        res.capacity !== this._meta.capacity;
      this._applyMeta(res);
      if (!changed) {
        return;
      }
      if (restarted || !this._loaded || this._isLive()) {
        await this._reload();
      } else {
        // widok jest zamrożony: liczymy tylko, ile nowych kart czeka na górze
        const fresh = await this._query({ offset: 0, limit: 0 });
        if (fresh && fresh.ok) {
          this._newCount = Math.max(0, fresh.total - this._total);
        }
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
    this._status = { ...(this._status || {}), ...res };
    this._pollLog();
  }

  async _clearLog() {
    const res = await this.wsCommand("meshtastic_ui/sniffer_clear");
    if (res && res.ok) {
      this._expanded = null;
      this._paused = false;
      this._scrolledAway = false;
      this._scrollToTop();
      await this._reload({ fresh: true });
    }
  }

  async _setCapacity(capacity) {
    this._error = "";
    const res = await this.wsCommand("meshtastic_ui/log_capacity_set", { kind: "sniffer", capacity });
    if (!res || !res.ok) {
      this._error = this._errorText(res && res.error);
      return;
    }
    this._capacity = res.sniffer.capacity;
    await this._pollLog();
    await this._reload({ fresh: true });
  }

  _onCapacityChange(value) {
    const capacity = Number(value);
    if (!CAPACITY_CHOICES.includes(capacity) || capacity === this._capacity) {
      return;
    }
    if (this._meta && capacity < this._meta.count) {
      this._capConfirm = capacity;
    } else {
      this._setCapacity(capacity);
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

  /* ── tryb na żywo ─────────────────────────────────────────── */

  _isLive() {
    return !this._paused && !this._scrolledAway;
  }

  _scrollToTop() {
    const list = this.renderRoot && this.renderRoot.querySelector(".cards");
    if (list) {
      list.scrollTop = 0;
    }
    this._scrollTop = 0;
  }

  _goLive() {
    this._paused = false;
    this._scrolledAway = false;
    this._newCount = 0;
    this._scrollToTop();
    this._reload({ fresh: true });
  }

  _togglePause() {
    if (this._isLive()) {
      this._paused = true;
    } else {
      this._goLive();
    }
  }

  _onScroll(event) {
    const top = event.target.scrollTop;
    this._scrollTop = top;
    const away = top > LIVE_SCROLL_THRESHOLD;
    if (away !== this._scrolledAway) {
      this._scrolledAway = away;
      if (!away && !this._paused) {
        // wróciliśmy na górę: dołącz to, co przyszło w międzyczasie
        this._newCount = 0;
        this._reload({ fresh: true });
      }
    }
    this.requestUpdate();
  }

  /* ── lista wirtualna ──────────────────────────────────────── */

  updated() {
    const list = this.renderRoot.querySelector(".cards");
    if (!list) {
      return;
    }
    if (list.clientHeight && list.clientHeight !== this._viewport) {
      this._viewport = list.clientHeight;
      this.requestUpdate();
    }
    // zmierz narysowane wiersze; różnice względem szacunku przesuwają resztę listy
    const anchor = this._win.start;
    const before = this._heights.offsetOf(anchor);
    let changed = false;
    list.querySelectorAll(".vrow").forEach((el) => {
      if (this._heights.set(Number(el.dataset.i), el.offsetHeight)) {
        changed = true;
      }
    });
    if (changed) {
      const delta = this._heights.offsetOf(anchor) - before;
      if (delta && list.scrollTop > 0) {
        list.scrollTop += delta;
        this._scrollTop = list.scrollTop;
      }
      this.requestUpdate();
    }
    for (const page of pagesForRange(this._win.start, this._win.end, PAGE, this._total)) {
      this._fetchPage(page);
    }
  }

  _filterNow() {
    clearTimeout(this._filterTimer);
    this._filterTimer = null;
    if (this._filterApplied === this._filter) {
      return;
    }
    this._filterApplied = this._filter;
    this._restartQuery();
  }

  /* Nowy filtr / źródło / grupowanie: wracamy na górę, na żywo. */
  _restartQuery() {
    this._paused = false;
    this._scrolledAway = false;
    this._expanded = null;
    this._scrollToTop();
    this._reload({ fresh: true });
  }

  /* ── nazwy i formatowanie ─────────────────────────────────── */

  _name(id) {
    if (id === null || id === undefined) {
      return null;
    }
    return this._names[id >>> 0] || this._names[String(id >>> 0)] || null;
  }

  _label(id) {
    if (id === null || id === undefined) {
      return "—";
    }
    if (id >>> 0 === BROADCAST) {
      return PL("Everyone");
    }
    const name = this._name(id);
    return name ? `${hexId(id)} (${name})` : hexId(id);
  }

  _gatewayLabel(entry) {
    const num = gatewayNum(entry.gateway);
    if (num === null) {
      return entry.gateway || "—";
    }
    const name = this._name(num);
    return name ? `${entry.gateway} (${name})` : entry.gateway;
  }

  /* Przekaźnik to tylko ostatni bajt numeru węzła — szukamy znanych węzłów
     z takim końcem; gdy równy końcówce nadawcy, pakiet przyszedł wprost. */

  _relayLabel(entry) {
    const relay = entry.relay_node;
    if (relay === null || relay === undefined || relay === 0) {
      return "—";
    }
    const byte = `0x${relay.toString(16).padStart(2, "0")}`;
    if (typeof entry.from === "number" && (entry.from & 0xff) === relay && (entry.hops_away ?? 0) === 0) {
      return `${byte} · ${PL("direct from sender")}`;
    }
    // po co najmniej jednym skoku przekaźnikiem nie mógł być sam nadawca
    const sender = typeof entry.from === "number" ? entry.from >>> 0 : null;
    const matches = Object.keys(this._names)
      .map((key) => Number(key) >>> 0)
      .filter((num) => (num & 0xff) === relay && num !== sender)
      .map((num) => this._names[num] || this._names[String(num)]);
    if (!matches.length) {
      return byte;
    }
    const shown = matches.slice(0, 3).join(" / ");
    return `${byte} (${shown}${matches.length > 3 ? " …" : ""})`;
  }

  /* SNR / RSSI w kolorze jakości łącza (signal-quality.js) */
  _signalHtml(entry) {
    const snr = typeof entry.rx_snr === "number" ? entry.rx_snr : undefined;
    const rssi = typeof entry.rx_rssi === "number" && entry.rx_rssi !== 0 ? entry.rx_rssi : undefined;
    if (snr === undefined && rssi === undefined) {
      return "";
    }
    const parts = [];
    if (snr !== undefined) {
      parts.push(`SNR ${snr.toFixed(1)} dB`);
    }
    if (rssi !== undefined) {
      parts.push(`RSSI ${rssi} dBm`);
    }
    return html`<span class="sig" style=${signalStyle(snr, rssi)}>${parts.join(" · ")}</span>`;
  }

  _hops(entry) {
    if (entry.hops_away === null || entry.hops_away === undefined) {
      return null;
    }
    return entry.hop_start ? `${entry.hops_away}/${entry.hop_start}` : String(entry.hops_away);
  }

  _portText(entry) {
    if (entry.port === "ENCRYPTED" && entry.pki_likely) {
      return PL("Private message (PKI)");
    }
    if (entry.port === "ENCRYPTED") {
      return PL("Encrypted");
    }
    if (entry.port === "PKI") {
      return PL("Private message (PKI)");
    }
    return portLabel("pl", entry.port);
  }

  /* Co widać w pakiecie, którego nie da się odczytać — zamiast pustego wiersza. */

  _undecodedInfo(entry) {
    if (entry.pki) {
      return PL("Private message encrypted with the recipient's key — cannot be read without it ({n} B).").replace(
        "{n}",
        entry.payload_size
      );
    }
    if (entry.pki_likely) {
      return PL("Most likely a private message (PKI) to another node — only the recipient can read it ({n} B).").replace(
        "{n}",
        entry.payload_size
      );
    }
    if (entry.encrypted) {
      const hash = typeof entry.channel === "number" ? `0x${entry.channel.toString(16).padStart(2, "0")}` : "?";
      const matches = entry.channel_hash_matches || [];
      const base = PL("Unknown channel key (channel hash {h}), {n} B").replace("{h}", hash).replace("{n}", entry.payload_size);
      return matches.length ? `${base} · ${PL("same hash as")}: ${matches.join(", ")} (${PL("different key")})` : base;
    }
    if (entry.payload_ascii) {
      return entry.payload_ascii;
    }
    return "";
  }

  _decryptedWith(info) {
    if (info.source === "plaintext") {
      return PL("unencrypted channel (no key), name unknown");
    }
    if (info.source === "public") {
      return PL("public default channel {c}").replace("{c}", info.name);
    }
    if (info.plain) {
      return PL("gateway channel {c} (unencrypted)").replace("{c}", info.name);
    }
    return PL("gateway channel {c}").replace("{c}", info.name);
  }

  _time(ts) {
    const date = new Date(ts);
    return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
  }

  _delta(ms) {
    if (ms < 1000) {
      return `+${ms} ms`;
    }
    return `+${(ms / 1000).toFixed(1)} s`;
  }

  _sourceLabel(entry) {
    return entry.source === "mqtt" ? "MQTT" : PL("Radio");
  }

  /* ── eksport i kopiowanie ─────────────────────────────────── */

  _download(filename, mime, parts) {
    const blob = new Blob(Array.isArray(parts) ? parts : [parts], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  _exportCtx() {
    return { name: (id) => this._name(id) };
  }

  /* Cały przefiltrowany bufor, porcjami po 1000 wpisów; plik składany z kawałków. */
  async _export(kind) {
    if (this._exporting) {
      return;
    }
    this._exporting = { kind, count: 0 };
    this._error = "";
    try {
      const params = this._queryParams();
      const ctx = this._exportCtx();
      const fetchPage = async (after) => {
        const res = await this.wsCommand("meshtastic_ui/sniffer_entries", { ...params, after, limit: EXPORT_CHUNK });
        if (!res || !res.ok) {
          throw new Error((res && res.error) || "export");
        }
        return res;
      };
      const onProgress = (count) => {
        this._exporting = { kind, count };
      };
      const name = `sniffer-${stamp(new Date())}`;
      if (kind === "json") {
        const out = await streamPages({
          fetchPage,
          format: (entries, first) => jsonChunk(entries.map((entry) => exportRow(entry, ctx)), first),
          header: jsonHeader(new Date().toISOString()),
          footer: (count) => jsonFooter(count),
          onProgress,
        });
        this._download(`${name}.json`, "application/json", out.chunks);
      } else {
        // BOM, żeby Excel poprawnie odczytał polskie znaki
        const out = await streamPages({
          fetchPage,
          format: (entries) => entries.map((entry) => csvLine(exportRow(entry, ctx))).join("\r\n") + "\r\n",
          header: `﻿${CSV_COLUMNS.join(";")}\r\n`,
          onProgress,
        });
        this._download(`${name}.csv`, "text/csv;charset=utf-8", out.chunks);
      }
    } catch (err) {
      this._error = PL("Could not reach the radio.");
    } finally {
      this._exporting = null;
    }
  }

  async _copyGroup(group) {
    const ctx = this._exportCtx();
    const text = JSON.stringify(
      { packet: exportRow(group.main, ctx), receptions: group.receptions.map((entry) => exportRow(entry, ctx)) },
      null,
      2
    );
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // bez HTTPS przeglądarka nie daje dostępu do schowka — plik zamiast tego
      this._download(`sniffer-packet-${group.main.id || group.main.seq}.json`, "application/json", text);
    }
    this._copied = group.key;
    setTimeout(() => {
      if (this._copied === group.key) {
        this._copied = null;
      }
    }, 1500);
  }

  /* ── widok: sterowanie ────────────────────────────────────── */

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
    const mqttEnabled = Boolean(status && status.mqtt_enabled);

    return html`
      <div class="controls">
        <div class="control-card">
          <div class="control-head">
            <ha-icon icon="mdi:radio-tower"></ha-icon>
            <div class="control-title">
              <div>${PL("Radio sniffer")}</div>
              <div class="control-sub">
                ${this._checking ? PL("Checking…") : this._statusBadge()}
              </div>
            </div>
            <span class="state ${enabled === true ? "on" : ""}">
              ${enabled === true ? PL("On") : enabled === false ? PL("Off") : PL("Unknown")}
            </span>
          </div>
          ${this._supportNote() ? html`<div class="note">${this._supportNote()}</div>` : ""}
          <div class="note">
            ${PL("The sniffer works only on the radio connected to Home Assistant. Its state lives in the radio's RAM, so it is always off after a reboot.")}
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
        </div>

        <div class="control-card">
          <div class="control-head">
            <ha-icon icon="mdi:cloud-outline"></ha-icon>
            <div class="control-title">
              <div>${PL("MQTT sniffer")}</div>
              <div class="control-sub">
                ${status && status.mqtt_connected
                  ? html`<span class="badge success">${PL("Connected")}</span>`
                  : html`<span class="badge secondary">${PL("Not connected")}</span>`}
              </div>
            </div>
            <span class="state ${mqttEnabled ? "on" : ""}">${mqttEnabled ? PL("On") : PL("Off")}</span>
          </div>
          <div class="note">
            ${PL("Subscribes directly to the MQTT broker your gateway's MQTT module uses, so it also sees traffic from other gateways on the same broker/channel — not only your own radio. Runs entirely in Home Assistant and keeps its setting across restarts.")}
          </div>
          ${status && status.mqtt_error ? html`<div class="note warn">${status.mqtt_error}</div>` : ""}
          <div class="buttons">
            ${mqttEnabled
              ? html`<button class="btn" ?disabled=${this._mqttBusy} @click=${() => this._setMqttSniffer(false)}>
                  ${PL("Disable MQTT sniffer")}
                </button>`
              : html`<button class="btn primary" ?disabled=${this._mqttBusy} @click=${() => this._setMqttSniffer(true)}>
                  ${PL("Enable MQTT sniffer")}
                </button>`}
          </div>
        </div>
      </div>
      ${this._error ? html`<div class="error">${this._error}</div>` : ""}
    `;
  }

  /* ── widok: karty pakietów ────────────────────────────────── */

  _renderChips(group) {
    const main = group.main;
    return html`
      ${group.radio ? html`<span class="chip"><ha-icon icon="mdi:radio-tower"></ha-icon>${group.radio > 1 ? `${PL("Radio")} ×${group.radio}` : PL("Radio")}</span>` : ""}
      ${group.gateways
        ? html`<span class="chip"><ha-icon icon="mdi:cloud-outline"></ha-icon>MQTT${group.gateways > 1 ? ` ×${group.gateways}` : ""}</span>`
        : ""}
      ${group.n > 1 ? html`<span class="chip strong">${PL("Heard {n}×").replace("{n}", group.n)}</span>` : ""}
      ${main.signed ? html`<span class="chip" title=${PL("Signed")}><ha-icon icon="mdi:shield-check-outline"></ha-icon></span>` : ""}
      ${main.pki ? html`<span class="chip" title="PKI"><ha-icon icon="mdi:key-outline"></ha-icon></span>` : ""}
      ${main.want_ack ? html`<span class="chip">ACK</span>` : ""}
    `;
  }

  _renderReceptions(group) {
    const first = group.first_ts;
    return html`
      <div class="receptions">
        <div class="section-title">${PL("Receptions")} (${group.n})</div>
        ${group.receptions.map(
          (entry) => html`
            <div class="reception">
              <div class="reception-head">
                <ha-icon icon=${entry.source === "mqtt" ? "mdi:cloud-outline" : "mdi:radio-tower"}></ha-icon>
                <span class="reception-gw">
                  ${this._sourceLabel(entry)}${entry.gateway ? html` · ${this._gatewayLabel(entry)}` : ""}
                </span>
                <span class="reception-time">
                  ${entry.ts === first ? this._time(entry.ts) : this._delta(entry.ts - first)}
                </span>
              </div>
              <div class="reception-meta">
                <span>${PL("Relay")}: ${this._relayLabel(entry)}</span>
                ${this._hops(entry) !== null ? html`<span>${PL("Hops")}: ${this._hops(entry)}</span>` : ""}
                ${this._signalHtml(entry) ? html`<span>${this._signalHtml(entry)}</span>` : ""}
                ${entry.encrypted ? html`<span>${PL("Encrypted")}</span>` : ""}
              </div>
            </div>
          `
        )}
        ${group.n > group.receptions.length
          ? html`<div class="more-note">Pokazano ${group.receptions.length} z ${group.n} odbiorów.</div>`
          : ""}
      </div>
    `;
  }

  _detailCtx() {
    return {
      nodeOf: (id) => {
        const key = id >>> 0;
        const short = this._names[key] || this._names[String(key)];
        const long = this._longNames[key] || this._longNames[String(key)];
        return short || long ? { short, long } : null;
      },
    };
  }

  _renderDetails(group) {
    const entry = group.main;
    const flags = [
      entry.want_ack ? PL("Wants ACK") : null,
      entry.signed ? PL("Signed") : null,
      entry.pki ? "PKI" : null,
      entry.via_mqtt ? "MQTT" : null,
      entry.encrypted ? PL("Encrypted") : null,
      entry.broadcast ? PL("Broadcast") : null,
    ].filter(Boolean);
    const hops =
      entry.hop_start !== null && entry.hop_start !== undefined
        ? `${entry.hop_limit ?? "—"} / ${entry.hop_start}`
        : "—";
    const sections = buildDetailSections(entry, this._detailCtx());
    const decoded = sections.length > 0;
    return html`
      <div class="details" @click=${(e) => e.stopPropagation()}>
        ${group.n > 1 || group.receptions.length > 1 ? this._renderReceptions(group) : ""}
        ${decoded ? html`<div class="content">${renderSections(sections)}</div>` : ""}
        <div class="section-title">${PL("Packet")}</div>
        ${entry.decrypted_with
          ? html`<div class="kv"><span class="k">${PL("Decrypted with")}</span><span>${this._decryptedWith(entry.decrypted_with)}</span></div>`
          : ""}
        ${!decoded
          ? html`<div class="kv"><span class="k">${PL("What is visible")}</span><span>${this._undecodedInfo(entry) || "—"}</span></div>`
          : ""}
        <div class="kv"><span class="k">${PL("Packet ID")}</span><span>${entry.id ?? "—"}</span></div>
        <div class="kv"><span class="k">${PL("Channel")}</span><span>${entry.mqtt_channel_name || (entry.decrypted_with && entry.decrypted_with.name) || entry.channel || "—"}</span></div>
        <div class="kv"><span class="k">${PL("Signal")}</span><span>${this._signalHtml(entry) || "—"}</span></div>
        <div class="kv"><span class="k">${PL("Hop limit / start")}</span><span>${hops}</span></div>
        <div class="kv"><span class="k">${PL("Flags")}</span><span>${flags.length ? flags.join(", ") : "—"}</span></div>
        <div class="kv"><span class="k">${PL("Payload size")}</span><span>${entry.payload_size} B</span></div>
        <div class="kv hex"><span class="k">${PL("Payload (hex)")}</span><span>${entry.payload_hex || "—"}</span></div>
        ${entry.payload_ascii
          ? html`<div class="kv hex"><span class="k">${PL("Payload (ASCII)")}</span><span>${entry.payload_ascii}</span></div>`
          : ""}
        <div class="buttons">
          <button class="btn" @click=${() => this._copyGroup(group)}>
            <ha-icon icon=${this._copied === group.key ? "mdi:check" : "mdi:content-copy"}></ha-icon>
            ${this._copied === group.key ? PL("Copied") : PL("Copy")}
          </button>
        </div>
      </div>
    `;
  }

  _renderCard(group) {
    const entry = group.main;
    const color = PORT_COLORS[entry.port] || "var(--primary-color)";
    const expanded = this._expanded === group.key;
    const info = entry.info || this._undecodedInfo(entry);
    const hops = this._hops(entry);
    const muted = !entry.info && (entry.encrypted || entry.pki || Boolean(entry.payload_ascii));
    return html`
      <div
        class="card ${entry.from_us ? "own" : ""} ${expanded ? "open" : ""}"
        style="--port-color: ${color}"
        @click=${() => { this._expanded = expanded ? null : group.key; }}
      >
        <div class="card-top">
          <span class="port">${this._portText(entry)}</span>
          <span class="time">${this._time(group.first_ts)}</span>
        </div>
        <div class="route">
          <span class="node">${this._label(entry.from)}</span>
          <ha-icon icon="mdi:arrow-right"></ha-icon>
          <span class="node ${entry.to >>> 0 === BROADCAST ? "broadcast" : ""}">${this._label(entry.to)}</span>
        </div>
        ${info ? html`<div class="info ${muted ? "muted" : ""}">${info}</div>` : ""}
        <div class="meta">
          ${this._renderChips(group)}
          ${hops !== null ? html`<span class="chip">${PL("Hops")} ${hops}</span>` : ""}
          ${group.n === 1 && this._signalHtml(entry) ? html`<span class="chip">${this._signalHtml(entry)}</span>` : ""}
        </div>
        ${expanded ? this._renderDetails(group) : ""}
      </div>
    `;
  }

  _renderLiveButton(newCount) {
    if (this._isLive()) {
      return html`<button class="live on" @click=${() => this._togglePause()} title=${PL("Pause")}>
        <span class="dot"></span>${PL("Live")}
      </button>`;
    }
    if (newCount > 0) {
      return html`<button class="live new" @click=${() => this._goLive()}>
        <ha-icon icon="mdi:arrow-up"></ha-icon>${PL("{n} new").replace("{n}", newCount)}
      </button>`;
    }
    return html`<button class="live" @click=${() => this._goLive()} title=${PL("Resume")}>
      <ha-icon icon="mdi:pause"></ha-icon>${PL("Paused")}
    </button>`;
  }

  _renderRows() {
    const win = computeWindow(this._heights, this._scrollTop, this._viewport, OVERSCAN_PX);
    this._win = win;
    const rows = [];
    for (let i = win.start; i < win.end; i += 1) {
      const group = this._rows[i];
      rows.push(
        group
          ? html`<div class="vrow" data-i=${i}>${this._renderCard(group)}</div>`
          : html`<div class="vrow" data-i=${i}><div class="card skeleton"></div></div>`
      );
    }
    return html`
      <div class="cards" @scroll=${(e) => this._onScroll(e)}>
        <div class="vspacer" style="height:${win.total}px">
          <div class="vrows" style="transform:translateY(${win.offset}px)">${rows}</div>
        </div>
      </div>
    `;
  }

  _renderCapacity() {
    const value = this._capacity || (this._meta && this._meta.capacity) || 25000;
    return html`
      <label class="cap" title="Ile ostatnich wpisów trzyma integracja w pamięci. Zmniejszenie usuwa najstarsze.">
        <span>Bufor</span>
        <select .value=${String(value)} @change=${(e) => this._onCapacityChange(e.target.value)}>
          ${CAPACITY_CHOICES.map(
            (size) => html`<option value=${size} ?selected=${size === value}>${thousands(size)}</option>`
          )}
        </select>
      </label>
    `;
  }

  _renderLog() {
    const meta = this._meta;
    const collecting = meta ? Boolean(meta.enabled || meta.mqtt_enabled) : false;
    const hasEntries = Boolean(meta && meta.count);
    const filtering = Boolean((this._filterApplied || "").trim()) || this._source !== "all";
    const busy = Boolean(this._exporting);

    return html`
      <div class="log-head">
        <h4>${PL("Sniffer log")}</h4>
        <span class="badge ${collecting ? "success" : "secondary"}">
          ${collecting ? PL("Collecting") : PL("Not collecting")}
        </span>
        <span class="count">
          ${thousands(this._total)} ${PL("packets")} · ${thousands(this._receptionsTotal)} ${PL("receptions")}${meta ? ` · ${PL("buffer")} ${thousands(meta.count)}/${thousands(meta.capacity)}` : ""}
        </span>
        <span class="spacer"></span>
        ${this._renderCapacity()}
        ${this._renderLiveButton(this._newCount)}
        <button
          class="icon-btn danger"
          title=${PL("Clear log")}
          aria-label=${PL("Clear log")}
          ?disabled=${!hasEntries}
          @click=${() => { this._clearConfirmOpen = true; }}
        >
          <ha-icon icon="mdi:trash-can-outline"></ha-icon>
        </button>
      </div>

      <div class="toolbar">
        <input
          class="filter"
          type="search"
          .value=${this._filter}
          placeholder=${PL("Filter by node, port or content")}
          @input=${(e) => {
            this._filter = e.target.value;
            clearTimeout(this._filterTimer);
            this._filterTimer = setTimeout(() => this._filterNow(), FILTER_DEBOUNCE_MS);
          }}
          @keydown=${(e) => { if (e.key === "Enter") this._filterNow(); }}
        />
        <div class="segmented">
          ${[
            ["all", PL("All")],
            ["radio", PL("Radio")],
            ["mqtt", "MQTT"],
          ].map(
            ([value, label]) => html`<button
              class=${this._source === value ? "active" : ""}
              @click=${() => { if (this._source !== value) { this._source = value; this._restartQuery(); } }}
            >${label}</button>`
          )}
        </div>
        <label class="toggle">
          <input type="checkbox" .checked=${this._grouped} @change=${(e) => { this._grouped = e.target.checked; this._restartQuery(); }} />
          ${PL("Group duplicates")}
        </label>
      </div>

      ${this._total > 0
        ? this._renderRows()
        : html`<div class="empty">
            <ha-icon icon="mdi:access-point-network"></ha-icon>
            <div>${!this._loaded
              ? PL("Checking…")
              : hasEntries && filtering
                ? "Żaden pakiet nie pasuje do filtrów."
                : collecting ? PL("Waiting for packets…") : PL("Enable the sniffer to start collecting packets.")}</div>
          </div>`}

      <div class="toolbar bottom">
        <button class="btn" ?disabled=${!hasEntries || busy} @click=${() => this._export("json")}>${PL("Export JSON")}</button>
        <button class="btn" ?disabled=${!hasEntries || busy} @click=${() => this._export("csv")}>${PL("Export CSV")}</button>
        ${busy ? html`<span class="count">Eksport… ${thousands(this._exporting.count)} wpisów</span>` : ""}
        <button class="btn danger" ?disabled=${!hasEntries} @click=${() => { this._clearConfirmOpen = true; }}>
          <ha-icon icon="mdi:trash-can-outline"></ha-icon>${PL("Clear log")}
        </button>
      </div>
      <div class="note">Eksport obejmuje cały przefiltrowany bufor, każdy odbiór osobno (nie tylko to, co widać na liście).</div>
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
          ${this._renderControls()}
          <div class="settings-section">${this._renderLog()}</div>
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

      <mesh-confirm-dialog
        .open=${this._clearConfirmOpen}
        .title=${PL("Clear the sniffer log?")}
        .message=${PL("All captured packets will be removed from the list. The sniffer keeps collecting new ones.")}
        .confirmLabel=${PL("Clear log")}
        .danger=${true}
        @confirm=${() => { this._clearConfirmOpen = false; this._clearLog(); }}
        @cancel=${() => { this._clearConfirmOpen = false; }}
      ></mesh-confirm-dialog>

      <mesh-confirm-dialog
        .open=${this._capConfirm !== null}
        .title=${"Zmniejszyć bufor?"}
        .message=${`Bufor zostanie zmniejszony do ${thousands(this._capConfirm || 0)} wpisów. Najstarsze pakiety ponad ten limit zostaną usunięte z pamięci.`}
        .confirmLabel=${"Zmniejsz"}
        .danger=${true}
        @confirm=${() => { const size = this._capConfirm; this._capConfirm = null; this._setCapacity(size); }}
        @cancel=${() => { this._capConfirm = null; }}
      ></mesh-confirm-dialog>
    `;
  }

  static get styles() {
    return [
      settingsStyles,
      badgeStyles,
      detailStyles,
      css`
        :host { display: block; }

        ha-icon { --mdc-icon-size: 16px; }

        /* ── sterowanie ── */
        .controls {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 12px;
          margin-bottom: 12px;
        }

        .control-card {
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          padding: 12px 14px;
          background: var(--card-background-color);
        }

        .control-head {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .control-head > ha-icon {
          --mdc-icon-size: 22px;
          color: var(--primary-color);
        }

        .control-title { flex: 1; font-size: 14px; font-weight: 500; }
        .control-sub { margin-top: 2px; font-weight: normal; }

        .state {
          font-size: 12px;
          padding: 2px 10px;
          border-radius: 999px;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
        }

        .state.on {
          background: rgba(76, 175, 80, 0.15);
          color: var(--success-color, #4caf50);
        }

        .note {
          font-size: 12px;
          line-height: 1.5;
          color: var(--secondary-text-color);
          padding: 8px 0 0;
        }

        .note.warn { color: var(--warning-color, #ff9800); }

        .error {
          margin: 0 0 12px;
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
          align-items: center;
          gap: 8px;
          margin-top: 10px;
        }

        .toolbar.bottom { margin-top: 12px; }

        .btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
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
        .btn.more { align-self: center; margin: 4px auto 8px; }

        /* ── nagłówek logu ── */
        .log-head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .log-head h4 { margin: 0; font-size: 15px; }
        .count { font-size: 12px; color: var(--secondary-text-color); }
        .spacer { flex: 1; }

        .live {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 999px;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          font-family: inherit;
          font-size: 12px;
          cursor: pointer;
        }

        .live.on {
          color: var(--success-color, #4caf50);
          border-color: rgba(76, 175, 80, 0.4);
          background: rgba(76, 175, 80, 0.1);
        }

        .live.new {
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color);
          background: var(--primary-color);
        }

        .icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          padding: 0;
          border-radius: 50%;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--secondary-text-color);
          cursor: pointer;
        }

        .icon-btn ha-icon { --mdc-icon-size: 18px; }
        .icon-btn.danger:hover:not([disabled]) { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437); }
        .icon-btn[disabled] { opacity: 0.4; cursor: default; }

        .live .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          animation: pulse 1.6s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.75); }
        }

        .filter {
          flex: 1 1 200px;
          min-width: 160px;
          padding: 7px 10px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 13px;
        }

        .segmented {
          display: inline-flex;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          overflow: hidden;
        }

        .segmented button {
          padding: 6px 12px;
          border: none;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 13px;
          cursor: pointer;
        }

        .segmented button + button { border-left: 1px solid var(--divider-color); }

        .segmented button.active {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }

        .toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          cursor: pointer;
        }

        /* ── karty ── */
        /* lista wirtualna: stała wysokość okna, w środku rozpórka o pełnej wysokości listy */
        .cards {
          margin-top: 12px;
          height: min(70vh, 640px);
          min-height: 280px;
          overflow-y: auto;
          overflow-anchor: none;
          padding-right: 2px;
        }

        .vspacer { position: relative; }
        .vrows { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }
        .vrow { padding-bottom: 8px; }
        .card.skeleton { min-height: 86px; opacity: 0.5; animation: pulse 1.6s ease-in-out infinite; cursor: default; }
        .sig { font-variant-numeric: tabular-nums; font-weight: 500; }
        .more-note { margin-top: 4px; font-size: 11px; color: var(--secondary-text-color); }
        .content { margin-bottom: 6px; }

        .cap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }

        .cap select {
          padding: 4px 6px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-family: inherit;
          font-size: 12px;
        }

        .card {
          position: relative;
          border: 1px solid var(--divider-color);
          border-left: 4px solid var(--port-color);
          border-radius: 12px;
          padding: 10px 12px;
          background: var(--card-background-color);
          cursor: pointer;
        }

        .card:hover { background: var(--secondary-background-color); }
        .card.open { background: var(--card-background-color); cursor: default; }
        .card.own { opacity: 0.75; }

        .card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .port {
          font-size: 12px;
          font-weight: 600;
          color: var(--port-color);
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .time {
          font-size: 12px;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
        }

        .route {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 4px;
          font-size: 14px;
          font-family: var(--code-font-family, monospace);
        }

        .route ha-icon { color: var(--secondary-text-color); }
        .node.broadcast { color: var(--secondary-text-color); }

        .info {
          margin-top: 4px;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .card.open .info { white-space: normal; word-break: break-word; }
        .info.muted { color: var(--secondary-text-color); font-style: italic; }

        .meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }

        .chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
        }

        .chip ha-icon { --mdc-icon-size: 13px; }

        .chip.strong {
          background: rgba(33, 150, 243, 0.14);
          color: var(--primary-color);
          font-weight: 600;
        }

        /* ── szczegóły ── */
        .details {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px dashed var(--divider-color);
          font-size: 12px;
          cursor: auto;
        }

        .section-title {
          margin: 4px 0 6px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--secondary-text-color);
        }

        .receptions { margin-bottom: 10px; }

        .reception {
          padding: 6px 8px;
          border-radius: 8px;
          background: var(--secondary-background-color);
        }

        .reception + .reception { margin-top: 4px; }

        .reception-head {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .reception-gw { flex: 1; font-weight: 500; }

        .reception-time {
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
        }

        .reception-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 14px;
          margin-top: 2px;
          padding-left: 22px;
          color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums;
        }

        .kv {
          display: flex;
          gap: 8px;
          padding: 2px 0;
        }

        .kv .k {
          flex: 0 0 140px;
          color: var(--secondary-text-color);
        }

        .kv.text span:last-child {
          white-space: pre-wrap;
          word-break: break-word;
        }

        .kv.hex span:last-child {
          word-break: break-all;
          font-family: var(--code-font-family, monospace);
        }

        .empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 32px 12px;
          color: var(--secondary-text-color);
          font-size: 13px;
        }

        .empty ha-icon { --mdc-icon-size: 32px; opacity: 0.6; }

        @media (max-width: 600px) {
          .kv .k { flex-basis: 110px; }
          .route { font-size: 13px; }
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-sniffer")) {
  customElements.define("mesh-settings-sniffer", MeshSettingsSniffer);
}
