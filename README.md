# MT_SW — opis / description

Repo: https://github.com/MT-SW/MT_SW_INTEGRATION


===========================================
PL — WERSJA POLSKA
===========================================

## MT_SW — fork integracji Meshtastic dla Home Assistant

Fork oficjalnej integracji meshtastic/home-assistant, rozwijany dla sieci mesh Świętokrzyskie. Oprócz encji i usług znanych z oryginału ma własny panel w pasku bocznym Home Assistanta (radio, wiadomości, węzły, mapa i pełne ustawienia radia) oraz obsługę funkcji firmware MT_SW.

Wymagania i instalacja:
- Home Assistant 2024.11.0 lub nowszy
- Instalacja przez HACS jako własne repozytorium (Custom repositories, typ Integration), potem dodanie integracji w Ustawienia → Urządzenia i usługi
- Połączenie z radiem: TCP (WiFi/Ethernet), USB (port szeregowy) lub Bluetooth
- Domena integracji to nadal meshtastic, tak jak w oryginale, więc nie instaluj jej razem z oficjalną integracją Meshtastic
- Panel w pasku bocznym jest widoczny tylko dla administratorów

Panel MT_SW_INTEGRATION (pasek boczny):
- Radio: karta każdej bramki — połączenie, model, rola, firmware, czas pracy, bateria, napięcie, obciążenie kanału i czas nadawania, poziom szumu, liczniki pakietów, węzły online i łącznie, wykresy oraz tabela kanałów. Ostatnie statystyki są pamiętane po restarcie do następnego pakietu od węzła. Tu też jest wyrzutnia wbudowanego klienta WWW
- Wiadomości: kanały i wiadomości bezpośrednie, wysyłanie, historia zapisywana w Home Assistancie, status doręczenia (oczekuje, wysłano do sieci, potwierdzona przez odbiorcę) oraz szczegóły wiadomości: trasa i liczba przeskoków, SNR i RSSI, przekaźniki, które ją usłyszały, podpis XEdDSA
- Węzły: lista z filtrami (ulubione, bezpośrednie, z pozycją, śledzone, bez MQTT, ignorowane) i kolumnami: krótka nazwa, nazwa, sygnał, skoki, bateria i ostatnio słyszany. Skoki są odmieniane (1 skok, 2 skoki, 5 skoków) i mają dopisek „via (krótka nazwa)” z przekaźnikiem ostatniego pakietu. SNR i RSSI są w jednej kolumnie i tylko dla połączeń bezpośrednich, bo przy skokach opisują łącze z przekaźnikiem, a nie z samym węzłem
- Szczegóły węzła: dane są w kategoriach nazwanych jak w aplikacji na Androida — Informacje o sąsiadach, Jakość sygnału (SNR, RSSI i poziom szumu), Metryka urządzenia, Metryki środowiskowe, Metryki zasilania, Pakiety, Zasoby, Pozycjonowanie i Śledzenie trasy. Każda kategoria ma przycisk „Historia”, a te, o które można zapytać węzeł, także „Poproś”. Historia pokazuje się na żądanie, jedna kategoria naraz, tylko dla otwartego węzła. Poza tym są akcje: wiadomość, ulubiony, ignorowanie, usunięcie węzła oraz diagnostyka na żądanie
- Mapa: pozycje węzłów, koła precyzji, linie topologii z NeighborInfo (SNR) i grupowanie gęstych etykiet. Dostawca kafli jest do wyboru: standardowe OpenStreetMap (jak w aplikacji), Esri, OpenTopoMap, CARTO, Stadia lub własny adres. Każdy dostawca ma osobny klucz API, zapisywany w Home Assistancie, więc wpisuje się go raz dla wszystkich przeglądarek i aplikacji mobilnej
- Ustawienia: pełna konfiguracja radia podłączonego do Home Assistanta, w grupach. Konfiguracja radia: LoRa, kanały (z kluczem PSK), użytkownik i wiadomość statusu. Konfiguracja urządzenia: urządzenie, pozycja, zasilanie, sieć, wyświetlacz, Bluetooth, bezpieczeństwo i ekran. Konfiguracja modułów: MQTT (z raportowaniem map), port szeregowy, powiadomienia zewnętrzne, Store & Forward, test zasięgu, telemetria, wiadomości predefiniowane, audio, informacje o sąsiadach, oświetlenie, czujnik detekcji, Paxcounter oraz moduły MT_SW: zarządzanie ruchem i Meshbeacon. Inne: Sniffer, akcje urządzenia (restart, wyłączenie, resety) i zarządzanie danymi zapisanymi przez panel
- Wszystkie napisy są po polsku (angielski jako zapasowy), a nazwy w Ustawieniach są dopasowane do aplikacji MT_SW na Androida

