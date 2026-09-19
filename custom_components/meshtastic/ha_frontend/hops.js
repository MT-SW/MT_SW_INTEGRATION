/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Skoki i przekaźnik ostatniego pakietu od węzła — dla listy węzłów.
 *
 * Firmware podaje przekaźnik tylko jako ostatni bajt numeru węzła
 * (relay_node), więc nazwę dobieramy z bazy węzłów. Przekaźnik, którego
 * retransmisję słyszymy bezpośrednio, musi być naszym sąsiadem, dlatego
 * najpierw sprawdzamy węzły z hops_away == 0 (tak samo robi okno szczegółów
 * wiadomości).
 *
 * Moduł jest czystą funkcją, bez zależności od Lita ani DOM.
 */

/* Zapis z pakietu starszy od tego, co radio wie o węźle, jest nieaktualny —
   węzeł mógł się odezwać inną drogą, a nasz zapis o niej nie wie. */
const VIA_STALE_MS = 10 * 60 * 1000;

/* Zapis z pakietu jest świeży, jeśli nie jest wyraźnie starszy od tego, co radio wie o węźle. */
function viaFresh(node) {
  const heardMs = node.last_heard ? node.last_heard * 1000 : 0;
  return typeof node.via_ts === "number" && node.via_ts >= heardMs - VIA_STALE_MS;
}

/**
 * Skoki i przekaźnik węzła, na podstawie ostatniego pakietu, jeśli jest świeży,
 * a w przeciwnym razie samego hops_away z bazy radia.
 *
 * @returns {{hops: number|null, relay: number|null}} relay tylko dla hops > 0
 *   (przy połączeniu bezpośrednim przekaźnikiem jest sam nadawca)
 */
export function viaInfo(node) {
  const fresh = viaFresh(node);
  const fromPacket = fresh && typeof node.via_hops === "number";
  const hops = fromPacket ? node.via_hops : typeof node.hops_away === "number" ? node.hops_away : null;
  const relay = fresh && node.via_relay && hops !== null && hops > 0 ? node.via_relay : null;
  return { hops, relay };
}

/**
 * Nazwy węzłów pasujących do bajtu przekaźnika (krótkie nazwy, do dwóch);
 * gdy nikt nie pasuje, sam bajt w zapisie szesnastkowym.
 */
export function relayLabel(nodes, node, byte) {
  const candidates = (nodes || []).filter(
    (n) =>
      typeof n.node_id === "number" &&
      (n.node_id & 0xff) === byte &&
      n.node_id !== node.node_id &&
      !n.is_gateway
  );
  const direct = candidates.filter((n) => n.hops_away === 0);
  const pool = direct.length ? direct : candidates;
  if (!pool.length) {
    return `0x${byte.toString(16).padStart(2, "0")}`;
  }
  const names = pool.slice(0, 2).map((n) => n.short_name || n.long_name || n.node_hex);
  return names.join(" / ") + (pool.length > 2 ? " …" : "");
}

/**
 * SNR i RSSI węzła — tylko dla połączenia bezpośredniego. Przy skokach oba
 * odczyty opisują ostatni odcinek (do przekaźnika), a nie łącze z samym
 * węzłem, więc ich pokazywanie wprowadzałoby w błąd.
 *
 * @returns {{snr: number|null, rssi: number|null}|null} null, gdy węzeł nie jest bezpośredni
 */
export function signalInfo(node) {
  if (viaInfo(node).hops !== 0) {
    return null;
  }
  const fresh = viaFresh(node);
  const snr = fresh && typeof node.via_snr === "number" ? node.via_snr : typeof node.snr === "number" ? node.snr : null;
  const rssi = fresh && typeof node.via_rssi === "number" && node.via_rssi !== 0 ? node.via_rssi : null;
  return { snr, rssi };
}

/** "5.5 dB / -101 dBm"; pusty napis, gdy nie ma czego pokazać. */
export function formatSignal(info) {
  if (!info) {
    return "";
  }
  const parts = [];
  if (info.snr !== null) {
    parts.push(`${info.snr.toFixed(1)} dB`);
  }
  if (info.rssi !== null) {
    parts.push(`${info.rssi} dBm`);
  }
  return parts.join(" / ");
}
