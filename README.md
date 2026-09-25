# MT_SW — opis / description

Repo: https://github.com/MT-SW/MT_SW_INTEGRATION


===========================================
PL — WERSJA POLSKA
===========================================

## MT_SW — fork integracji Meshtastic dla Home Assistant

Fork oficjalnej integracji meshtastic/home-assistant, rozwijany dla sieci mesh Świętokrzyskie. Oprócz encji i usług znanych z oryginału ma własny panel w pasku bocznym Home Assistanta, działający jak aplikacja Meshtastic na telefonie (radio, wiadomości, węzły, mapa, sniffer i pełne ustawienia radia), obsługę funkcji firmware MT_SW oraz własny klient webowy MT_SW.

Wymagania i instalacja:
- Home Assistant 2024.11.0 lub nowszy — integracja sama dobiera API rejestru urządzeń i jednostek, więc działa zarówno na starszych wersjach (np. w kontenerze Dockera na OpenMediaVault), jak i na najnowszych
- Instalacja przez HACS jako własne repozytorium (Custom repositories, typ Integration), potem dodanie integracji w Ustawienia → Urządzenia i usługi
- Połączenie z radiem: TCP (WiFi/Ethernet), USB (port szeregowy) lub Bluetooth
- Domena integracji to nadal meshtastic, tak jak w oryginale, więc nie instaluj jej razem z oficjalną integracją Meshtastic
- Panel w pasku bocznym jest widoczny tylko dla administratorów
- Przy dodawaniu integracji, zaraz po połączeniu z radiem, wybierasz tryb pracy (opis niżej). Przy trybie „Tylko panel” kreator pomija wybór węzłów i encji powiadomień

Tryb pracy — dwie niezależne części:
- Integracja składa się z dwóch części, które działają niezależnie od siebie. Panel MT_SW to aplikacja w pasku bocznym i nie tworzy żadnych encji. Statystyki to urządzenia i encje Home Assistanta dla wybranych węzłów (bateria, sygnał, telemetria, pozycja, powiadomienia), z których korzystają historia, wykresy, karty i automatyzacje
- Do wyboru są trzy warianty: „Panel i statystyki” (zalecany), „Tylko panel” i „Tylko statystyki”. Tryb wybiera się przy dodawaniu integracji i zmienia w każdej chwili w Ustawienia → Urządzenia i usługi → MT_SW_INTEGRATION → Konfiguruj; każdy wariant ma na ekranie pełny opis
- Błąd w jednej części nigdy nie zatrzymuje drugiej: start odbywa się warstwami (połączenie z radiem → panel → statystyki), a gdy statystyki nie wstaną (np. po utracie bazy węzłów w radiu), panel działa dalej, a statystyki są ponawiane w tle. Panel pokazuje wtedy dyskretny komunikat
- Po wyłączeniu statystyk istniejące encje zostają w Home Assistant jako niedostępne i można je usunąć ręcznie; po wyłączeniu panelu historia wiadomości zostaje zachowana
- Opcje integracji zawierają tylko ustawienia samej integracji: tryb pracy, śledzone węzły (jedna lista z wyszukiwaniem, z długą i krótką nazwą oraz identyfikatorem węzła), powiadomienia, klient webowy i proxy TCP. Sniffer i konfigurację radia zmienia się w panelu

