## 🇵🇱 Polski

### Nowe
- **Zdrowie sieci** – nowa zakładka: oceny, rankingi, rozkłady, grupy węzłów (własne, do tworzenia i edycji) i eksport (CSV, MD, HTML, TXT, PDF).
- **Zdrowie sieci jak w aplikacji** – widok „Metryki”: 7 zakładek, lista węzłów z małym wykresem, po kliknięciu duże wykresy z zakresem czasu.
- **Śledzenie węzłów w Home Assistancie** – jednym przyciskiem na węźle albo hurtem z grup.
- **Kalkulator anten** (okno na mapie) – 13 typów anten: wymiary, zysk, impedancja, straty w kablu i złączach, moc wypromieniowana na tle limitów pasm. Wzory jak w aplikacji MT_SW_APP.
- **Panorama terenu** (okno na mapie) – sylwetka terenu dookoła stacji z naniesionymi węzłami (widoczne i zasłonięte).
- **Funkcje MT_SW** – Ustawienia → Inne → Funkcje MT_SW: jedno miejsce z listą wszystkich naszych funkcji.
- **Szybkie komendy** w zdalnej administracji.
- **Protobufy 2.8.2** (najnowsze oryginalne, te same co w aplikacji); nowe tryby portu szeregowego (WS85, VE.Direct, MS config, Log, Log text, Modbus).
- **Klient webowy** przebudowany na najnowszej wersji oryginału z naszą oprawą i pełnym polskim tłumaczeniem.
- **Trzy niezależne części** – zbieranie danych (encje), panel i klient web działają osobno. Panel widzi wszystko, co jest w radiu, i sam zapisuje dane.
- **Okres trzymania danych panelu** – Ustawienia → Pamięć: od 1 do 60 dni (domyślnie 30).
- **Grupy węzłów do zbierania** – Opcje integracji: gotowe zestawy (ulubione, słyszane 24 godz. i 7 dni, routery, z pozycją) i własne grupy zapisywane pod nazwą (widać też grupy zrobione wcześniej). Każda grupa dostaje w HA etykietę „MT_SW: nazwa” na urządzeniach swoich węzłów – do pulpitów, automatyzacji i skryptów. Tylko dokładają węzły, już dodane zostają.
- **Węzeł usunięty z radia** (ręcznie albo czyszczeniem bazy) – zbieranie kończy się bez błędów; integracja pamięta go 30 dni (stałe) i sama wznawia zbieranie, jeśli węzeł wróci.

### Poprawki
- Czasowe odłączenie integracji od radia: nie przerywa go już trwające ponowne łączenie, a po upływie czasu integracja łączy się sama.
- OTA: nie wiesza się na żądaniu restartu (limit 30 s), każdy krok jest w logu.
- Zgodność ze starszymi i nowymi wersjami Home Assistanta (pole urządzeń `config_entries`).
- Pozycja bramki w logu przeniesiona na poziom debug.
- Węzeł, który zmienił tylko numer (ten sam klucz albo nazwy i model): zbieranie trwa dalej na tym samym urządzeniu, także gdy stary numer jeszcze jest w bazie radia.
- Scalanie duplikatów w Ustawieniach integracji działa przy wyłączonym panelu; zapis ustawień nie kasuje już innych opcji (np. sniffera MQTT).

---

## 🇬🇧 English

### New
- **Network health** – new tab: ratings, rankings, distributions, node groups (your own, create and edit) and export (CSV, MD, HTML, TXT, PDF).
- **Network health like the app** – "Metrics" view: 7 tabs, node list with a small chart, large charts with time range on click.
- **Tracking nodes in Home Assistant** – with one button on a node or in bulk from groups.
- **Antenna calculator** (window on the map) – 13 antenna types: dimensions, gain, impedance, cable and connector losses, radiated power against band limits. Same maths as the MT_SW_APP app.
- **Terrain panorama** (window on the map) – terrain skyline around the station with nodes placed on it (visible and hidden).
- **MT_SW functions** – Settings → Other → MT_SW functions: one place listing all our functions.
- **Quick commands** in remote administration.
- **Protobufs 2.8.2** (latest original, same as the app); new serial module modes (WS85, VE.Direct, MS config, Log, Log text, Modbus).
- **Web client** rebuilt on the latest upstream version with our branding and a full Polish translation.
- **Three independent parts** – data collection (entities), the panel and the web client work separately. The panel sees everything on the radio and stores data on its own.
- **Panel data retention** – Settings → Storage: 1 to 60 days (default 30).
- **Node groups for collection** – integration Options: ready-made sets (favorites, heard in 24 h and 7 days, routers, with a position) and your own named groups (groups made earlier show up too). Each group gets an HA label "MT_SW: name" on its nodes' devices, for dashboards, automations and scripts. They only add nodes; the ones already added stay.
- **Data collection** – Settings → Data collection: list of collected nodes, adding with search, removing (also removes from the radio, so it disappears from the panel) and merging duplicates.
- **Node removed from the radio** (by hand or by database cleanup) – collection ends without errors; the integration remembers it for 30 days (fixed) and resumes collection by itself if the node returns.

### Fixes
- Timed disconnect of the integration from the radio: an in-flight reconnect no longer breaks it, and the integration reconnects by itself when the time is up.
- OTA: no longer hangs on the reboot request (30 s limit), every step is logged.
- Compatibility with older and newer Home Assistant versions (the device `config_entries` field).
- Gateway position log moved to debug level.
- A node that changed only its number (same key, or same names and model): collection continues on the same device, also while the old number is still in the radio database.
- Merging duplicates in the integration settings works with the panel turned off; saving settings no longer wipes other options (e.g. the MQTT sniffer).
