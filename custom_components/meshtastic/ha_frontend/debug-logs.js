/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Ustawienia → Inne → Debugowanie: dwa osobne logi, tak jak w aplikacji Android.
 *
 *  - "Urządzenie"  — rekordy logu firmware (to samo, co radio wypisuje na porcie
 *    szeregowym). Linie wyglądają jak w aplikacji: "data  L/źródło: treść",
 *    gdzie L to T, D, I, W, E albo C. Przez Bluetooth działa z każdym firmware,
 *    przez Wi-Fi i USB tylko z firmware MT_SW, a radio wysyła logi dopiero po
 *    włączeniu "Logi debugowania" w ustawieniach zabezpieczeń.
 *  - "Integracja"  — logi Pythona samej integracji (custom_components.meshtastic).
 *
 * Logi zbiera integracja (bufory w pamięci, domyślnie po 25 000 wpisów; rozmiar
 * 5 000 / 10 000 / 25 000 wybiera się tutaj). Panel NIE pobiera całego bufora:
 * dostaje zwarty indeks numerów wpisów pasujących do filtra (poziomy + tekst
 * liczy serwer), a treść wierszy dociąga tylko dla tych, które są widoczne
 * (lista wirtualna: w DOM tylko widoczne wiersze z zapasem). Lista jest w
 * kolejności chronologicznej (najnowsze na dole) i może śledzić nowe wpisy
 * (auto-przewijanie). Przyrost dopytujemy co ~2 s (since = numer ostatniego
 * wpisu), ale tylko gdy widok jest widoczny. Kopiowanie i eksport .txt obejmują
 * cały przefiltrowany bufor — pobierany porcjami, bez zawieszania karty.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { settingsStyles } from "./styles.js";
import "./components.js";
import { HeightMap, computeWindow, isAtBottom } from "./virtual-list.js";
import { IdIndex, LineCache, collectChunks } from "./log-index.js";

const POLL_MS = 2000;
const QUERY_DEBOUNCE_MS = 300;
const GET_CHUNK = 500;
const LINE_ESTIMATE = 18;
const OVERSCAN_PX = 400;
const CACHE_LINES = 4000;
const CAPACITY_CHOICES = [5000, 10000, 25000];
const PROGRAMMATIC_SCROLL_MS = 200;

/* poziomy jak w aplikacji: litera pierwszego znaku nazwy poziomu */
const DEVICE_LEVELS = ["T", "D", "I", "W", "E", "C"];
const INTEGRATION_LEVELS = ["D", "I", "W", "E", "C"];
const LEVEL_NAMES = {
  T: "TRACE",
  D: "DEBUG",
  I: "INFO",
  W: "WARNING",
  E: "ERROR",
  C: "CRITICAL",
};

const DEVICE_EMPTY =
  "Brak logów urządzenia. Włącz „Logi debugowania” w ustawieniach zabezpieczeń urządzenia, aby radio wysyłało do aplikacji te same logi, które widać na porcie szeregowym. Przez Bluetooth działa to z każdym firmware, a przez Wi-Fi i USB tylko z firmware MT_SW.";
const INTEGRATION_EMPTY = "Brak logów integracji.";

const pad = (n) => String(n).padStart(2, "0");
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

