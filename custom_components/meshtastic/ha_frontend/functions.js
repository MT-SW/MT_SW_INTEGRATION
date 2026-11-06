/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Ustawienia → Funkcje MT_SW → Pozostałe funkcje: wszystko, co dodaliśmy sami względem
 * oryginału, zebrane w grupach. Kliknięcie przenosi do miejsca, gdzie dana funkcja działa
 * (zakładka, narzędzie na mapie albo panel w ustawieniach). Funkcje bez przejścia opisują
 * to, co działa w tle albo w Opcjach integracji.
 */

import { LitElement, html, css } from "./vendor/lit/lit-element.js";

const SECTIONS = [
 {
  "pl": "Zbieranie danych (encje w Home Assistancie)",
  "en": "Data collection (Home Assistant entities)",
  "items": [
   {
    "icon": "mdi:tune",
    "where": "",
    "pl": [
     "Tryb pracy: panel i statystyki osobno",
     "Trzy warianty: panel i statystyki, tylko panel, tylko statystyki. Błąd jednej części nigdy nie zatrzymuje drugiej."
    ],
    "en": [
     "Mode: panel and statistics separately",
     "Three variants: panel and statistics, panel only, statistics only. A failure in one part never stops the other."
    ]
   },
   {
    "icon": "mdi:radio-tower",
    "where": "tab:nodes",
    "pl": [
     "Śledzenie węzłów w HA",
     "Jednym przyciskiem na węźle albo hurtem (ulubione, pokazane, grupa) włączasz encje węzła."
    ],
    "en": [
     "Tracking nodes in HA",
     "One button on a node, or in bulk (favorites, shown, group), turns the node's entities on."
    ]
   },
   {
    "icon": "mdi:account-multiple-plus",
    "where": "",
    "pl": [
     "Grupy węzłów do zbierania",
     "Opcje integracji: gotowe zestawy (ulubione, słyszane 24 godz. i 7 dni, routery, z pozycją) i własne grupy, także te zrobione wcześniej. Każda grupa dostaje w HA etykietę „MT_SW: nazwa”."
    ],
    "en": [
     "Node groups for collection",
     "Integration Options: ready-made sets (favorites, heard in 24 h and 7 days, routers, with a position) and your own groups, including earlier ones. Each group gets an HA label \"MT_SW: name\"."
    ]
   },
   {
    "icon": "mdi:merge",
    "where": "",
    "pl": [
     "Scalanie duplikatów i zmiana numeru węzła",
     "Ten sam klucz PKI (bez klucza: te same nazwy i model) to to samo urządzenie: zbieranie trwa dalej pod nowym numerem, encje zachowują historię. Ręczne scalanie w Opcjach integracji."
    ],
    "en": [
     "Merging duplicates and node number change",
     "The same PKI key (without a key: the same names and model) is the same device: collection continues under the new number and entities keep their history. Manual merging in the integration Options."
    ]
   },
   {
    "icon": "mdi:delete-restore",
    "where": "",
    "pl": [
     "Węzeł usunięty z radia",
     "Zbieranie kończy się bez błędów; integracja pamięta węzeł 30 dni (stałe) i sama wznawia zbieranie, gdy wróci."
    ],
    "en": [
     "Node removed from the radio",
     "Collection ends without errors; the integration remembers the node for 30 days (fixed) and resumes by itself when it returns."
    ]
   },
   {
    "icon": "mdi:chip",
    "where": "",
    "pl": [
     "Czujniki, encje i usługi",
     "Telemetria i statystyki, Noise Floor, Heap, liczniki pakietów, czujniki binarne (wyciszony, podpisany XEdDSA, słyszany na bieżącym LoRa), sąsiedzi (NeighborInfo), device_tracker, powiadomienia, reply_id w wiadomościach, tłumaczenia PL/EN."
    ],
    "en": [
     "Sensors, entities and services",
     "Telemetry and statistics, Noise Floor, Heap, packet counters, binary sensors (muted, XEdDSA signed, heard on current LoRa), neighbors (NeighborInfo), device_tracker, notifications, reply_id in messages, PL/EN translations."
    ]
   },
   {
    "icon": "mdi:connection",
    "where": "",
    "pl": [
     "Odporne połączenie z radiem",
     "Ponowne łączenie po restarcie radia (TCP, USB, Bluetooth), strażnik łącza, strażnik całej integracji (przeładowanie po 10 min bez radia), start po utracie bazy węzłów, lokalne proxy TCP."
    ],
    "en": [
     "Resilient radio connection",
     "Reconnecting after a radio restart (TCP, USB, Bluetooth), link watchdog, whole-integration watchdog (reload after 10 min without the radio), startup after losing the node database, local TCP proxy."
    ]
   },
   {
    "icon": "mdi:home-assistant",
    "where": "",
    "pl": [
     "Zgodność z Home Assistantem",
     "Działa na starszych (od 2024.11) i najnowszych wersjach; przestarzałe API rejestru urządzeń zastąpione; deduplikacja encji po unique_id."
    ],
    "en": [
     "Home Assistant compatibility",
     "Works on older (from 2024.11) and newest versions; deprecated device registry APIs replaced; entities deduplicated by unique_id."
    ]
   }
  ]
 },
 {
  "pl": "Węzły i sieć",
  "en": "Nodes and network",
  "items": [
   {
    "icon": "mdi:heart-pulse",
    "where": "tab:health",
    "pl": [
     "Zdrowie sieci",
     "Siedem zakładek jak w aplikacji (zasilanie, sygnał, eter, środowisko, zasoby, ruch, sąsiedzi), lista z oceną i małym wykresem, filtry, szczegóły z wykresami i zakresem czasu, podsumowanie, grupy, rozkłady i eksport."
    ],
    "en": [
     "Network health",
     "Seven tabs like the app (power, signal, airtime, environment, resources, traffic, neighbors), a list with rating and small chart, filters, details with charts and time range, summary, groups, distributions and export."
    ]
   },
   {
    "icon": "mdi:format-list-bulleted",
    "where": "tab:nodes",
    "pl": [
     "Lista węzłów na żywo",
     "Zmiany z radia na bieżąco, ulubione, ignorowanie i usuwanie od razu, filtry (ulubione, bezpośrednie, z pozycją, śledzone, bez MQTT), kolumny skrótu, przekaźnika i sygnału."
    ],
    "en": [
     "Live node list",
     "Live changes from the radio, instant favorite, ignore and remove, filters (favorites, direct, with position, tracked, no MQTT), short name, relay and signal columns."
    ]
   },
   {
    "icon": "mdi:account-details",
    "where": "tab:nodes",
    "pl": [
     "Szczegóły węzła",
     "Kategorie jak w aplikacji (sąsiedzi, jakość sygnału, metryki urządzenia, środowiska i zasilania, pakiety, zasoby, pozycjonowanie, traceroute), historia 30 dni z zakresem, minimapa i ślad."
    ],
    "en": [
     "Node details",
     "Categories like the app (neighbors, signal quality, device, environment and power metrics, packets, resources, positioning, traceroute), 30-day history with a range, minimap and track."
    ]
   },
   {
    "icon": "mdi:remote",
    "where": "tab:nodes",
    "pl": [
     "Administracja zdalna i szybkie komendy",
     "Ustawienia zdalnego węzła przez bramkę (PKC jak w aplikacji), zdalne GPIO, szybkie komendy /ping, /hello i /test."
    ],
    "en": [
     "Remote administration and quick commands",
     "Remote node settings through the gateway (PKC like the app), remote GPIO, quick commands /ping, /hello and /test."
    ]
   },
   {
    "icon": "mdi:clock-check-outline",
    "where": "tab:nodes",
    "pl": [
     "Ostatnio słyszany",
     "Panel zapamiętuje czas każdego pakietu, także z kanału dodatkowego; używa go na liście i przy czyszczeniu bazy."
    ],
    "en": [
     "Last heard",
     "The panel remembers the time of every packet, also from a secondary channel; it uses it in the list and in database cleanup."
    ]
   },
   {
    "icon": "mdi:palette",
    "where": "",
    "pl": [
     "Kolory SNR i RSSI jak w aplikacji",
     "Progi zależne od presetu modemu bramki: lista, szczegóły, traceroute, sąsiedzi i wiadomości."
    ],
    "en": [
     "SNR and RSSI colours like the app",
     "Thresholds depend on the gateway's modem preset: list, details, traceroute, neighbors and messages."
    ]
   }
  ]
 },
 {
  "pl": "Mapa i planowanie",
  "en": "Map and planning",
  "items": [
   {
    "icon": "mdi:map",
    "where": "tab:map",
    "pl": [
     "Mapa",
     "Pozycje, koła precyzji, linie topologii NeighborInfo, grupowanie gęstych etykiet, filtr MQTT, wybór dostawcy kafli (domyślnie OpenStreetMap)."
    ],
    "en": [
     "Map",
     "Positions, precision circles, NeighborInfo topology lines, grouping of dense labels, MQTT filter, tile provider choice (OpenStreetMap by default)."
    ]
   },
   {
    "icon": "mdi:routes",
    "where": "tab:map",
    "pl": [
     "Traceroute na mapie",
     "Wynik trasy jako linie ze strzałkami w kolorze jakości sygnału, z wartościami SNR."
    ],
    "en": [
     "Traceroute on the map",
     "The route result as arrowed lines coloured by signal quality, with SNR values."
    ]
   },
   {
    "icon": "mdi:map-marker-path",
    "where": "tab:map",
    "pl": [
     "Mesh Link Planer",
     "Punkty A i B, teren, propagacja ITM, bilans łącza, profil ze strefą Fresnela, zasięg na mapie, duże zasięgi pobierane kawałkami."
    ],
    "en": [
     "Mesh Link Planer",
     "Points A and B, terrain, ITM propagation, link budget, profile with a Fresnel zone, coverage on the map, large ranges downloaded in pieces."
    ]
   },
   {
    "icon": "mdi:antenna",
    "where": "map:antenna",
    "pl": [
     "Kalkulator anten",
     "13 typów anten: wymiary, zysk, impedancja, straty w kablu i złączach, moc wypromieniowana na tle limitów pasm; przycisk „Użyj w planerze”."
    ],
    "en": [
     "Antenna calculator",
     "13 antenna types: dimensions, gain, impedance, cable and connector losses, radiated power against band limits; a \"Use in planner\" button."
    ]
   },
   {
    "icon": "mdi:image-filter-hdr",
    "where": "map:horizon",
    "pl": [
     "Panorama terenu",
     "Sylwetka terenu dookoła bramki z węzłami (widoczne i zasłonięte), z krzywizną Ziemi."
    ],
    "en": [
     "Terrain panorama",
     "Terrain skyline around the gateway with nodes (visible and hidden), with Earth curvature."
    ]
   }
  ]
 },
 {
  "pl": "Wiadomości i czat",
  "en": "Messages and chat",
  "items": [
   {
    "icon": "mdi:message-text",
    "where": "tab:messages",
    "pl": [
     "Wiadomości",
     "Kanały i wiadomości prywatne, historia zapisywana w HA, statusy doręczenia jak w aplikacji, podział i składanie długich wiadomości, sygnał i przekaźnik przy wiadomości, szczegóły doręczenia."
    ],
    "en": [
     "Messages",
     "Channels and direct messages, history stored in HA, delivery statuses like the app, splitting and reassembling long messages, signal and relay on a message, delivery details."
    ]
   },
   {
    "icon": "mdi:image",
    "where": "settings:chat",
    "pl": [
     "Zdjęcia i podglądy obrazów",
     "Wysyłanie zdjęć z czatu, pełnoekranowy podgląd, automatyczne ładowanie obrazów z linków (ustawienie Czat), udostępnianie lokalizacji per kanał."
    ],
    "en": [
     "Photos and image previews",
     "Sending photos from the chat, full-screen viewer, automatic loading of images from links (Chat setting), location sharing per channel."
    ]
   }
  ]
 },
 {
  "pl": "Radio i ustawienia",
  "en": "Radio and settings",
  "items": [
   {
    "icon": "mdi:radio-handheld",
    "where": "tab:radio",
    "pl": [
     "Radio",
     "Karta bramki z połączeniem, modelem, firmware, baterią, obciążeniem kanału, szumem, licznikami i wykresami; tabela kanałów; pamiętane statystyki po restarcie."
    ],
    "en": [
     "Radio",
     "Gateway card with connection, model, firmware, battery, channel load, noise, counters and charts; channel table; statistics remembered after a restart."
    ]
   },
   {
    "icon": "mdi:cog",
    "where": "tab:settings",
    "pl": [
     "Pełna konfiguracja radia",
     "LoRa (pełna lista presetów, nadpisanie Coding Rate, Ok dla MQTT), kanały z PSK i lokalizacją, użytkownik, moduły (Mesh Beacon, Traffic Management, Status Message, Serial z nowymi trybami, Remote Hardware), bezpieczeństwo, ekran, pozycjonowanie z przyciskiem „Użyj lokalizacji Home Assistanta”, listy czasów jak w aplikacji."
    ],
    "en": [
     "Full radio configuration",
     "LoRa (full preset list, Coding Rate override, Ok to MQTT), channels with PSK and location, user, modules (Mesh Beacon, Traffic Management, Status Message, Serial with new modes, Remote Hardware), security, screen, positioning with a \"Use Home Assistant location\" button, time lists like the app."
    ]
   },
   {
    "icon": "mdi:update",
    "where": "settings:ota",
    "pl": [
     "Firmware (OTA) i odłączenie od radia",
     "Aktualizacja ESP32 przez Wi-Fi lub Bluetooth, nRF52 przez DFU; odłączenie na 5, 10, 15 lub 30 minut, żeby radio było wolne dla innej aplikacji."
    ],
    "en": [
     "Firmware (OTA) and radio disconnect",
     "ESP32 update over Wi-Fi or Bluetooth, nRF52 over DFU; disconnect for 5, 10, 15 or 30 minutes so the radio is free for another app."
    ]
   },
   {
    "icon": "mdi:database",
    "where": "settings:storage",
    "pl": [
     "Pamięć i czyszczenie bazy węzłów",
     "Okres trzymania danych panelu (1–60 dni), czyszczenie bazy radia wg nieaktywności i rodzaju węzła (także tylko z niezgodnym kluczem), tryb automatyczny."
    ],
    "en": [
     "Storage and node database cleanup",
     "Panel data retention (1–60 days), radio database cleanup by inactivity and node kind (including mismatched key only), automatic mode."
    ]
   },
   {
    "icon": "mdi:source-branch",
    "where": "",
    "pl": [
     "Protobufy 2.8.2",
     "Definicje protokołu z najnowszego oryginalnego wydania, te same co w aplikacji MT_SW_APP."
    ],
    "en": [
     "Protobufs 2.8.2",
     "Protocol definitions from the latest upstream release, the same as in the MT_SW_APP app."
    ]
   }
  ]
 },
 {
  "pl": "Diagnostyka",
  "en": "Diagnostics",
  "items": [
   {
    "icon": "mdi:radar",
    "where": "settings:sniffer",
    "pl": [
     "Sniffer radiowy i MQTT",
     "Log jak w aplikacji: karty pakietów, grupowanie powtórzeń, odszyfrowywanie po hashu kanału, pełna treść pakietów, filtry, wyszukiwarka, eksport JSON i CSV, bufor do 25 000."
    ],
    "en": [
     "Radio and MQTT sniffer",
     "A log like the app: packet cards, repeat grouping, decryption by channel hash, full packet content, filters, search, JSON and CSV export, buffer up to 25,000."
    ]
   },
   {
    "icon": "mdi:stethoscope",
    "where": "tab:nodes",
    "pl": [
     "Diagnostyka na żądanie (OnDemand)",
     "W szczegółach węzła z MT_SW_FIRMWARE: statystyki, ping, węzły online, błędy routingu, aktywność eteru, log pakietów."
    ],
    "en": [
     "On-demand diagnostics (OnDemand)",
     "In node details with MT_SW_FIRMWARE: statistics, ping, online nodes, routing errors, airtime, packet log."
    ]
   },
   {
    "icon": "mdi:bug-outline",
    "where": "settings:debug_logs",
    "pl": [
     "Logi debugowania",
     "Dwa logi jak w aplikacji: urządzenie (logi firmware) i integracja; filtr poziomu, wyszukiwarka, kopiowanie i eksport, bufor 5 000 / 10 000 / 25 000."
    ],
    "en": [
     "Debug logs",
     "Two logs like the app: device (firmware logs) and integration; level filter, search, copy and export, buffer 5,000 / 10,000 / 25,000."
    ]
   }
  ]
 },
 {
  "pl": "Wsparcie, klient web i prawa",
  "en": "Support, web client and rights",
  "items": [
   {
    "icon": "mdi:heart-outline",
    "where": "settings:support",
    "pl": [
     "Wsparcie i zgłoszenia",
     "Dobrowolne wsparcie projektu (Ko-fi), zgłaszanie błędów i pomysłów (Discord, WhatsApp, Signal) z paczką logów oraz przełącznik zbierania logów debugowania."
    ],
    "en": [
     "Support and reports",
     "Voluntary support of the project (Ko-fi), reporting bugs and ideas (Discord, WhatsApp, Signal) with a logs package and a debug log collection switch."
    ]
   },
   {
    "icon": "mdi:web",
    "where": "",
    "pl": [
     "Klient webowy MT_SW",
     "Przebudowany na najnowszej wersji oryginału z naszą oprawą, mapą OpenStreetMap i pełnym polskim tłumaczeniem (opcjonalny, w Opcjach integracji)."
    ],
    "en": [
     "MT_SW web client",
     "Rebuilt on the latest upstream version with our branding, OpenStreetMap map and a full Polish translation (optional, in the integration Options)."
    ]
   },
   {
    "icon": "mdi:palette-swatch",
    "where": "",
    "pl": [
     "Branding MT_SW",
     "Ikona i logo w Home Assistancie, panelu i kliencie webowym; kolory #F5C839 i #2C2D3C; napisy po polsku (angielski jako zapasowy)."
    ],
    "en": [
     "MT_SW branding",
     "Icon and logo in Home Assistant, the panel and the web client; colours #F5C839 and #2C2D3C; Polish texts (English as a fallback)."
    ]
   }
  ]
 }
];

