/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Czyste pomocniki dużych logów (do 25 000 wpisów) — bez DOM-u, żeby dały się testować.
 *
 *  - IdIndex   : zwarty indeks numerów wpisów, które przechodzą filtr. Bez filtra
 *                to po prostu zakres first_id..last_id (nic nie jest przesyłane),
 *                z filtrem — lista numerów z serwera, dopisywana przyrostowo.
 *  - LineCache : podręczna pamięć treści wierszy (numer → wpis) o ograniczonym rozmiarze.
 *  - collectChunks / streamPages : składanie eksportu porcjami z oddawaniem
 *                sterowania przeglądarce, żeby zakładka się nie zawieszała.
 */

export class IdIndex {
  constructor() {
    this.reset();
  }

  reset() {
    this.mode = "all"; // "all": zakres first..last; "ids": jawna lista
    this.ids = [];
    this.firstId = 1;
    this.lastId = 0;
  }

  get length() {
    return this.mode === "all" ? Math.max(0, this.lastId - this.firstId + 1) : this.ids.length;
  }

  idAt(index) {
    if (index < 0 || index >= this.length) {
      return null;
    }
    return this.mode === "all" ? this.firstId + index : this.ids[index];
  }

  /* Pozycja numeru w indeksie albo -1. */
  indexOf(id) {
    if (this.mode === "all") {
      return id >= this.firstId && id <= this.lastId ? id - this.firstId : -1;
    }
    let low = 0;
    let high = this.ids.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const value = this.ids[mid];
      if (value === id) {
        return mid;
      }
      if (value < id) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return -1;
  }

  /*
   * Odpowiedź debug_logs_index: { ids: [..] | null, first_id, last_id }.
   * ids === null → brak filtra (zakres); tablica → pasujące numery nowsze niż poprzednio.
   * Zwraca liczbę dopisanych wierszy.
   */
  apply(res) {
    const before = this.length;
    if (res.ids === null || res.ids === undefined) {
      this.mode = "all";
      this.ids = [];
      this.firstId = res.first_id;
      this.lastId = res.last_id;
      return Math.max(0, this.length - before);
    }
    if (this.mode !== "ids") {
      this.mode = "ids";
      this.ids = [];
    }
    for (const id of res.ids) {
      this.ids.push(id);
    }
    this.firstId = res.first_id;
    this.lastId = res.last_id;
    // wypchnięte z bufora po stronie serwera
    if (this.ids.length && this.ids[0] < res.first_id) {
      let low = 0;
      let high = this.ids.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (this.ids[mid] < res.first_id) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }
      this.ids = this.ids.slice(low);
    }
    return res.ids.length;
  }
}

export class LineCache {
  constructor(limit = 4000) {
    this.limit = limit;
    this._map = new Map();
  }

  get size() {
    return this._map.size;
  }

  clear() {
    this._map.clear();
  }

  get(id) {
    return this._map.get(id);
  }

  has(id) {
    return this._map.has(id);
  }

  put(entry) {
    this._map.delete(entry.id);
    this._map.set(entry.id, entry);
    while (this._map.size > this.limit) {
      this._map.delete(this._map.keys().next().value);
    }
  }

  putAll(entries) {
    for (const entry of entries) {
      this.put(entry);
    }
  }

  /* Numery z zakresu indeksu [start, end), których treści jeszcze nie mamy. */
  missing(index, start, end) {
    const out = [];
    const stop = Math.min(end, index.length);
    for (let i = Math.max(0, start); i < stop; i += 1) {
      const id = index.idAt(i);
      if (id !== null && !this._map.has(id)) {
        out.push(id);
      }
    }
    return out;
  }
}

export const defaultYield = () => new Promise((resolve) => setTimeout(resolve, 0));

/*
 * Eksport po numerach z indeksu: pobiera treść porcjami po `chunkSize`, zamienia
 * każdą porcję na tekst i zwraca tablicę kawałków (do `new Blob(chunks)`) —
 * nigdy jednego wielkiego łańcucha. `fetchEntries(ids) -> Promise<entry[]>`.
 */
export async function collectChunks(index, { chunkSize = 1000, fetchEntries, format, onProgress, yieldFn = defaultYield, shouldCancel }) {
  const chunks = [];
  const total = index.length;
  for (let start = 0; start < total; start += chunkSize) {
    if (shouldCancel && shouldCancel()) {
      return null;
    }
    const ids = [];
    for (let i = start; i < Math.min(total, start + chunkSize); i += 1) {
      ids.push(index.idAt(i));
    }
    const entries = await fetchEntries(ids);
    chunks.push(entries.map(format).join("\n") + (entries.length ? "\n" : ""));
    if (onProgress) {
      onProgress(Math.min(total, start + chunkSize), total);
    }
    await yieldFn();
  }
  return chunks;
}

/*
 * Eksport stronami z serwera (sniffer_entries): fetchPage(after) → { entries, next, done }.
 * format(entries, first) zwraca tekst porcji; first = czy to pierwsza niepusta porcja
 * (do przecinków w JSON-ie); footer może być funkcją (count) => tekst.
 * Zwraca { chunks, count } albo null przy anulowaniu.
 */
export async function streamPages({ fetchPage, format, header = "", footer = "", onProgress, yieldFn = defaultYield, shouldCancel }) {
  const chunks = [header];
  let after = 0;
  let count = 0;
  for (;;) {
    if (shouldCancel && shouldCancel()) {
      return null;
    }
    const page = await fetchPage(after);
    if (page.entries.length) {
      chunks.push(format(page.entries, count === 0));
      count += page.entries.length;
    }
    after = page.next;
    if (onProgress) {
      onProgress(count);
    }
    if (page.done) {
      break;
    }
    await yieldFn();
  }
  chunks.push(typeof footer === "function" ? footer(count) : footer);
  return { chunks, count };
}
