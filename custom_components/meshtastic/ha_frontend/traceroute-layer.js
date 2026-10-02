/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Traceroute na mapie z siłą sygnału — odpowiednik widoku z aplikacji na
 * Androida (TracerouteLayers.kt / TracerouteEdges.kt / determineSignalQuality).
 *
 * Plik ma trzy części:
 *  1. czysta logika (jakość sygnału, krawędzie trasy, dostępność mapy,
 *     geometria w pikselach) — bez DOM-u i bez Leafleta, testowalna w Node;
 *  2. warstwa Leafleta rysująca linie, strzałki i wartości SNR w SVG;
 *  3. kontroler (TracerouteOverlay) używany przez zakładkę Mapa oraz mały
 *     szablon przycisku "Pokaż na mapie" dla zakładki Węzły.
 *
 * Moduł nie zależy od warstwy statystyk integracji ani od panelu — dostaje
 * wszystko przez argumenty.
 */

import { html } from "./vendor/lit/lit-element.js";
import { t } from "./i18n.js";

/* ------------------------------------------------------------------ */
/* 1. Czysta logika                                                    */
/* ------------------------------------------------------------------ */

export const UNKNOWN_SNR = -128;

/* Jakość sygnału — te same nazwy, kolejność i kolory co Quality w aplikacji:
   dobry = złoty, wystarczający = czerwony, słaby = fioletowy, brak = biały.
   Biel i tak ma ciemną obwódkę (patrz renderowanie), więc widać ją na jasnej
   mapie. Nieznany SNR (brak pomiaru) to osobny, szary stan z etykietą "?". */
export const QUALITY = {
  GOOD: { id: "GOOD", color: "#EBB60C", labelKey: "map.traceroute.q_good" },
  FAIR: { id: "FAIR", color: "#F4212E", labelKey: "map.traceroute.q_fair" },
  BAD: { id: "BAD", color: "#B03CFF", labelKey: "map.traceroute.q_bad" },
  NONE: { id: "NONE", color: "#F2F2F2", labelKey: "map.traceroute.q_none" },
};
export const UNKNOWN_COLOR = "#9E9E9E";
export const QUALITY_ORDER = [QUALITY.GOOD, QUALITY.FAIR, QUALITY.BAD, QUALITY.NONE];

/* Współczynnik rozpiętości (SF) presetów — z ChannelOption.kt. Dolna granica
   demodulacji to -7.5 dB dla SF7 i o 2.5 dB niżej na każdy kolejny SF. */
const PRESET_SF = {
  VERY_LONG_SLOW: 12,
  LONG_TURBO: 11,
  LONG_FAST: 11,
  LONG_MODERATE: 11,
  LONG_SLOW: 12,
  MEDIUM_FAST: 9,
  MEDIUM_SLOW: 10,
  MEDIUM_TURBO: 9,
  SHORT_FAST: 7,
  SHORT_SLOW: 8,
  SHORT_TURBO: 7,
  LITE_FAST: 9,
  LITE_SLOW: 10,
  NARROW_FAST: 7,
  NARROW_SLOW: 8,
  TINY_FAST: 7,
  TINY_SLOW: 8,
};
const DEFAULT_PRESET = "LONG_FAST";
const SNR_FAIR_OFFSET = 5.5;
const SNR_BAD_OFFSET = 7.5;
const NARROW_BANDS = { good: -3, fair: -7, bad: -12 };
const LITE_BANDS = { good: -5, fair: -10, bad: -15 };

/** Dolna granica demodulacji presetu (dB); nieznany preset = domyślny (LongFast). */
export function snrLimit(preset) {
  const sf = PRESET_SF[preset] ?? PRESET_SF[DEFAULT_PRESET];
  return -7.5 - 2.5 * (sf - 7);
}

/** Progi SNR (dB) dla presetu: powyżej good = dobry, powyżej fair = wystarczający, od bad w górę = słaby. */
export function snrBands(preset) {
  if (preset === "NARROW_FAST" || preset === "NARROW_SLOW") {
    return NARROW_BANDS;
  }
  if (preset === "LITE_FAST" || preset === "LITE_SLOW") {
    return LITE_BANDS;
  }
  const limit = snrLimit(preset);
  return { good: limit, fair: limit - SNR_FAIR_OFFSET, bad: limit - SNR_BAD_OFFSET };
}

