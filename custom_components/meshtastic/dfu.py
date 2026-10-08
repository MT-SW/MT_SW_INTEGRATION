# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Aktualizacja firmware radia nRF52 przez Bluetooth (Nordic DFU) — odpowiednik tego, co robi aplikacja na Androida.

Przebieg (tak jak w aplikacji):

1. Wchodzimy do radia po Bluetooth i wysyłamy „buttonless DFU” — radio restartuje się do bootloadera.
2. Szukamy radia w trybie DFU (ten sam adres albo adres +1) i łączymy się z usługą Legacy DFU (Adafruit).
3. Wysyłamy ``START_DFU``, rozmiary, pakiet init (``.dat``), potem plik firmware (``.bin``) małymi paczkami;
   co kilka paczek bootloader potwierdza liczbę odebranych bajtów (PRN).
4. ``VALIDATE`` i ``ACTIVATE_AND_RESET`` — radio uruchamia się z nowym firmware.

Plik to „zip DFU” (``…-ota.zip``) z ``manifest.json``, ``.dat`` i ``.bin``. Obsługujemy Legacy DFU (bootloader
Adafruit w radiach Meshtastic nRF52). Bootloader Secure DFU jest rozpoznawany, ale nie obsługiwany — dostaniesz wtedy
czytelny komunikat zamiast zepsutego radia.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import struct
import zipfile
from typing import Any, Callable

# Usługa i znaki Legacy DFU (Nordic SDK 11/12, Adafruit BLEDfu)
LEGACY_SERVICE = "00001530-1212-efde-1523-785feabcd123"
LEGACY_CONTROL = "00001531-1212-efde-1523-785feabcd123"
LEGACY_PACKET = "00001532-1212-efde-1523-785feabcd123"
LEGACY_VERSION = "00001534-1212-efde-1523-785feabcd123"
# Usługa i znaki Secure DFU (tylko do rozpoznania / wyzwolenia)
SECURE_SERVICE = "0000fe59-0000-1000-8000-00805f9b34fb"
SECURE_BUTTONLESS = "8ec90003-f315-4f60-9fb8-838830daea50"

OP_START_DFU = 0x01
OP_INIT_DFU_PARAMS = 0x02
OP_RECEIVE_FIRMWARE = 0x03
OP_VALIDATE = 0x04
OP_ACTIVATE_AND_RESET = 0x05
OP_RESET = 0x06
OP_PRN_REQ = 0x08
RESP_CODE = 0x10
RESP_PRN = 0x11
INIT_START = 0x00
INIT_COMPLETE = 0x01
IMAGE_APPLICATION = 0x04
STATUS_SUCCESS = 0x01
STATUS_INVALID_STATE = 0x02

STATUS_NAMES = {
    0x01: "SUCCESS",
    0x02: "INVALID_STATE",
    0x03: "NOT_SUPPORTED",
    0x04: "DATA_SIZE_EXCEEDS_LIMIT",
    0x05: "CRC_ERROR",
    0x06: "OPERATION_FAILED",
}

PRN_INTERVAL = 10
PRN_INTERVAL_RECOVERY = 5
MIN_PACKET = 20
MAX_PACKET = 244
MAX_INIT_SIZE = 256
MIN_DFU_VERSION = 5
SESSION_ATTEMPTS = 3
MAX_STALE_RESETS = 2

REBOOT_WAIT_S = 4.0
SCAN_ATTEMPTS = 4
SCAN_TIMEOUT_S = 10.0
CONNECT_TIMEOUT_S = 15.0
SETTLE_S = 0.5
START_TIMEOUT_S = 90.0
COMMAND_TIMEOUT_S = 30.0
VALIDATE_TIMEOUT_S = 60.0
MIN_FIRMWARE_BYTES = 20 * 1024
MAX_FIRMWARE_BYTES = 1024 * 1024


class DfuError(Exception):
    """Błąd z czytelnym opisem dla użytkownika."""


class StaleSession(DfuError):
    """Bootloader trzyma stan przerwanej sesji (INVALID_STATE na START)."""


