// Drobne narzędzia wspólne dla modułów plannera (bez zależności od DOM).

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Liczba ze stałą liczbą miejsc po przecinku, '.' jako separator (port Num.fmt z Kotlina).
 * NaN/Infinity -> "0" / "0.00..".
 */
export function fmt(value, decimals) {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return decimals > 0 ? '0.' + '0'.repeat(Math.min(decimals, 9)) : '0';
  }
  const d = clamp(Math.trunc(decimals), 0, 9);
  let p = 1.0;
  for (let i = 0; i < d; i++) p *= 10.0;
  const a = Math.abs(value);
  if (a * p >= 9.0e15) {
    const s = a >= 9.0e18 ? '9223372036854775807' : BigInt(Math.trunc(a)).toString();
    return (value < 0 ? '-' : '') + s + (d > 0 ? '.' + '0'.repeat(d) : '');
  }
  const scaled = Math.floor(a * p + 0.5);
  const fp = scaled % p;
  const ip = (scaled - fp) / p;
  let out = '';
  if (value < 0 && scaled !== 0) out += '-';
  out += String(ip);
  if (d > 0) out += '.' + String(fp).padStart(d, '0');
  return out;
}

/** Jak fmt, ale bez zer końcowych i bez wiszącej kropki. */
export function fmtTrim(value, decimals) {
  const s = fmt(value, decimals);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** Prosty mutex (kolejka obietnic): run(fn) wykonuje fn po zakończeniu poprzednich. */
export class Mutex {
  constructor() { this._tail = Promise.resolve(); }
  run(fn) {
    const next = this._tail.then(fn, fn);
    // ogon nigdy nie odrzuca, żeby kolejne zadania mogły ruszyć
    this._tail = next.then(() => undefined, () => undefined);
    return next;
  }
}

/** Błąd anulowania (zgodny z DOMException AbortError, ale działa też w Node bez DOM). */
export function abortError(message = 'Aborted') {
  const e = new Error(message);
  e.name = 'AbortError';
  return e;
}

export const isAbortError = (e) => !!e && (e.name === 'AbortError' || e.code === 20);

export function throwIfAborted(signal) {
  if (signal && signal.aborted) throw signal.reason && isAbortError(signal.reason) ? signal.reason : abortError();
}

/** Oddaje sterowanie pętli zdarzeń (żeby worker/UI mogły obsłużyć wiadomości). */
export const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));
