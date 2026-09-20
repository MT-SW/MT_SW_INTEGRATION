/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Wersja FW+ (numer zwracany przez REQUEST_FW_PLUS_VERSION), od której firmware
 * ma wszystkie funkcje MT_SW naraz: diagnostykę na żądanie (OnDemand), sniffer
 * i resztę. Firmware z tymi funkcjami zgłasza domyślnie wersję 2, więc jeden
 * próg wystarcza dla całego panelu. Musi się zgadzać z MIN_FW_PLUS_VERSION
 * w ondemand.py.
 */

export const MIN_FW_PLUS_VERSION = 2;