/** determineSignalQuality z aplikacji (sam SNR): zwraca jeden z QUALITY. */
export function determineSignalQuality(snr, preset) {
  const bands = snrBands(preset);
  if (snr > bands.good) {
    return QUALITY.GOOD;
  }
  if (snr > bands.fair) {
    return QUALITY.FAIR;
  }
  if (snr >= bands.bad) {
    return QUALITY.BAD;
  }
  return QUALITY.NONE;
}

/** Kolor odcinka: jakość SNR albo szary, gdy SNR nieznany (null). */
export function edgeColor(snrDb, preset) {
  return snrDb === null || snrDb === undefined ? UNKNOWN_COLOR : determineSignalQuality(snrDb, preset).color;
}

/** "-3.5 dB" albo "?" — jedno miejsce po przecinku, jak w aplikacji. */
export function snrLabel(snrDb) {
  return snrDb === null || snrDb === undefined ? "?" : `${snrDb.toFixed(1)} dB`;
}

/** Poprawna pozycja — tak samo jak w zakładce Mapa (skończone, w zakresie, nie 0/0). */
export function hasValidPosition(node) {
  return Boolean(
    node &&
      Number.isFinite(node.latitude) &&
      Number.isFinite(node.longitude) &&
      Math.abs(node.latitude) <= 90 &&
      Math.abs(node.longitude) <= 180 &&
      !(node.latitude === 0 && node.longitude === 0)
  );
}

function intList(value) {
  return Array.isArray(value) ? value.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
}

/**
 * Widok trasy z wyniku traceroute: pełne trasy (z obu końcami) i SNR.
 * Świeży wynik i wpis historii mają fullRoute/fullRouteBack z serwera; starsze
 * wpisy nie — wtedy końce dokładamy z bramki (origin) i węzła docelowego,
 * identycznie jak robi to lista tras w zakładce Węzły.
 */
export function buildTraceView(result, nodeId, gatewayId) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const route = intList(result.route);
  const routeBack = intList(result.routeBack);
  const snrTowards = intList(result.snrTowards);
  const snrBack = intList(result.snrBack);
  const origin = result.origin ?? gatewayId ?? null;
  const destination = result.destination ?? nodeId ?? null;

  let forward = intList(result.fullRoute);
  let back = intList(result.fullRouteBack);
  if (!forward.length && origin !== null && destination !== null) {
    forward = [origin, ...route, destination];
  }
  if (!back.length && origin !== null && destination !== null && (routeBack.length || snrBack.length)) {
    back = [destination, ...routeBack, origin];
  }
  return {
    id: `${destination}:${forward.join(",")}|${back.join(",")}|${snrTowards.join(",")}|${snrBack.join(",")}`,
    forward,
    back,
    snrTowards,
    snrBack,
    preset: result.modemPreset || null,
  };
}

/**
 * Dostępność mapy — evaluateTracerouteMapAvailability z aplikacji.
 * `positioned` to zbiór numerów węzłów z poprawną pozycją. Wynik:
 * "ok" | "missing_endpoints" | "missing_relays" | "no_mappable".
 */
export function evaluateTracerouteAvailability(forward, back, positioned) {
  const endpoints = [
    forward[0],
    forward[forward.length - 1],
    back[0],
    back[back.length - 1],
  ].filter((v) => v !== undefined);
  if (endpoints.some((id) => !positioned.has(id))) {
    return "missing_endpoints";
  }
  const related = new Set([...forward, ...back]);
  if (![...related].some((id) => positioned.has(id))) {
    return "no_mappable";
  }
  return [...related].every((id) => positioned.has(id)) ? "ok" : "missing_relays";
}

/** Klucz tłumaczenia powodu niedostępności (null = mapa dostępna). */
export function availabilityMessageKey(status) {
  switch (status) {
    case "missing_endpoints":
      return "map.traceroute.endpoint_missing";
    case "missing_relays":
      return "map.traceroute.relays_missing";
    case "no_mappable":
      return "map.traceroute.no_data";
    default:
      return null;
  }
}

/** Dostępność dla widoku trasy i listy węzłów panelu. */
export function traceAvailability(view, nodes) {
  const positioned = new Set((nodes || []).filter(hasValidPosition).map((n) => n.node_id));
  if (!view) {
    return "no_mappable";
  }
  return evaluateTracerouteAvailability(view.forward, view.back, positioned);
}

