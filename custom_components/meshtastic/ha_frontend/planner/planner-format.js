// Czyste funkcje pomocnicze UI plannera: liczby, współrzędne, osie wykresu (port PlannerInput / Formatting /
// ChartMath / Num z aplikacji na Androida). Bez DOM i bez zależności od silnika — łatwe do testowania w Node.

/** Liczba ze stałą liczbą miejsc po przecinku, '.' jako separator (jak Num.fmt w Kotlinie). NaN/Infinity -> "0.00". */
export function fmt(value, decimals) {
  const d = Math.min(9, Math.max(0, Math.trunc(decimals)));
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return d > 0 ? `0.${'0'.repeat(d)}` : '0';
  }
  let p = 1;
  for (let i = 0; i < d; i++) p *= 10;
  const a = Math.abs(value);
  if (a * p >= 9.0e15) {
    const s = a >= 9.0e18 ? '9223372036854775807' : BigInt(Math.trunc(a)).toString();
    return (value < 0 ? '-' : '') + s + (d > 0 ? `.${'0'.repeat(d)}` : '');
  }
  const scaled = Math.floor(a * p + 0.5);
  const fp = scaled % p;
  const ip = (scaled - fp) / p;
  let out = '';
  if (value < 0 && scaled !== 0) out += '-';
  out += String(ip);
  if (d > 0) out += `.${String(fp).padStart(d, '0')}`;
  return out;
}

