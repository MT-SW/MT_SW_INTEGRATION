/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Tłumaczenia panelu MT_SW_INTEGRATION.
 *
 * Home Assistant nie udostępnia frontendowi dowolnych kluczy z translations/*.json
 * (tylko kategorie takie jak config, options, entity), dlatego napisy panelu
 * trzymamy tutaj. Język wybierany jest po hass.language, z fallbackiem na pl.
 *
 * Dodanie języka = dopisanie kolejnego obiektu poniżej. Polski jest bazą —
 * jeśli w innym języku brakuje klucza, użyty zostanie polski.
 */

export const DEFAULT_LANGUAGE = "pl";

const STRINGS = {
  pl: {
    "panel.title": "MT_SW_INTEGRATION",

    "tab.radio": "Radio",
    "tab.messages": "Wiadomości",
    "tab.neighbors": "Sąsiedzi",

    "common.unknown": "—",
    "common.yes": "Tak",
    "common.no": "Nie",
    "common.open": "Otwórz",
    "common.refresh": "Odśwież",
    "common.loading": "Wczytywanie…",

    "radio.no_gateways": "Nie znaleziono żadnej załadowanej bramki.",
    "radio.status.available": "Połączona",
    "radio.status.unavailable": "Brak połączenia",
    "radio.web_client": "Klient WWW",
    "radio.web_client.open": "Otwórz klient WWW",
    "radio.web_client.unavailable": "Klient WWW niedostępny",

    "radio.section.device": "Urządzenie",
    "radio.hw_model": "Model sprzętu",
    "radio.role": "Rola",
    "radio.firmware": "Firmware",
    "radio.node_id": "ID węzła",
    "radio.uptime": "Czas pracy",

    "radio.section.power": "Zasilanie i eter",
    "radio.battery": "Bateria",
    "radio.voltage": "Napięcie",
    "radio.channel_utilization": "Wykorzystanie kanału",
    "radio.air_util_tx": "Czas nadawania",
    "radio.noise_floor": "Poziom szumu",

    "radio.section.packets": "Pakiety",
    "radio.packets_tx": "Wysłane",
    "radio.packets_rx": "Odebrane",
    "radio.packets_rx_bad": "Błędne",
    "radio.packets_tx_relay": "Przekazane",
    "radio.packets_tx_dropped": "Odrzucone",

    "radio.section.mesh": "Sieć",
    "radio.nodes_online": "Węzły online",
    "radio.nodes_total": "Węzły łącznie",
    "radio.tracked_nodes": "Węzły śledzone",

    "radio.section.channels": "Kanały",
    "radio.channels.empty": "Bramka nie zgłosiła jeszcze żadnych kanałów.",
    "radio.channels.error": "Nie udało się pobrać kanałów z bramki.",
    "radio.channels.index": "Nr",
    "radio.channels.name": "Nazwa",
    "radio.channels.role": "Rola",
    "radio.channels.psk": "Szyfrowanie",
    "radio.channels.encrypted": "Szyfrowany",
    "radio.channels.open": "Otwarty",
    "radio.channels.uplink": "Uplink",
    "radio.channels.downlink": "Downlink",
    "radio.channels.precision": "Precyzja pozycji",
    "radio.channels.unnamed": "(bez nazwy)",

    "messages.channel": "Kanał",
    "messages.empty": "Brak wiadomości i kanałów do wyświetlenia.",
    "messages.no_messages": "Ta rozmowa jest jeszcze pusta.",
    "messages.placeholder": "Napisz wiadomość… (Enter wysyła, Shift+Enter nowa linia)",
    "messages.send": "Wyślij",
    "messages.sending": "Wysyłanie…",
    "messages.send_failed": "Nie udało się wysłać wiadomości.",
    "messages.hops": "{n} przeskoków",
    "messages.ack.pending": "Oczekuje na potwierdzenie",
    "messages.ack.ok": "Potwierdzona",
    "messages.ack.failed": "Brak potwierdzenia",

    "radio.chart.airtime": "Obciążenie eteru",
    "radio.chart.packets": "Ruch pakietów (na próbkę)",
    "radio.chart.empty": "Zbieranie danych — wykres pojawi się po kilku minutach.",
    "radio.chart.chutil": "Wykorzystanie kanału",
    "radio.chart.airutil": "Czas nadawania",
    "radio.chart.tx": "Wysłane",
    "radio.chart.rx": "Odebrane",
    "radio.chart.rx_bad": "Błędne",

    "neighbors.empty": "Żaden śledzony węzeł nie zgłosił jeszcze sąsiadów.",
    "neighbors.none_in_frame": "Brak sąsiadów w ostatniej ramce.",
    "neighbors.col.neighbor": "Sąsiad",
    "neighbors.col.id": "ID",
    "neighbors.col.snr": "SNR",
    "neighbors.col.last_heard": "Ostatnio słyszany",
    "neighbors.count": "{count} sąsiadów",

    "duration.days": "{n} d",
    "duration.hours": "{n} godz.",
    "duration.minutes": "{n} min",
    "duration.seconds": "{n} s",
  },

  en: {
    "panel.title": "MT_SW_INTEGRATION",

    "tab.radio": "Radio",
    "tab.messages": "Messages",
    "tab.neighbors": "Neighbors",

    "common.unknown": "—",
    "common.yes": "Yes",
    "common.no": "No",
    "common.open": "Open",
    "common.refresh": "Refresh",
    "common.loading": "Loading…",

    "radio.no_gateways": "No loaded gateway found.",
    "radio.status.available": "Connected",
    "radio.status.unavailable": "Disconnected",
    "radio.web_client": "Web client",
    "radio.web_client.open": "Open web client",
    "radio.web_client.unavailable": "Web client unavailable",

    "radio.section.device": "Device",
    "radio.hw_model": "Hardware model",
    "radio.role": "Role",
    "radio.firmware": "Firmware",
    "radio.node_id": "Node ID",
    "radio.uptime": "Uptime",

    "radio.section.power": "Power & airtime",
    "radio.battery": "Battery",
    "radio.voltage": "Voltage",
    "radio.channel_utilization": "Channel utilization",
    "radio.air_util_tx": "Air util TX",
    "radio.noise_floor": "Noise floor",

    "radio.section.packets": "Packets",
    "radio.packets_tx": "Sent",
    "radio.packets_rx": "Received",
    "radio.packets_rx_bad": "Bad",
    "radio.packets_tx_relay": "Relayed",
    "radio.packets_tx_dropped": "Dropped",

    "radio.section.mesh": "Mesh",
    "radio.nodes_online": "Nodes online",
    "radio.nodes_total": "Nodes total",
    "radio.tracked_nodes": "Tracked nodes",

    "radio.section.channels": "Channels",
    "radio.channels.empty": "The gateway has not reported any channels yet.",
    "radio.channels.error": "Could not fetch channels from the gateway.",
    "radio.channels.index": "#",
    "radio.channels.name": "Name",
    "radio.channels.role": "Role",
    "radio.channels.psk": "Encryption",
    "radio.channels.encrypted": "Encrypted",
    "radio.channels.open": "Open",
    "radio.channels.uplink": "Uplink",
    "radio.channels.downlink": "Downlink",
    "radio.channels.precision": "Position precision",
    "radio.channels.unnamed": "(unnamed)",

    "messages.channel": "Channel",
    "messages.empty": "No messages or channels to show.",
    "messages.no_messages": "This conversation is still empty.",
    "messages.placeholder": "Write a message… (Enter sends, Shift+Enter for a new line)",
    "messages.send": "Send",
    "messages.sending": "Sending…",
    "messages.send_failed": "Could not send the message.",
    "messages.hops": "{n} hops",
    "messages.ack.pending": "Awaiting acknowledgement",
    "messages.ack.ok": "Acknowledged",
    "messages.ack.failed": "Not acknowledged",

    "radio.chart.airtime": "Airtime load",
    "radio.chart.packets": "Packet traffic (per sample)",
    "radio.chart.empty": "Collecting data — the chart appears after a few minutes.",
    "radio.chart.chutil": "Channel utilization",
    "radio.chart.airutil": "Air util TX",
    "radio.chart.tx": "Sent",
    "radio.chart.rx": "Received",
    "radio.chart.rx_bad": "Bad",

    "neighbors.empty": "No tracked node has reported neighbors yet.",
    "neighbors.none_in_frame": "No neighbors in the last frame.",
    "neighbors.col.neighbor": "Neighbor",
    "neighbors.col.id": "ID",
    "neighbors.col.snr": "SNR",
    "neighbors.col.last_heard": "Last heard",
    "neighbors.count": "{count} neighbors",

    "duration.days": "{n}d",
    "duration.hours": "{n}h",
    "duration.minutes": "{n}m",
    "duration.seconds": "{n}s",
  },
};