/**
 * Odcinki jednego kierunku. Odcinek i biegnie od route[i] do route[i+1];
 * SNR jest używalny tylko, gdy lista ma route.length-1 wpisów (w przeciwnym
 * razie wszystkie nieznane, jak w tekście traceroute). -128 = nieznany.
 * Odcinki z węzłem bez pozycji są pomijane.
 */
export function tracerouteEdges(route, snr, positions) {
  const usable = Array.isArray(snr) && snr.length === route.length - 1;
  const edges = [];
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = positions.get(route[i]);
    const b = positions.get(route[i + 1]);
    if (!a || !b) {
      continue;
    }
    const raw = usable ? snr[i] : UNKNOWN_SNR;
    edges.push({
      from: route[i],
      to: route[i + 1],
      a,
      b,
      snrDb: raw === UNKNOWN_SNR ? null : raw / 4,
    });
  }
  return edges;
}

/* Parametry rysowania (px), zgodne z TracerouteLayers.kt. */
export const GEOM = {
  startFraction: 0.04, // linia zaczyna się 4% za nadawcą
  endFraction: 0.93, // i kończy 7% przed odbiorcą
  separation: 3, // przesunięcie w prawo od kierunku jazdy
  lineWidth: 3,
  arrowLength: 11,
  arrowHalfWidth: 5,
  labelSide: 11, // środek napisu od własnej linii, na zewnątrz
};

/**
 * Geometria jednego odcinka w pikselach ekranu (oś y w dół).
 * Prawa strona kierunku jazdy to normalna (-uy, ux): jadąc na wschód
 * (1,0) prawa strona to południe (0,1). Dwa kierunki tej samej pary węzłów
 * dostają przeciwne normalne, więc leżą symetrycznie po obu stronach osi.
 * Zwraca null dla odcinka o zerowej długości.
 */
export function edgeGeometry(p1, p2, opts = {}) {
  const g = { ...GEOM, ...opts };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) {
    return null;
  }
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const ox = nx * g.separation;
  const oy = ny * g.separation;

  const start = { x: p1.x + dx * g.startFraction + ox, y: p1.y + dy * g.startFraction + oy };
  const tip = { x: p1.x + dx * g.endFraction + ox, y: p1.y + dy * g.endFraction + oy };
  const segment = len * (g.endFraction - g.startFraction);
  // Przy bardzo krótkim odcinku strzałka maleje, zamiast zjadać całą linię.
  const arrowLen = Math.min(g.arrowLength, segment * 0.6);
  const halfWidth = g.arrowHalfWidth * (arrowLen / g.arrowLength);
  const base = { x: tip.x - ux * arrowLen, y: tip.y - uy * arrowLen };
  const arrow = [
    tip,
    { x: base.x + nx * halfWidth, y: base.y + ny * halfWidth },
    { x: base.x - nx * halfWidth, y: base.y - ny * halfWidth },
  ];
  const mid = { x: p1.x + dx * 0.5 + ox, y: p1.y + dy * 0.5 + oy };
  const label = { x: mid.x + nx * g.labelSide, y: mid.y + ny * g.labelSide };

  return {
    lineStart: start,
    lineEnd: base,
    tip,
    arrow,
    mid,
    label,
    labelAngle: readableAngle(dx, dy),
    normal: { x: nx, y: ny },
    unit: { x: ux, y: uy },
    length: len,
  };
}

/** Kąt napisu (stopnie) wzdłuż odcinka, nigdy do góry nogami: zakres (-90, 90]. */
export function readableAngle(dx, dy) {
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90) {
    angle -= 180;
  } else if (angle <= -90) {
    angle += 180;
  }
  return angle;
}

/* ------------------------------------------------------------------ */
/* 2. Warstwa Leafleta (SVG)                                           */
/* ------------------------------------------------------------------ */

const SVG_NS = "http://www.w3.org/2000/svg";
const PANE_NAME = "mtswTrace";
const PANE_PADDING = 0.5;

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs || {})) {
    el.setAttribute(key, String(value));
  }
  return el;
}

/**
 * Tworzy warstwę L.Layer rysującą odcinki. `directions` to lista
 * { edges, ... } (kierunek w przód i powrotny). Piksele liczone są od nowa
 * przy każdym przesunięciu i zmianie powiększenia, więc przesunięcie
 * 3 px zawsze ma 3 px na ekranie, niezależnie od zoomu.
 */
