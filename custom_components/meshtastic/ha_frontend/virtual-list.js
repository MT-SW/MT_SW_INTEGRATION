/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Matematyka listy wirtualnej (okienkowej) dla długich logów.
 *
 * Panel pokazuje do 25 000 wierszy, więc w DOM trafiają tylko te widoczne plus
 * zapas (overscan). Wiersze mają różne wysokości (karta zwinięta / rozwinięta,
 * zawijane linie logu), dlatego trzymamy zmierzone wysokości i szacujemy
 * resztę średnią zmierzonych. Moduł nie dotyka DOM-u — łatwo go testować.
 */

export class HeightMap {
  constructor(estimate = 60) {
    this.estimate = estimate;
    this._heights = new Float64Array(0);
    this._offsets = new Float64Array(1);
    this._count = 0;
    this._dirty = true;
    this._sum = 0;
    this._measured = 0;
  }

  get count() {
    return this._count;
  }

  /* Zmienia liczbę wierszy; zmierzone wysokości wierszy, które zostają, są zachowane. */
  setCount(count) {
    count = Math.max(0, count | 0);
    if (count === this._count) {
      return;
    }
    const next = new Float64Array(count);
    const keep = Math.min(count, this._count);
    next.set(this._heights.subarray(0, keep));
    this._heights = next;
    this._count = count;
    this._dirty = true;
    this._recount();
  }

  /* Zapomnij wszystkie pomiary (np. po zmianie filtra). */
  reset(count = 0) {
    this._heights = new Float64Array(Math.max(0, count | 0));
    this._count = this._heights.length;
    this._dirty = true;
    this._recount();
  }

  /* Wstaw `n` pustych wierszy na początku (lista rośnie od góry — nowe pakiety). */
  shift(n) {
    if (!n) {
      return;
    }
    if (n < 0) {
      // usunięcie n wierszy z początku
      const drop = Math.min(-n, this._count);
      this._heights = this._heights.slice(drop);
      this._count = this._heights.length;
    } else {
      const next = new Float64Array(this._count + n);
      next.set(this._heights, n);
      this._heights = next;
      this._count += n;
    }
    this._dirty = true;
    this._recount();
  }

  _recount() {
    let sum = 0;
    let measured = 0;
    for (let i = 0; i < this._count; i += 1) {
      if (this._heights[i] > 0) {
        sum += this._heights[i];
        measured += 1;
      }
    }
    this._sum = sum;
    this._measured = measured;
  }

  /* Zapisz zmierzoną wysokość; zwraca true, gdy się zmieniła (trzeba przeliczyć okno). */
  set(index, height) {
    if (index < 0 || index >= this._count || !(height > 0)) {
      return false;
    }
    const previous = this._heights[index];
    if (Math.abs(previous - height) < 0.5) {
      return false;
    }
    if (previous > 0) {
      this._sum += height - previous;
    } else {
      this._sum += height;
      this._measured += 1;
    }
    this._heights[index] = height;
    this._dirty = true;
    return true;
  }

  /* Wysokość wiersza: zmierzona albo szacunek (średnia dotychczasowych pomiarów). */
  get(index) {
    const known = this._heights[index];
    if (known > 0) {
      return known;
    }
    return this._measured ? this._sum / this._measured : this.estimate;
  }

  _rebuild() {
    if (!this._dirty) {
      return;
    }
    const offsets = new Float64Array(this._count + 1);
    const fallback = this._measured ? this._sum / this._measured : this.estimate;
    let acc = 0;
    for (let i = 0; i < this._count; i += 1) {
      offsets[i] = acc;
      acc += this._heights[i] > 0 ? this._heights[i] : fallback;
    }
    offsets[this._count] = acc;
    this._offsets = offsets;
    this._dirty = false;
  }

  /* Odległość górnej krawędzi wiersza od góry listy. */
  offsetOf(index) {
    this._rebuild();
    return this._offsets[Math.max(0, Math.min(index, this._count))];
  }

  total() {
    this._rebuild();
    return this._offsets[this._count];
  }

  /* Indeks wiersza, w którym leży współrzędna y (binarnie). */
  indexAt(y) {
    this._rebuild();
    if (this._count === 0) {
      return 0;
    }
    let low = 0;
    let high = this._count - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this._offsets[mid] <= y) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }
}

/*
 * Zakres wierszy do narysowania: [start, end) oraz przesunięcie pierwszego
 * z nich od góry listy. overscanPx to zapas nad i pod widocznym oknem.
 */
export function computeWindow(map, scrollTop, viewportHeight, overscanPx = 300) {
  const count = map.count;
  if (count === 0) {
    return { start: 0, end: 0, offset: 0, total: 0 };
  }
  const top = Math.max(0, scrollTop - overscanPx);
  const bottom = scrollTop + viewportHeight + overscanPx;
  const start = map.indexAt(top);
  let end = map.indexAt(bottom) + 1;
  end = Math.min(count, Math.max(end, start + 1));
  return { start, end, offset: map.offsetOf(start), total: map.total() };
}

/* Strony (po `pageSize` wierszy) potrzebne do pokrycia zakresu [start, end). */
export function pagesForRange(start, end, pageSize, total) {
  if (end <= start || pageSize <= 0) {
    return [];
  }
  const last = Math.min(end, total) - 1;
  if (last < start) {
    return [];
  }
  const pages = [];
  for (let page = Math.floor(start / pageSize); page <= Math.floor(last / pageSize); page += 1) {
    pages.push(page);
  }
  return pages;
}

/* Czy widok jest przy dolnej krawędzi (tolerancja w px) — do „przewijaj automatycznie”. */
export function isAtBottom(scrollTop, viewportHeight, scrollHeight, tolerance = 8) {
  return scrollHeight - scrollTop - viewportHeight <= tolerance;
}