/**
 * Zwraca kod języka obsługiwanego przez panel na podstawie obiektu hass.
 * "pl-PL" i "pl" trafiają na "pl"; nieznany język -> DEFAULT_LANGUAGE.
 */
export function resolveLanguage(hass) {
  const raw = (hass && hass.language) || DEFAULT_LANGUAGE;
  const base = String(raw).toLowerCase().split("-")[0];
  return STRINGS[base] ? base : DEFAULT_LANGUAGE;
}

/**
 * Tłumaczy klucz. vars podmienia wystąpienia {nazwa} w napisie.
 * Brakujący klucz spada na polski, a w ostateczności zwraca sam klucz,
 * żeby brak tłumaczenia był widoczny, a nie cichy.
 */
export function t(hass, key, vars) {
  const lang = resolveLanguage(hass);
  let text = STRINGS[lang][key];
  if (text === undefined) {
    text = STRINGS[DEFAULT_LANGUAGE][key];
  }
  if (text === undefined) {
    return key;
  }
  if (!vars) {
    return text;
  }
  return Object.keys(vars).reduce(
    (acc, name) => acc.split(`{${name}}`).join(String(vars[name])),
    text
  );
}

/** Formatuje czas pracy w sekundach na zwięzły napis w języku panelu. */
export function formatUptime(hass, seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) {
    return t(hass, "common.unknown");
  }
  const total = Math.max(0, Math.floor(Number(seconds)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const parts = [];
  if (days) parts.push(t(hass, "duration.days", { n: days }));
  if (hours) parts.push(t(hass, "duration.hours", { n: hours }));
  if (minutes && parts.length < 2) parts.push(t(hass, "duration.minutes", { n: minutes }));
  if (!parts.length) parts.push(t(hass, "duration.seconds", { n: secs }));
  return parts.slice(0, 2).join(" ");
}
