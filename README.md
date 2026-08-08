# Meshtastic_S+ — opis / description

Repo: https://github.com/Meshtastic-Swietokrzyskie/meshtastic_s_home-assistant


===========================================
PL — WERSJA POLSKA
===========================================

## Meshtastic_S+ — fork integracji Meshtastic dla Home Assistant

Fork oficjalnej integracji meshtastic/home-assistant, rozwijany dla sieci mesh Świętokrzyskie.

Co naprawia względem oryginału:
- Deduplikacja encji po unique_id zamiast entity_id (sensor / binary_sensor / device_tracker), także dla notify między config entries
- Stabilny entity_id dzięki suggested_object_id
- model_id przekazywane jako string do rejestru urządzeń
- Usunięte przestarzałe battery_level z device_tracker
- Naprawiony crash przy nienumerycznym state_class na sensorze userString
- Poprawione czyszczenie osieroconych encji/urządzeń — bazuje na skonfigurowanym filtrze węzłów
- Nazwy urządzeń aktualizują się na żywo z NodeInfo
- Naprawiony wolny start HA i zależność pyserial-asyncio-fast
- Wyeliminowany spam duplikatów ID przy race condition async_add_entities
- Nowość (2.10): przebudowane powiązanie urządzeń dla encji gateway/channel/direct-message — usunięto ustawianie device_info bez config entry (deprecated w HA core, przestałoby działać w HA 2027.8.0); linkowanie odbywa się teraz przez entity_registry.async_update_entity()
- Nowość (2.11): zastąpiono przestarzałą stałą CONCENTRATION_MICROGRAMS_PER_CUBIC_METER przez UnitOfDensity

Dodane funkcje:
- Sensor Noise Floor (localStats.noiseFloor)
- Sensory Heap Total / Heap Free (port z upstream dev)
- state_class: measurement dla liczników pakietów z localStats
- reply_id w akcjach send_text / send_direct_message / broadcast_channel_message
- Załatany wendorowany telemetry_pb2.py (brakujące pola LocalStats)

W planach:
- Obsługa Neighbor Info (lista sąsiadów/SNR per węzeł)
- Własny branding wbudowanego klienta meshtastic_web
- Przywrócenie nagłówków SPDX/MIT w ~40 plikach


===========================================
EN — ENGLISH VERSION
===========================================

## Meshtastic_S+ — Meshtastic integration fork for Home Assistant

A fork of the official meshtastic/home-assistant integration, maintained for the Świętokrzyskie mesh network.

Fixes over upstream:
- Deduplicates entities by unique_id instead of entity_id (sensor / binary_sensor / device_tracker), including notify entities across config entries
- Stable entity_id via suggested_object_id
- model_id passed as a string to the device registry
- Removed deprecated battery_level from device_tracker
- Fixed a crash from non-numeric state_class on the userString host sensor
- Fixed cleanup of orphaned entities/devices — now based on the configured node filter rather than live coordinator presence
- Device names now sync live from NodeInfo updates
- Fixed slow Home Assistant startup and the pyserial-asyncio-fast dependency
- Eliminated duplicate-entity-ID spam caused by a race in async_add_entities
- New in 2.10: reworked device linkage for gateway/channel/direct-message entities — stopped setting device_info at construction (deprecated in HA core, would break in HA 2027.8.0); linkage now goes through entity_registry.async_update_entity() instead
- New in 2.11: replaced the deprecated CONCENTRATION_MICROGRAMS_PER_CUBIC_METER constant with UnitOfDensity

Added features:
- Noise Floor sensor (localStats.noiseFloor)
- Heap Total / Heap Free sensors (ported from upstream dev)
- state_class: measurement for the localStats packet counters
- reply_id support in the send_text / send_direct_message / broadcast_channel_message actions
- Patched vendored telemetry_pb2.py (missing LocalStats fields)

Planned:
- Neighbor Info support (per-node neighbor/SNR list)
- Custom branding for the embedded meshtastic_web client
- Restoring SPDX/MIT license headers across ~40 files