Panel MT_SW_INTEGRATION (pasek boczny):
- Radio: karta każdej bramki — połączenie, model, rola, firmware, czas pracy, bateria, napięcie, obciążenie kanału i czas nadawania, poziom szumu, liczniki pakietów, węzły online i łącznie, wykresy oraz tabela kanałów. Ostatnie statystyki są pamiętane po restarcie do następnego pakietu od węzła. Tu też jest wyrzutnia wbudowanego klienta WWW
- Wiadomości: kanały i wiadomości bezpośrednie, wysyłanie, historia zapisywana w Home Assistancie, status doręczenia (oczekuje, wysłano do sieci, potwierdzona przez odbiorcę). W dymku odebranej wiadomości przy połączeniu bezpośrednim widać SNR i RSSI, a po skokach liczbę skoków i przekaźnik w postaci „via (krótka nazwa)”. Szczegóły wiadomości pokazują trasę, przekaźnik, przez który doleciała, poziom sygnału (SNR i RSSI), podpis XEdDSA, a dla wysłanych także przekaźniki, które ją usłyszały. Linki w wiadomościach są klikalne, a linki do obrazków mogą pokazywać podgląd pod tekstem (jak w aplikacji). Obrazki ładują się od razu w pełnej rozdzielczości, tak jak w aplikacji jest jeden tryb. Automatyczne ładowanie jest domyślnie włączone i wyłącza się je w Ustawieniach → Inne → Czat („Automatycznie ładuj obrazki z linków w czacie”, ustawienie wspólne dla wszystkich przeglądarek), a wtedy obrazek ładuje się po kliknięciu „Załaduj obrazek”. Kliknięcie miniatury otwiera zdjęcie na pełnym ekranie z powiększaniem. Przycisk „+” obok pola pisania wysyła zdjęcie: po potwierdzeniu trafia ono przez Home Assistanta na publiczny serwer catbox.moe (bez konta i klucza), a w wiadomości leci sam link, który u odbiorcy pokazuje się jako podgląd
- Węzły: lista na żywo, jak w aplikacji — zmiany przychodzą z połączenia z radiem na bieżąco, bez odpytywania, a dodanie do ulubionych, ignorowanie i usunięcie węzła widać od razu po kliknięciu (jeśli radio odrzuci polecenie, zmiana jest cofana). Filtry: ulubione, bezpośrednie, z pozycją, śledzone, bez MQTT, ignorowane i kolumnami: krótka nazwa, nazwa, sygnał, skoki, bateria, czas pracy i ostatnio słyszany. Skoki są odmieniane (1 skok, 2 skoki, 5 skoków) i mają dopisek „via (krótka nazwa)” z przekaźnikiem ostatniego pakietu. SNR i RSSI są w jednej kolumnie i tylko dla połączeń bezpośrednich, bo przy skokach opisują łącze z przekaźnikiem, a nie z samym węzłem
- Szczegóły węzła: dane są w kategoriach nazwanych jak w aplikacji na Androida — Informacje o sąsiadach, Jakość sygnału (osobne wykresy SNR i RSSI z pakietów słyszanych bezpośrednio oraz poziomu szumu), Metryka urządzenia, Metryki środowiskowe, Metryki zasilania, Pakiety, Zasoby, Pozycjonowanie i Śledzenie trasy (z wykresem liczby skoków w obie strony w czasie). Każda kategoria ma przycisk „Historia”, a te, o które można zapytać węzeł, także „Poproś”. Historia pokazuje się na żądanie, jedna kategoria naraz, tylko dla otwartego węzła. Na górze szczegółów widać wiadomość statusu, którą węzeł rozgłasza po sieci (moduł Status Message). Poza tym są akcje: wiadomość, ulubiony, ignorowanie, usunięcie węzła z bazy radia oraz diagnostyka na żądanie
- Mapa: pozycje węzłów, koła precyzji, linie topologii z NeighborInfo (SNR) i grupowanie gęstych etykiet. Dostawca kafli jest do wyboru: standardowe OpenStreetMap (jak w aplikacji), Esri, OpenTopoMap, CARTO, Stadia lub własny adres. Każdy dostawca ma osobny klucz API, zapisywany w Home Assistancie, więc wpisuje się go raz dla wszystkich przeglądarek i aplikacji mobilnej
- Ustawienia: pełna konfiguracja radia podłączonego do Home Assistanta, w grupach. Konfiguracja radia: LoRa (z pełną listą presetów nazwanych jak w aplikacji oraz opcjami „Ok dla MQTT” i „Zignoruj MQTT”), kanały (z kluczem PSK i udostępnianiem lokalizacji z regulowaną dokładnością, także dokładną), użytkownik i wiadomość statusu. Konfiguracja urządzenia: urządzenie, pozycja, zasilanie, sieć (WiFi, nadawanie UDP, NTP, syslog), wyświetlacz, Bluetooth, bezpieczeństwo i ekran. Konfiguracja modułów: MQTT (z raportowaniem map), port szeregowy, powiadomienia zewnętrzne, Store & Forward, test zasięgu, telemetria, wiadomości predefiniowane, audio, informacje o sąsiadach, oświetlenie, czujnik detekcji, Paxcounter, zarządzanie ruchem i Meshbeacon (nadawanie i nasłuch, oferowany region, preset i kanał oraz cele nadawania). Inne: Sniffer (radiowy i MQTT, opis niżej), akcje urządzenia (restart, wyłączenie, resety), Czat (automatyczne ładowanie obrazków z linków) i Pamięć, czyli zarządzanie danymi zapisanymi przez panel oraz czyszczenie bazy węzłów radia: według czasu nieaktywności i rodzaju węzłów (wszystkie, znane, nieznane), z podglądem tego, co zostanie usunięte, i z opcją automatyczną (co N dni usuwa węzły nieaktywne dłużej niż M dni). Ulubione, ignorowane i śledzone węzły oraz własna bramka nigdy nie są usuwane
- Wszystkie napisy są po polsku (angielski jako zapasowy), a nazwy w Ustawieniach są dopasowane do aplikacji MT_SW na Androida