/** Jak fmt, ale bez zer końcowych (i bez wiszącej kropki). */
export function fmtTrim(value, decimals) {
  const s = fmt(value, decimals);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function fmtSigned(value, decimals) {
  return (value > 0 ? '+' : '') + fmt(value, decimals);
}

/** "850 m" lub "12.34 km". */
export function fmtDistance(meters, unitM = 'm', unitKm = 'km') {
  return meters < 1000 ? `${fmt(meters, 0)} ${unitM}` : `${fmt(meters / 1000, 2)} ${unitKm}`;
}

/** Kolor werdyktu (stałe, czytelne w jasnym i ciemnym motywie). */
export function verdictColor(verdict) {
  switch (verdict) {
    case 'EXCELLENT': return '#2e9e4f';
    case 'GOOD': return '#5cb85c';
    case 'MARGINAL': return '#e0b400';
    case 'WEAK': return '#ef7c00';
    default: return '#d32f2f';
  }
}

export function verdictKey(verdict) {
  switch (verdict) {
    case 'EXCELLENT': return 'verdict_excellent';
    case 'GOOD': return 'verdict_good';
    case 'MARGINAL': return 'verdict_marginal';
    case 'WEAK': return 'verdict_weak';
    default: return 'verdict_no_link';
  }
}

export function itmModeKey(mode) {
  switch (mode) {
    case 'LINE_OF_SIGHT': return 'itm_mode_los';
    case 'DIFFRACTION': return 'itm_mode_diffraction';
    case 'TROPOSCATTER': return 'itm_mode_troposcatter';
    default: return 'itm_mode_unknown';
  }
}

export function ductingKey(level) {
  switch (level) {
    case 'ELEVATED': return 'ducting_elevated';
    case 'POSSIBLE_DUCT': return 'ducting_possible';
    default: return 'ducting_normal';
  }
}

export function clutterPresetKey(id) {
  switch (id) {
    case 'RURAL_OPEN': return 'clutter_rural_open';
    case 'FOREST_LIGHT': return 'clutter_forest_light';
    case 'FOREST_DENSE': return 'clutter_forest_dense';
    case 'SUBURBAN': return 'clutter_suburban';
    case 'URBAN': return 'clutter_urban';
    case 'CUSTOM': return 'clutter_custom';
    default: return 'clutter_none';
  }
}

export function errorKey(code) {
  switch (code) {
    case 'ELEVATION_OFFLINE': return 'error_elevation_offline';
    case 'ELEVATION_DECODE': return 'error_elevation_decode';
    case 'POINTS_TOO_CLOSE': return 'error_points_too_close';
    case 'COVERAGE_NEEDS_POINT': return 'error_coverage_needs_point';
    default: return 'error_compute_failed';
  }
}

export function feederPresetKey(id) {
  switch (id) {
    case 'direct': return 'feeder_preset_direct';
    case 'adapter_sma_n': return 'feeder_preset_adapter_sma_n';
    case 'adapter_n_n': return 'feeder_preset_adapter_n_n';
    case 'pigtail': return 'feeder_preset_pigtail';
    case 'pigtail_cable': return 'feeder_preset_pigtail_cable';
    case 'long_lmr400': return 'feeder_preset_long_lmr400';
    case 'ecoflex_roof': return 'feeder_preset_ecoflex_roof';
    case 'heliax_mast': return 'feeder_preset_heliax_mast';
    default: return 'feeder_preset_custom';
  }
}

/** Kod ostrzeżenia feedera -> klucz napisu. */
export function feederWarningKey(code) {
  if (code === 'SECTION_COUNT_MISMATCH') return 'feeder_warn_sections';
  if (code === 'CONNECTOR_COUNT_EXCEEDS_MAX') return 'feeder_warn_too_many';
  if (code.startsWith('UNKNOWN_')) return 'feeder_warn_unknown';
  if (code === 'CUSTOM_LOSS_MISSING') return 'feeder_warn_custom_loss';
  if (code === 'INVALID_LENGTH') return 'feeder_warn_length';
  if (code === 'FREQUENCY_CLAMPED') return 'feeder_warn_frequency';
  return 'feeder_warn_other';
}

/** "custom · 3 m" -> "<własny kabel> · 3 m" (etykiety z computeFeeder są angielskie/techniczne). */
export function localizeFeederLabel(label, customLabel) {
  return label.startsWith('custom ') ? customLabel + label.slice('custom'.length) : label;
}

// ---- liczby i współrzędne wpisywane przez użytkownika ----

const NUMBER_CHARS = '+-.eE';

/**
 * Liczba dziesiętna: "12,5" i "12.5" dają 12.5; gdy są oba znaki, ostatni jest przecinkiem dziesiętnym
 * ("1.234,5" = 1234.5). null dla pustego, błędnego, NaN i nieskończoności.
 */
export function parseNumber(text) {
  const s0 = String(text ?? '').replace(/[\s  ]/g, '');
  if (!s0) return null;
  const lastDot = s0.lastIndexOf('.');
  const lastComma = s0.lastIndexOf(',');
  let s;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    s = `${s0.slice(0, dec).replace(/[.,]/g, '')}.${s0.slice(dec + 1)}`;
  } else if (lastComma >= 0) {
    s = s0.replace(/,/g, '.');
  } else {
    s = s0;
  }
  if ((s.match(/\./g) || []).length > 1) return null;
  for (const ch of s) {
    if (!((ch >= '0' && ch <= '9') || NUMBER_CHARS.includes(ch))) return null;
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

const isHemisphere = (c) => 'NSEWnsew'.includes(c);

function parseDms(input) {
  const s = input.replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/[º˚]/g, '°').trim();
  const degEnd = s.indexOf('°');
  if (degEnd <= 0) return null;
  const negative = s.startsWith('-');
  const degRaw = parseNumber(s.slice(0, degEnd));
  if (degRaw === null) return null;
  const deg = Math.abs(degRaw);
  let rest = s.slice(degEnd + 1).trim();
  let minutes = 0;
  let seconds = 0;
  if (rest) {
    const mEnd = rest.indexOf("'");
    if (mEnd < 0) return null;
    const m = parseNumber(rest.slice(0, mEnd));
    if (m === null) return null;
    minutes = m;
    rest = rest.slice(mEnd + 1).trim();
    if (rest.endsWith('"')) rest = rest.slice(0, -1).trim();
    if (rest) {
      const sec = parseNumber(rest);
      if (sec === null) return null;
      seconds = sec;
    }
  }
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  const v = deg + minutes / 60 + seconds / 3600;
  return negative ? -v : v;
}

/**
 * Szerokość (isLatitude) lub długość geograficzna: liczba, liczba z literą półkuli ("52.1N", "S 12,5", "19.2 E")
 * albo stopnie-minuty-sekundy ("52°12'30\"N"). Litera złej osi albo litera z liczbą ujemną -> null.
 */
export function parseCoordinate(text, isLatitude) {
  let s = String(text ?? '').trim();
  if (!s) return null;
  let hemisphere = null;
  if (isHemisphere(s[0])) {
    hemisphere = s[0].toUpperCase();
    s = s.slice(1).trim();
  } else if (isHemisphere(s[s.length - 1])) {
    hemisphere = s[s.length - 1].toUpperCase();
    s = s.slice(0, -1).trim();
  }
  let sign = 1;
  if (hemisphere) {
    const latitudeLetter = hemisphere === 'N' || hemisphere === 'S';
    if (latitudeLetter !== isLatitude) return null;
    if (hemisphere === 'S' || hemisphere === 'W') sign = -1;
  }
  const raw = /[°º˚]/.test(s) ? parseDms(s) : parseNumber(s);
  if (raw === null) return null;
  if (hemisphere && raw < 0) return null;
  const v = sign * raw;
  const limit = isLatitude ? 90 : 180;
  return Math.abs(v) > limit ? null : v;
}

/**
 * Wklejona para "szerokość, długość": separatory ';', ", " lub białe znaki albo pojedynczy przecinek między
 * dwiema liczbami z kropką. Gdy pierwsza wartość nie może być szerokością, kolejność jest zamieniana.
 * @returns {[number, number]|null} [lat, lon]
 */
export function parseLatLonPair(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  let parts;
  if (t.includes(';')) {
    parts = t.split(';');
  } else {
    const bySpace = t.split(/\s*,\s+|\s+/);
    if (bySpace.length === 2) parts = bySpace;
    else if ((t.match(/,/g) || []).length === 1) parts = t.split(',');
    else parts = bySpace;
  }
  parts = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length !== 2) return null;
  const lat = parseCoordinate(parts[0], true);
  const lon = parseCoordinate(parts[1], false);
  if (lat !== null && lon !== null) return [lat, lon];
  const lon2 = parseCoordinate(parts[0], false);
  const lat2 = parseCoordinate(parts[1], true);
  return lat2 !== null && lon2 !== null ? [lat2, lon2] : null;
}