export function createTracerouteLayer(L, edgeGroups, preset) {
  const TraceLayer = L.Layer.extend({
    initialize(groups, presetName) {
      this._groups = groups;
      this._preset = presetName;
    },

    onAdd(map) {
      this._map = map;
      let pane = map.getPane(PANE_NAME);
      if (!pane) {
        pane = map.createPane(PANE_NAME);
        // nad liniami i okręgami (overlayPane 400), pod znacznikami (600)
        pane.style.zIndex = 450;
        pane.style.pointerEvents = "none";
      }
      this._svg = svgEl("svg", { class: "mtsw-trace-svg" });
      this._svg.style.position = "absolute";
      this._svg.style.pointerEvents = "none";
      pane.appendChild(this._svg);
      this._update();
    },

    onRemove() {
      if (this._svg && this._svg.parentNode) {
        this._svg.parentNode.removeChild(this._svg);
      }
      this._svg = null;
    },

    getEvents() {
      return {
        moveend: this._update,
        zoomend: this._update,
        viewreset: this._update,
        resize: this._update,
        zoomanim: this._onZoomAnim,
      };
    },

    /* Animacja powiększenia: skalujemy gotowy obraz, jak renderery Leafleta.
       To prywatne API — gdyby go zabrakło, chowamy warstwę do końca animacji. */
    _onZoomAnim(event) {
      const map = this._map;
      if (!this._svg || !this._center) {
        return;
      }
      try {
        const scale = map.getZoomScale(event.zoom, this._zoom);
        const viewHalf = map.getSize().multiplyBy(0.5 + PANE_PADDING);
        const currentCenterPoint = map.project(this._center, event.zoom);
        const offset = viewHalf
          .multiplyBy(-scale)
          .add(currentCenterPoint)
          .subtract(map._getNewPixelOrigin(event.center, event.zoom));
        L.DomUtil.setTransform(this._svg, offset, scale);
      } catch (err) {
        this._svg.style.visibility = "hidden";
      }
    },

    _update() {
      const map = this._map;
      if (!map || !this._svg) {
        return;
      }
      const size = map.getSize();
      if (!size || size.x <= 0 || size.y <= 0) {
        return;
      }
      const min = map.containerPointToLayerPoint(size.multiplyBy(-PANE_PADDING)).round();
      const max = map.containerPointToLayerPoint(size.multiplyBy(1 + PANE_PADDING)).round();
      const w = max.x - min.x;
      const h = max.y - min.y;

      this._center = map.getCenter();
      this._zoom = map.getZoom();

      const svg = this._svg;
      svg.style.visibility = "";
      svg.setAttribute("width", w);
      svg.setAttribute("height", h);
      svg.setAttribute("viewBox", `${min.x} ${min.y} ${w} ${h}`);
      L.DomUtil.setPosition(svg, min);

      while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
      }
      this._draw(svg);
    },

    _draw(svg) {
      const map = this._map;
      const casings = svgEl("g", {});
      const lines = svgEl("g", {});
      const arrows = svgEl("g", {});
      const labels = svgEl("g", {});

      for (const group of this._groups) {
        for (const edge of group.edges) {
          const p1 = map.latLngToLayerPoint([edge.a.latitude, edge.a.longitude]);
          const p2 = map.latLngToLayerPoint([edge.b.latitude, edge.b.longitude]);
          const geo = edgeGeometry(p1, p2);
          if (!geo) {
            continue;
          }
          const color = edgeColor(edge.snrDb, this._preset);

          // Ciemna obwódka pod kolorem: biały "brak sygnału" musi być widoczny na jasnej mapie.
          casings.appendChild(
            svgEl("line", {
              x1: geo.lineStart.x,
              y1: geo.lineStart.y,
              x2: geo.lineEnd.x,
              y2: geo.lineEnd.y,
              stroke: "#000",
              "stroke-opacity": 0.5,
              "stroke-width": GEOM.lineWidth + 2,
              "stroke-linecap": "butt",
            })
          );
          lines.appendChild(
            svgEl("line", {
              x1: geo.lineStart.x,
              y1: geo.lineStart.y,
              x2: geo.lineEnd.x,
              y2: geo.lineEnd.y,
              stroke: color,
              "stroke-width": GEOM.lineWidth,
              "stroke-linecap": "butt",
            })
          );
          arrows.appendChild(
            svgEl("polygon", {
              points: geo.arrow.map((p) => `${p.x},${p.y}`).join(" "),
              fill: color,
              stroke: "#000",
              "stroke-opacity": 0.5,
              "stroke-width": 1,
              "stroke-linejoin": "round",
            })
          );
          const text = svgEl("text", {
            x: geo.label.x,
            y: geo.label.y,
            transform: `rotate(${geo.labelAngle} ${geo.label.x} ${geo.label.y})`,
            fill: color,
            "font-size": 12,
            "font-weight": 600,
            "text-anchor": "middle",
            "dominant-baseline": "central",
            stroke: "#000",
            "stroke-width": 3,
            "stroke-linejoin": "round",
            "paint-order": "stroke",
          });
          text.textContent = snrLabel(edge.snrDb);
          labels.appendChild(text);
        }
      }
      svg.appendChild(casings);
      svg.appendChild(lines);
      svg.appendChild(arrows);
      svg.appendChild(labels);
    },
  });
  return new TraceLayer(edgeGroups, preset);
}

