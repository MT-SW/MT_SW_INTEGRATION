/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Szczegóły pakietu w Snifferze jako czytelne widoki zamiast jednej linii
 * tekstu: sąsiedzi jako lista, traceroute jako pionowa lista skoków w obie
 * strony, pozycja / NodeInfo / telemetria / routing / admin jako tabele
 * etykieta–wartość. Model sekcji buduje sniffer-format.js (testowany w node);
 * tutaj jest tylko jego rysowanie. SNR i RSSI są kolorowane jakością łącza
 * (signal-quality.js), a kolor niesie styl w samym „spanie” modelu.
 */

import { html, css } from "./vendor/lit/lit-element.js";

function renderSpan(value) {
  if (value === null || value === undefined) {
    return html`—`;
  }
  if (typeof value !== "object") {
    return html`${value}`;
  }
  if (value.href) {
    return html`<a class="detail-link" href=${value.href} target="_blank" rel="noopener noreferrer">${value.t}</a>`;
  }
  if (value.chip) {
    return html`<span class="short-chip">${value.t}</span>`;
  }
  const classes = `${value.mono ? "mono" : ""} ${value.note ? "note-text" : ""}`.trim();
  return html`<span class=${classes} style=${value.s || ""}>${value.t}</span>`;
}

function nodeName(name, short, id) {
  return html`
    ${short ? html`<span class="short-chip">${short}</span>` : ""}
    ${name ? html`<span class="who-name">${name}</span>` : ""}
    <span class="mono who-id">${id || ""}</span>
  `;
}

function renderKv(section) {
  if (!section.rows.length) {
    return "";
  }
  return html`
    <div class="detail-section">
      <div class="section-title">${section.title}</div>
      ${section.rows.map(
        (row) => html`<div class="kv"><span class="k">${row.k}</span><span class="v">${renderSpan(row.v)}</span></div>`
      )}
    </div>
  `;
}

function renderNeighbors(section) {
  return html`
    <div class="detail-section">
      <div class="section-title">${section.title} (${section.rows.length})</div>
      ${section.rows.length
        ? html`<ul class="neighbor-list">
            ${section.rows.map(
              (row) => html`<li class="neighbor">
                <span class="who">${nodeName(row.name, row.short, row.id)}</span>
                <span class="neighbor-snr">${row.snr ? renderSpan({ ...row.snr, t: `SNR ${row.snr.t}` }) : "—"}</span>
              </li>`
            )}
          </ul>`
        : html`<div class="muted-line">${section.empty}</div>`}
    </div>
  `;
}

const ROLE_LABELS = { origin: "start", destination: "cel", unknown: "", hop: "" };

function renderHops(section) {
  const last = section.hops.length - 1;
  return html`
    <div class="detail-section">
      <div class="section-title">${section.title}<span class="section-sub"> · ${section.summary}</span></div>
      <ol class="hop-list">
        ${section.hops.map(
          (hop, index) => html`
            ${index > 0
              ? html`<li class="hop-link" aria-hidden="true">
                  <span class="hop-rail"><ha-icon icon="mdi:arrow-down"></ha-icon></span>
                  ${hop.snr ? html`<span class="hop-snr">${renderSpan(hop.snr)}</span>` : html`<span class="hop-snr muted">—</span>`}
                </li>`
              : ""}
            <li class="hop role-${hop.role}">
              <span class="hop-badge">
                ${hop.role === "origin"
                  ? html`<ha-icon icon="mdi:flag-outline"></ha-icon>`
                  : hop.role === "destination" && index === last
                    ? html`<ha-icon icon="mdi:flag-checkered"></ha-icon>`
                    : hop.unknown
                      ? "?"
                      : index}
              </span>
              <span class="who ${hop.unknown ? "unknown" : ""}">
                ${hop.unknown ? html`<span class="who-name">${hop.name}</span>` : nodeName(hop.name, hop.short, hop.id)}
              </span>
              ${ROLE_LABELS[hop.role] ? html`<span class="hop-role">${ROLE_LABELS[hop.role]}</span>` : ""}
            </li>
          `
        )}
      </ol>
    </div>
  `;
}

function renderText(section) {
  return html`
    <div class="detail-section">
      <div class="section-title">${section.title}</div>
      <div class="detail-text">${section.text}</div>
    </div>
  `;
}

export function renderSections(sections) {
  return sections.map((section) => {
    if (section.kind === "neighbors") {
      return renderNeighbors(section);
    }
    if (section.kind === "hops") {
      return renderHops(section);
    }
    if (section.kind === "text") {
      return renderText(section);
    }
    return renderKv(section);
  });
}

export const detailStyles = css`
  .detail-section { margin-bottom: 10px; }
  .detail-link { color: var(--primary-color); text-decoration: none; }
  .detail-link:hover { text-decoration: underline; }
  .mono { font-family: var(--code-font-family, monospace); }
  .note-text { color: var(--secondary-text-color); font-style: italic; }
  .muted-line { color: var(--secondary-text-color); padding: 2px 0; }
  .section-sub { font-weight: normal; text-transform: none; letter-spacing: 0; }

  .detail-text {
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--secondary-background-color);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
  }

  .short-chip {
    display: inline-block;
    min-width: 2.4em;
    padding: 1px 7px;
    margin-right: 6px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    background: rgba(33, 150, 243, 0.14);
    color: var(--primary-color);
  }

  .who { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 0 4px; min-width: 0; }
  .who-name { font-weight: 500; margin-right: 6px; word-break: break-word; }
  .who-id { color: var(--secondary-text-color); font-size: 11px; }
  .who.unknown .who-name { color: var(--secondary-text-color); font-style: italic; }

  .neighbor-list { list-style: none; margin: 0; padding: 0; }
  .neighbor {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 5px 8px;
    border-radius: 8px;
  }
  .neighbor:nth-child(odd) { background: var(--secondary-background-color); }
  .neighbor-snr { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 500; }

  .hop-list { list-style: none; margin: 0; padding: 0; }
  .hop {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 6px;
    border-radius: 8px;
  }
  .hop-badge {
    flex: 0 0 26px;
    height: 26px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
    border: 1px solid var(--divider-color);
  }
  .hop-badge ha-icon { --mdc-icon-size: 15px; }
  .role-origin .hop-badge { background: rgba(76, 175, 80, 0.16); border-color: rgba(76, 175, 80, 0.5); }
  .role-destination .hop-badge { background: rgba(33, 150, 243, 0.16); border-color: rgba(33, 150, 243, 0.5); }
  .hop-role {
    margin-left: auto;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--secondary-text-color);
  }
  .hop-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 6px;
    min-height: 22px;
    color: var(--secondary-text-color);
  }
  .hop-rail {
    flex: 0 0 26px;
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(var(--divider-color), var(--divider-color)) center / 2px 100% no-repeat;
  }
  .hop-rail ha-icon {
    --mdc-icon-size: 14px;
    background: var(--card-background-color);
    border-radius: 50%;
  }
  .hop-snr { font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 500; }
  .hop-snr.muted { font-weight: normal; }
`;
