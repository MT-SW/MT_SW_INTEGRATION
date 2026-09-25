/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Warstwa tłumacząca dane między naszym backendem a przeniesionymi
 * zakładkami z projektu meshtastic-ui-ha.
 *
 * Ich komponenty są czysto prezentacyjne, ale oczekują innego kształtu
 * danych niż nasz WebSocket API: węzły jako obiekt kluczowany "!hex"
 * zamiast tablicy, znaczniki czasu jako ISO zamiast milisekund, inne
 * nazwy pól telemetrii. Całe tłumaczenie siedzi tutaj, żeby ich pliki
 * zostały nietknięte i dały się podmieniać na nowsze wydania jeden do
 * jednego.
 */

/** Numer węzła -> "!hex", czyli postać, której używają ich komponenty. */
export function hexId(nodeId) {
  if (nodeId === null || nodeId === undefined) {
    return "";
  }
  return `!${(Number(nodeId) >>> 0).toString(16).padStart(8, "0")}`;
}

/** "!hex" (albo liczba) -> numer węzła, dla zdarzeń wracających z ich UI. */
export function numId(value) {
  if (typeof value === "number") {
    return value;
  }
  const raw = String(value || "").replace(/^!/, "");
  const parsed = Number.parseInt(raw, 16);
  return Number.isNaN(parsed) ? null : parsed;
}

function isoFromSeconds(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function isoFromMillis(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

/** Nasza tablica węzłów -> ich obiekt { "!hex": node }. */
export function adaptNodes(nodes) {
  const out = {};
  for (const node of nodes || []) {
    out[hexId(node.node_id)] = {
      id: hexId(node.node_id),
      num: node.node_id,
      name: node.long_name || node.short_name || hexId(node.node_id),
      short_name: node.short_name || "",
      hardware_model: node.hw_model || null,
      model: node.hw_model || null,
      role: node.role || null,
      battery: node.battery_level,
      voltage: node.voltage,
      snr: node.snr,
      rssi: node.rssi ?? null,
      hops: node.hops_away,
      hops_away: node.hops_away,
      via_mqtt: Boolean(node.via_mqtt),
      latitude: node.latitude ?? null,
      longitude: node.longitude ?? null,
      altitude: node.altitude ?? null,
      precision_bits: node.precision_bits ?? null,
      temperature: node.temperature ?? null,
      humidity: node.humidity ?? null,
      pressure: node.pressure ?? null,
      uptime: node.uptime_seconds ?? null,
      air_util_tx: node.air_util_tx ?? null,
      channel_utilization: node.channel_utilization ?? null,
      channel: node.channel ?? null,
      last_seen: isoFromSeconds(node.last_heard),
      _last_seen: isoFromSeconds(node.last_heard),
      is_favorite: Boolean(node.is_favorite),
      is_ignored: Boolean(node.is_ignored),
      is_gateway: Boolean(node.is_gateway),
      // nasze rozszerzenie: sąsiedzi z NeighborInfo, ich UI tego nie używa,
      // ale nie przeszkadza, a przyda się przy dokładaniu naszych widoków
      neighbors: node.neighbors || [],
    };
  }
  return out;
}

export function favoriteIds(nodes) {
  return (nodes || []).filter((n) => n.is_favorite).map((n) => hexId(n.node_id));
}

export function ignoredIds(nodes) {
  return (nodes || []).filter((n) => n.is_ignored).map((n) => hexId(n.node_id));
}

/** Klucz rozmowy w ich postaci: "ch_<index>" albo "dm_<!hex>". */
export function conversationKey(message) {
  if (message.to_channel !== null && message.to_channel !== undefined) {
    return `ch_${message.to_channel}`;
  }
  const peer = message.direction === "out" ? message.to_node : message.from;
  return peer === null || peer === undefined ? null : `dm_${hexId(peer)}`;
}

function adaptMessage(message) {
  return {
    message_id: message.id ?? null,
    packet_id: message.id ?? null,
    from: hexId(message.from),
    to: message.to_node === null || message.to_node === undefined ? null : hexId(message.to_node),
    channel: message.to_channel ?? null,
    text: message.text || "",
    timestamp: isoFromMillis(message.ts),
    _outgoing: message.direction === "out",
    type: message.to_channel === null || message.to_channel === undefined ? "direct" : "broadcast",
    reply_id: message.reply_id || 0,
    hops_away: message.hops_away ?? null,
    snr: message.rx_snr ?? null,
    status: message.ack || null,
    error: message.ack_error || null,
    // zachowane do usuwania po naszej stronie
    _ts: message.ts,
  };
}

/** Nasza płaska lista -> ich { klucz_rozmowy: [wiadomości] }. */
export function adaptMessages(messages) {
  const out = {};
  for (const message of messages || []) {
    const key = conversationKey(message);
    if (!key) {
      continue;
    }
    if (!out[key]) {
      out[key] = [];
    }
    out[key].push(adaptMessage(message));
  }
  return out;
}

/** Kanały -> ich lista rozmów kanałowych. */
export function adaptChannels(channels) {
  return (channels || [])
    .filter((channel) => channel.role && channel.role !== "DISABLED")
    .map((channel) => ({
      id: `ch_${channel.index}`,
      index: channel.index,
      name: channel.display_name || channel.name || `Channel ${channel.index}`,
      role: channel.role,
    }));
}

export function adaptChannelNames(channels) {
  const out = {};
  for (const channel of channels || []) {
    out[channel.index] = channel.display_name || channel.name || `Channel ${channel.index}`;
  }
  return out;
}

/** Rozmowy prywatne wyprowadzone z historii wiadomości. */
export function adaptDms(messages, nodes) {
  const byId = new Map((nodes || []).map((n) => [hexId(n.node_id), n]));
  const seen = new Map();

  for (const message of messages || []) {
    const key = conversationKey(message);
    if (!key || !key.startsWith("dm_")) {
      continue;
    }
    const peer = key.slice(3);
    const node = byId.get(peer);
    if (!seen.has(key) || seen.get(key).lastTs < message.ts) {
      seen.set(key, {
        id: key,
        node_id: peer,
        name: node ? node.long_name || node.short_name || peer : peer,
        lastTs: message.ts,
      });
    }
  }

  return [...seen.values()].sort((a, b) => b.lastTs - a.lastTs);
}

/** Statusy dostarczenia w ich postaci { message_id: status }. */
export function adaptDeliveryStatuses(messages) {
  const out = {};
  for (const message of messages || []) {
    if (message.direction === "out" && message.id) {
      out[message.id] = message.ack || "PENDING";
    }
  }
  return out;
}

/** Trasy z naszych wyników traceroute -> ich { "!hex": trasa }. */
export function adaptTraceroutes(routes) {
  const out = {};
  for (const [nodeId, route] of Object.entries(routes || {})) {
    out[nodeId] = {
      route: (route.route || []).map(hexId),
      route_back: (route.routeBack || []).map(hexId),
      snr_towards: route.snrTowards || [],
      snr_back: route.snrBack || [],
    };
  }
  return out;
}