class MtswFunctionsTab extends LitElement {
  static get properties() {
    return { hass: { type: Object } };
  }

  _lang() {
    return ((this.hass && this.hass.language) || "pl").startsWith("pl") ? "pl" : "en";
  }

  _go(where) {
    if (!where) return;
    this.dispatchEvent(new CustomEvent("mtsw-goto", { detail: { where }, bubbles: true, composed: true }));
  }

  render() {
    const lang = this._lang();
    return html`
      <div class="wrap">
        <h4>${lang === "pl" ? "Pozostałe funkcje" : "Other functions"}</h4>
        <p class="legend">${lang === "pl" ? "Wszystko, co dodaliśmy od siebie. Kliknij funkcję z ikoną strzałki, żeby ją otworzyć." : "Everything we added ourselves. Click a function with an arrow to open it."}</p>
        ${SECTIONS.map(
          (s) => html`
            <h4>${s[lang]}</h4>
            <div class="list">
              ${s.items.map(
                (i) => html`<div class="item ${i.where ? "link" : ""}" @click=${() => this._go(i.where)}>
                  <ha-icon icon=${i.icon}></ha-icon>
                  <span><b>${i[lang][0]}</b><small>${i[lang][1]}</small></span>
                  ${i.where ? html`<ha-icon class="go" icon="mdi:chevron-right"></ha-icon>` : ""}
                </div>`
              )}
            </div>`
        )}
      </div>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; }
      .wrap { padding: 0; }
      h3 { margin: 14px 0 6px; font-weight: 500; }
      h4 { margin: 18px 0 8px; font-weight: 500; color: var(--secondary-text-color); font-size: 14px; }
      .legend { font-size: 12px; color: var(--secondary-text-color); }
      .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
      .item { display: flex; gap: 12px; align-items: center; text-align: left; color: var(--primary-text-color); background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 12px; padding: 12px 14px; }
      .item.link { cursor: pointer; }
      .item.link:hover { background: var(--secondary-background-color); }
      ha-icon { color: var(--secondary-text-color); flex: none; }
      .go { margin-left: auto; }
      span { display: flex; flex-direction: column; gap: 2px; }
      small { color: var(--secondary-text-color); font-size: 12px; }
    `;
  }
}

if (!customElements.get("mtsw-functions-tab")) {
  customElements.define("mtsw-functions-tab", MtswFunctionsTab);
}
