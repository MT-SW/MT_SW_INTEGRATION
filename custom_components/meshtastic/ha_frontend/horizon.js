/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Zakładka Panorama terenu — sylwetka terenu dookoła bramki z naniesionymi węzłami:
 * zielone stoją nad grzbietem przed nimi (widać je), czerwone są przez teren zasłonięte.
 * Obliczenia jak w aplikacji MT_SW_APP (HorizonPanorama), dane o terenie: Mapterhorn
 * (ten sam silnik wysokości co w Planerze).
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";
import { PlannerElevation, TERRAIN_ATTRIBUTION } from "./planner/elevation.js";
import { setPlannerProxy, createHassProxy } from "./planner/net.js";
import { destination, distanceM, bearingDeg, EARTH_RADIUS_M } from "./planner/geodesy.js";

const TEXT = {
  pl: {
    title: "Panorama terenu",
    help: "Widok z bramki dookoła: ciemna sylwetka to teren. Zielone węzły są nad grzbietem przed nimi (powinny być widoczne), czerwone chowają się za terenem. Liczy się geometrię terenu i krzywiznę Ziemi, nie moc radia.",
    lat: "Szerokość",
    lon: "Długość",
    use_gateway: "Moja bramka",
    antenna: "Antena stacji [m]",
    target_antenna: "Anteny węzłów [m]",
    radius: "Teren do [km]",
    nodes_to: "Węzły do [km]",
    only_fav: "Tylko ulubione",
    labels: "Nazwy węzłów",
    heading: "Kierunek",
    fov: "Szerokość widoku",
    compute: "Policz panoramę",
    loading: "Pobieram teren i liczę…",
    need_pos: "Podaj położenie stacji albo wybierz bramkę z pozycją.",
    failed: "Nie udało się pobrać terenu: {e}",
    visible: "widoczny",
    hidden: "zasłonięty",
    clearance: "nad grzbietem",
    node: "Węzeł",
    dist: "Odległość",
    bearing: "Azymut",
    state: "Stan",
    summary: "Widocznych: {v} z {n}",
    none: "Brak węzłów z pozycją w tym zasięgu.",
    N: "N", E: "E", S: "S", W: "W",
  },
  en: {
    title: "Terrain panorama",
    help: "A view around the gateway: the dark silhouette is the terrain. Green nodes stand above the ridge in front of them (should be visible), red ones hide behind the terrain. It uses terrain geometry and Earth curvature, not radio power.",
    lat: "Latitude",
    lon: "Longitude",
    use_gateway: "My gateway",
    antenna: "Station antenna [m]",
    target_antenna: "Node antennas [m]",
    radius: "Terrain to [km]",
    nodes_to: "Nodes to [km]",
    only_fav: "Favorites only",
    labels: "Node names",
    heading: "Heading",
    fov: "View width",
    compute: "Compute panorama",
    loading: "Loading terrain and computing…",
    need_pos: "Enter the station position or pick a gateway with a position.",
    failed: "Could not load terrain: {e}",
    visible: "visible",
    hidden: "hidden",
    clearance: "above ridge",
    node: "Node",
    dist: "Distance",
    bearing: "Bearing",
    state: "State",
    summary: "Visible: {v} of {n}",
    none: "No nodes with a position in this range.",
    N: "N", E: "E", S: "S", W: "W",
  },
};

const SAMPLES = 400;
const BEARINGS = 720;
const K = 4 / 3;
const EFFECTIVE_R = EARTH_RADIUS_M * K;

const angleDeg = (observerM, targetM, dist) =>
  (Math.atan2(targetM - (dist * dist) / (2 * EFFECTIVE_R) - observerM, dist) * 180) / Math.PI;

/* Sylwetka terenu dookoła punktu (port HorizonPanorama.build). */
export function buildProfile(ground, centre, antennaM, radiusM) {
  const centreGround = ground(centre.lat, centre.lon);
  const observer = centreGround + antennaM;
  const spacing = radiusM / SAMPLES;
  const points = [];
  for (let i = 0; i < BEARINGS; i++) {
    const bearing = (360 * i) / BEARINGS;
    let best = -Infinity;
    let bestDist = radiusM;
    for (let s = 1; s <= SAMPLES; s++) {
      const d = s * spacing;
      const p = destination(centre, bearing, d);
      const a = angleDeg(observer, ground(p.lat, p.lon), d);
      if (a > best) {
        best = a;
        bestDist = d;
      }
    }
    if (best === -Infinity) best = angleDeg(observer, centreGround, radiusM);
    points.push({ bearing, angle: best, dist: bestDist });
  }
  return { centre, observer, radiusM, stepM: spacing, points };
}