/* ------------------------------------------------------------------ */
/* 3. Kontroler dla zakładki Mapa                                      */
/* ------------------------------------------------------------------ */

const STYLE_ID = "data-mtsw-trace";
const TRACE_CSS = `
.mtsw-trace-dot {
  width: 10px; height: 10px; box-sizing: border-box;
  border-radius: 50%; background: #fff; border: 2px solid #000;
}
.mtsw-trace-legend {
  background: var(--card-background-color, #fff);
  color: var(--primary-text-color, #212121);
  border-radius: 8px; padding: 8px 12px; font-size: 12px; line-height: 1.5;
  box-shadow: 0 1px 5px rgba(0,0,0,.4); min-width: 150px;
}
.mtsw-trace-legend .t-title { font-weight: 600; margin-bottom: 2px; }
.mtsw-trace-legend .t-count { color: var(--secondary-text-color, #727272); margin-bottom: 4px; }
.mtsw-trace-legend .t-row { display: flex; align-items: center; gap: 8px; }
.mtsw-trace-legend .t-swatch {
  width: 22px; height: 3px; border-radius: 1px; outline: 1px solid rgba(0,0,0,.5);
}
.mtsw-trace-legend button {
  margin-top: 6px; width: 100%; cursor: pointer; font: inherit;
  border: 1px solid var(--divider-color, #ccc); border-radius: 6px;
  background: none; color: inherit; padding: 4px 8px;
}
.mtsw-trace-legend button:hover { background: var(--secondary-background-color, #eee); }
`;

function ensureTraceStyles(root) {
  if (!root || !root.querySelector || root.querySelector(`style[${STYLE_ID}]`)) {
    return;
  }
  const style = document.createElement("style");
  style.setAttribute(STYLE_ID, "");
  style.textContent = TRACE_CSS;
  root.appendChild(style);
}

function nodeTitle(node, id) {
  return (
    (node && (node.short_name || node.long_name || node.node_hex)) ||
    `!${(id >>> 0).toString(16).padStart(8, "0")}`
  );
}

/**
 * Rysuje widok trasy na mapie Leafleta: warstwę linii, węzły z etykietami
 * i legendę. sync() jest tanie i idempotentne — przebudowuje tylko wtedy,
 * gdy zmieni się trasa, pozycje jej węzłów, preset albo język.
 */
export class TracerouteOverlay {
  constructor() {
    this._map = null;
    this._layer = null;
    this._nodeGroup = null;
    this._legend = null;
    this._signature = null;
    this._viewId = null;
    this.active = false;
  }