Funkcje firmware MT_SW_FW (wymagają radia z firmware MT_SW_FW w wersji 2 lub nowszej; od tej wersji są dostępne wszystkie naraz, a panel pokazuje je tylko wtedy):
- Diagnostyka na żądanie (OnDemand, port 354) w szczegółach węzła: statystyki węzła (bateria, czas pracy, CPU, pamięć, liczniki), ping także z potwierdzeniem, węzły online, błędy routingu, liczniki portów, aktywność eteru, log wymiany pakietów, historia odbioru i wersja MT_SW Firmware. Nazwy portów i błędów są takie same jak w aplikacji na Androida
- Sniffer radiowy (Ustawienia → Inne → Sniffer): włączanie i wyłączanie przez OnDemand, z ostrzeżeniem przed włączeniem. Stan sniffera jest w pamięci RAM radia, więc po restarcie zawsze jest wyłączony, a włączyć go można tylko na bramce podłączonej do Home Assistanta

Sniffer (Ustawienia → Inne → Sniffer):
- Dwa źródła: sniffer radiowy (wymaga MT_SW_FW, opis wyżej) i sniffer MQTT, który subskrybuje ten sam broker co moduł MQTT bramki, więc widzi też ruch z innych bram. Sniffer MQTT działa w całości w Home Assistancie, pamięta swoje ustawienie po restarcie i jest sterowany wyłącznie z panelu
- Log wygląda jak Sniffer Log w aplikacji: karty pakietów z kolorowym paskiem wg rodzaju, nadawca → odbiorca z krótkimi nazwami, czas z milisekundami, najnowsze na górze, szczegóły po kliknięciu, przycisk „Na żywo” (pauza albo przewinięcie w dół zatrzymuje tylko widok, a przycisk pokazuje „N nowych”)
- Grupowanie powtórzeń: ten sam pakiet usłyszany kilka razy — przez własne radio, z różnych bram MQTT albo przez różne przekaźniki — trafia do jednej karty z oznaczeniem „Odebrany N×”. Po rozwinięciu widać każdy odbiór: bramkę, opóźnienie względem pierwszego odbioru, przekaźnik dopasowany do znanych węzłów, liczbę skoków, SNR i RSSI. Grupowanie można wyłączyć
- Odszyfrowywanie jak w firmware, po hashu kanału: kluczami kanałów bramki, publicznych kanałów domyślnych (każdy preset modemu z domyślnym kluczem) oraz kanałów bez szyfrowania, także o nazwach, których bramka nie zna. Tak samo dla radia i MQTT; pakiety z bram, które wysyłają do MQTT bez szyfrowania, pokazują pełną treść. Karta mówi, dzięki któremu kluczowi pakiet odczytano
- Pełna treść pakietu, jak w Panelu Debugowania w aplikacji: tekst, pozycja, NodeInfo, telemetria z wartościami, traceroute z trasą w obie strony i SNR, sąsiedzi, routing, admin, waypoint, OnDemand, raport mapy, Paxcounter, Store & Forward
- Gdy pakietu nie da się odczytać, widać to, co niesie: hash kanału ze znanymi kanałami o tym samym hashu (np. „LongFast — inny klucz”), informację o wiadomości prywatnej PKI (także o prywatnych wiadomościach do innych węzłów, których nie odczyta nikt poza odbiorcą), rozmiar oraz zrzut bajtów w hex i ASCII
- Filtr źródła (Wszystko / Radio / MQTT), wyszukiwarka przeszukująca także treść, kopiowanie pakietu ze wszystkimi odbiorami, eksport do JSON i CSV oraz ikona kosza przy przycisku „Na żywo”, która po potwierdzeniu czyści całą listę. Log trzyma do 5000 wpisów w pamięci