function formatTime(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fileStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/* "2026-10-02 14:03:11  I/źródło: treść" — jak wiersz logu w aplikacji */
function formatLine(entry) {
  return `${formatTime(entry.ts)}  ${entry.level}/${entry.source || "-"}: ${entry.message}`;
}

function newTabState() {
  return {
    index: new IdIndex(), // numery wpisów, które przechodzą filtr
    cache: new LineCache(CACHE_LINES), // treść wierszy po numerze
    heights: new HeightMap(LINE_ESTIMATE),
    fetching: new Set(),
    sinceId: 0, // ostatni numer, który serwer już uwzględnił w indeksie
    epoch: null,
    meta: null,
    levels: null, // null = wszystkie
    query: "", // to, co wpisano
    appliedQuery: "", // to, co poszło do serwera
    gen: 0, // zmienia się przy zmianie filtra — odrzuca spóźnione odpowiedzi
  };
}

class MeshSettingsDebugLogs extends LitElement {
  static get properties() {
    return {
      wsCommand: { type: Object },
      _tab: { type: String, state: true },
      _status: { type: Object, state: true },
      _error: { type: String, state: true },
      _busy: { type: Boolean, state: true },
      _autoScroll: { type: Boolean, state: true },
      _copied: { type: Boolean, state: true },
      _clearConfirm: { type: Boolean, state: true },
      _capacity: { type: Number, state: true },
      _capConfirm: { type: Number, state: true },
      _exporting: { type: Object, state: true },
      _rev: { type: Number, state: true },
    };
  }

  constructor() {
    super();
    this._tab = "device";
    this._status = null;
    this._error = "";
    this._busy = false;
    this._autoScroll = true;
    this._copied = false;
    this._clearConfirm = false;
    this._capacity = null;
    this._capConfirm = null;
    this._exporting = null;
    this._rev = 0;
    this._state = { device: newTabState(), integration: newTabState() };
    this._timer = null;
    this._queryTimer = null;
    this._polling = false;
    this._repoll = false;
    this._inView = true;
    this._observer = null;
    this._scrollTop = 0;
    this._viewport = 400;
    this._win = { start: 0, end: 0, offset: 0, total: 0 };
    this._programmaticUntil = 0;
    this._onVisibility = () => this._syncPolling();
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this._onVisibility);
    if (typeof IntersectionObserver !== "undefined") {
      this._observer = new IntersectionObserver((records) => {
        const last = records[records.length - 1];
        this._inView = Boolean(last && last.isIntersecting);
        this._syncPolling();
      });
      this._observer.observe(this);
    }
    if (this.wsCommand) this._syncPolling();
  }

  firstUpdated() {
    // wsCommand jest już ustawione; dopiero teraz można pytać integrację
    this._loadStatus();
    this._loadCapacity();
    this._syncPolling();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this._onVisibility);
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    clearTimeout(this._queryTimer);
    this._stopPolling();
  }

  /* ── odpytywanie: tylko gdy widok widać ─────────────────── */

  _syncPolling() {
    if (this.isConnected && this._inView && !document.hidden) {
      if (!this._timer) {
        this._poll();
        this._timer = setInterval(() => this._poll(), POLL_MS);
      }
    } else {
      this._stopPolling();
    }
  }

  _stopPolling() {
    clearInterval(this._timer);
    this._timer = null;
  }

  _tz() {
    return -new Date().getTimezoneOffset();
  }

  _hiddenLevels(st, source) {
    if (!st.levels) return [];
    const known = source === "device" ? DEVICE_LEVELS : INTEGRATION_LEVELS;
    return known.filter((level) => !st.levels.has(level));
  }

  /* Indeks pasujących wpisów (przyrostowo) + kilka najnowszych w całości. */
  async _poll() {
    if (this._polling || !this.wsCommand) return;
    this._polling = true;
    const source = this._tab;
    const st = this._state[source];
    const gen = st.gen;
    try {
      const res = await this.wsCommand("meshtastic_ui/debug_logs_index", {
        source,
        since: st.sinceId,
        hide_levels: this._hiddenLevels(st, source),
        query: st.appliedQuery,
        tz_offset: this._tz(),
        tail: 100,
      });
      if (!res || !res.ok || gen !== st.gen) return;
      if ((st.epoch !== null && res.epoch !== st.epoch) || res.last_id < st.sinceId) {
        // integracja została przeładowana — numeracja zaczęła się od nowa
        this._resetTab(st);
        st.epoch = res.epoch;
        st.meta = res;
        this._rev += 1;
        return;
      }
      st.epoch = res.epoch;
      st.meta = res;
      const before = st.index.length;
      const appended = st.index.apply(res);
      const dropped = before + appended - st.index.length;
      if (dropped > 0) st.heights.shift(-dropped);
      st.heights.setCount(st.index.length);
      st.sinceId = res.last_id;
      st.cache.putAll(res.entries || []);
      this._rev += 1;
    } finally {
      this._polling = false;
      if (this._repoll) {
        this._repoll = false;
        this._poll();
      }
    }
  }

  /* Zmiana filtra / karty w trakcie trwającego zapytania: powtórz je zaraz po jego końcu. */
  _pollSoon() {
    if (this._polling) {
      this._repoll = true;
    } else {
      this._poll();
    }
  }

  _resetTab(st) {
    st.gen += 1;
    st.index.reset();
    st.heights.reset(0);
    st.fetching.clear();
    st.sinceId = 0;
  }

  async _loadStatus() {
    if (!this.wsCommand) return;
    const res = await this.wsCommand("meshtastic_ui/debug_logs_status");
    if (res && res.ok) {
      this._status = res;
    } else if (res && res.error) {
      this._error = res.error;
    }
  }

  async _loadCapacity() {
    if (!this.wsCommand) return;
    const res = await this.wsCommand("meshtastic_ui/log_capacity_get");
    if (res && res.ok && res.debug) {
      this._capacity = res.debug.capacity;
    }
  }

  async _setCapacity(capacity) {
    this._error = "";
    const res = await this.wsCommand("meshtastic_ui/log_capacity_set", { kind: "debug", capacity });
    if (!res || !res.ok) {
      this._error = (res && res.error) || "Operacja nie powiodła się.";
      return;
    }
    this._capacity = res.debug.capacity;
    // mniejszy bufor wypchnął najstarsze wpisy: indeks liczymy od nowa
    for (const st of Object.values(this._state)) {
      this._resetTab(st);
      st.cache.clear();
    }
    this._rev += 1;
    this._loadStatus();
    this._pollSoon();
  }

  _onCapacityChange(value) {
    const capacity = Number(value);
    if (!CAPACITY_CHOICES.includes(capacity) || capacity === this._capacity) return;
    const counts = this._status ? [this._status.device?.count ?? 0, this._status.integration?.count ?? 0] : [0];
    if (Math.max(...counts) > capacity) {
      this._capConfirm = capacity;
    } else {
      this._setCapacity(capacity);
    }
  }

  /* ── treść wierszy: tylko dla widocznych ─────────────────── */

  async _fetchLines(st, source, ids) {
    const fresh = ids.filter((id) => !st.fetching.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => st.fetching.add(id));
    const gen = st.gen;
    try {
      for (let i = 0; i < fresh.length; i += GET_CHUNK) {
        const res = await this.wsCommand("meshtastic_ui/debug_logs_get", {
          source,
          ids: fresh.slice(i, i + GET_CHUNK),
        });
        if (gen !== st.gen) return;
        if (res && res.ok) {
          st.cache.putAll(res.entries || []);
          this._rev += 1;
        }
      }
    } finally {
      fresh.forEach((id) => st.fetching.delete(id));
    }
  }

  /* ── akcje ────────────────────────────────────────────────── */

  async _run(type, data, onOk) {
    if (this._busy) return;
    this._busy = true;
    this._error = "";
    const res = await this.wsCommand(type, data);
    this._busy = false;
    if (!res || !res.ok) {
      this._error = (res && res.error) || "Operacja nie powiodła się.";
      return;
    }
    onOk(res);
  }

  _setCollecting(enabled) {
    return this._run("meshtastic_ui/debug_logs_collect", { enabled }, (res) => {
      this._status = { ...(this._status || {}), device: res };
    });
  }

  _setFirmwareApi(enabled) {
    return this._run("meshtastic_ui/debug_logs_firmware_api", { enabled }, (res) => {
      this._status = { ...(this._status || {}), device: res };
    });
  }

  _setDebugCapture(enabled) {
    return this._run("meshtastic_ui/debug_logs_capture_debug", { enabled }, (res) => {
      this._status = { ...(this._status || {}), integration: res };
      this._poll();
    });
  }

  async _clear() {
    const source = this._tab;
    await this._run("meshtastic_ui/debug_logs_clear", { source }, () => {
      const st = this._state[source];
      this._resetTab(st);
      st.cache.clear();
      this._rev += 1;
    });
    this._loadStatus();
    this._pollSoon();
  }

  _switchTab(tab) {
    if (tab === this._tab) return;
    this._tab = tab;
    this._copied = false;
    this._scrollTop = 0;
    this._rev += 1;
    this._pollSoon();
  }

  /* ── filtry ───────────────────────────────────────────────── */

  _allLevels() {
    return this._tab === "device" ? DEVICE_LEVELS : INTEGRATION_LEVELS;
  }

  /* Zmiana filtra: stary indeks przestaje obowiązywać, serwer liczy nowy. */
  _filtersChanged() {
    const st = this._state[this._tab];
    this._resetTab(st);
    this._rev += 1;
    this._pollSoon();
  }

  _toggleLevel(level) {
    const st = this._state[this._tab];
    const current = new Set(st.levels || this._allLevels());
    if (current.has(level)) current.delete(level);
    else current.add(level);
    st.levels = current.size === this._allLevels().length ? null : current;
    this._filtersChanged();
  }

  _onQueryInput(value) {
    const st = this._state[this._tab];
    st.query = value;
    clearTimeout(this._queryTimer);
    this._queryTimer = setTimeout(() => {
      if (st.appliedQuery !== st.query) {
        st.appliedQuery = st.query;
        this._filtersChanged();
      }
    }, QUERY_DEBOUNCE_MS);
  }

  /* ── kopiowanie i eksport: cały przefiltrowany bufor, porcjami ── */

  async _collectText() {
    const source = this._tab;
    const st = this._state[source];
    this._exporting = { done: 0, total: st.index.length };
    try {
      const chunks = await collectChunks(st.index, {
        chunkSize: GET_CHUNK,
        fetchEntries: async (ids) => {
          const res = await this.wsCommand("meshtastic_ui/debug_logs_get", { source, ids });
          if (!res || !res.ok) throw new Error("get");
          return res.entries || [];
        },
        format: formatLine,
        onProgress: (done, total) => {
          this._exporting = { done, total };
        },
      });
      return chunks;
    } catch (err) {
      this._error = "Nie udało się pobrać logu z integracji.";
      return null;
    } finally {
      this._exporting = null;
    }
  }

  async _copy() {
    const chunks = await this._collectText();
    if (!chunks) return;
    try {
      await navigator.clipboard.writeText(chunks.join(""));
    } catch (err) {
      // bez HTTPS przeglądarka nie daje dostępu do schowka — plik zamiast tego
      this._saveBlob(chunks);
      return;
    }
    this._copied = true;
    setTimeout(() => {
      this._copied = false;
    }, 1500);
  }

  async _download() {
    const chunks = await this._collectText();
    if (chunks) this._saveBlob(chunks);
  }

  _saveBlob(chunks) {
    const name = this._tab === "device" ? "mt_sw_device_log" : "mt_sw_integration_log";
    const blob = new Blob(chunks, { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}_${fileStamp(new Date())}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── lista wirtualna ──────────────────────────────────────── */

  _scrollToBottom() {
    const list = this.renderRoot.querySelector(".log-list");
    if (!list) return;
    this._programmaticUntil = Date.now() + PROGRAMMATIC_SCROLL_MS;
    list.scrollTop = list.scrollHeight;
    this._scrollTop = list.scrollTop;
  }

  updated() {
    const list = this.renderRoot.querySelector(".log-list");
    if (!list) return;
    const st = this._state[this._tab];
    if (list.clientHeight && list.clientHeight !== this._viewport) {
      this._viewport = list.clientHeight;
      this.requestUpdate();
    }
    // zmierz narysowane wiersze (zawijanie linii zmienia wysokość)
    const anchor = this._win.start;
    const before = st.heights.offsetOf(anchor);
    let changed = false;
    list.querySelectorAll(".line").forEach((el) => {
      if (st.heights.set(Number(el.dataset.i), el.offsetHeight)) changed = true;
    });
    if (changed) {
      const delta = st.heights.offsetOf(anchor) - before;
      if (delta && !this._autoScroll && list.scrollTop > 0) {
        list.scrollTop += delta;
        this._scrollTop = list.scrollTop;
      }
      this.requestUpdate();
    }
    if (this._autoScroll) this._scrollToBottom();
    // dociągnij treść widocznych wierszy
    const missing = st.cache.missing(st.index, this._win.start, this._win.end);
    if (missing.length) this._fetchLines(st, this._tab, missing);
  }

  _onScroll(event) {
    const list = event.target;
    this._scrollTop = list.scrollTop;
    // ręczne przewinięcie wyłącza śledzenie, żeby lista nie uciekała spod palca
    if (Date.now() > this._programmaticUntil) {
      const atBottom = isAtBottom(list.scrollTop, list.clientHeight, list.scrollHeight, 8);
      if (!atBottom && this._autoScroll) this._autoScroll = false;
    }
    this.requestUpdate();
  }

  /* ── widok ────────────────────────────────────────────────── */

  _levelClass(level) {
    if (level === "E" || level === "C") return "lvl-error";
    if (level === "W") return "lvl-warn";
    return "";
  }

  _renderDeviceControls() {
    const dev = (this._status && this._status.device) || {};
    const api = dev.firmware_api_enabled;
    return html`
      <div class="controls">
        <mesh-toggle
          .label=${"Zbieranie logów urządzenia"}
          .description=${"Gdy włączone, integracja zapisuje w pamięci rekordy logu wysyłane przez radio (do 25 000 ostatnich — rozmiar bufora wybierasz poniżej). Przez Bluetooth włącza też odbiór logów z radia."}
          .checked=${dev.collecting !== false}
          @change=${(e) => this._setCollecting(e.detail.checked)}
        ></mesh-toggle>
        <mesh-toggle
          .label=${"Logi debugowania w radiu"}
          .description=${"Ustawienie „Logi debugowania” (API dziennika debugowania) w konfiguracji zabezpieczeń radia. Bez niego radio nie wysyła logów. Zmiana zapisuje konfigurację i może zrestartować radio."}
          .checked=${api === true}
          @change=${(e) => this._setFirmwareApi(e.detail.checked)}
        ></mesh-toggle>
        <div class="note ${dev.any_firmware === false ? "note-warn" : ""}">
          ${dev.any_firmware === true
            ? "To połączenie Bluetooth — logi urządzenia działają z każdym firmware."
            : dev.any_firmware === false
              ? "To połączenie Wi-Fi/TCP lub USB (port szeregowy) — logi urządzenia działają tylko z firmware MT_SW. Przez Bluetooth działają z każdym firmware."
              : "Przez Bluetooth logi działają z każdym firmware, a przez Wi-Fi i USB tylko z firmware MT_SW."}
        </div>
      </div>
    `;
  }

  _renderIntegrationControls() {
    const info = (this._status && this._status.integration) || {};
    return html`
      <div class="controls">
        <mesh-toggle
          .label=${"Zbieraj także poziom DEBUG"}
          .description=${"Domyślnie widać wpisy zapisywane przez Home Assistant (zwykle od poziomu INFO). Włączenie podnosi poziom logowania integracji do DEBUG — te wpisy trafią też do głównego logu Home Assistanta. Ustawienie znika po przeładowaniu integracji."}
          .checked=${info.debug_capture === true}
          @change=${(e) => this._setDebugCapture(e.detail.checked)}
        ></mesh-toggle>
      </div>
    `;
  }

  _renderList() {
    const st = this._state[this._tab];
    if (!st.index.length) {
      const total = st.meta ? st.meta.count : 0;
      return html`<div class="empty">
        ${total > 0
          ? "Żaden wpis nie pasuje do filtrów."
          : this._tab === "device"
            ? DEVICE_EMPTY
            : INTEGRATION_EMPTY}
      </div>`;
    }
    const win = computeWindow(st.heights, this._scrollTop, this._viewport, OVERSCAN_PX);
    this._win = win;
    const rows = [];
    for (let i = win.start; i < win.end; i += 1) {
      const entry = st.cache.get(st.index.idAt(i));
      rows.push(
        entry
          ? html`<div class="line ${this._levelClass(entry.level)}" data-i=${i}>${formatLine(entry)}</div>`
          : html`<div class="line pending" data-i=${i}>…</div>`
      );
    }
    return html`<div class="log-list" @scroll=${(e) => this._onScroll(e)}>
      <div class="vspacer" style="height:${win.total}px">
        <div class="vrows" style="transform:translateY(${win.offset}px)">${rows}</div>
      </div>
    </div>`;
  }

  render() {
    const st = this._state[this._tab];
    const levels = this._allLevels();
    const active = st.levels || new Set(levels);
    const meta = st.meta || {};
    const shown = st.index.length;
    const capacity = this._capacity || meta.capacity || 25000;
    const busy = Boolean(this._exporting);
    return html`
      <div class="settings-panel">
        <div class="settings-panel-header">
          <h3>Debugowanie</h3>
          <p>Dwa osobne logi: z urządzenia (firmware radia) i z samej integracji.</p>
        </div>
        <div class="settings-panel-body">
          <div class="segments">
            <button class="seg ${this._tab === "device" ? "on" : ""}" @click=${() => this._switchTab("device")}>Urządzenie</button>
            <button class="seg ${this._tab === "integration" ? "on" : ""}" @click=${() => this._switchTab("integration")}>Integracja</button>
          </div>

          ${this._error ? html`<div class="error">${this._error}</div>` : ""}
          ${this._tab === "device" ? this._renderDeviceControls() : this._renderIntegrationControls()}

          <div class="toolbar">
            <input
              class="search"
              type="search"
              placeholder="Szukaj w logach"
              .value=${st.query}
              @input=${(e) => this._onQueryInput(e.target.value)}
            />
            <div class="chips">
              ${levels.map(
                (level) => html`<button
                  class="chip ${active.has(level) ? "on" : ""}"
                  title=${LEVEL_NAMES[level]}
                  @click=${() => this._toggleLevel(level)}
                >${level}</button>`
              )}
            </div>
          </div>

          <div class="toolbar">
            <label class="check">
              <input
                type="checkbox"
                .checked=${this._autoScroll}
                @change=${(e) => {
                  this._autoScroll = e.target.checked;
                  if (this._autoScroll) this._scrollToBottom();
                }}
              />
              Przewijaj automatycznie
            </label>
            <span class="count">${thousands(shown)} / ${thousands(meta.count ?? shown)} (maks. ${thousands(meta.capacity ?? capacity)})</span>
            <label class="cap" title="Ile ostatnich wpisów każdego logu trzyma integracja w pamięci. Zmniejszenie usuwa najstarsze.">
              <span>Bufor</span>
              <select .value=${String(capacity)} @change=${(e) => this._onCapacityChange(e.target.value)}>
                ${CAPACITY_CHOICES.map(
                  (size) => html`<option value=${size} ?selected=${size === capacity}>${thousands(size)}</option>`
                )}
              </select>
            </label>
            <span class="spacer"></span>
            ${busy ? html`<span class="count">Pobieranie… ${thousands(this._exporting.done)} / ${thousands(this._exporting.total)}</span>` : ""}
            <button class="btn" ?disabled=${!shown || busy} @click=${() => this._copy()}>
              <ha-icon icon=${this._copied ? "mdi:check" : "mdi:content-copy"}></ha-icon>${this._copied ? "Skopiowano" : "Kopiuj"}
            </button>
            <button class="btn" ?disabled=${!shown || busy} @click=${() => this._download()}>
              <ha-icon icon="mdi:download"></ha-icon>Pobierz .txt
            </button>
            <button class="btn danger" ?disabled=${!(meta.count > 0)} @click=${() => { this._clearConfirm = true; }}>
              <ha-icon icon="mdi:trash-can-outline"></ha-icon>Wyczyść logi
            </button>
          </div>

          ${this._renderList()}
          ${this._tab === "device" && shown
            ? html`<div class="note">Eksport i kopia obejmują cały przefiltrowany bufor (nie tylko to, co widać na liście). Log urządzenia może zawierać szczegóły węzłów i fragmenty wiadomości — sprawdź go przed publicznym udostępnieniem.</div>`
            : shown
              ? html`<div class="note">Eksport i kopia obejmują cały przefiltrowany bufor (nie tylko to, co widać na liście). Zbyt długie linie są w buforze skracane.</div>`
              : ""}
        </div>
      </div>

      <mesh-confirm-dialog
        .open=${this._clearConfirm}
        .title=${"Wyczyścić logi?"}
        .message=${"Wszystkie zebrane wpisy tego logu zostaną usunięte z pamięci integracji. Zbieranie trwa dalej."}
        .confirmLabel=${"Wyczyść logi"}
        .danger=${true}
        @confirm=${() => { this._clearConfirm = false; this._clear(); }}
        @cancel=${() => { this._clearConfirm = false; }}
      ></mesh-confirm-dialog>

      <mesh-confirm-dialog
        .open=${this._capConfirm !== null}
        .title=${"Zmniejszyć bufory logów?"}
        .message=${`Oba logi (urządzenia i integracji) zostaną zmniejszone do ${thousands(this._capConfirm || 0)} wpisów. Najstarsze wpisy ponad ten limit zostaną usunięte z pamięci.`}
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
      css`
        :host { display: block; }
        .segments { display: flex; gap: 0; margin-bottom: 12px; }
        .seg {
          flex: 1; padding: 8px 12px; cursor: pointer; font-size: 14px;
          border: 1px solid var(--divider-color); background: transparent;
          color: var(--primary-text-color);
        }
        .seg:first-child { border-radius: 8px 0 0 8px; }
        .seg:last-child { border-radius: 0 8px 8px 0; border-left: none; }
        .seg.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
        .controls { margin-bottom: 8px; }
        .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
        .spacer { flex: 1; }
        .search {
          flex: 1; min-width: 160px; padding: 8px 10px; font-size: 14px;
          border: 1px solid var(--divider-color); border-radius: 8px;
          background: var(--card-background-color); color: var(--primary-text-color);
        }
        .chips { display: flex; gap: 4px; }
        .chip {
          min-width: 32px; padding: 6px 8px; cursor: pointer; font-size: 12px; font-weight: 600;
          border: 1px solid var(--divider-color); border-radius: 16px; background: transparent;
          color: var(--secondary-text-color);
        }
        .chip.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        .check { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
        .count { font-size: 12px; color: var(--secondary-text-color); }
        .btn {
          display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; cursor: pointer;
          font-size: 13px; border: 1px solid var(--divider-color); border-radius: 8px;
          background: transparent; color: var(--primary-text-color);
        }
        .btn ha-icon { --mdc-icon-size: 18px; }
        .btn[disabled] { opacity: 0.5; cursor: default; }
        .btn.danger { color: var(--error-color, #f44336); }
        .log-list {
          height: calc(var(--mtsw-tab-height, calc(100vh - 105px)) - 330px);
          min-height: 240px;
          overflow: auto;
          overflow-anchor: none;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          user-select: text;
        }
        .line {
          padding: 2px 8px;
          font-family: var(--code-font-family, monospace);
          font-size: 11px;
          white-space: pre-wrap;
          word-break: break-word;
          border-bottom: 1px solid var(--divider-color);
        }
        .vspacer { position: relative; }
        .vrows { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }
        .line.pending { color: var(--secondary-text-color); }
        .cap { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--secondary-text-color); }
        .cap select {
          padding: 4px 6px; font-size: 12px; font-family: inherit;
          border: 1px solid var(--divider-color); border-radius: 8px;
          background: var(--card-background-color); color: var(--primary-text-color);
        }
        .line.lvl-error { color: var(--error-color, #f44336); }
        .line.lvl-warn { color: var(--warning-color, #ff9800); }
        .empty { padding: 24px 16px; text-align: center; font-size: 13px; color: var(--secondary-text-color); border: 1px dashed var(--divider-color); border-radius: 8px; }
        .note { margin-top: 6px; font-size: 12px; color: var(--secondary-text-color); }
        .note-warn { color: var(--warning-color, #ff9800); }
        .error {
          background: rgba(244,67,54,0.1); border: 1px solid rgba(244,67,54,0.3);
          border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; color: #f44336; font-size: 13px;
        }
      `,
    ];
  }
}

if (!customElements.get("mesh-settings-debug-logs")) {
  customElements.define("mesh-settings-debug-logs", MeshSettingsDebugLogs);
}