Funkcje firmware MT_SW (wymagają radia z firmware MT_SW):
- Diagnostyka na żądanie (OnDemand, port 354) w szczegółach węzła: statystyki węzła (bateria, czas pracy, CPU, pamięć, liczniki), ping także z potwierdzeniem, węzły online, błędy routingu, liczniki portów, aktywność eteru, log wymiany pakietów, historia odbioru i wersja MT_SW Firmware. Nazwy portów i błędów są takie same jak w aplikacji na Androida
- Sniffer (Ustawienia → Sniffer): włączanie i wyłączanie przez OnDemand (wymaga FW+ w wersji 3 lub nowszej), ostrzeżenie przed włączeniem, log przechwyconych pakietów na żywo (do 5000 w pamięci) z filtrem, pauzą i eksportem do JSON i CSV. Stan sniffera jest w pamięci RAM radia, więc po restarcie zawsze jest wyłączony, a włączyć go można tylko na bramce podłączonej do Home Assistanta

Encje i usługi (jak w oryginale, z poprawkami poniżej): czujniki telemetrii i statystyk, czujniki binarne (m.in. wyciszony, podpisany XEdDSA, słyszany na bieżącym LoRa), device_tracker, przyciski (restart, pobranie sąsiadów), encje tekstowe, powiadomienia (notify) dla kanałów i węzłów, wpisy w logbooku, wyzwalacze i akcje urządzeń oraz usługi send_text, send_direct_message, broadcast_channel_message, request_telemetry, request_position, request_traceroute i set_fixed_position.

Opcjonalne, domyślnie wyłączone:
- Wbudowany klient WWW Meshtastic (domyślnie port 4408) z własnym brandingiem MT_SW i tłumaczeniami w 22 językach
- Lokalne proxy TCP (domyślnie port 4403), które pozwala innym klientom współdzielić jedno połączenie z radiem. Radio zwykle obsługuje jednego klienta naraz, więc inne aplikacje łącz przez to proxy, a nie wprost z adresem radia

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
- Przebudowane powiązanie urządzeń dla encji gateway/channel/direct-message (dawniej fix-2.10) — usunięto ustawianie device_info bez config entry (deprecated w HA core, przestałoby działać w HA 2027.8.0); linkowanie odbywa się teraz przez entity_registry.async_update_entity()
- Zastąpiono przestarzałą stałą CONCENTRATION_MICROGRAMS_PER_CUBIC_METER przez UnitOfDensity (dawniej fix-2.11)
- Encje, urządzenia i filtr węzłów są rozpoznawane po kluczu publicznym PKI, więc przeżywają zmianę numeru węzła (kolizja w sieci, aktualizacja firmware); duplikaty są wykrywane i scalane
- Zmiana filtra węzłów działa od razu, bez przeładowania integracji; usuwanie nieaktualnych węzłów z urządzenia jest ponawiane, a ręczne usuwanie urządzeń jest zawsze dozwolone
- Stabilniejsze połączenie: ponowne połączenia pobierają minimalną konfigurację zamiast pełnej synchronizacji, heartbeat jest tylko informacyjny, proxy TCP zapamiętuje konfigurację radia, naprawiono ponowne łączenie po USB po zerwaniu oraz podwajanie kanałów po ponownym połączeniu
- Wendorowane protobufy pochodzą wprost z oficjalnego meshtastic/protobufs, bez własnego forka

Dodane funkcje:
- Sensor Noise Floor (localStats.noiseFloor)
- Sensory Heap Total / Heap Free (port z upstream dev)
- state_class: measurement dla liczników pakietów z localStats
- reply_id w akcjach send_text / send_direct_message / broadcast_channel_message
- Obsługa Neighbor Info: przycisk pobrania sąsiadów, lista sąsiadów z SNR w atrybutach i w panelu oraz linie topologii na mapie
- Panel w pasku bocznym opisany wyżej, z własnym backendem WebSocket i trwałą historią wiadomości oraz danych węzłów
- Własny branding: ikona i logo MT_SW w Home Assistancie, w panelu i w wbudowanym kliencie WWW
- Przywrócone nagłówki SPDX/MIT w plikach, które miały je w oryginale

Podziękowania:
- Meshtastic i Pascal Brogle (@broglep) za oficjalną integrację, na której oparty jest ten fork
- Daring-Designs/meshtastic-ui-ha (MIT) — z tego projektu pochodzi zakładka Ustawienia; pozostałe zakładki panelu są własne


===========================================
EN — ENGLISH VERSION
===========================================

## MT_SW — Meshtastic integration fork for Home Assistant

A fork of the official meshtastic/home-assistant integration, maintained for the Świętokrzyskie mesh network. On top of the entities and services from the original it has its own sidebar panel in Home Assistant (radio, messages, nodes, map and full radio settings) and support for MT_SW firmware features.

Requirements and installation:
- Home Assistant 2024.11.0 or newer
- Install through HACS as a custom repository (type Integration), then add the integration under Settings → Devices & services
- Connection to the radio: TCP (WiFi/Ethernet), USB (serial port) or Bluetooth
- The integration domain is still meshtastic, as in the original, so do not install it next to the official Meshtastic integration
- The sidebar panel is visible to administrators only

