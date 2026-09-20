/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Linki w wiadomościach: rozpoznawanie adresów http(s) w tekście i wybór tych,
 * które wskazują obrazek, żeby czat mógł pokazać ich podgląd, jak w aplikacji.
 *
 * Moduł jest czystą funkcją, bez zależności od Lita ani DOM. Dopuszczamy wyłącznie
 * http i https — żadnych javascript:, data: ani innych schematów.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/* Podgląd nie powinien zalać czatu: kilka obrazków na wiadomość w zupełności wystarcza. */
export const MAX_IMAGES_PER_MESSAGE = 3;

/* Adres razem ze znakami interpunkcji na końcu ("zobacz https://a.pl/x.png.") nie jest linkiem
   do obrazka, więc je obcinamy. Zamykający nawias zostaje tylko wtedy, gdy adres sam go otwiera
   (np. ".../Foo_(bar)"). */
const CLOSERS = { ")": "(", "]": "[", "}": "{" };

function trimUrl(raw) {
  let url = raw;
  while (url.length) {
    const last = url[url.length - 1];
    if (".,;:!?".includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (CLOSERS[last] && url.split(last).length > url.split(CLOSERS[last]).length) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

/**
 * Tekst rozbity na kawałki zwykłego tekstu i linków, w kolejności występowania.
 *
 * @returns {Array<{type: "text"|"link", value: string}>}
 */
export function splitLinks(text) {
  const source = String(text ?? "");
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (!url) {
      continue;
    }
    if (match.index > last) {
      parts.push({ type: "text", value: source.slice(last, match.index) });
    }
    parts.push({ type: "link", value: url });
    last = match.index + url.length;
  }
  if (last < source.length) {
    parts.push({ type: "text", value: source.slice(last) });
  }
  return parts;
}

/* Czy adres wskazuje obrazek — po rozszerzeniu ścieżki (zapytanie i fragment się nie liczą). */
export function isImageUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && IMAGE_PATH.test(parsed.pathname);
  } catch (err) {
    return false;
  }
}

/** Adresy obrazków z tekstu: bez powtórzeń, najwyżej MAX_IMAGES_PER_MESSAGE. */
export function imageUrls(text) {
  const found = [];
  for (const part of splitLinks(text)) {
    if (part.type === "link" && isImageUrl(part.value) && !found.includes(part.value)) {
      found.push(part.value);
    }
  }
  return found.slice(0, MAX_IMAGES_PER_MESSAGE);
}

/* Przeglądarka zablokuje obrazek http na stronie https, więc nie ma sensu go próbować. */
export function canEmbed(url, pageProtocol) {
  return !(pageProtocol === "https:" && url.startsWith("http:"));
}
