/*
 * SPDX-FileCopyrightText: 2026 MT_SW
 *
 * SPDX-License-Identifier: MIT
 *
 * Polskie etykiety pól konfiguracji.
 *
 * Źródłem jest values-pl/strings.xml z aplikacji MT_SW_APP — chodzi o to,
 * żeby to samo pole nazywało się tak samo w aplikacji i w panelu.
 *
 * Klucze to nazwy pól w postaci, w jakiej zwraca je radio (camelCase),
 * pogrupowane po sekcji. Pole bez wpisu spada na automatyczne
 * uczłowieczenie nazwy w settings.js — nic się nie psuje, po prostu
 * wyświetli się forma techniczna.
 */

const COMMON = {
  enabled: "Włączony",
  name: "Nazwa",
  mode: "Tryb",
  role: "Rola",
  address: "Adres",
  password: "Hasło",
  username: "Nazwa użytkownika",
  timeout: "Limit czasu",
};

export const FIELD_LABELS = {
  device: {
    role: "Rola urządzenia",
    serialEnabled: "Konsola szeregowa",
    buttonGpio: "Przycisk GPIO",
    buzzerGpio: "Buzzer GPIO",
    buzzerMode: "Tryb buzzera",
    rebroadcastMode: "Tryb retransmisji",
    nodeInfoBroadcastSecs: "Interwał transmisji informacji o węźle",
    doubleTapAsButtonPress: "Podwójne dotknięcie jako naciśnięcie przycisku",
    isManaged: "Tryb zarządzany",
    disableTripleClick: "Wyłącz potrójne kliknięcie (ping adhoc)",
    tzdef: "Strefa czasowa",
    ledHeartbeatDisabled: "Wyłącz LED bicia serca",
  },

  position: {
    positionBroadcastSecs: "Okresowe nadawanie pozycji",
    positionBroadcastSmartEnabled: "Inteligentne pozycjonowanie",
    fixedPosition: "Położenie stałe",
    gpsEnabled: "Lokalizacja włączona",
    gpsUpdateInterval: "Interwał odpytywania GPS",
    gpsAttemptTime: "Czas próby uzyskania pozycji",
    positionFlags: "Flagi położenia",
    rxGpio: "GPS Rx GPIO",
    txGpio: "GPS Tx GPIO",
    gpsEnGpio: "GPS EN GPIO",
    gpsMode: "Tryb GPS (sprzęt fizyczny)",
    broadcastSmartMinimumDistance: "Inteligentny dystans",
    broadcastSmartMinimumIntervalSecs: "Inteligentny interwał",
  },

  power: {
    isPowerSaving: "Włącz tryb oszczędzania energii",
    onBatteryShutdownAfterSecs: "Wyłącz przy utracie zasilania",
    adcMultiplierOverride: "Współczynnik nadpisania mnożnika ADC",
    waitBluetoothSecs: "Czas oczekiwania na Bluetooth",
    sdsSecs: "Czas trwania głębokiego uśpienia",
    lsSecs: "Czas lekkiego uśpienia",
    minWakeSecs: "Minimalny czas czuwania",
    deviceBatteryInaAddress: "Adres I2C dla wartości baterii INA_2XX",
    powermonEnables: "Monitor zasilania (maska)",
  },

  network: {
    wifiEnabled: "WiFi włączone",
    wifiSsid: "SSID",
    wifiPsk: "Hasło",
    ntpServer: "Serwer NTP",
    ethEnabled: "Ethernet włączony",
    addressMode: "Tryb IPv4",
    ipv4Config: "Konfiguracja IPv4",
    ipv6Enabled: "IPv6 włączone",
    rsyslogServer: "Serwer rsyslog",
    enabledProtocols: "Włączone protokoły",
  },

  display: {
    screenOnSecs: "Ekran włączony na",
    gpsFormat: "Format współrzędnych GPS",
    autoScreenCarouselSecs: "Interwał karuzeli",
    compassNorthTop: "Północ u góry kompasu",
    flipScreen: "Odwróć ekran",
    units: "Wyświetlana jednostka",
    oled: "Typ ekranu OLED",
    displaymode: "Tryb wyświetlania",
    headingBold: "Pogrubiony nagłówek",
    wakeOnTapOrMotion: "Wybudź przy dotknięciu lub ruchu",
    compassOrientation: "Orientacja kompasu",
    use12hClock: "Użyj formatu 12-godzinnego",
    useLongNodeName: "Użyj długiej nazwy węzła",
    enableMessageBubbles: "Dymki wiadomości",
  },

  lora: {
    usePreset: "Użyj predefiniowanych ustawień",
    modemPreset: "Presety",
    bandwidth: "Pasmo",
    spreadFactor: "Współczynnik rozproszenia",
    codingRate: "Szybkość kodowania",
    frequencyOffset: "Przesunięcie częstotliwości",
    region: "Region",
    hopLimit: "Liczba skoków",
    txEnabled: "Nadawanie włączone",
    txPower: "Moc nadawania",
    channelNum: "Slot częstotliwości",
    overrideDutyCycle: "Pomiń limit czasu nadawania",
    sx126xRxBoostedGain: "Wzmocniony zysk RX",
    overrideFrequency: "Wymuszenie częstotliwości",
    paFanDisabled: "Wentylator PA wyłączony",
    ignoreIncoming: "Ignoruj przychodzące",
    ignoreMqtt: "Zignoruj MQTT",
    configOkToMqtt: "Ok dla MQTT",
    femLnaMode: "Tryb FEM/LNA",
    serialHalOnly: "Tylko HAL szeregowy",
  },

  bluetooth: {
    enabled: "Bluetooth włączony",
    mode: "Tryb parowania",
    fixedPin: "Stały PIN",
  },

  security: {
    publicKey: "Klucz publiczny",
    privateKey: "Klucz prywatny",
    adminKey: "Klucze administratora",
    isManaged: "Tryb zarządzany",
    serialEnabled: "Konsola szeregowa",
    debugLogApiEnabled: "API dziennika debugowania włączone",
    adminChannelEnabled: "Stary kanał administracyjny",
    packetSignaturePolicy: "Autentyczność pakietów",
  },

  deviceUi: {
    version: "Wersja",
    screenBrightness: "Jasność ekranu",
    screenTimeout: "Wygaszanie ekranu",
    screenLock: "Blokada ekranu",
    settingsLock: "Blokada ustawień",
    pinCode: "Kod PIN",
    theme: "Motyw",
    alertEnabled: "Alerty włączone",
    bannerEnabled: "Banery włączone",
    ringToneId: "Dzwonek",
    language: "Język",
    nodeFilter: "Filtr węzłów",
    nodeHighlight: "Wyróżnianie węzłów",
    calibrationData: "Dane kalibracji",
    mapData: "Dane mapy",
    compassMode: "Tryb kompasu",
    screenRgbColor: "Kolor RGB ekranu",
    isClockfaceAnalog: "Analogowa tarcza zegara",
    gpsFormat: "Format współrzędnych GPS",
  },

  mqtt: {
    enabled: "Włącz MQTT",
    address: "Adres",
    username: "Nazwa użytkownika",
    password: "Hasło",
    encryptionEnabled: "Szyfrowanie włączone",
    jsonEnabled: "Włącz wyjście JSON",
    tlsEnabled: "Włącz TLS",
    root: "Główny temat",
    proxyToClientEnabled: "Proxy do klienta włączone",
    mapReportingEnabled: "Raportowanie map",
    mapReportSettings: "Ustawienia raportu mapy",
  },

  serial: {
    enabled: "Włącz tryb serial",
    echo: "Włącz echo",
    rxd: "RX",
    txd: "TX",
    baud: "Prędkość transmisji",
    timeout: "Limit czasu",
    mode: "Tryb serial",
    overrideConsoleSerialPort: "Nadpisz port szeregowy konsoli",
  },

  externalNotification: {
    enabled: "Powiadomienia zewnętrzne włączone",
    outputMs: "Czas trwania (w milisekundach)",
    output: "Wyjście LED (GPIO)",
    outputVibra: "Wyjście silnika wibracyjnego (GPIO)",
    outputBuzzer: "Wyjście buzzera (GPIO)",
    active: "Wyjście LED aktywne wysokim stanem",
    alertMessage: "Dioda wiadomości alarmowej",
    alertMessageVibra: "Wibracja wiadomości alarmowej",
    alertMessageBuzzer: "Brzęczyk wiadomości alarmowej",
    alertBell: "Dioda dzwonka alarmowego",
    alertBellVibra: "Wibracja dzwonka alarmowego",
    alertBellBuzzer: "Brzęczyk dzwonka alarmowego",
    usePwm: "Użyj buzzera PWM",
    nagTimeout: "Czas przypomnienia (sekundy)",
    useI2sAsBuzzer: "Użyj I2S jako buzzer",
  },

  storeForward: {
    enabled: "Store & Forward włączony",
    heartbeat: "Bicie serca",
    records: "Liczba rekordów",
    historyReturnMax: "Maks. zwracana historia",
    historyReturnWindow: "Okno zwracanej historii",
    isServer: "Serwer",
  },

  rangeTest: {
    enabled: "Test zasięgu włączony",
    sender: "Interwał wiadomości nadawcy (sekundy)",
    save: "Zapisz .CSV w pamięci (tylko ESP32)",
    clearOnReboot: "Czyść po restarcie",
  },

  telemetry: {
    deviceUpdateInterval: "Interwał aktualizacji metryk urządzenia",
    deviceTelemetryEnabled: "Wysyłaj telemetrię urządzenia",
    environmentUpdateInterval: "Interwał aktualizacji metryk środowiskowych",
    environmentMeasurementEnabled: "Moduł metryk środowiskowych włączony",
    environmentScreenEnabled: "Metryki środowiskowe na ekranie włączone",
    environmentDisplayFahrenheit: "Metryki środowiskowe w Fahrenheitach",
    airQualityEnabled: "Włącz moduł metryk jakości powietrza",
    airQualityInterval: "Czas aktualizacji metryk jakości powietrza",
    airQualityScreenEnabled: "Metryki jakości powietrza na ekranie",
    powerMeasurementEnabled: "Włącz moduł metryk zasilania",
    powerUpdateInterval: "Czas aktualizacji metryk zasilania",
    powerScreenEnabled: "Wyświetlaj metryki zasilania na ekranie",
    healthMeasurementEnabled: "Włącz moduł metryk zdrowia",
    healthUpdateInterval: "Czas aktualizacji metryk zdrowia",
    healthScreenEnabled: "Wyświetlaj metryki zdrowia na ekranie",
  },

  cannedMessage: {
    enabled: "Wiadomości predefiniowane włączone",
    rotary1Enabled: "Enkoder obrotowy #1 włączony",
    inputbrokerPinA: "Pin GPIO dla portu A enkodera obrotowego",
    inputbrokerPinB: "Pin GPIO dla portu B enkodera obrotowego",
    inputbrokerPinPress: "Pin GPIO dla portu Press enkodera obrotowego",
    inputbrokerEventCw: "Generuj zdarzenie wejścia przy CW",
    inputbrokerEventCcw: "Generuj zdarzenie wejścia przy CCW",
    inputbrokerEventPress: "Generuj zdarzenie wejścia przy naciśnięciu",
    updown1Enabled: "Wejście Góra/Dół/Wybór włączone",
    allowInputSource: "Zezwól na źródło wejściowe",
    sendBell: "Wyślij dzwonek",
  },

  audio: {
    codec2Enabled: "CODEC 2 włączony",
    pttPin: "Pin PTT (Push-To-Talk)",
    bitrate: "Częstotliwość próbkowania CODEC2",
    i2sWs: "I2S wybór słowa",
    i2sSd: "I2S dane wyjściowe",
    i2sDin: "I2S dane wejściowe",
    i2sSck: "Zegar I2S",
  },

  remoteHardware: {
    enabled: "Zdalny sprzęt włączony",
    allowUndefinedPinAccess: "Zezwól na dostęp do niezdefiniowanych pinów",
    availablePins: "Dostępne piny",
  },

  neighborInfo: {
    enabled: "Włącz informacje o sąsiadach",
    updateInterval: "Częstotliwość aktualizacji (w sekundach)",
    transmitOverLora: "Nadaj przez LoRa",
  },

  ambientLighting: {
    ledState: "Stan diody LED",
    current: "Prąd",
    red: "Czerwony",
    green: "Zielony",
    blue: "Niebieski",
  },

  detectionSensor: {
    enabled: "Czujnik detekcji włączony",
    minimumBroadcastSecs: "Minimalny czas transmisji (sekundy)",
    stateBroadcastSecs: "Nadawanie stanu (sekundy)",
    sendBell: "Wyślij dzwonek",
    name: "Przyjazna nazwa",
    monitorPin: "Pin GPIO do monitorowania",
    detectionTriggerType: "Typ wyzwalacza wykrywania",
    usePullup: "Użyj trybu INPUT_PULLUP",
  },

  paxcounter: {
    enabled: "Paxcounter włączony",
    paxcounterUpdateInterval: "Częstotliwość aktualizacji (w sekundach)",
    wifiThreshold: "Próg WiFi RSSI (domyślnie: -80)",
    bleThreshold: "Próg RSSI BLE (domyślnie -80)",
  },

  /* Poniższe sekcje pochodzą z firmware MT_SW i nie istnieją w oficjalnym. */

  statusmessage: {
    nodeStatus: "Wiadomość statusu",
  },

  trafficManagement: {
    positionMinIntervalSecs: "Min. interwał pozycji (sek.)",
    nodeinfoDirectResponseMaxHops: "Maks. skoków dla bezpośredniej odpowiedzi",
    rateLimitWindowSecs: "Okno ograniczenia (sek.)",
    rateLimitMaxPackets: "Maks. pakietów w oknie",
    unknownPacketThreshold: "Próg nieznanych pakietów",
  },

  tak: {
    team: "Kolor zespołu",
    role: "Rola członka",
  },

  meshBeacon: {
    flags: "Flagi",
    broadcastMessage: "Wiadomość meshbeacon",
    broadcastOfferChannel: "Oferuj kanał",
    broadcastOfferRegion: "Nadawaj region",
    broadcastOfferPreset: "Nadawaj preset",
    broadcastIntervalSecs: "Interwał nadawania (sekundy)",
    broadcastTargets: "Cele nadawania",
  },

  nodemodadmin: {
    snifferEnabled: "Tryb sniffera",
  },
};

/** Etykieta pola albo null, gdy nie mamy tłumaczenia. */
export function fieldLabel(section, field) {
  const inSection = FIELD_LABELS[section];
  if (inSection && inSection[field]) {
    return inSection[field];
  }
  return COMMON[field] || null;
}
