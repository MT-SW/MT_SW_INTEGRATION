## 🇵🇱 Polski

### Nowe
- **Zdrowie sieci** – nowa zakładka: oceny, rankingi, rozkłady, grupy węzłów (własne, do tworzenia i edycji) i eksport (CSV, MD, HTML, TXT, PDF).
- **Śledzenie węzłów w Home Assistancie** – jednym przyciskiem na węźle albo hurtem z grup.
- **Kalkulator anten** (okno na mapie) – 13 typów anten: wymiary, zysk, impedancja, straty w kablu i złączach, moc wypromieniowana na tle limitów pasm. Wzory jak w aplikacji MT_SW_APP.
- **Panorama terenu** (okno na mapie) – sylwetka terenu dookoła stacji z naniesionymi węzłami (widoczne i zasłonięte).
- **Funkcje MT_SW** – Ustawienia → Inne → Funkcje MT_SW: jedno miejsce z listą wszystkich naszych funkcji.
- **Szybkie komendy** w zdalnej administracji.
- **Protobufy 2.8.2** (najnowsze oryginalne, te same co w aplikacji); nowe tryby portu szeregowego (WS85, VE.Direct, MS config, Log, Log text, Modbus).
- **Klient webowy** przebudowany na najnowszej wersji oryginału z naszą oprawą i pełnym polskim tłumaczeniem.
- **Trzy niezależne części** – zbieranie danych (encje), panel i klient web działają osobno. Panel widzi wszystko, co jest w radiu, i sam zapisuje dane.
- **Okres trzymania danych panelu** – Ustawienia → Pamięć: od 1 do 60 dni (domyślnie 30).
- **Węzeł usunięty z radia** (ręcznie albo czyszczeniem bazy) – zbieranie kończy się bez błędów; integracja pamięta go 30 dni (stałe) i sama wznawia zbieranie, jeśli węzeł wróci.

### Poprawki
- Czasowe odłączenie integracji od radia: nie przerywa go już trwające ponowne łączenie, a po upływie czasu integracja łączy się sama.
- OTA: nie wiesza się na żądaniu restartu (limit 30 s), każdy krok jest w logu.
- Zgodność ze starszymi i nowymi wersjami Home Assistanta (pole urządzeń `config_entries`).
- Pozycja bramki w logu przeniesiona na poziom debug.

---

## 🇬🇧 English

### New
- **Network health** – new tab: ratings, rankings, distributions, node groups (your own, create and edit) and export (CSV, MD, HTML, TXT, PDF).
- **Tracking nodes in Home Assistant** – with one button on a node or in bulk from groups.
- **Antenna calculator** (window on the map) – 13 antenna types: dimensions, gain, impedance, cable and connector losses, radiated power against band limits. Same maths as the MT_SW_APP app.
- **Terrain panorama** (window on the map) – terrain skyline around the station with nodes placed on it (visible and hidden).
- **MT_SW functions** – Settings → Other → MT_SW functions: one place listing all our functions.
- **Quick commands** in remote administration.
- **Protobufs 2.8.2** (latest original, same as the app); new serial module modes (WS85, VE.Direct, MS config, Log, Log text, Modbus).
- **Web client** rebuilt on the latest upstream version with our branding and a full Polish translation.
- **Three independent parts** – data collection (entities), the panel and the web client work separately. The panel sees everything on the radio and stores data on its own.
- **Panel data retention** – Settings → Storage: 1 to 60 days (default 30).
- **Data collection** – Settings → Data collection: list of collected nodes, adding with search, removing (also removes from the radio, so it disappears from the panel) and merging duplicates.
- **Node removed from the radio** (by hand or by database cleanup) – collection ends without errors; the integration remembers it for 30 days (fixed) and resumes collection by itself if the node returns.

### Fixes
- Timed disconnect of the integration from the radio: an in-flight reconnect no longer breaks it, and the integration reconnects by itself when the time is up.
- OTA: no longer hangs on the reboot request (30 s limit), every step is logged.
- Compatibility with older and newer Home Assistant versions (the device `config_entries` field).
- Gateway position log moved to debug level.
