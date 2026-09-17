/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Polskie napisy dla przeniesionej zakładki ustawień.
 *
 * Pliki settings.js i modules.js pochodzą z projektu meshtastic-ui-ha i mają
 * napisy wpisane po angielsku w kodzie. Zamiast edytować je w blisko trzystu
 * miejscach, wszystkie etykiety i opisy przechodzą przez PL(), a tłumaczenia
 * siedzą tutaj. Hasło, którego nie ma w słowniku, wyświetla się po angielsku —
 * dopisanie brakującego to jedna linijka, bez ruszania tamtych plików.
 *
 * Wartości przykładowe (adresy IP, mqtt.meshtastic.org) świadomie pominięte.
 */

const PL_STRINGS = {
  /* ── wspólne ── */
  Name: "Nazwa",
  Enabled: "Włączony",
  Mode: "Tryb",
  Role: "Rola",
  Address: "Adres",
  Password: "Hasło",
  Username: "Nazwa użytkownika",
  Port: "Port",
  Options: "Opcje",
  Messages: "Wiadomości",
  Triggers: "Wyzwalacze",
  Output: "Wyjście",
  Broker: "Broker",
  Current: "Prąd",
  Gateway: "Brama domyślna",
  Heartbeat: "Bicie serca",
  Records: "Liczba rekordów",
  Red: "Czerwony",
  Green: "Zielony",
  Blue: "Niebieski",
  Environment: "Środowisko",
  "Air Quality": "Jakość powietrza",
  "Device Metrics": "Metryki urządzenia",
  "Power Metrics": "Metryki zasilania",
  "Input Source": "Źródło wejściowe",

  /* ── LoRa ── */
  Region: "Region",
  "Modem Preset": "Preset modemu",
  "Use Preset": "Użyj presetu",
  "Use the modem preset or custom values":
    "Użyj predefiniowanych ustawień albo wartości własnych",
  "Bandwidth (kHz)": "Pasmo (kHz)",
  "Override bandwidth (0 = use preset)": "Wymuszone pasmo (0 = z presetu)",
  "Spread Factor": "Współczynnik rozproszenia",
  "Override spread factor (0 = use preset)":
    "Wymuszony współczynnik rozproszenia (0 = z presetu)",
  "Coding Rate": "Szybkość kodowania",
  "Override coding rate (0 = use preset)": "Wymuszona szybkość kodowania (0 = z presetu)",
  "Frequency Offset (Hz)": "Przesunięcie częstotliwości (Hz)",
  "Fine-tune frequency offset": "Dostrojenie przesunięcia częstotliwości",
  "Hop Limit": "Liczba skoków",
  "Max number of hops (1-7)": "Maksymalna liczba przeskoków (1-7)",
  "TX Enabled": "Nadawanie włączone",
  "Allow radio to transmit": "Zezwól radiu na nadawanie",
  "TX Power (dBm)": "Moc nadawania (dBm)",
  "Transmit power in dBm (0 = max for region)":
    "Moc nadawania w dBm (0 = maksimum dla regionu)",
  "Override Duty Cycle": "Pomiń limit czasu nadawania",
  "Override regional duty cycle limits (use with caution)":
    "Pomija regionalne limity czasu nadawania — używaj ostrożnie",
  "Boosted RX Gain": "Wzmocniony zysk RX",
  "Enable boosted RX gain on SX1262": "Włącz wzmocniony zysk RX na SX1262",

  /* ── urządzenie ── */
  "Device Role": "Rola urządzenia",
  "Determines how the device behaves on the mesh":
    "Decyduje o tym, jak urządzenie zachowuje się w sieci",
  "Rebroadcast Mode": "Tryb retransmisji",
  "Controls which messages this node rebroadcasts":
    "Decyduje, które pakiety ten węzeł przekazuje dalej",
  "Node Info Broadcast Secs": "Interwał rozgłaszania informacji o węźle",
  "How often to broadcast node info (seconds, 0 = default)":
    "Jak często rozgłaszać informacje o węźle (sekundy, 0 = domyślnie)",
  "Button GPIO": "Przycisk GPIO",
  "GPIO pin for user button (0 = default)":
    "Pin GPIO przycisku użytkownika (0 = domyślny)",
  "Buzzer GPIO": "Buzzer GPIO",
  "GPIO pin for buzzer (0 = default)": "Pin GPIO buzzera (0 = domyślny)",
  "Double Tap as Button Press": "Podwójne dotknięcie jako naciśnięcie przycisku",
  "Use double-tap on the device as a button press":
    "Traktuj podwójne dotknięcie urządzenia jako naciśnięcie przycisku",
  "LED Heartbeat Disabled": "Wyłącz LED bicia serca",
  "Disable the LED heartbeat indicator": "Wyłącza migającą diodę bicia serca",
  "Serial Console Disabled": "Konsola szeregowa wyłączona",
  "Disable serial console access for security":
    "Blokuje dostęp do konsoli szeregowej ze względów bezpieczeństwa",

  /* ── pozycja ── */
  "GPS Enabled": "GPS włączony",
  "Enable the onboard GPS hardware": "Włącz wbudowany moduł GPS",
  "GPS Mode": "Tryb GPS",
  "How the device obtains its position": "Sposób ustalania pozycji przez urządzenie",
  "GPS Update Interval (secs)": "Interwał odpytywania GPS (s)",
  "How often the GPS hardware checks position": "Jak często moduł GPS sprawdza pozycję",
  "Position Broadcast Secs": "Interwał rozgłaszania pozycji (s)",
  "How often to broadcast position (seconds, 0 = default)":
    "Jak często rozgłaszać pozycję (sekundy, 0 = domyślnie)",
  "Smart Position Broadcast": "Inteligentne rozgłaszanie pozycji",
  "Only broadcast position when movement is detected":
    "Rozgłaszaj pozycję tylko po wykryciu ruchu",
  "Broadcast Smart Min Distance (m)": "Minimalny dystans inteligentny (m)",
  "Min distance to move before broadcasting (0 = disabled)":
    "Minimalna zmiana odległości przed rozgłoszeniem (0 = wyłączone)",
  "Broadcast Smart Min Interval (secs)": "Minimalny interwał inteligentny (s)",
  "Min interval between smart broadcasts":
    "Minimalny odstęp między inteligentnymi rozgłoszeniami",
  "Fixed Position": "Położenie stałe",
  "Use a fixed position instead of GPS": "Użyj stałej pozycji zamiast GPS",
  "Latitude": "Szerokość geograficzna",
  "Longitude": "Długość geograficzna",
  "Altitude (m)": "Wysokość (m)",
  "RX GPIO": "GPS Rx GPIO",
  "GPIO pin for GPS RX (0 = default)": "Pin GPIO dla GPS RX (0 = domyślny)",
  "TX GPIO": "GPS Tx GPIO",
  "GPIO pin for GPS TX (0 = default)": "Pin GPIO dla GPS TX (0 = domyślny)",

  /* ── zasilanie ── */
  "Power Saving": "Oszczędzanie energii",
  "Enable power saving mode (light sleep between operations)":
    "Włącz tryb oszczędzania energii (lekkie uśpienie między operacjami)",
  "On Battery Shutdown After (secs)": "Wyłączenie na baterii po (s)",
  "Auto-shutdown after this many seconds on battery (0 = disabled)":
    "Automatyczne wyłączenie po tylu sekundach na baterii (0 = wyłączone)",
  "ADC Multiplier Override": "Nadpisanie mnożnika ADC",
  "Override voltage divider ratio for battery reading (0 = auto)":
    "Wymuszony współczynnik dzielnika napięcia dla odczytu baterii (0 = automatycznie)",
  "Wait Bluetooth Secs": "Czas oczekiwania na Bluetooth (s)",
  "Seconds to wait for Bluetooth before sleeping":
    "Ile sekund czekać na Bluetooth przed uśpieniem",
  "Light Sleep Interval (secs)": "Interwał lekkiego uśpienia (s)",
  "Light sleep interval for power saving": "Interwał lekkiego uśpienia przy oszczędzaniu energii",
  "Min Wake Secs": "Minimalny czas czuwania (s)",
  "Minimum time to stay awake (seconds)": "Minimalny czas czuwania (sekundy)",

  /* ── sieć ── */
  "WiFi Enabled": "WiFi włączone",
  "Enable WiFi connectivity": "Włącz łączność WiFi",
  "WiFi SSID": "Nazwa sieci WiFi (SSID)",
  "Network name": "Nazwa sieci",
  "WiFi Password": "Hasło WiFi",
  "Ethernet Enabled": "Ethernet włączony",
  "Enable Ethernet connectivity": "Włącz łączność Ethernet",
  "NTP Server": "Serwer NTP",
  "Custom NTP server address": "Własny adres serwera NTP",
  "Syslog Server": "Serwer syslog",
  "Remote syslog server (host:port)": "Zdalny serwer syslog (host:port)",
  "IPv4 Address": "Adres IPv4",
  "Static IPv4 address (leave empty for DHCP)":
    "Statyczny adres IPv4 (puste = DHCP)",
  "Subnet Mask": "Maska podsieci",
  "DNS Server": "Serwer DNS",

  /* ── wyświetlacz ── */
  "Screen On Secs": "Ekran włączony przez (s)",
  "How long the screen stays on (0 = always on)":
    "Jak długo ekran pozostaje włączony (0 = zawsze)",
  "Auto Carousel Secs": "Interwał karuzeli (s)",
  "Seconds between auto-cycling pages (0 = disabled)":
    "Odstęp między automatyczną zmianą stron (0 = wyłączone)",
  "Display Units": "Jednostki",
  "Display Mode": "Tryb wyświetlania",
  "Color mode for the display": "Tryb kolorów wyświetlacza",
  "OLED Type": "Typ ekranu OLED",
  "OLED display hardware type": "Typ sprzętowy wyświetlacza OLED",
  "Flip Screen": "Odwróć ekran",
  "Rotate the display 180 degrees": "Obróć obraz o 180 stopni",
  "Heading Bold": "Pogrubiony nagłówek",
  "Use bold for heading text (0 = no, 1 = yes)":
    "Pogrub tekst nagłówka (0 = nie, 1 = tak)",
  "Compass North Top": "Północ u góry kompasu",
  "Always orient compass with north at top":
    "Kompas zawsze zwrócony północą do góry",
  "Wake on Tap or Motion": "Wybudź przy dotknięciu lub ruchu",
  "Wake the screen when motion is detected": "Wybudź ekran po wykryciu ruchu",

  /* ── Bluetooth ── */
  "Bluetooth Enabled": "Bluetooth włączony",
  "Enable Bluetooth radio": "Włącz moduł Bluetooth",
  "Pairing Mode": "Tryb parowania",
  "How the device pairs with Bluetooth clients":
    "Sposób parowania z klientami Bluetooth",
  "Fixed PIN": "Stały PIN",
  "6-digit pairing PIN": "Sześciocyfrowy PIN parowania",

  /* ── bezpieczeństwo i użytkownik ── */
  "Admin Key Required": "Wymagany klucz administratora",
  "Require admin key for remote administration":
    "Wymagaj klucza administratora do zdalnego zarządzania",
  "Admin Channel Index": "Indeks kanału administracyjnego",
  "Channel index used for admin messages (0 = primary)":
    "Indeks kanału dla wiadomości administracyjnych (0 = podstawowy)",
  "Admin Channel Enabled": "Kanał administracyjny włączony",
  "Allow configuration via a dedicated admin channel":
    "Zezwól na konfigurację przez dedykowany kanał administracyjny",
  "Admin Keys": "Klucze administratora",
  "No admin keys configured": "Brak skonfigurowanych kluczy administratora",
  Show: "Pokaż",
  Hide: "Ukryj",
  Deprecated: "przestarzałe",
  "Debug Log Enabled": "Dziennik diagnostyczny włączony",
  "Enable verbose debug logging on the device":
    "Włącz szczegółowe logowanie diagnostyczne na urządzeniu",
  "Long Name": "Długa nazwa",
  "Your radio's display name on the mesh (max 39 chars)":
    "Nazwa urządzenia widoczna w sieci (maks. 39 znaków)",
  "Short Name": "Krótka nazwa",
  "4-character abbreviation shown on compact displays":
    "Czteroznakowy skrót pokazywany na małych ekranach",
  "Licensed Operator": "Radioamator licencjonowany",
  "If enabled, your node will use HAM mode with longer names and no encryption":
    "Włącza tryb radioamatorski: dłuższe nazwy i brak szyfrowania",
  "Base64 encoded key": "Klucz zakodowany w Base64",
  "Channel name": "Nazwa kanału",
  "Uplink Enabled": "Wysyłanie włączone",
  "Forward packets from this channel to MQTT":
    "Przekazuj pakiety z tego kanału do MQTT",
  "Downlink Enabled": "Odbiór włączony",
  "Forward packets from MQTT to this channel":
    "Przekazuj pakiety z MQTT na ten kanał",

  /* ── MQTT ── */
  "MQTT Enabled": "MQTT włączone",
  "Enable MQTT client on this device": "Włącz klienta MQTT na tym urządzeniu",
  "MQTT broker hostname or IP": "Nazwa hosta lub IP brokera MQTT",
  "Root Topic": "Główny temat",
  "MQTT root topic": "Główny temat MQTT",
  "Encryption Enabled": "Szyfrowanie włączone",
  "Encrypt MQTT traffic": "Szyfruj ruch MQTT",
  "JSON Enabled": "Wyjście JSON",
  "Send JSON-formatted messages to MQTT": "Wysyłaj wiadomości w formacie JSON do MQTT",
  "TLS Enabled": "TLS włączone",
  "Use TLS for broker connection": "Użyj TLS do połączenia z brokerem",
  "Proxy to Client Enabled": "Proxy do klienta włączone",
  "Proxy MQTT traffic through connected client":
    "Przekazuj ruch MQTT przez podłączonego klienta",
  "Map Reporting Enabled": "Raportowanie na mapę",
  "Report position to the Meshtastic map": "Zgłaszaj pozycję na mapę publiczną",

  /* ── port szeregowy ── */
  "Enable serial module": "Włącz moduł portu szeregowego",
  "Baud Rate": "Prędkość transmisji",
  "Serial communication protocol": "Protokół komunikacji szeregowej",
  "Timeout (ms)": "Limit czasu (ms)",
  "Serial timeout in milliseconds": "Limit czasu portu szeregowego w milisekundach",
  Echo: "Echo",
  "Echo received serial data back": "Odsyłaj odebrane dane szeregowe",
  "Override Console Serial Port": "Nadpisz port szeregowy konsoli",
  "Use the main serial port for this module":
    "Użyj głównego portu szeregowego dla tego modułu",

  /* ── powiadomienia zewnętrzne ── */
  "Enable external notification module": "Włącz moduł powiadomień zewnętrznych",
  "Output GPIO": "Wyjście GPIO",
  "GPIO pin for notification output": "Pin GPIO wyjścia powiadomień",
  "Output Duration (ms)": "Czas trwania (ms)",
  "Notification pulse duration": "Długość impulsu powiadomienia",
  "Active High": "Aktywny stanem wysokim",
  "Output is active-high (vs active-low)":
    "Wyjście aktywne stanem wysokim (zamiast niskim)",
  "Output Vibra GPIO": "Wyjście silnika wibracyjnego (GPIO)",
  "GPIO for vibration motor": "Pin GPIO silnika wibracyjnego",
  "Output Buzzer GPIO": "Wyjście buzzera (GPIO)",
  "GPIO for piezo buzzer": "Pin GPIO buzzera piezo",
  "Alert on Message": "Alert przy wiadomości",
  "Notify on incoming messages": "Powiadamiaj o wiadomościach przychodzących",
  "Alert on Message Vibra": "Wibracja przy wiadomości",
  "Use vibration for message alerts": "Użyj wibracji do alertów o wiadomościach",
  "Alert on Message Buzzer": "Brzęczyk przy wiadomości",
  "Use buzzer for message alerts": "Użyj buzzera do alertów o wiadomościach",
  "Alert on Bell": "Alert przy dzwonku",
  "Notify on bell character": "Powiadamiaj o znaku dzwonka",
  "Alert on Bell Vibra": "Wibracja przy dzwonku",
  "Alert on Bell Buzzer": "Brzęczyk przy dzwonku",
  "Use PWM Buzzer": "Buzzer PWM",
  "Drive buzzer with PWM for tones": "Steruj buzzerem sygnałem PWM",
  "Nag Timeout (secs)": "Czas przypomnienia (s)",
  "Repeat notification interval (0 = once)":
    "Odstęp powtarzania powiadomienia (0 = jednorazowo)",

  /* ── Store & Forward ── */
  "Enable Store & Forward module": "Włącz moduł Store & Forward",
  "Is Server": "Tryb serwera",
  "Act as the S&F server for the mesh": "Pracuj jako serwer S&F dla sieci",
  "Number of messages to store (0 = auto)":
    "Liczba przechowywanych wiadomości (0 = automatycznie)",
  "History Return Max": "Maksimum zwracanej historii",
  "Max messages to return on request":
    "Maksymalna liczba wiadomości zwracanych na żądanie",
  "History Return Window (secs)": "Okno zwracanej historii (s)",
  "Time window for history requests": "Zakres czasu dla żądań historii",
  "Send periodic heartbeat to clients": "Wysyłaj okresowe bicie serca do klientów",

  /* ── test zasięgu ── */
  "Enable Range Test module": "Włącz moduł testu zasięgu",
  "Sender Interval (secs)": "Interwał nadawania (s)",
  "Seconds between test messages (0 = receive only)":
    "Odstęp między wiadomościami testowymi (0 = tylko odbiór)",
  "Save to File": "Zapisz do pliku",
  "Save received test data to file": "Zapisuj odebrane dane testowe do pliku",

  /* ── telemetria ── */
  "Update Interval (secs)": "Interwał aktualizacji (s)",
  "How often the radio broadcasts device metrics. 0 uses the firmware default (3600s on fw 2.7.x).":
    "Jak często radio rozgłasza metryki urządzenia. 0 oznacza wartość domyślną firmware (3600 s w 2.7.x).",
  "Environment Measurement Enabled": "Pomiary środowiskowe włączone",
  "Enable environment sensor readings": "Włącz odczyty czujników środowiskowych",
  "Environment Update Interval (secs)": "Interwał metryk środowiskowych (s)",
  "Environment Screen Enabled": "Metryki środowiskowe na ekranie",
  "Show on screen (1 = yes)": "Pokazuj na ekranie (1 = tak)",
  "Air Quality Enabled": "Jakość powietrza włączona",
  "Enable air quality sensor readings": "Włącz odczyty czujnika jakości powietrza",
  "Air Quality Interval (secs)": "Interwał jakości powietrza (s)",
  "Power Measurement Enabled": "Pomiary zasilania włączone",
  "Enable power sensor readings (INA sensors)":
    "Włącz odczyty czujników zasilania (INA)",
  "Power Update Interval (secs)": "Interwał metryk zasilania (s)",
  "Power Screen Enabled": "Metryki zasilania na ekranie",

  /* ── gotowe wiadomości ── */
  "Enable Canned Message module": "Włącz moduł gotowych wiadomości",
  "Rotary Encoder Enabled": "Enkoder obrotowy włączony",
  "Input Pin A": "Pin wejściowy A",
  "GPIO for rotary encoder / button A": "Pin GPIO enkodera obrotowego / przycisku A",
  "Input Pin B": "Pin wejściowy B",
  "GPIO for rotary encoder B": "Pin GPIO enkodera obrotowego B",
  "Input Pin Press": "Pin naciśnięcia",
  "GPIO for press/select": "Pin GPIO naciśnięcia / wyboru",
  "Up/Down Enabled": "Wejście góra/dół włączone",
  "Allow Input Source": "Zezwól na źródło wejściowe",
  "Allow message input from hardware": "Zezwól na wprowadzanie wiadomości ze sprzętu",
  "Input Event Source": "Źródło zdarzeń wejściowych",
  "Send Bell": "Wyślij dzwonek",
  "Send a bell notification with alerts": "Dołącz sygnał dzwonka do alertów",

  /* ── dźwięk ── */
  "Codec2 Enabled": "CODEC 2 włączony",
  "Enable Codec2 audio module": "Włącz moduł dźwięku Codec2",
  Bitrate: "Przepływność",
  "Codec2 bitrate setting": "Ustawienie przepływności Codec2",
  "PTT GPIO": "Pin PTT",
  "GPIO for push-to-talk button": "Pin GPIO przycisku push-to-talk",
  "I2S WS GPIO": "I2S WS GPIO",
  "I2S SD GPIO": "I2S SD GPIO",
  "I2S DIN GPIO": "I2S DIN GPIO",
  "I2S SCK GPIO": "I2S SCK GPIO",

  /* ── sąsiedzi ── */
  "Enable Neighbor Info module": "Włącz moduł informacji o sąsiadach",
  "How often to broadcast neighbor info (0 = default)":
    "Jak często rozgłaszać informacje o sąsiadach (0 = domyślnie)",

  /* ── podświetlenie ── */
  "LED State": "Stan diody LED",
  "Turn the LED on or off": "Włącz lub wyłącz diodę",
  "LED brightness / current limit (0-31)":
    "Jasność diody / ograniczenie prądu (0-31)",
  "Red channel (0-255)": "Kanał czerwony (0-255)",
  "Green channel (0-255)": "Kanał zielony (0-255)",
  "Blue channel (0-255)": "Kanał niebieski (0-255)",

  /* ── czujnik detekcji ── */
  "Enable Detection Sensor module": "Włącz moduł czujnika detekcji",
  "Monitor Pin": "Monitorowany pin",
  "GPIO pin to monitor for detection": "Pin GPIO monitorowany pod kątem detekcji",
  "Detection Triggered High": "Wyzwalanie stanem wysokim",
  "Message when pin goes HIGH": "Wiadomość przy stanie wysokim",
  "Detection Triggered Low": "Wyzwalanie stanem niskim",
  "Message when pin goes LOW": "Wiadomość przy stanie niskim",
  "Use Pullup": "Rezystor podciągający",
  "Enable internal pullup resistor": "Włącz wewnętrzny rezystor podciągający",
  "Minimum Broadcast Secs": "Minimalny odstęp rozgłaszania (s)",
  "Min interval between alert broadcasts": "Minimalny odstęp między alertami",
  "State Broadcast Secs": "Rozgłaszanie stanu (s)",
  "Periodic state broadcast interval": "Interwał okresowego rozgłaszania stanu",

  /* ── licznik PAX ── */
  "Enable Paxcounter module": "Włącz moduł licznika PAX",
  "How often to broadcast pax count (0 = default)":
    "Jak często rozgłaszać licznik PAX (0 = domyślnie)",
  "WiFi Threshold": "Próg WiFi",
  "Enable WiFi device counting": "Licz urządzenia WiFi",
  "BLE Threshold": "Próg BLE",
  "Enable BLE device counting": "Licz urządzenia BLE",

  /* ── kanał docelowy ── */
  "Send to Channel": "Wyślij na kanał",
  "Channel index to send on": "Indeks kanału do nadawania",

  /* ── nazwy kategorii i wartości list wyboru ── */
  LoRa: "LoRa",
  Channels: "Kanały",
  Device: "Urządzenie",
  User: "Użytkownik",
  Position: "Pozycja",
  Power: "Zasilanie",
  Network: "Sieć",
  Display: "Wyświetlacz",
  Bluetooth: "Bluetooth",
  Security: "Bezpieczeństwo",
  "Device Actions": "Akcje urządzenia",
  Storage: "Pamięć",
  MQTT: "MQTT",
  Serial: "Port szeregowy",
  "Ext. Notification": "Powiadomienia zewnętrzne",
  "Store & Forward": "Store & Forward",
  "Range Test": "Test zasięgu",
  Telemetry: "Telemetria",
  "Canned Messages": "Gotowe wiadomości",
  Audio: "Dźwięk",
  "Neighbor Info": "Informacje o sąsiadach",
  "Ambient Lighting": "Podświetlenie",
  "Detection Sensor": "Czujnik detekcji",
  Paxcounter: "Licznik PAX",
  TAK: "TAK",

  /* role urządzenia — nazwy z aplikacji MT_SW_APP */
  Client: "Klient",
  "Client Mute": "Klient pasywny",
  "Client Hidden": "Klient ukryty",
  "Client Base": "Klient bazowy",
  Router: "Router",
  "Router Late": "Router pomocniczy",
  "Router Client": "Router Klienta",
  Repeater: "Repeater",
  Tracker: "Tracker",
  Sensor: "Czujnik",
  "TAK Tracker": "TAK Tracker",
  "Lost and Found": "Zgubiony i znaleziony",

  /* tryby retransmisji */
  All: "Wszystko",
  "All (Skip Decoding)": "Wszystko, bez dekodowania",
  "Local Only": "Tylko lokalne kanały",
  "Known Only": "Tylko znane węzły",

  /* pozostałe wartości list */
  None: "Brak",
  Disabled: "Wyłączone",
  Default: "Domyślny",
  "Auto Detect": "Wykryj automatycznie",
  "Not Present": "Brak sprzętu",
  Metric: "Metryczne",
  Imperial: "Imperialne",
  Color: "Kolorowy",
  "Two Color": "Dwukolorowy",
  Inverted: "Odwrócony",
  Simple: "Prosty",
  "Random PIN": "Losowy PIN",
  "No PIN": "Bez PIN-u",
  Primary: "Podstawowy",
  Secondary: "Dodatkowy",
  "Text Message": "Wiadomość tekstowa",
  "Rotary Encoder": "Enkoder obrotowy",
  "Up/Down/Select": "Góra/Dół/Wybór",

  /* ── nowe pola dodane w tym wydaniu ── */
  "0-255 (0 = default)": "0-255 (0 = domyślnie)",
  Dark: "Ciemny",
  Light: "Jasny",
  Theme: "Motyw",
  Screen: "Ekran",
  "Screen Brightness": "Jasność ekranu",
  "Screen Timeout (secs)": "Wygaszanie ekranu (s)",
  "Screen Lock": "Blokada ekranu",
  "Settings Lock": "Blokada ustawień",
  "PIN Code": "Kod PIN",
  "Require a PIN to wake the screen": "Wymagaj PIN-u do wybudzenia ekranu",
  "Require a PIN to change settings on the device":
    "Wymagaj PIN-u do zmiany ustawień na urządzeniu",
  "Alerts Enabled": "Alerty włączone",
  "Banners Enabled": "Banery włączone",
  "Analog Clock Face": "Analogowa tarcza zegara",
  "Compass Mode": "Tryb kompasu",
  Dynamic: "Dynamiczny",
  "Fixed Ring": "Stały pierścień",
  "Freeze Heading": "Zamrożony kurs",
  "GPS Coordinate Format": "Format współrzędnych GPS",
  Decimal: "Dziesiętny",
  "Degrees/Minutes/Seconds": "Stopnie/Minuty/Sekundy",
  "Open Location Code": "Kod lokalizacji otwartej",
  "On-device UI: theme, brightness, lock and language (firmware 2.8+).":
    "Interfejs na ekranie urządzenia: motyw, jasność, blokada i język (firmware 2.8+).",

  "Packet Signature Policy": "Polityka podpisu pakietów",
  "How strictly this node verifies signed packets (firmware 2.8+)":
    "Jak rygorystycznie ten węzeł weryfikuje podpisane pakiety (firmware 2.8+)",
  "Compatible — Accept Unsigned": "Kompatybilny — akceptuj niepodpisane",
  "Balanced — Prefer Authenticated": "Zrównoważony — preferuj uwierzytelnione",
  "Strict — Require Authentication": "Ścisły — wymagaj uwierzytelnienia",

  "Traffic Management": "Zarządzanie ruchem",
  "MT_SW firmware extension for shaping mesh traffic — not part of stock Meshtastic.":
    "Rozszerzenie firmware MT_SW do kształtowania ruchu sieciowego — nieobecne w oficjalnym Meshtastic.",
  "Position Min Interval (secs)": "Min. interwał pozycji (s)",
  "NodeInfo Direct Response Max Hops": "Maks. skoków dla bezpośredniej odpowiedzi NodeInfo",
  "Rate Limit Window (secs)": "Okno ograniczenia (s)",
  "Rate Limit Max Packets": "Maks. pakietów w oknie",
  "Unknown Packet Threshold": "Próg nieznanych pakietów",

  "Mesh Beacon": "Sygnał mesh (beacon)",
  "MT_SW firmware extension: periodically announces this mesh to nearby networks.":
    "Rozszerzenie firmware MT_SW: okresowo ogłasza tę sieć mesh pobliskim sieciom.",
  "Channel and target offers are configured on the device and are not editable here yet.":
    "Oferowany kanał i cele nadawania konfiguruje się na urządzeniu — nie są jeszcze edytowalne z panelu.",
  "Beacon Message": "Wiadomość beacona",
  "Broadcast Interval (secs)": "Interwał nadawania (s)",
  "Offered Region": "Oferowany region",
  "Offered Preset": "Oferowany preset",

  Sniffer: "Sniffer",
  "Sniffer Mode": "Tryb sniffera",
  "MT_SW firmware extension: forward packets overheard but not addressed to this node.":
    "Rozszerzenie firmware MT_SW: przekazuj pakiety odsłuchane, ale nieadresowane do tego węzła.",
  "Forward locally overheard packets not addressed to this node to the app":
    "Przekazuj do aplikacji lokalnie odsłuchane pakiety nieadresowane do tego węzła",
  "Requires MT_SW-branded firmware and app. Other combinations may hang the node.":
    "Wymaga brandowanej aplikacji i firmware MT_SW. Inne kombinacje mogą zawiesić węzeł.",

  "Status Message": "Wiadomość statusu",
  "MT_SW firmware extension: a custom status text broadcast to the mesh.":
    "Rozszerzenie firmware MT_SW: własny tekst statusu rozgłaszany do sieci mesh.",
  "Status Text": "Treść statusu",
  "Shown to other nodes on the node list": "Widoczny innym węzłom na liście węzłów",

  /* baud rate portu szeregowego — liczby zostają, dopisujemy jednostkę */
  "110": "110 bps", "300": "300 bps", "600": "600 bps", "1200": "1200 bps",
  "2400": "2400 bps", "4800": "4800 bps", "9600": "9600 bps", "19200": "19200 bps",
  "38400": "38400 bps", "57600": "57600 bps", "115200": "115200 bps",
  "230400": "230400 bps", "460800": "460800 bps", "576000": "576000 bps",
  "921600": "921600 bps",
  "1200 bps": "1200 bps", "1300 bps": "1300 bps", "1400 bps": "1400 bps",
  "1600 bps": "1600 bps", "2400 bps": "2400 bps", "3200 bps": "3200 bps",
  "700 bps": "700 bps", "700B bps": "700B bps",

  CalTopo: "CalTopo",
  NMEA: "NMEA",
  Protobuf: "Protobuf",
  SSD1306: "SSD1306",
  SH1106: "SH1106",
  SH1107: "SH1107",
};

/** Tłumaczenie napisu z przeniesionej zakładki; brak hasła = angielski. */
export function PL(text) {
  return PL_STRINGS[text] || text;
}