const profileAt = (profile, bearing) => {
  const w = ((bearing % 360) + 360) % 360;
  return profile.points[Math.min(profile.points.length - 1, Math.floor((w / 360) * profile.points.length))];
};

/* Ustawia węzły względem sylwetki (port HorizonPanorama.place). */
export function placeNodes(profile, ground, nodes, targetAntennaM, maxDistM) {
  const out = [];
  for (const n of nodes) {
    const at = { lat: n.latitude, lon: n.longitude };
    const dist = distanceM(profile.centre, at);
    if (dist <= 0 || dist > maxDistM) continue;
    const bearing = bearingDeg(profile.centre, at);
    const angle = angleDeg(profile.observer, ground(at.lat, at.lon) + targetAntennaM, dist);
    let highest = -Infinity;
    const known = Math.min(dist, profile.radiusM);
    for (let d = profile.stepM; d < known; d += profile.stepM) {
      const p = destination(profile.centre, bearing, d);
      const a = angleDeg(profile.observer, ground(p.lat, p.lon), d);
      if (a > highest) highest = a;
    }
    out.push({ node: n, bearing, dist, angle, occluding: highest, visible: angle > highest, clearance: angle - highest });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

class MeshHorizonTab extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      nodes: { type: Array },
      _lat: { type: String },
      _lon: { type: String },
      _antenna: { type: Number },
      _targetAntenna: { type: Number },
      _radius: { type: Number },
      _nodesTo: { type: Number },
      _onlyFav: { type: Boolean },
      _labels: { type: Boolean },
      _heading: { type: Number },
      _fov: { type: Number },
      _busy: { type: Boolean },
      _error: { type: String },
      _result: { type: Object },
    };
  }

  constructor() {
    super();
    this.nodes = [];
    this._lat = "";
    this._lon = "";
    this._antenna = 5;
    this._targetAntenna = 3;
    this._radius = 15;
    this._nodesTo = 100;
    this._onlyFav = false;
    this._labels = true;
    this._heading = 0;
    this._fov = 120;
    this._busy = false;
    this._error = "";
    this._result = null;
    this._elevation = null;
    this._ground = null;
    this._groundKey = "";
  }

  _tr(key, params = {}) {
    const lang = (this.hass && this.hass.language) || "pl";
    let s = (TEXT[lang.startsWith("pl") ? "pl" : "en"] || TEXT.pl)[key] || key;
    Object.entries(params).forEach(([k, v]) => (s = s.replace(`{${k}}`, v)));
    return s;
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this._lat) this._useGateway();
  }

  _gateway() {
    return (this.nodes || []).find((n) => n.is_gateway && typeof n.latitude === "number" && typeof n.longitude === "number");
  }

  _useGateway() {
    const g = this._gateway();
    if (g) {
      this._lat = g.latitude.toFixed(6);
      this._lon = g.longitude.toFixed(6);
    }
  }

  updated(changed) {
    if (changed.has("nodes") && !this._lat) this._useGateway();
    this._draw();
  }

  async _compute() {
    const lat = Number(this._lat);
    const lon = Number(this._lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      this._error = this._tr("need_pos");
      return;
    }
    this._busy = true;
    this._error = "";
    try {
      setPlannerProxy(createHassProxy(() => this.hass));
      this._elevation = this._elevation || new PlannerElevation();
      const key = `${lat.toFixed(4)},${lon.toFixed(4)},${this._radius}`;
      if (!this._ground || this._groundKey !== key) {
        this._ground = await this._elevation.prepareArea({ lat, lon }, this._radius + 2);
        this._groundKey = key;
      }
      // dajemy przeglądarce chwilę na odrysowanie komunikatu przed ciężkim liczeniem
      await new Promise((r) => setTimeout(r, 30));
      const centre = { lat, lon };
      const profile = buildProfile(this._ground, centre, this._antenna, this._radius * 1000);
      const list = (this.nodes || []).filter(
        (n) => typeof n.latitude === "number" && typeof n.longitude === "number" && !n.is_gateway && !(this._onlyFav && !n.is_favorite)
      );
      const targets = placeNodes(profile, this._ground, list, this._targetAntenna, this._nodesTo * 1000);
      this._result = { profile, targets };
    } catch (err) {
      this._error = this._tr("failed", { e: (err && err.message) || String(err) });
    } finally {
      this._busy = false;
    }
  }

  /* ── rysowanie ── */

  _draw() {
    const canvas = this.renderRoot.querySelector("canvas");
    if (!canvas) return;
    const width = Math.max(320, canvas.parentElement.clientWidth);
    const height = 340;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this);
    const text = css.getPropertyValue("--primary-text-color").trim() || "#222";
    const sub = css.getPropertyValue("--secondary-text-color").trim() || "#777";
    const sky = css.getPropertyValue("--card-background-color").trim() || "#fff";
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    if (!this._result) return;

    const { profile, targets } = this._result;
    const maxTerrain = Math.max(...profile.points.map((p) => p.angle));
    const maxNode = targets.length ? Math.max(...targets.map((t) => t.angle)) : 0;
    const top = Math.max(3, Math.ceil(Math.max(maxTerrain, maxNode) + 1));
    const bottom = Math.min(-2, Math.floor(Math.min(...profile.points.map((p) => p.angle)) - 1));
    const yOf = (a) => 8 + ((top - a) / (top - bottom)) * (height - 36);
    const xOf = (b) => {
      const delta = ((((b - this._heading) % 360) + 540) % 360) - 180;
      return width / 2 + (delta / this._fov) * width;
    };

    // siatka kątów
    ctx.font = "11px sans-serif";
    ctx.fillStyle = sub;
    ctx.strokeStyle = "rgba(128,128,128,0.25)";
    const stepA = top - bottom > 20 ? 5 : 2;
    for (let a = Math.ceil(bottom / stepA) * stepA; a <= top; a += stepA) {
      ctx.beginPath();
      ctx.moveTo(0, yOf(a));
      ctx.lineTo(width, yOf(a));
      ctx.stroke();
      ctx.fillText(`${a}°`, 3, yOf(a) - 2);
    }

    // sylwetka terenu
    ctx.beginPath();
    ctx.moveTo(0, height - 28);
    for (let px = 0; px <= width; px += 2) {
      const bearing = this._heading + ((px - width / 2) / width) * this._fov;
      ctx.lineTo(px, yOf(profileAt(profile, bearing).angle));
    }
    ctx.lineTo(width, height - 28);
    ctx.closePath();
    ctx.fillStyle = "rgba(90,100,110,0.75)";
    ctx.fill();
    ctx.strokeStyle = text;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.lineWidth = 1;

    // węzły
    const green = "#2e9e4f";
    const red = "#d6453d";
    for (const t of targets) {
      const x = xOf(t.bearing);
      if (x < -20 || x > width + 20) continue;
      const y = yOf(t.angle);
      ctx.strokeStyle = t.visible ? green : red;
      ctx.fillStyle = t.visible ? green : red;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, height - 28);
      ctx.globalAlpha = 0.25;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      if (this._labels) {
        ctx.fillStyle = text;
        ctx.fillText(t.node.short_name || t.node.node_hex || "", x + 7, y - 6);
      }
    }

    // kierunki świata
    ctx.fillStyle = text;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    for (let b = 0; b < 360; b += 45) {
      const x = xOf(b);
      if (x < 0 || x > width) continue;
      const label = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" }[b];
      ctx.fillText(label.length === 1 ? this._tr(label) : label, x, height - 10);
      ctx.fillStyle = sub;
      ctx.fillRect(x, height - 28, 1, 6);
      ctx.fillStyle = text;
    }
    ctx.textAlign = "start";
  }

  /* ── widok ── */

  _num(label, prop, min, max, step = 1) {
    return html`<label class="f">${label}
      <input type="number" min=${min} max=${max} step=${step} .value=${String(this[prop])}
        @change=${(e) => (this[prop] = Math.min(max, Math.max(min, Number(e.target.value) || min)))} /></label>`;
  }

  render() {
    const r = this._result;
    const visible = r ? r.targets.filter((t) => t.visible).length : 0;
    return html`
      <div class="wrap">
        <h3>${this._tr("title")}</h3>
        <p class="legend">${this._tr("help")}</p>
        <div class="grid">
          <label class="f">${this._tr("lat")}<input .value=${this._lat} @input=${(e) => (this._lat = e.target.value)} /></label>
          <label class="f">${this._tr("lon")}<input .value=${this._lon} @input=${(e) => (this._lon = e.target.value)} /></label>
          ${this._num(this._tr("antenna"), "_antenna", 0, 200)}
          ${this._num(this._tr("target_antenna"), "_targetAntenna", 0, 200)}
          <label class="f">${this._tr("radius")}
            <select @change=${(e) => (this._radius = Number(e.target.value))}>
              ${[5, 10, 15, 25, 40, 60].map((v) => html`<option value=${v} ?selected=${v === this._radius}>${v}</option>`)}
            </select></label>
          ${this._num(this._tr("nodes_to"), "_nodesTo", 5, 1000, 5)}
        </div>
        <div class="bar">
          <button class="chip" @click=${() => this._useGateway()}>${this._tr("use_gateway")}</button>
          <label class="tog"><input type="checkbox" .checked=${this._onlyFav} @change=${(e) => (this._onlyFav = e.target.checked)} />${this._tr("only_fav")}</label>
          <label class="tog"><input type="checkbox" .checked=${this._labels} @change=${(e) => (this._labels = e.target.checked)} />${this._tr("labels")}</label>
          <button class="chip on" ?disabled=${this._busy} @click=${() => this._compute()}>${this._tr("compute")}</button>
        </div>
        ${this._busy ? html`<div class="note">${this._tr("loading")}</div>` : ""}
        ${this._error ? html`<div class="note err">${this._error}</div>` : ""}
        <div class="canvas-wrap"><canvas></canvas></div>
        <div class="bar">
          <label class="f grow">${this._tr("heading")}: ${Math.round(this._heading)}°
            <input type="range" min="0" max="359" .value=${String(this._heading)} @input=${(e) => (this._heading = Number(e.target.value))} /></label>
          <label class="f grow">${this._tr("fov")}: ${this._fov}°
            <input type="range" min="30" max="360" step="10" .value=${String(this._fov)} @input=${(e) => (this._fov = Number(e.target.value))} /></label>
        </div>
        ${r
          ? html`<p class="legend">${this._tr("summary", { v: visible, n: r.targets.length })} · ${TERRAIN_ATTRIBUTION}</p>
              ${r.targets.length
                ? html`<div class="table-wrap"><table>
                    <thead><tr><th>${this._tr("node")}</th><th>${this._tr("dist")}</th><th>${this._tr("bearing")}</th><th>${this._tr("state")}</th></tr></thead>
                    <tbody>
                      ${r.targets.map(
                        (t) => html`<tr class="click" @click=${() => (this._heading = Math.round(t.bearing))}>
                          <td>${t.node.long_name || t.node.short_name || t.node.node_hex}</td>
                          <td>${(t.dist / 1000).toFixed(1)} km</td>
                          <td>${Math.round(t.bearing)}°</td>
                          <td><span class="dot ${t.visible ? "good" : "bad"}"></span>${t.visible
                            ? `${this._tr("visible")} (+${t.clearance.toFixed(1)}° ${this._tr("clearance")})`
                            : this._tr("hidden")}</td>
                        </tr>`
                      )}
                    </tbody></table></div>`
                : html`<div class="note">${this._tr("none")}</div>`}`
          : ""}
      </div>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; height: var(--mtsw-tab-height, 100%); overflow: auto; }
      .wrap { padding: 8px 16px 24px; max-width: 1100px; margin: 0 auto; }
      h3 { margin: 12px 0 4px; font-weight: 500; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
      .f { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--secondary-text-color); }
      .f.grow { flex: 1; min-width: 200px; }
      input:not([type="checkbox"]):not([type="range"]), select { padding: 6px 8px; border-radius: 8px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; font-size: 14px; }
      .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
      .chip { appearance: none; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); border-radius: 16px; padding: 5px 14px; font: inherit; font-size: 13px; cursor: pointer; }
      .chip.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
      .chip[disabled] { opacity: 0.5; cursor: default; }
      .tog { font-size: 13px; display: flex; gap: 4px; align-items: center; }
      .canvas-wrap { border: 1px solid var(--divider-color); border-radius: 12px; overflow: hidden; background: var(--card-background-color); }
      canvas { display: block; }
      .note { font-size: 13px; padding: 6px 0; color: var(--secondary-text-color); }
      .note.err { color: var(--error-color, #db4437); }
      .legend { font-size: 12px; color: var(--secondary-text-color); }
      .table-wrap { overflow-x: auto; border: 1px solid var(--divider-color); border-radius: 12px; background: var(--card-background-color); }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--divider-color); white-space: nowrap; }
      th { font-size: 12px; color: var(--secondary-text-color); font-weight: 500; }
      tr.click { cursor: pointer; }
      tr.click:hover { background: var(--secondary-background-color); }
      .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
      .dot.good { background: #2e9e4f; }
      .dot.bad { background: #d6453d; }
    `;
  }
}

if (!customElements.get("mtsw-horizon-tab")) {
  customElements.define("mtsw-horizon-tab", MeshHorizonTab);
}