Encje i usługi (jak w oryginale, z poprawkami poniżej): czujniki telemetrii i statystyk, czujniki binarne (m.in. wyciszony, podpisany XEdDSA, słyszany na bieżącym LoRa), device_tracker, przyciski (restart, pobranie sąsiadów), encje tekstowe, powiadomienia (notify) dla kanałów i węzłów, wpisy w logbooku, wyzwalacze i akcje urządzeń oraz usługi send_text, send_direct_message, broadcast_channel_message, request_telemetry, request_position, request_traceroute i set_fixed_position.

Opcjonalne, domyślnie wyłączone:
- Klient webowy MT_SW (domyślnie port 4408) — zbudowany na najnowszej wersji oficjalnego klienta meshtastic/web (wrzesień 2026), w barwach MT_SW (logo, złoto #F5C839 i granat #2C2D3C), z pełnym polskim tłumaczeniem i tłumaczeniami w 22 językach. Nawigacja działa na adresach z `#`, więc odświeżenie strony nie gubi widoku, a bazę węzłów i wiadomości trzyma w przeglądarce. Łączy się z radiem przez integrację, więc nie zrywa połączenia Home Assistanta. Otwiera się z zakładki Radio w panelu; strona z instrukcją połączenia jest po polsku lub angielsku. Uwaga: protokół Meshtastic nie ma uwierzytelniania, więc każdy z dostępem do Home Assistanta może wtedy sterować bramką. Opis budowania i wszystkie nasze zmiany względem oryginału są w `meshtastic_web/MTSW_WEB_CLIENT.md` i `meshtastic_web/mtsw-web-client.patch`.
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
- Jednostka µg/m³ korzysta z UnitOfDensity na nowym Home Assistancie i ze starszej stałej CONCENTRATION_MICROGRAMS_PER_CUBIC_METER na starszym (dawniej fix-2.11)
- Encje, urządzenia i filtr węzłów są rozpoznawane po kluczu publicznym PKI, więc przeżywają zmianę numeru węzła (kolizja w sieci, aktualizacja firmware); duplikaty są wykrywane i scalane
- Zmiana filtra węzłów działa od razu, bez przeładowania integracji; usuwanie nieaktualnych węzłów z urządzenia jest ponawiane, a ręczne usuwanie urządzeń jest zawsze dozwolone
- Stabilniejsze połączenie: ponowne połączenia pobierają minimalną konfigurację zamiast pełnej synchronizacji, proxy TCP zapamiętuje konfigurację radia, naprawiono ponowne łączenie po USB po zerwaniu oraz podwajanie kanałów po ponownym połączeniu
- Ponowne łączenie po restarcie radia: TCP keepalive i strażnik oparty na odpowiedziach radia na heartbeat wykrywają radio, które po restarcie po prostu „znika”, a integracja łączy się ponownie co najwyżej co ~20 s. Gdy radio się zrestartowało, pełna baza węzłów jest pobierana ponownie w tle. Naprawiono też pakiet „rebooted”, który wcześniej zatrzymywał połączenie na stałe
- Strażnik całej integracji: jeśli radio nie wraca przez 10 minut mimo ponawiania (restart, zanik prądu, zawieszony stan), integracja przeładowuje się sama i łączy od zera, a gdy radio dalej jest wyłączone, Home Assistant ponawia start, aż wróci. Utrata połączenia, kolejne próby z adresem radia i przywrócenie połączenia są widoczne w zwykłym logu
- Start po utracie bazy węzłów w radiu (np. po zaniku zasilania): kolizje identyfikatorów w rejestrze urządzeń są rozwiązywane automatycznie, każdy węzeł jest budowany osobno, a nieudany start sprząta po sobie (zamyka połączenie, nie zostawia załadowanych platform)
- Zapis ustawień radia z panelu (LoRa, kanały, użytkownik, moduły, bezpieczeństwo) jest niezawodny: integracja nakłada zmiany na bieżącą sekcję zamiast wysyłać same pola z formularza (firmware podmienia całą sekcję, więc wcześniej zerowało się wszystko, czego formularz nie pokazywał — m.in. klucze PKI przy zapisie sekcji Bezpieczeństwo), zapisuje w transakcji edycji (zmiany zapisują się na dysk radia nawet wtedy, gdy inny klient zostawił otwartą transakcję), po zapisie sekcji restartuje radio, żeby zmiana weszła na każdej wersji firmware, obsługuje pola spoza sekcji (stała pozycja, port MQTT, gotowe wiadomości, ekran dotykowy), a panel pokazuje komunikat o udanym albo nieudanym zapisie
- Usuwanie węzła z bazy radia działa — wcześniej integracja czekała bez końca na odpowiedź, której firmware nigdy nie wysyła
- Mapa w panelu nie wysypuje się już błędami Leafleta i rysuje się od nowa tylko wtedy, gdy zmieni się coś, co na niej widać
- Zapis kanału z panelu nie wyłącza już kanału dodatkowego: rola była wysyłana w złym miejscu i radio ją pomijało. Zapis zachowuje też pola kanału, których panel nie zna
- Wendorowane protobufy pochodzą wprost z oficjalnego meshtastic/protobufs, bez własnego forka

Dodane funkcje:
- Sensor Noise Floor (localStats.noiseFloor)
- Sensory Heap Total / Heap Free (port z upstream dev)
- state_class: measurement dla liczników pakietów z localStats
- reply_id w akcjach send_text / send_direct_message / broadcast_channel_message
- Obsługa Neighbor Info: przycisk pobrania sąsiadów, lista sąsiadów z SNR w atrybutach i w panelu oraz linie topologii na mapie
- Panel w pasku bocznym opisany wyżej, z własnym backendem WebSocket i trwałą historią wiadomości oraz danych węzłów
- Tryb pracy z niezależnym panelem i statystykami, opisany wyżej
- Sniffer z odszyfrowywaniem, pełnym dekodowaniem i grupowaniem powtórzeń, opisany wyżej
- Własny branding: ikona i logo MT_SW w Home Assistancie, w panelu i w kliencie webowym MT_SW, razem z kolorystyką marki
- Przywrócone nagłówki SPDX/MIT w plikach, które miały je w oryginale

Podziękowania:
- Meshtastic i Pascal Brogle (@broglep) za oficjalną integrację, na której oparty jest ten fork
- Daring-Designs/meshtastic-ui-ha (MIT) — z tego projektu pochodzi zakładka Ustawienia; pozostałe zakładki panelu są własne


===========================================
EN — ENGLISH VERSION
===========================================

## MT_SW — Meshtastic integration fork for Home Assistant

A fork of the official meshtastic/home-assistant integration, maintained for the Świętokrzyskie mesh network. On top of the entities and services from the original it has its own sidebar panel in Home Assistant that works like the Meshtastic app on your phone (radio, messages, nodes, map, sniffer and full radio settings), support for MT_SW firmware features and its own MT_SW web client.

Requirements and installation:
- Home Assistant 2024.11.0 or newer — the integration picks the right device-registry and unit APIs by itself, so it runs on older versions (e.g. in a Docker container on OpenMediaVault) as well as on the newest ones
- Install through HACS as a custom repository (type Integration), then add the integration under Settings → Devices & services
- Connection to the radio: TCP (WiFi/Ethernet), USB (serial port) or Bluetooth
- The integration domain is still meshtastic, as in the original, so do not install it next to the official Meshtastic integration
- The sidebar panel is visible to administrators only
- When adding the integration, right after connecting to the radio, you choose the mode (described below). With "Panel only" the wizard skips choosing nodes and notify entities

Mode — two independent parts:
- The integration consists of two parts that work independently. The MT_SW panel is the sidebar app and creates no entities. Statistics are Home Assistant devices and entities for the selected nodes (battery, signal, telemetry, position, notifications), which history, graphs, cards and automations are built on
- There are three options: "Panel and statistics" (recommended), "Panel only" and "Statistics only". The mode is chosen when adding the integration and can be changed at any time under Settings → Devices & services → MT_SW_INTEGRATION → Configure; every option is fully described on screen
- A failure in one part never stops the other: startup runs in layers (radio connection → panel → statistics), and if statistics fail to start (e.g. after the radio lost its node database), the panel keeps working and statistics are retried in the background. The panel then shows an unobtrusive notice
- After disabling statistics, existing entities stay in Home Assistant as unavailable and can be removed manually; after disabling the panel, the message history is kept
- The integration options hold only settings of the integration itself: mode, tracked nodes (a single searchable list with each node's long and short name and ID), notifications, web client and TCP proxy. The sniffer and the radio configuration are changed in the panel

MT_SW_INTEGRATION panel (sidebar):
- Radio: a card for each gateway — connection, model, role, firmware, uptime, battery, voltage, channel utilization and airtime, noise floor, packet counters, nodes online and total, charts and a channel table. The latest statistics are remembered across restarts until the next packet from the node. The launcher for the embedded web client is here too
- Messages: channels and direct messages, sending, history stored in Home Assistant, delivery status (pending, sent to the mesh, acknowledged by the recipient). In the bubble of a received message a direct link shows SNR and RSSI, and a relayed one shows the hop count and the relay as "via (short name)". The message details show the route, the relay it came through, the signal level (SNR and RSSI), the XEdDSA signature and, for sent messages, the relays that heard it. Links in messages are clickable, and links to images can show a preview under the text (as in the app). Images load right away in full resolution, as in the app there is a single mode. Automatic loading is on by default and is switched off in Settings → Other → Chat ("Automatically load images from links in chat", a setting shared by all browsers), and then an image loads after you click "Load image". Clicking a thumbnail opens the photo full screen with zoom. The "+" button next to the composer sends a photo: after a confirmation it is uploaded through Home Assistant to the public server catbox.moe (no account or key), and only the link goes into the message, which shows as a preview for the recipient
- Nodes: a live list, as in the app — changes arrive from the radio connection as they happen, without polling, and adding a favorite, ignoring or removing a node shows immediately on click (if the radio rejects the command, the change is rolled back). Filters: favorites, direct, with position, tracked, hide MQTT, ignored and columns: short name, name, signal, hops, battery, uptime and last heard. Hops are declined in Polish (1 skok, 2 skoki, 5 skoków) and carry a "via (short name)" note with the relay of the latest packet. SNR and RSSI share one column and are shown only for direct links, because with hops they describe the link to the relay, not to the node itself
- Node details: data is grouped in categories named as in the Android app — Neighbor info, Signal quality (separate charts of SNR and RSSI from packets heard directly, and of the noise floor), Device metrics, Environment metrics, Power metrics, Packets, Resources, Position and Traceroute (with a chart of the hop count in both directions over time). Every category has a "History" button, and those the node can be asked about also have "Request". History is shown on demand, one category at a time, only for the open node. At the top of the details you see the status message the node broadcasts over the mesh (the Status Message module). There are also actions: message, favorite, ignore, remove the node from the radio's database and on-demand diagnostics
- Map: node positions, precision circles, topology lines from NeighborInfo (SNR) and grouping of dense labels. The tile provider is selectable: standard OpenStreetMap (as in the app), Esri, OpenTopoMap, CARTO, Stadia or a custom URL. Each provider has its own API key, stored in Home Assistant, so it is entered once for every browser and the mobile app
- Settings: full configuration of the radio connected to Home Assistant, in groups. Radio config: LoRa (with the full list of presets named as in the app and the "OK to MQTT" and "Ignore MQTT" options), channels (with PSK and location sharing with an adjustable accuracy, also precise), user and status message. Device config: device, position, power, network (WiFi, UDP broadcast, NTP, syslog), display, Bluetooth, security and screen. Module config: MQTT (with map reporting), serial, external notification, Store & Forward, range test, telemetry, canned messages, audio, neighbor info, ambient lighting, detection sensor, Paxcounter, traffic management and Meshbeacon (broadcast and listen, offered region, preset and channel, and broadcast targets). Other: the Sniffer (radio and MQTT, described below), device actions (reboot, shutdown, resets), Chat (automatic loading of images from links) and Storage, i.e. management of the data stored by the panel and cleaning of the radio's node database: by inactivity time and node kind (all, known, unknown), with a preview of what will be removed and an automatic option (every N days it removes nodes inactive for longer than M days). Favorite, ignored and tracked nodes and your own gateway are never removed
- All texts are in Polish (English as a fallback), and the names in Settings match the MT_SW Android app

MT_SW_FW firmware features (require a radio running MT_SW_FW firmware version 2 or newer; all of them are available from that version on, and the panel shows them only then):
- On-demand diagnostics (OnDemand, port 354) in the node details: node stats (battery, uptime, CPU, memory, counters), ping including the acknowledged variant, nodes online, routing errors, port counters, air activity, packet exchange log, RX history and MT_SW Firmware version. Port and error names are the same as in the Android app
- Radio sniffer (Settings → Other → Sniffer): enabled and disabled through OnDemand, with a warning before enabling. The sniffer state lives in the radio's RAM, so it is always off after a reboot, and it can only be enabled on the gateway connected to Home Assistant

Sniffer (Settings → Other → Sniffer):
- Two sources: the radio sniffer (requires MT_SW_FW, see above) and the MQTT sniffer, which subscribes to the same broker as the gateway's MQTT module and therefore also sees traffic from other gateways. The MQTT sniffer runs entirely in Home Assistant, keeps its setting across restarts and is controlled only from the panel
- The log looks like the Sniffer Log in the app: packet cards with a coloured stripe by type, sender → recipient with short names, time with milliseconds, newest on top, details on click and a "Live" button (pausing or scrolling down only freezes the view, and the button then shows "N new")
- Duplicate grouping: the same packet heard several times — by your own radio, from different MQTT gateways or via different relays — goes into one card marked "Heard N×". Expanding it shows every reception: gateway, delay relative to the first reception, relay matched to known nodes, hop count, SNR and RSSI. Grouping can be turned off
- Decryption the way the firmware does it, by channel hash: with the gateway's channel keys, the public default channels (every modem preset with the default key) and unencrypted channels, including ones whose names the gateway doesn't know. It works the same for the radio and MQTT; packets from gateways that publish to MQTT unencrypted show their full content. The card says which key the packet was read with
- Full packet content, as in the Debug Panel in the app: text, position, NodeInfo, telemetry with values, traceroute with the route both ways and SNR, neighbours, routing, admin, waypoint, OnDemand, map report, Paxcounter, Store & Forward
- When a packet can't be read, you see what it carries: the channel hash with the known channels sharing it (e.g. "LongFast — different key"), a note about private PKI messages (including direct messages to other nodes, which only the recipient can read), the size and a hex and ASCII dump
- Source filter (All / Radio / MQTT), search that also covers the content, copying a packet with all its receptions, export to JSON and CSV, and a trash icon next to the "Live" button that clears the whole list after confirmation. The log keeps up to 5000 entries in memory

Entities and services (as in the original, with the fixes below): telemetry and statistics sensors, binary sensors (e.g. muted, XEdDSA signed, heard on the current LoRa), device_tracker, buttons (reboot, request neighbors), text entities, notify entities for channels and nodes, logbook entries, device triggers and actions, and the services send_text, send_direct_message, broadcast_channel_message, request_telemetry, request_position, request_traceroute and set_fixed_position.

Optional, disabled by default:
- MT_SW web client (port 4408 by default) — built on the latest official meshtastic/web client (September 2026), in MT_SW colours (logo, gold #F5C839 and navy #2C2D3C), with a full Polish translation and translations in 22 languages. Navigation uses `#` addresses, so reloading the page keeps the view, and the node and message database is kept in the browser. It talks to the radio through the integration, so Home Assistant's own connection is not dropped. It opens from the Radio tab of the panel; the connection instructions page is in Polish or English. Note: the Meshtastic protocol has no authentication, so anyone with access to Home Assistant can then control the gateway. How it is built and all our changes relative to the original are in `meshtastic_web/MTSW_WEB_CLIENT.md` and `meshtastic_web/mtsw-web-client.patch`.
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
- The µg/m³ unit uses UnitOfDensity on newer Home Assistant and the older CONCENTRATION_MICROGRAMS_PER_CUBIC_METER constant on older ones (formerly fix-2.11)
- Entities, devices and the node filter are recognized by the PKI public key, so they survive a node number change (mesh collision, firmware update); duplicates are detected and merged
- A node filter change applies immediately without reloading the integration; removal of stale nodes from the device is retried, and manual device removal is always allowed
- A steadier connection: reconnects fetch a minimal config instead of a full sync, the TCP proxy caches the radio configuration, and USB reconnecting after a drop and channel doubling after a reconnect are fixed
- Reconnecting after a radio restart: TCP keepalive and a watchdog based on the radio's heartbeat replies detect a radio that simply "vanishes" on restart, and the integration reconnects at most every ~20 s. When the radio has restarted, the full node database is re-fetched in the background. The "rebooted" packet, which used to stop the connection for good, is fixed too
- An integration-level supervisor: if the radio doesn't come back for 10 minutes despite retrying (restart, power loss, a stalled state), the integration reloads itself and connects from scratch, and if the radio is still off, Home Assistant keeps retrying the startup until it returns. Connection loss, retry attempts with the radio's address and the restored connection are visible in the regular log
- Startup after the radio loses its node database (e.g. after a power cut): identifier collisions in the device registry are resolved automatically, every node is built on its own, and a failed startup cleans up after itself (closes the connection, leaves no platforms loaded)
- Saving radio settings from the panel (LoRa, channels, user, modules, security) is reliable: the integration applies changes on top of the current section instead of sending only the form's fields (the firmware replaces the whole section, so everything the form didn't show used to be wiped — including the PKI keys when saving the Security section), writes inside an edit transaction (changes reach the radio's storage even if another client left a transaction open), reboots the radio after saving a section so the change applies on every firmware version, handles fields outside the section (fixed position, MQTT port, canned messages, touchscreen), and the panel shows a message on success or failure
- Removing a node from the radio's database works — previously the integration waited forever for a reply the firmware never sends
- The panel map no longer floods the log with Leaflet errors and is only redrawn when something visible on it changes
- Saving a channel from the panel no longer disables a secondary channel: the role was sent in the wrong place and the radio ignored it. Saving also keeps the channel fields the panel does not know
- Vendored protobufs come straight from the official meshtastic/protobufs, without a custom fork

Added features:
- Noise Floor sensor (localStats.noiseFloor)
- Heap Total / Heap Free sensors (ported from upstream dev)
- state_class: measurement for the localStats packet counters
- reply_id support in the send_text / send_direct_message / broadcast_channel_message actions
- Neighbor Info support: a request-neighbors button, a neighbor list with SNR in attributes and in the panel, and topology lines on the map
- The sidebar panel described above, with its own WebSocket backend and persistent history of messages and node data
- The mode with an independent panel and statistics, described above
- The sniffer with decryption, full decoding and duplicate grouping, described above
- Custom branding: the MT_SW icon and logo in Home Assistant, in the panel and in the MT_SW web client, together with the brand colours
- SPDX/MIT license headers restored in the files that had them in the original

Credits:
- Meshtastic and Pascal Brogle (@broglep) for the official integration this fork is based on
- Daring-Designs/meshtastic-ui-ha (MIT) — the Settings tab comes from that project; the other panel tabs are our own