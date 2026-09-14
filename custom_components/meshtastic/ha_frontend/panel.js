import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";

class MeshtasticPanel extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      narrow: { type: Boolean },
      route: { type: Object },
      panel: { type: Object },
    };
  }

  render() {
    if (!this.hass) {
      return html``;
    }

    const mesh_entities = Object.values(this.hass.entities).filter(e => e.platform === "meshtastic" && e.entity_id.startsWith("meshtastic."));
    const gateway_entities = mesh_entities.filter(e => this.hass.states[e.entity_id].attributes["device_class"] === "gateway");

    const gateway_info = gateway_entities.map(e => ({
      "entity": e.entity_id,
      "gateway_id": e.entity_id.replace("meshtastic\.", ""),
      "name": this.hass.states[e.entity_id].attributes["friendly_name"],
      "unavailable": this.hass.states[e.entity_id].state === "unavailable"
    }));

    const neighbor_nodes = Object.values(this.hass.states)
      .filter(s => s.entity_id.startsWith("sensor.") && Array.isArray(s.attributes.neighbors))
      .map(s => ({
        "name": s.attributes.friendly_name || s.entity_id,
        "count": s.state,
        "neighbors": s.attributes.neighbors,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return html`
      <ha-top-app-bar-fixed>
        <ha-menu-button
            slot="navigationIcon"
            .hass=${this.hass}
            .narrow=${this.narrow}
        ></ha-menu-button>
        <div slot="title">MT_SW_INTEGRATION</div>
        
        <div class="">
          <h1>Klient WWW</h1>
          <div class="container">
            ${gateway_info.map((gateway) => html`
              <ha-card outlined>
                <div class="card-content">
                  <img alt="" style="visibility: initial;"
                       src="/meshtastic/web/icon.svg">
                  <h2>${gateway.name || gateway.entity}</h2>
                  <h3>&nbsp;</h3>
                  <div class="card-actions">
                    ${gateway.unavailable ? html`
                      <ha-button unelevated disabled="true">Open</ha-button>` : html`<a
                        href="${"/meshtastic/web/" + gateway.gateway_id}" target="_blank">
                      <ha-button unelevated>Open</ha-button>
                    </a>`}
                  </div>
              </ha-card>
            `)}
          </div>

          <h1>Sąsiedzi</h1>
          ${neighbor_nodes.length === 0 ? html`
            <div class="empty">Żadem śledzony węzeł nie zgłosił jeszcze sąsiadów.</div>
          ` : html`
            <div class="neighbor-container">
              ${neighbor_nodes.map((node) => html`
                <ha-card outlined>
                  <div class="card-header">
                    <span class="node-name">${node.name}</span>
                    <span class="node-count">${node.count}</span>
                  </div>
                  ${node.neighbors.length === 0 ? html`
                    <div class="empty">Brak sąsiadów w ostatniej ramce.</div>
                  ` : html`
                    <table>
                      <thead>
                        <tr>
                          <th>Sąsiad</th>
                          <th>ID</th>
                          <th class="num">SNR</th>
                          <th>Ostatnio słyszany</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${node.neighbors.map((n) => html`
                          <tr>
                            <td>
                              <span class="short">${n.short_name}</span>
                              <span class="long">${n.long_name}</span>
                            </td>
                            <td><code>${n.id}</code></td>
                            <td class="num">${Number(n.snr ?? 0).toFixed(2)} dB</td>
                            <td>${n.last_heard ? new Date(n.last_heard).toLocaleString() : "—"}</td>
                          </tr>
                        `)}
                      </tbody>
                    </table>
                  `}
                </ha-card>
              `)}
            </div>
          `}
      </ha-top-app-bar-fixed>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      :host([virtualize]) {
        height: 100%;
      }
      
      h1 {
        margin-top: 8px;
        margin-left: 16px;
        margin-inline-start: 16px;
        margin-inline-end: initial;

        font-family: var(--paper-font-headline_-_font-family);
        -webkit-font-smoothing: var(--paper-font-headline_-_-webkit-font-smoothing);
        white-space: var(--paper-font-headline_-_white-space);
        overflow: var(--paper-font-headline_-_overflow);
        text-overflow: var(--paper-font-headline_-_text-overflow);
        font-size: var(--paper-font-headline_-_font-size);
        font-weight: var(--paper-font-headline_-_font-weight);
        line-height: var(--paper-font-headline_-_line-height);
      }

      a {
        text-decoration: none;
      }
      
      .container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 8px;
        padding: 8px 16px 16px;
      }

      .card-content {
        display: flex;
        justify-content: center;
        flex-direction: column;
        align-items: center;
      }

      .card-content h2 {
        font-size: 16px;
        font-weight: 400;
        margin-top: 8px;
        margin-bottom: 0px;
        max-width: 100%;
      }
      
      .card-content h3 {
        font-size: 14px;
        margin: 0px;
        max-width: 100%;
        text-align: center;
        font-weight: normal;
      }

      .card-content img {
        width: 40px;
        height: 40px;
      }

      .neighbor-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
        gap: 8px;
        padding: 8px 16px 16px;
      }

      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px 4px;
      }

      .node-name {
        font-size: 16px;
        font-weight: 500;
      }

      .node-count {
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .empty {
        padding: 8px 16px 16px;
        color: var(--secondary-text-color);
        font-size: 14px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      th, td {
        text-align: left;
        padding: 6px 16px;
        border-top: 1px solid var(--divider-color);
      }

      th {
        font-weight: 500;
        color: var(--secondary-text-color);
        font-size: 12px;
        text-transform: uppercase;
      }

      td.num, th.num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .short {
        font-weight: 500;
      }

      .long {
        color: var(--secondary-text-color);
        margin-inline-start: 8px;
      }

      code {
        font-family: var(--code-font-family, monospace);
        color: var(--secondary-text-color);
      }

      .card-actions {
        border-top: none;
        padding-top: 0px;
        padding-bottom: 16px;
        justify-content: center;
        display: flex;
      }
    `;
  }
}

if (!customElements.get("meshtastic-frontend")) {
  customElements.define("meshtastic-frontend", MeshtasticPanel);
}