  sync({ L, map, view, nodes, hass, onClose }) {
    if (!view || !map || !L) {
      this.clear();
      return;
    }
    const byId = new Map((nodes || []).map((n) => [n.node_id, n]));
    const ids = [...new Set([...view.forward, ...view.back])];
    const positions = new Map();
    for (const id of ids) {
      const node = byId.get(id);
      if (hasValidPosition(node)) {
        positions.set(id, { latitude: node.latitude, longitude: node.longitude });
      }
    }
    const signature = JSON.stringify([
      view.id,
      view.preset,
      hass && hass.language,
      ids.map((id) => {
        const node = byId.get(id);
        const p = positions.get(id);
        return [id, p ? p.latitude : null, p ? p.longitude : null, node ? node.short_name || node.long_name : null];
      }),
    ]);
    if (this.active && this._map === map && signature === this._signature) {
      return;
    }
    const newView = this._viewId !== view.id || this._map !== map;
    this._removeLayers();
    this._map = map;
    this._signature = signature;
    this._viewId = view.id;
    this.active = true;

    ensureTraceStyles(map.getContainer().getRootNode());

    const groups = [
      { edges: tracerouteEdges(view.forward, view.snrTowards, positions) },
      { edges: tracerouteEdges(view.back, view.snrBack, positions) },
    ];
    this._layer = createTracerouteLayer(L, groups, view.preset).addTo(map);

    this._nodeGroup = L.layerGroup().addTo(map);
    for (const [id, p] of positions) {
      const node = byId.get(id);
      L.marker([p.latitude, p.longitude], {
        icon: L.divIcon({
          className: "",
          html: '<div class="mtsw-trace-dot"></div>',
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        }),
        keyboard: false,
      })
        .bindTooltip(nodeTitle(node, id), {
          direction: "top",
          permanent: true,
          className: "mtsw-node-label",
          offset: [0, -6],
        })
        .addTo(this._nodeGroup);
    }

    const unknown = groups.some((g) => g.edges.some((e) => e.snrDb === null));
    this._legend = this._makeLegend(L, hass, positions.size, ids.length, unknown, onClose).addTo(map);

    if (newView && positions.size) {
      const points = [...positions.values()].map((p) => [p.latitude, p.longitude]);
      try {
        map.fitBounds(points, { padding: [60, 60], maxZoom: 16, animate: false });
      } catch (err) {
        console.debug("MT_SW: nie udało się dopasować mapy do trasy", err);
      }
    }
  }

  _makeLegend(L, hass, shown, total, unknown, onClose) {
    const Legend = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create("div", "mtsw-trace-legend");
        const title = L.DomUtil.create("div", "t-title", div);
        title.textContent = t(hass, "map.traceroute.title");
        const count = L.DomUtil.create("div", "t-count", div);
        count.textContent = t(hass, "map.traceroute.showing", { n: shown, total });
        const rows = QUALITY_ORDER.map((q) => ({ color: q.color, label: t(hass, q.labelKey) }));
        if (unknown) {
          rows.push({ color: UNKNOWN_COLOR, label: t(hass, "map.traceroute.q_unknown") });
        }
        for (const row of rows) {
          const el = L.DomUtil.create("div", "t-row", div);
          const swatch = L.DomUtil.create("span", "t-swatch", el);
          swatch.style.background = row.color;
          const label = L.DomUtil.create("span", "", el);
          label.textContent = row.label;
        }
        const close = L.DomUtil.create("button", "", div);
        close.type = "button";
        close.textContent = t(hass, "map.traceroute.close");
        L.DomEvent.on(close, "click", (e) => {
          L.DomEvent.stop(e);
          if (typeof onClose === "function") {
            onClose();
          }
        });
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      },
    });
    return new Legend({ position: "bottomleft" });
  }

  _removeLayers() {
    if (this._layer) {
      this._layer.remove();
      this._layer = null;
    }
    if (this._nodeGroup) {
      this._nodeGroup.remove();
      this._nodeGroup = null;
    }
    if (this._legend) {
      this._legend.remove();
      this._legend = null;
    }
  }

  clear() {
    this._removeLayers();
    this._signature = null;
    this._viewId = null;
    this._map = null;
    this.active = false;
  }
}

/* ------------------------------------------------------------------ */
/* Przycisk "Pokaż na mapie" dla zakładki Węzły                        */
/* ------------------------------------------------------------------ */

/**
 * Szablon przycisku i — gdy mapa niedostępna — powodu po polsku.
 * Odpowiednik TracerouteAlertHandler: przycisk istnieje tylko wtedy, gdy
 * każdy węzeł trasy (tam i z powrotem, razem z końcami) ma pozycję.
 */
export function renderTracerouteMapAction({ hass, view, nodes, onShow }) {
  if (!view) {
    return html``;
  }
  const status = traceAvailability(view, nodes);
  const reasonKey = availabilityMessageKey(status);
  return html`
    <div class="route-note" style="padding-top: 8px">
      <button class="action" ?disabled=${reasonKey !== null} @click=${() => onShow(view)}>
        ${t(hass, "map.traceroute.show")}
      </button>
      ${reasonKey
        ? html`<div style="color: var(--error-color, #db4437); margin-top: 6px">${t(hass, reasonKey)}</div>`
        : ""}
    </div>
  `;
}
