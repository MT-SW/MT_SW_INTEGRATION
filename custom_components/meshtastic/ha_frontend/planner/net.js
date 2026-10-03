// Wspólna warstwa sieciowa plannera (Mapterhorn, Open-Meteo, Overpass).
//
// 1. Zapytania idą w trybie CORS bez ciasteczek i bez nagłówka Referer (`credentials: 'omit'`,
//    `referrerPolicy: 'no-referrer'`) — strona Home Assistanta nie wycieka do zewnętrznych serwerów,
//    a żadne dodatkowe nagłówki nie wywołują zapytania preflight (poza `Range` dla PMTiles).
// 2. Gdy bezpośrednie zapytanie kończy się TypeError (CORS / mixed content / CSP / brak sieci),
//    a panel zainstalował proxy (setPlannerProxy), to samo zapytanie idzie przez backend integracji
//    (POST /api/meshtastic/planner/proxy, tylko administrator, lista dozwolonych hostów).
//    Po pierwszej takiej porażce host jest „przyklejony” do proxy, żeby nie powtarzać nieudanych zapytań.
import { isAbortError } from './util.js';

export const PLANNER_PROXY_PATH = '/api/meshtastic/planner/proxy';

/** Hosty, do których backend pozwala pośredniczyć (musi się zgadzać z planner_proxy.py). */
export const PLANNER_PROXY_HOSTS = Object.freeze([
  'overpass-api.de', 'overpass.private.coffee', 'overpass.kumi.systems', 'api.open-meteo.com', 'download.mapterhorn.com',
]);

let proxy = null;
const stickyHosts = new Set();

/** Instaluje (albo usuwa, gdy null) funkcję proxy `(url, init) => Promise<Response>`. */
export function setPlannerProxy(fn) {
  proxy = typeof fn === 'function' ? fn : null;
  stickyHosts.clear();
}

export const hasPlannerProxy = () => proxy !== null;

export function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

/** Domyślne opcje bezpośredniego zapytania; wywołujący może je nadpisać. */
export function withDefaults(init) {
  return { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', ...(init || {}) };
}

/**
 * fetch z awaryjnym przejściem przez proxy backendu.
 * @param {typeof fetch} fetchImpl  zwykle globalThis.fetch (w testach atrapa)
 * @returns {Promise<Response>} odpowiedź + pole `viaProxy` (true, gdy poszła przez backend)
 */
export async function plannerFetch(fetchImpl, url, init = {}) {
  const host = hostOf(url);
  if (proxy && stickyHosts.has(host)) return viaProxy(url, init, host, null);
  try {
    return await fetchImpl(url, withDefaults(init));
  } catch (e) {
    if (!proxy || isAbortError(e) || !(e instanceof TypeError)) throw e;
    stickyHosts.add(host);
    return viaProxy(url, init, host, e);
  }
}

async function viaProxy(url, init, host, original) {
  try {
    const res = await proxy(url, init);
    try { res.viaProxy = true; } catch { /* odpowiedź tylko do odczytu — trudno */ }
    return res;
  } catch (e) {
    if (isAbortError(e)) throw e;
    // proxy nie działa (np. brak uprawnień administratora) — nie przyklejamy hosta na stałe
    stickyHosts.delete(host);
    if (original) {
      original.proxyError = e;
      throw original;
    }
    throw e;
  }
}

/**
 * Proxy przez backend integracji. `getHass` zwraca bieżący obiekt hass (zmienia się przy każdej aktualizacji).
 * Odpowiedź backendu ma status 200 z nagłówkiem X-Upstream-Status; odtwarzamy z niej zwykłą Response.
 */
export function createHassProxy(getHass) {
  return async (url, init = {}) => {
    const hass = getHass();
    if (!hass || typeof hass.fetchWithAuth !== 'function') throw new Error('no hass.fetchWithAuth');
    const headers = {};
    if (init.headers) {
      const range = init.headers.Range || init.headers.range;
      if (range) headers.Range = range;
    }
    const payload = { url, method: init.method || 'GET', headers };
    if (init.body !== undefined && init.body !== null) payload.body = String(init.body);
    const res = await hass.fetchWithAuth(PLANNER_PROXY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: init.signal,
    });
    if (!res.ok) {
      let text = '';
      try { text = (await res.text()).slice(0, 200); } catch { /* brak treści */ }
      throw new Error(`proxy HTTP ${res.status} ${text}`.trim());
    }
    const upstream = Number(res.headers.get('X-Upstream-Status')) || 200;
    const noBody = upstream === 101 || upstream === 204 || upstream === 205 || upstream === 304;
    return new Response(noBody ? null : await res.arrayBuffer(), {
      status: upstream,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' },
    });
  };
}
