/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Przygotowanie zdjęcia do wysłania z czatu. Serwer Home Assistanta przyjmuje do
 * 15 MB (patrz image_upload.py); większe zdjęcie z aparatu zmniejszamy w
 * przeglądarce i zapisujemy jako JPEG, zamiast odrzucać.
 */

/* Musi się zgadzać z MAX_UPLOAD_BYTES w image_upload.py. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const SHRINK_MAX_SIDE = 2560;
const SHRINK_QUALITY = 0.85;

/**
 * Plik gotowy do wysłania: bez zmian, gdy mieści się w limicie, a inaczej zmniejszony.
 * Rzuca błędem, gdy nie da się go zmniejszyć (przeglądarka nie odczyta formatu).
 */
export async function preparePhoto(file) {
  if (file.size <= MAX_PHOTO_BYTES) {
    return file;
  }
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, SHRINK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", SHRINK_QUALITY));
  if (!blob || blob.size > MAX_PHOTO_BYTES) {
    throw new Error("photo_too_large");
  }
  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}