MT_SW_INTEGRATION panel (sidebar):
- Radio: a card for each gateway — connection, model, role, firmware, uptime, battery, voltage, channel utilization and airtime, noise floor, packet counters, nodes online and total, charts and a channel table. The latest statistics are remembered across restarts until the next packet from the node. The launcher for the embedded web client is here too
- Messages: channels and direct messages, sending, history stored in Home Assistant, delivery status (pending, sent to the mesh, acknowledged by the recipient) and message details: route and hop count, SNR and RSSI, relays that heard it, XEdDSA signature
- Nodes: a list with filters (favorites, direct, with position, tracked, hide MQTT, ignored) and columns: short name, name, signal, hops, battery and last heard. Hops are declined in Polish (1 skok, 2 skoki, 5 skoków) and carry a "via (short name)" note with the relay of the latest packet. SNR and RSSI share one column and are shown only for direct links, because with hops they describe the link to the relay, not to the node itself
- Node details: data is grouped in categories named as in the Android app — Neighbor info, Signal quality (SNR, RSSI and noise floor), Device metrics, Environment metrics, Power metrics, Packets, Resources, Position and Traceroute. Every category has a "History" button, and those the node can be asked about also have "Request". History is shown on demand, one category at a time, only for the open node. There are also actions: message, favorite, ignore, remove node and on-demand diagnostics
- Map: node positions, precision circles, topology lines from NeighborInfo (SNR) and grouping of dense labels. The tile provider is selectable: standard OpenStreetMap (as in the app), Esri, OpenTopoMap, CARTO, Stadia or a custom URL. Each provider has its own API key, stored in Home Assistant, so it is entered once for every browser and the mobile app
- Settings: full configuration of the radio connected to Home Assistant, in groups. Radio config: LoRa, channels (with PSK), user and status message. Device config: device, position, power, network, display, Bluetooth, security and screen. Module config: MQTT (with map reporting), serial, external notification, Store & Forward, range test, telemetry, canned messages, audio, neighbor info, ambient lighting, detection sensor, Paxcounter, plus MT_SW modules: traffic management and Meshbeacon. Other: the Sniffer, device actions (reboot, shutdown, resets) and management of the data stored by the panel
- All texts are in Polish (English as a fallback), and the names in Settings match the MT_SW Android app

MT_SW firmware features (require a radio running MT_SW firmware):
- On-demand diagnostics (OnDemand, port 354) in the node details: node stats (battery, uptime, CPU, memory, counters), ping including the acknowledged variant, nodes online, routing errors, port counters, air activity, packet exchange log, RX history and MT_SW Firmware version. Port and error names are the same as in the Android app
- Sniffer (Settings → Sniffer): enabled and disabled through OnDemand (requires FW+ version 3 or newer), a warning before enabling, a live log of captured packets (up to 5000 in memory) with a filter, pause and export to JSON and CSV. The sniffer state lives in the radio's RAM, so it is always off after a reboot, and it can only be enabled on the gateway connected to Home Assistant

Entities and services (as in the original, with the fixes below): telemetry and statistics sensors, binary sensors (e.g. muted, XEdDSA signed, heard on the current LoRa), device_tracker, buttons (reboot, request neighbors), text entities, notify entities for channels and nodes, logbook entries, device triggers and actions, and the services send_text, send_direct_message, broadcast_channel_message, request_telemetry, request_position, request_traceroute and set_fixed_position.

Optional, disabled by default:
- Embedded Meshtastic web client (port 4408 by default) with MT_SW branding and translations in 22 languages
- Local TCP proxy (port 4403 by default) that lets other clients share the single connection to the radio. The radio usually serves one client at a time, so connect other apps through this proxy rather than straight to the radio's address

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
- Reworked device linkage for gateway/channel/direct-message entities (formerly fix-2.10) — stopped setting device_info at construction (deprecated in HA core, would break in HA 2027.8.0); linkage now goes through entity_registry.async_update_entity() instead
- Replaced the deprecated CONCENTRATION_MICROGRAMS_PER_CUBIC_METER constant with UnitOfDensity (formerly fix-2.11)
- Entities, devices and the node filter are recognized by the PKI public key, so they survive a node number change (mesh collision, firmware update); duplicates are detected and merged
- A node filter change applies immediately without reloading the integration; removal of stale nodes from the device is retried, and manual device removal is always allowed
- A steadier connection: reconnects fetch a minimal config instead of a full sync, the heartbeat is informational only, the TCP proxy caches the radio configuration, and USB reconnecting after a drop and channel doubling after a reconnect are fixed
- Vendored protobufs come straight from the official meshtastic/protobufs, without a custom fork

Added features:
- Noise Floor sensor (localStats.noiseFloor)
- Heap Total / Heap Free sensors (ported from upstream dev)
- state_class: measurement for the localStats packet counters
- reply_id support in the send_text / send_direct_message / broadcast_channel_message actions
- Neighbor Info support: a request-neighbors button, a neighbor list with SNR in attributes and in the panel, and topology lines on the map
- The sidebar panel described above, with its own WebSocket backend and persistent history of messages and node data
- Custom branding: the MT_SW icon and logo in Home Assistant, in the panel and in the embedded web client
- SPDX/MIT license headers restored in the files that had them in the original

Credits:
- Meshtastic and Pascal Brogle (@broglep) for the official integration this fork is based on
- Daring-Designs/meshtastic-ui-ha (MIT) — the Settings tab comes from that project; the other panel tabs are our own