class MidStreamDrop(DfuError):
    """Łącze zerwało się w trakcie wysyłania pliku."""


def is_dfu_zip(data: bytes) -> bool:
    return data[:2] == b"PK"


def parse_dfu_zip(data: bytes) -> tuple[bytes, bytes]:
    """Z paczki DFU wyciągnij (pakiet init ``.dat``, firmware ``.bin``) aplikacji."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as err:
        msg = "To nie jest poprawny plik zip."
        raise DfuError(msg) from err
    with archive:
        try:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        except KeyError as err:
            msg = "W zipie nie ma pliku manifest.json — to nie jest paczka DFU."
            raise DfuError(msg) from err
        except (ValueError, UnicodeDecodeError) as err:
            msg = "Nie mogę odczytać manifest.json z paczki DFU."
            raise DfuError(msg) from err
        section = manifest.get("manifest") if isinstance(manifest, dict) else None
        if not isinstance(section, dict):
            msg = "manifest.json ma nieoczekiwany format."
            raise DfuError(msg)
        app = section.get("application")
        if not isinstance(app, dict):
            if any(isinstance(section.get(k), dict) for k in ("softdevice", "bootloader", "softdevice_bootloader")):
                msg = "Ta paczka zawiera tylko SoftDevice/bootloader — nie wolno jej wgrywać jako aplikacji."
            else:
                msg = "W manifest.json nie ma obrazu „application”."
            raise DfuError(msg)
        try:
            init = archive.read(str(app["dat_file"]))
            firmware = archive.read(str(app["bin_file"]))
        except (KeyError, TypeError) as err:
            msg = "W zipie brakuje pliku .dat lub .bin wskazanego w manifest.json."
            raise DfuError(msg) from err
    if len(init) > MAX_INIT_SIZE:
        msg = (
            f"Pakiet init ma {len(init)} B — za duży na Legacy DFU. To wygląda na paczkę Secure DFU, "
            "a radia Meshtastic nRF52 używają bootloadera Legacy."
        )
        raise DfuError(msg)
    if not MIN_FIRMWARE_BYTES <= len(firmware) <= MAX_FIRMWARE_BYTES:
        msg = "Rozmiar firmware w paczce jest nieprawdopodobny dla nRF52."
        raise DfuError(msg)
    return init, firmware


def validate_dfu_zip(name: str, data: bytes) -> None:
    """Sprawdź paczkę DFU (zgłasza ``DfuError``)."""
    if not name.lower().endswith(".zip") or not is_dfu_zip(data):
        msg = "Do nRF52 potrzebna jest paczka DFU (plik .zip, np. firmware-….-ota.zip)."
        raise DfuError(msg)
    parse_dfu_zip(data)


def _u32(value: int) -> bytes:
    return struct.pack("<I", value)


def packet_size(mtu: int | None) -> int:
    """Rozmiar paczki: MTU−3, nie mniej niż 20 i wyrównany do 4 bajtów (bootloader Adafruit tego wymaga)."""
    if not mtu:
        return MIN_PACKET
    sized = max(MIN_PACKET, min(MAX_PACKET, int(mtu) - 3))
    return sized - (sized % 4)


def mac_plus_one(mac: str) -> str:
    parts = mac.upper().split(":")
    if len(parts) != 6:  # noqa: PLR2004
        return mac.upper()
    parts[-1] = f"{(int(parts[-1], 16) + 1) & 0xFF:02X}"
    return ":".join(parts)


def parse_response(data: bytes) -> tuple[str, int, int]:
    """Zwraca (rodzaj, opcode/0, status/bajty): ``("resp", opcode, status)``, ``("prn", 0, bajty)`` lub ``("unknown",0,0)``."""
    if len(data) >= 3 and data[0] == RESP_CODE:  # noqa: PLR2004
        return "resp", data[1], data[2]
    if len(data) >= 5 and data[0] == RESP_PRN:  # noqa: PLR2004
        return "prn", 0, struct.unpack_from("<I", data, 1)[0]
    return "unknown", 0, 0


def _import_bleak():
    try:
        import bleak  # noqa: PLC0415
    except ImportError as err:
        msg = "Ta instalacja Home Assistanta nie ma obsługi Bluetooth (biblioteka bleak)."
        raise DfuError(msg) from err
    return bleak


async def trigger_buttonless(mac: str, set_status: Callable[[str, str], None]) -> None:
    """Połącz się z radiem w normalnym trybie i każ mu wejść w bootloader DFU (jak aplikacja)."""
    bleak = _import_bleak()
    set_status("connecting", "Łączę się z radiem po Bluetooth, żeby włączyć tryb DFU…")
    last: Exception | None = None
    for _ in range(3):
        try:
            async with bleak.BleakClient(mac, timeout=CONNECT_TIMEOUT_S) as client:
                services = client.services
                if services.get_service(SECURE_SERVICE) is not None:
                    await _trigger_secure(client)
                elif services.get_service(LEGACY_SERVICE) is not None:
                    await _trigger_legacy(client)
                else:
                    msg = (
                        "Radio nie udostępnia usługi DFU przez Bluetooth. Czy to na pewno nRF52 "
                        "z oryginalnym bootloaderem?"
                    )
                    raise DfuError(msg)
            return
        except DfuError:
            raise
        except Exception as err:  # noqa: BLE001
            # Radio rozłącza się w trakcie zapisu, bo restartuje się do bootloadera — to oczekiwane.
            last = err
            if getattr(err, "_dfu_triggered", False):
                return
            await asyncio.sleep(2.0)
    msg = f"Nie udało się połączyć z radiem po Bluetooth ({last})."
    raise DfuError(msg)


async def _trigger_legacy(client: Any) -> None:
    with contextlib.suppress(Exception):
        await client.start_notify(LEGACY_CONTROL, lambda _c, _d: None)
    try:
        await client.write_gatt_char(LEGACY_CONTROL, bytes([OP_START_DFU, IMAGE_APPLICATION]), response=True)
    except Exception:  # noqa: BLE001 - radio rozłącza się, zanim potwierdzi zapis
        return


async def _trigger_secure(client: Any) -> None:
    with contextlib.suppress(Exception):
        await client.start_notify(SECURE_BUTTONLESS, lambda _c, _d: None)
    try:
        await client.write_gatt_char(SECURE_BUTTONLESS, bytes([0x01]), response=True)
    except Exception:  # noqa: BLE001
        return


async def find_dfu_device(mac: str, set_status: Callable[[str, str], None]) -> tuple[Any, str]:
    """Znajdź radio w bootloaderze. Zwraca (urządzenie, rodzaj: ``legacy``/``secure``)."""
    bleak = _import_bleak()
    targets = {mac.upper(), mac_plus_one(mac)}
    await asyncio.sleep(REBOOT_WAIT_S)
    for attempt in range(1, SCAN_ATTEMPTS + 1):
        set_status("connecting", f"Szukam radia w trybie DFU (próba {attempt}/{SCAN_ATTEMPTS})…")
        found: dict[str, str] = {}

        def _match(device, advertisement) -> bool:
            uuids = [u.lower() for u in (advertisement.service_uuids or [])]
            if LEGACY_SERVICE in uuids:
                found["kind"] = "legacy"
                return True
            if SECURE_SERVICE in uuids and device.address.upper() in targets:
                found["kind"] = "secure"
                return True
            return False

        device = await bleak.BleakScanner.find_device_by_filter(_match, timeout=SCAN_TIMEOUT_S)
        if device is not None:
            return device, found.get("kind", "legacy")
    msg = "Nie znalazłem radia w trybie DFU. Zbliż HA do radia i spróbuj ponownie."
    raise DfuError(msg)


class LegacyDfuSession:
    """Jedna sesja wgrywania przez Legacy DFU na już połączonym kliencie bleak."""

    def __init__(
        self,
        client: Any,
        init: bytes,
        firmware: bytes,
        set_status: Callable[[str, str], None],
        set_progress: Callable[[float], None],
        *,
        recovery: bool = False,
    ) -> None:
        self.client = client
        self.init = init
        self.firmware = firmware
        self.set_status = set_status
        self.set_progress = set_progress
        self.prn_interval = PRN_INTERVAL_RECOVERY if recovery else PRN_INTERVAL
        self.queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.sent = 0
        self.last_prn = -1

    def _on_notify(self, _char: Any, data: bytearray) -> None:
        self.queue.put_nowait(bytes(data))

    async def _control(self, payload: bytes) -> None:
        await self.client.write_gatt_char(LEGACY_CONTROL, payload, response=True)

    async def _packet(self, payload: bytes) -> None:
        await self.client.write_gatt_char(LEGACY_PACKET, payload, response=False)

    def _connected(self) -> bool:
        return bool(getattr(self.client, "is_connected", True))

    async def _next(self, timeout: float, *, skip_prn: bool) -> tuple[str, int, int]:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                msg = "Bootloader nie odpowiedział w wymaganym czasie."
                raise DfuError(msg)
            try:
                data = await asyncio.wait_for(self.queue.get(), remaining)
            except asyncio.TimeoutError as err:
                if not self._connected():
                    msg = "Radio rozłączyło się podczas rozmowy z bootloaderem."
                    raise DfuError(msg) from err
                msg = "Bootloader nie odpowiedział w wymaganym czasie."
                raise DfuError(msg) from err
            kind, a, b = parse_response(data)
            if kind == "prn" and skip_prn:
                continue
            return kind, a, b

    async def _expect(self, opcode: int, timeout: float) -> None:
        kind, op, status = await self._next(timeout, skip_prn=True)
        if kind != "resp":
            msg = "Nieoczekiwana odpowiedź bootloadera."
            raise DfuError(msg)
        if status != STATUS_SUCCESS:
            name = STATUS_NAMES.get(status, f"0x{status:02X}")
            if opcode == OP_START_DFU and status == STATUS_INVALID_STATE:
                raise StaleSession
            msg = f"Bootloader odrzucił polecenie 0x{opcode:02X}: {name}."
            raise DfuError(msg)
        if op != opcode:
            msg = f"Odpowiedź na inne polecenie (0x{op:02X} zamiast 0x{opcode:02X})."
            raise DfuError(msg)

    async def run(self) -> None:
        await self.client.start_notify(LEGACY_CONTROL, self._on_notify)
        await asyncio.sleep(SETTLE_S)
        version = -1
        with contextlib.suppress(Exception):
            raw = await self.client.read_gatt_char(LEGACY_VERSION)
            if len(raw) >= 2:  # noqa: PLR2004
                version = raw[0] | (raw[1] << 8)
        if 0 < version < MIN_DFU_VERSION:
            msg = f"Bootloader jest za stary (wersja DFU {version}, potrzeba co najmniej {MIN_DFU_VERSION})."
            raise DfuError(msg)

        size = packet_size(getattr(self.client, "mtu_size", None))
        fw = self.firmware

        self.set_status("erasing", "Bootloader przygotowuje pamięć (kasowanie może potrwać kilkadziesiąt sekund)…")
        await self._control(bytes([OP_START_DFU, IMAGE_APPLICATION]))
        await self._packet(_u32(0) + _u32(0) + _u32(len(fw)))
        await self._expect(OP_START_DFU, START_TIMEOUT_S)

        await self._control(bytes([OP_INIT_DFU_PARAMS, INIT_START]))
        for pos in range(0, len(self.init), MIN_PACKET):
            await self._packet(self.init[pos : pos + MIN_PACKET])
        await self._control(bytes([OP_INIT_DFU_PARAMS, INIT_COMPLETE]))
        await self._expect(OP_INIT_DFU_PARAMS, COMMAND_TIMEOUT_S)

        await self._control(bytes([OP_PRN_REQ, self.prn_interval & 0xFF, (self.prn_interval >> 8) & 0xFF]))
        await self._control(bytes([OP_RECEIVE_FIRMWARE]))

        self.set_status("uploading", "Wysyłam firmware do radia…")
        since_prn = 0
        while self.sent < len(fw):
            end = min(self.sent + size, len(fw))
            chunk = fw[self.sent : end]
            self.sent = end
            try:
                await self._packet(chunk)
            except Exception as err:  # noqa: BLE001
                raise MidStreamDrop(f"Łącze zerwało się przy {self.sent}/{len(fw)} B: {err}") from err
            since_prn += 1
            if since_prn >= self.prn_interval and self.sent < len(fw):
                kind, _a, received = await self._next(COMMAND_TIMEOUT_S, skip_prn=False)
                if kind == "resp":
                    name = STATUS_NAMES.get(received, f"0x{received:02X}")
                    msg = f"Bootloader przerwał wgrywanie: {name}."
                    raise DfuError(msg)
                if kind != "prn" or received != self.sent:
                    msg = f"Niezgodność potwierdzenia: wysłano {self.sent} B, radio ma {received} B."
                    raise DfuError(msg)
                self.last_prn = self.sent
                since_prn = 0
                self.set_progress(self.sent / len(fw))
        await self._expect(OP_RECEIVE_FIRMWARE, VALIDATE_TIMEOUT_S)

        self.set_status("verifying", "Radio sprawdza i zapisuje firmware…")
        self.set_progress(1.0)
        await self._control(bytes([OP_VALIDATE]))
        await self._expect(OP_VALIDATE, VALIDATE_TIMEOUT_S)
        with contextlib.suppress(Exception):
            # Radio restartuje się, zanim potwierdzi zapis — to oczekiwane.
            await self._control(bytes([OP_ACTIVATE_AND_RESET]))

    async def reset(self) -> None:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(self._control(bytes([OP_RESET])), 1.5)


async def flash_legacy(
    device: Any,
    init: bytes,
    firmware: bytes,
    set_status: Callable[[str, str], None],
    set_progress: Callable[[float], None],
) -> None:
    """Wgraj firmware przez Legacy DFU, z ponawianiem całej sesji (Legacy nie umie wznawiać)."""
    bleak = _import_bleak()
    recovery = False
    stale = 0
    attempt = 0
    last_error = "nieznany błąd"
    while attempt < SESSION_ATTEMPTS:
        attempt += 1
        if attempt > 1:
            set_status("connecting", f"Ponawiam całą sesję DFU (próba {attempt}/{SESSION_ATTEMPTS})…")
            await asyncio.sleep(3.0)
        set_progress(0.0)
        session = None
        try:
            async with bleak.BleakClient(device, timeout=CONNECT_TIMEOUT_S) as client:
                session = LegacyDfuSession(client, init, firmware, set_status, set_progress, recovery=recovery)
                try:
                    await session.run()
                except StaleSession:
                    await session.reset()
                    stale += 1
                    if stale > MAX_STALE_RESETS:
                        msg = "Bootloader wciąż trzyma przerwaną sesję. Wyłącz i włącz radio, i spróbuj jeszcze raz."
                        raise DfuError(msg) from None
                    attempt -= 1  # czyszczenie nie zużywa próby wgrywania
                    last_error = "Bootloader trzymał przerwaną sesję."
                    continue
                except MidStreamDrop as err:
                    recovery = True
                    last_error = str(err)
                    continue
                return
        except DfuError:
            raise
        except Exception as err:  # noqa: BLE001
            last_error = str(err)
            if session is not None and session.sent:
                recovery = True
    msg = f"Nie udało się wgrać firmware przez DFU: {last_error}"
    raise DfuError(msg)


async def run_dfu(
    mac: str,
    data: bytes,
    set_status: Callable[[str, str], None],
    set_progress: Callable[[float], None],
) -> None:
    """Cały przebieg: wyzwolenie DFU, znalezienie bootloadera, wgranie."""
    init, firmware = parse_dfu_zip(data)
    await trigger_buttonless(mac, set_status)
    device, kind = await find_dfu_device(mac, set_status)
    if kind == "secure":
        msg = (
            "Radio ma bootloader Secure DFU, którego ta wersja integracji jeszcze nie obsługuje "
            "(radia Meshtastic nRF52 zwykle mają Legacy). Użyj aplikacji na telefon — integracja jest na ten czas odłączona."
        )
        raise DfuError(msg)
    await flash_legacy(device, init, firmware, set_status, set_progress)