export function formatCoordinates(lat, lon, decimals = 5) {
  return `${fmt(lat, decimals)}, ${fmt(lon, decimals)}`;
}

/** Liczba do pola tekstowego: najwyżej `decimals` cyfr, bez zer końcowych, kropka. */
export function formatField(value, decimals) {
  return fmtTrim(value, decimals);
}

export function formatWatts(watts) {
  return fmtTrim(watts, watts >= 1 ? 2 : 4);
}

/** Czy pole tekstowe i model to ta sama wartość. */
export function sameValue(a, b) {
  return Math.abs(a - b) <= 1.0e-6 * Math.max(1, Math.max(Math.abs(a), Math.abs(b)));
}

// ---- osie wykresów (ChartMath.kt) ----

/** Najbliższy krok 1-2-5. */
export function niceStep(raw) {
  if (!(raw > 0) || Number.isNaN(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const factor = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return factor * mag;
}

/** Ładne podziałki osi w [lo, hi], około `target` sztuk. */
export function niceTicks(lo, hi, target) {
  const span = hi - lo;
  if (Number.isNaN(span) || span <= 0 || target < 1) return [lo];
  const step = niceStep(span / target);
  const out = [];
  let t = Math.ceil(lo / step) * step;
  let guard = 0;
  while (t <= hi + step * 1.0e-9 && guard < 1000) {
    out.push(Math.abs(t) < step * 1.0e-9 ? 0 : t);
    t += step;
    guard++;
  }
  return out;
}

/** Miejsca po przecinku potrzebne, by wydrukować wielokrotności `step`. */
export function decimalsFor(step) {
  if (Number.isNaN(step) || step <= 0 || step >= 1) return 0;
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1.0e-9)));
}

/** Indeks próbki rosnącej tablicy `distances` najbliższej x. */
export function nearestIndex(distances, x) {
  if (!distances || distances.length === 0) return 0;
  let best = 0;
  let bestDiff = Math.abs(distances[0] - x);
  for (let i = 1; i < distances.length; i++) {
    const diff = Math.abs(distances[i] - x);
    if (diff < bestDiff) { best = i; bestDiff = diff; }
  }
  return best;
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Znacznik czasu do nazwy pliku: yyyyMMdd_HHmmss (UTC). */
export function fileStamp(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** "yyyy-MM-dd HH:mm" (UTC). */
export function formatUtcMinute(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
