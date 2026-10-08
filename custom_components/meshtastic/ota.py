# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Aktualizacja firmware przez Wi-Fi (OTA) z poziomu integracji oraz czasowe odłączenie od radia.

Odpowiednik ekranu „Aktualizacja firmware” z aplikacji na Androida, dla radia z ESP32:

1. prosimy radio o restart do bootloadera OTA przez Wi-Fi (polecenie ``ota_request`` z sumą SHA-256 pliku),
2. radio wstaje w bootloaderze, dołącza do sieci Wi-Fi i rozgłasza się UDP (port 3232),
3. łączymy się z nim po TCP (port 3232), wysyłamy ``OTA <rozmiar> <sha256>`` i plik kawałkami po 1024 B,
4. radio sprawdza sumę i restartuje się z nowym firmware.

Integracja na czas aktualizacji odłącza się od radia, a po wszystkim wraca sama. Ta sama możliwość odłączenia
jest dostępna osobno („Odłącz na X minut”), żeby np. zrobić OTA aplikacją, nie wyłączając integracji.

Dla radia nRF52 jest osobna ścieżka: Bluetooth DFU (moduł ``dfu.py``), z paczką DFU ``.zip``.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import re
import socket
import time
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

import aiohttp
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import dfu
from .const import CONF_CONNECTION_BLUETOOTH_ADDRESS, CONF_CONNECTION_TCP_HOST, CONF_CONNECTION_TYPE, DOMAIN, LOGGER

if TYPE_CHECKING:
    from aiohttp import web
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant

_LOGGER = LOGGER.getChild("ota")

WS_PREFIX = "meshtastic"
OTA_DIR_NAME = "meshtastic_ota"
UPLOAD_URL_PATH = "/api/meshtastic/ota_upload"
OTA_PORT = 3232
CHUNK_SIZE = 1024
WRITE_DELAY_S = 0.01
MAX_FIRMWARE_BYTES = 8 * 1024 * 1024
MIN_FIRMWARE_BYTES = 100 * 1024
REBOOT_MODE_BLE = 1  # AdminMessage.OTAMode.OTA_BLE
REBOOT_MODE_WIFI = 2  # AdminMessage.OTAMode.OTA_WIFI
PREFLIGHT_TIMEOUT_S = 5.0
DISCOVERY_TIMEOUT_S = 40.0
READINESS_DELAY_S = 8.0
CONNECT_ATTEMPTS = 10
CONNECT_TIMEOUT_S = 5.0
ERASE_TIMEOUT_S = 60.0
COMMAND_TIMEOUT_S = 10.0
VERIFY_TIMEOUT_S = 30.0
PAUSE_FOR_OTA_S = 15 * 60
BLE_OTA_SERVICE = "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
BLE_OTA_WRITE = "62ec0272-3ec5-11eb-b378-0242ac130005"
BLE_OTA_NOTIFY = "62ec0272-3ec5-11eb-b378-0242ac130003"
BLE_REBOOT_DELAY_S = 5.0
BLE_SCAN_ATTEMPTS = 4
BLE_SCAN_TIMEOUT_S = 10.0
BLE_CONNECT_TIMEOUT_S = 15.0
BLE_ACK_TIMEOUT_S = 10.0
BLE_CHUNK_SIZE = 512
_MAC = re.compile(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")
MAX_PAUSE_MINUTES = 60
_BEACON = re.compile(r"^Meshtastic_[0-9A-Fa-f]{4}\s+\S{1,32}$")
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")

STATES_RUNNING = ("preparing", "waiting", "connecting", "erasing", "uploading", "verifying")


class OtaError(Exception):
    """Błąd aktualizacji z komunikatem po polsku, gotowym do pokazania w panelu."""


def _ota_dir(hass: HomeAssistant) -> Path:
    path = Path(hass.config.path(OTA_DIR_NAME))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_name(name: str) -> str:
    cleaned = _SAFE_NAME.sub("_", Path(name or "firmware.bin").name).strip("._") or "firmware.bin"
    if not cleaned.lower().endswith((".bin", ".zip")):
        cleaned += ".bin"
    return cleaned[:120]


def validate_firmware(name: str, data: bytes) -> None:
    """Sprawdź plik: paczka DFU (.zip, nRF52) albo aplikacja ESP32 (``firmware-….bin``), nie obraz fabryczny."""
    if name.lower().endswith(".zip") or dfu.is_dfu_zip(data):
        try:
            dfu.validate_dfu_zip(name, data)
        except dfu.DfuError as err:
            raise OtaError(str(err)) from err
        return
    if "factory" in name.lower():
        msg = "To plik „factory” (pełny obraz do wgrania kablem). Do OTA potrzebny jest zwykły plik firmware-….bin."
        raise OtaError(msg)
    if len(data) < MIN_FIRMWARE_BYTES:
        msg = "Plik jest za mały na firmware ESP32."
        raise OtaError(msg)
    if len(data) > MAX_FIRMWARE_BYTES:
        msg = "Plik jest za duży na firmware ESP32."
        raise OtaError(msg)
    if data[0] != 0xE9:
        msg = "To nie wygląda na obraz firmware ESP32 (zły nagłówek)."
        raise OtaError(msg)


class OtaJob:
    """Stan jednej aktualizacji, do odczytu przez panel."""

    def __init__(self) -> None:
        self.state = "idle"  # idle | preparing | waiting | connecting | erasing | uploading | verifying | done | error
        self.progress = 0.0
        self.message = ""
        self.error: str | None = None
        self.file: str | None = None
        self.address: str | None = None
        self.started_at: float | None = None
        self.finished_at: float | None = None
        self.task: asyncio.Task | None = None

    @property
    def running(self) -> bool:
        return self.state in STATES_RUNNING

    def set(self, state: str, message: str = "", progress: float | None = None) -> None:
        self.state = state
        self.message = message
        if progress is not None:
            self.progress = progress

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "running": self.running,
            "progress": round(self.progress, 3),
            "message": self.message,
            "error": self.error,
            "file": self.file,
            "address": self.address,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


def _jobs(hass: HomeAssistant) -> dict[str, OtaJob]:
    return hass.data.setdefault(DOMAIN, {}).setdefault("ota_jobs", {})


def _job(hass: HomeAssistant, entry_id: str) -> OtaJob:
    return _jobs(hass).setdefault(entry_id, OtaJob())


async def _discover(timeout: float) -> str | None:
    """Poczekaj na rozgłoszenie UDP bootloadera OTA (``Meshtastic_xxxx <wersja>``) i zwróć adres nadawcy."""
    loop = asyncio.get_running_loop()
    found: asyncio.Future[str] = loop.create_future()

    class _Protocol(asyncio.DatagramProtocol):
        def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
            if not found.done() and _BEACON.match(data.decode(errors="ignore").strip()):
                found.set_result(addr[0])

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.setblocking(False)
        sock.bind(("0.0.0.0", OTA_PORT))  # noqa: S104 - rozgłoszenie przychodzi na wszystkie interfejsy
    except OSError as err:
        sock.close()
        _LOGGER.info("Nasłuch rozgłoszenia OTA niemożliwy: %s", err)
        return None
    transport, _ = await loop.create_datagram_endpoint(_Protocol, sock=sock)
    try:
        return await asyncio.wait_for(found, timeout)
    except TimeoutError:
        return None
    finally:
        transport.close()


async def _readline(reader: asyncio.StreamReader, timeout: float) -> str:
    try:
        raw = await asyncio.wait_for(reader.readline(), timeout)
    except TimeoutError as err:
        msg = f"Radio nie odpowiedziało w ciągu {timeout:.0f} s."
        raise OtaError(msg) from err
    if not raw:
        msg = "Radio zamknęło połączenie."
        raise OtaError(msg)
    return raw.decode(errors="ignore").strip()


async def _open(address: str, attempts: int, job: OtaJob) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        job.set("connecting", f"Łączę z radiem {address} (próba {attempt}/{attempts})…")
        try:
            return await asyncio.wait_for(asyncio.open_connection(address, OTA_PORT), CONNECT_TIMEOUT_S)
        except (OSError, TimeoutError) as err:
            last = err
            await asyncio.sleep(2)
    msg = f"Nie udało się połączyć z radiem {address}:{OTA_PORT} — czy radio weszło w tryb OTA i jest w tej samej sieci? ({last})"
    raise OtaError(msg)


async def _upload(address: str, data: bytes, digest: str, job: OtaJob) -> None:
    reader, writer = await _open(address, CONNECT_ATTEMPTS, job)
    try:
        writer.write(f"OTA {len(data)} {digest}\n".encode())
        await writer.drain()
        job.set("erasing", "Radio przygotowuje pamięć…")
        while True:
            response = await _readline(reader, ERASE_TIMEOUT_S)
            if response.startswith("OK"):
                break
            if response == "ERASING":
                job.set("erasing", "Radio kasuje pamięć na nowe firmware…")
                continue
            if response.startswith("ERR"):
                if "hash rejected" in response.lower():
                    msg = "Radio odrzuciło sumę kontrolną pliku (to inny plik niż ten, o który prosiliśmy)."
                    raise OtaError(msg)
                msg = f"Radio odrzuciło aktualizację: {response[4:] or 'nieznany błąd'}"
                raise OtaError(msg)

        sent = 0
        total = len(data)
        job.set("uploading", "Wysyłam firmware…", 0.0)
        while sent < total:
            chunk = data[sent : sent + CHUNK_SIZE]
            writer.write(chunk)
            await writer.drain()
            sent += len(chunk)
            job.progress = sent / total
            job.message = f"Wysyłam firmware… {int(job.progress * 100)}%"
            await asyncio.sleep(WRITE_DELAY_S)

        job.set("verifying", "Radio sprawdza i zapisuje firmware…", 1.0)
        while True:
            response = await _readline(reader, VERIFY_TIMEOUT_S)
            if response.startswith("OK"):
                return
            if response == "ACK":
                continue
            if response.startswith("ERR"):
                if "hash mismatch" in response.lower():
                    msg = "Po wysłaniu suma kontrolna się nie zgadza — plik dotarł uszkodzony. Spróbuj ponownie."
                    raise OtaError(msg)
                msg = f"Weryfikacja nie powiodła się: {response[4:] or 'nieznany błąd'}"
                raise OtaError(msg)
    finally:
        writer.close()
        with contextlib.suppress(Exception):
            await writer.wait_closed()


def _mac_plus_one(mac: str) -> str:
    """W trybie OTA radio ma adres BLE o jeden większy (ostatni bajt) — tak jak w aplikacji."""
    parts = mac.upper().split(":")
    if len(parts) != 6:  # noqa: PLR2004
        return mac.upper()
    parts[-1] = f"{(int(parts[-1], 16) + 1) & 0xFF:02X}"
    return ":".join(parts)


async def _upload_ble(mac: str, data: bytes, digest: str, job: OtaJob) -> None:
    """OTA przez Bluetooth (ESP32): to samo „OTA <rozmiar> <sha256>”, ale kawałki są potwierdzane (ACK) po kolei."""
    try:
        from bleak import BleakClient, BleakScanner  # noqa: PLC0415
    except ImportError as err:
        msg = "Ta instalacja Home Assistanta nie ma obsługi Bluetooth (biblioteka bleak)."
        raise OtaError(msg) from err

    targets = {mac.upper(), _mac_plus_one(mac)}
    job.set("waiting", "Czekam, aż radio wstanie w trybie OTA przez Bluetooth…")
    await asyncio.sleep(BLE_REBOOT_DELAY_S)

    device = None
    for attempt in range(1, BLE_SCAN_ATTEMPTS + 1):
        job.set("connecting", f"Szukam radia w trybie OTA (próba {attempt}/{BLE_SCAN_ATTEMPTS})…")

        def _match(found, advertisement) -> bool:
            uuids = [u.lower() for u in (advertisement.service_uuids or [])]
            return found.address.upper() in targets or BLE_OTA_SERVICE in uuids

        device = await BleakScanner.find_device_by_filter(_match, timeout=BLE_SCAN_TIMEOUT_S)
        if device is not None:
            break
    if device is None:
        msg = "Nie znalazłem radia w trybie OTA przez Bluetooth. Czy jest w zasięgu Bluetooth serwera Home Assistanta?"
        raise OtaError(msg)

    responses: asyncio.Queue[str] = asyncio.Queue()

    def _on_notify(_sender: Any, payload: bytearray) -> None:
        responses.put_nowait(bytes(payload).decode(errors="ignore").strip())

    async def _next(timeout: float) -> str:
        try:
            return await asyncio.wait_for(responses.get(), timeout)
        except TimeoutError as err:
            msg = f"Radio nie odpowiedziało w ciągu {timeout:.0f} s."
            raise OtaError(msg) from err

    job.set("connecting", "Łączę z radiem przez Bluetooth…")
    try:
        async with BleakClient(device, timeout=BLE_CONNECT_TIMEOUT_S) as client:
            await client.start_notify(BLE_OTA_NOTIFY, _on_notify)
            await asyncio.sleep(0.5)
            payload = max(20, min(BLE_CHUNK_SIZE, int(getattr(client, "mtu_size", 23)) - 3))

            command = f"OTA {len(data)} {digest}\n".encode()
            for offset in range(0, len(command), payload):
                await client.write_gatt_char(BLE_OTA_WRITE, command[offset : offset + payload], response=True)
            job.set("erasing", "Radio przygotowuje pamięć…")
            while True:
                response = await _next(ERASE_TIMEOUT_S)
                if response.startswith("OK"):
                    break
                if response == "ERASING":
                    job.set("erasing", "Radio kasuje pamięć na nowe firmware…")
                    continue
                if response.startswith("ERR"):
                    if "hash rejected" in response.lower():
                        msg = "Radio odrzuciło sumę kontrolną pliku (to inny plik niż ten, o który prosiliśmy)."
                        raise OtaError(msg)
                    msg = f"Radio odrzuciło aktualizację: {response[4:] or 'nieznany błąd'}"
                    raise OtaError(msg)

            total = len(data)
            sent = 0
            job.set("uploading", "Wysyłam firmware…", 0.0)
            while sent < total:
                chunk = data[sent : sent + payload]
                await client.write_gatt_char(BLE_OTA_WRITE, chunk, response=False)
                sent += len(chunk)
                response = await _next(BLE_ACK_TIMEOUT_S)
                last = sent >= total
                if response == "ACK":
                    pass
                elif response.startswith("OK") and last:
                    job.progress = 1.0
                    return
                elif response.startswith("ERR"):
                    if "hash mismatch" in response.lower():
                        msg = "Po wysłaniu suma kontrolna się nie zgadza — plik dotarł uszkodzony. Spróbuj ponownie."
                        raise OtaError(msg)
                    msg = f"Transfer nie powiódł się: {response[4:] or 'nieznany błąd'}"
                    raise OtaError(msg)
                else:
                    msg = f"Nieoczekiwana odpowiedź radia podczas wysyłania: {response}"
                    raise OtaError(msg)
                job.progress = sent / total
                job.message = f"Wysyłam firmware… {int(job.progress * 100)}%"

            job.set("verifying", "Radio sprawdza i zapisuje firmware…", 1.0)
            while True:
                response = await _next(VERIFY_TIMEOUT_S)
                if response.startswith("OK"):
                    return
                if response == "ACK":
                    continue
                msg = f"Weryfikacja nie powiodła się: {response}"
                raise OtaError(msg)
    except OtaError:
        raise
    except Exception as err:  # noqa: BLE001 - błędy bleak mają różne typy; użytkownik dostaje jeden czytelny komunikat
        msg = f"Błąd Bluetooth podczas aktualizacji: {err}"
        raise OtaError(msg) from err


async def _run(  # noqa: PLR0913
    hass: HomeAssistant, entry: ConfigEntry, job: OtaJob, data: bytes, address_hint: str | None, mode: str
) -> None:
    interface = entry.runtime_data.client.interface
    digest_bytes = hashlib.sha256(data).digest()
    digest = digest_bytes.hex()
    try:
        mac = address_hint or entry.data.get(CONF_CONNECTION_BLUETOOTH_ADDRESS)
        if mode == "dfu":
            # nRF52: bez polecenia administracyjnego — bootloader DFU włączamy przez Bluetooth, jak aplikacja.
            if not mac or not _MAC.match(str(mac)):
                msg = "Do aktualizacji nRF52 podaj adres BLE radia (AA:BB:CC:DD:EE:FF)."
                raise OtaError(msg)
            job.address = str(mac)
            job.set("preparing", "Odłączam integrację od radia na czas aktualizacji…", 0.0)
            await interface.pause_link(PAUSE_FOR_OTA_S)
            await asyncio.sleep(2.0)  # daj BlueZ zwolnić połączenie
            try:
                await dfu.run_dfu(str(mac), data, job.set, lambda p: setattr(job, "progress", p))
            except dfu.DfuError as err:
                raise OtaError(str(err)) from err
            job.set("done", "Gotowe. Radio uruchamia się z nowym firmware — integracja połączy się z nim sama.", 1.0)
            return
        if mode == "ble" and (not mac or not _MAC.match(str(mac))):
            # Sprawdzamy przed restartem radia — po nim nie ma już odwrotu do zwykłej pracy bez ponownego uruchomienia.
            msg = "Do OTA przez Bluetooth podaj adres BLE radia (AA:BB:CC:DD:EE:FF)."
            raise OtaError(msg)
        job.set("preparing", "Proszę radio o restart do trybu OTA…", 0.0)
        await interface.request_reboot_ota(REBOOT_MODE_BLE if mode == "ble" else REBOOT_MODE_WIFI, digest_bytes)

        # Radio potwierdza „Rebooting to WiFi OTA” albo odrzuca („OTA Loader does not support …”) — jak w aplikacji.
        deadline = time.monotonic() + PREFLIGHT_TIMEOUT_S
        while time.monotonic() < deadline:
            note = interface.last_client_notification()
            if note:
                if note.startswith("Rebooting to"):
                    break
                msg = f"Radio odmówiło wejścia w tryb OTA: {note}"
                raise OtaError(msg)
            await asyncio.sleep(0.25)

        # Od tej chwili radio się restartuje — integracja nie może go zagadywać ani łączyć się ponownie.
        await interface.pause_link(PAUSE_FOR_OTA_S)

        if mode == "ble":
            job.address = str(mac)
            await _upload_ble(str(mac), data, digest, job)
        else:
            host = entry.data.get(CONF_CONNECTION_TCP_HOST) if entry.data.get(CONF_CONNECTION_TYPE) == "tcp" else None
            address = address_hint or None
            if address is None:
                job.set("waiting", "Czekam, aż radio wstanie w trybie OTA i się ogłosi w sieci…")
                address = await _discover(DISCOVERY_TIMEOUT_S)
                if address is None:
                    address = host
                    await asyncio.sleep(READINESS_DELAY_S)
            else:
                job.set("waiting", "Czekam, aż radio wstanie w trybie OTA…")
                await asyncio.sleep(READINESS_DELAY_S)
            if not address:
                msg = "Nie znalazłem radia w trybie OTA. Podaj jego adres IP ręcznie i spróbuj ponownie."
                raise OtaError(msg)
            job.address = address
            await _upload(address, data, digest, job)
        job.set("done", "Gotowe. Radio uruchamia się z nowym firmware — integracja połączy się z nim sama.", 1.0)
    except OtaError as err:
        job.error = str(err)
        job.set("error", str(err))
        _LOGGER.warning("Aktualizacja OTA nie powiodła się: %s", err)
    except asyncio.CancelledError:
        job.error = "Przerwano."
        job.set("error", "Przerwano.")
        raise
    except Exception as err:  # noqa: BLE001 - nieoczekiwany błąd ma trafić do panelu, nie zawiesić zadania
        job.error = f"Nieoczekiwany błąd: {err}"
        job.set("error", job.error)
        _LOGGER.exception("Aktualizacja OTA zakończona nieoczekiwanym błędem")
    finally:
        job.finished_at = time.time()
        with contextlib.suppress(Exception):
            await interface.resume_link()


def _entry(hass: HomeAssistant, entry_id: str) -> ConfigEntry | None:
    from .websocket_api import _entry_by_id  # noqa: PLC0415 - unikamy cyklu importów

    return _entry_by_id(hass, entry_id)


def _list_files(hass: HomeAssistant) -> list[dict[str, Any]]:
    out = []
    for path in sorted([*_ota_dir(hass).glob("*.bin"), *_ota_dir(hass).glob("*.zip")]):
        stat = path.stat()
        out.append({"name": path.name, "size": stat.st_size, "modified": stat.st_mtime})
    return out


def _status(hass: HomeAssistant, entry: ConfigEntry, files: list[dict[str, Any]]) -> dict[str, Any]:
    interface = entry.runtime_data.client.interface
    return {
        "job": _job(hass, entry.entry_id).as_dict(),
        "link": {
            "up": interface.link_up,
            "paused": interface.link_paused,
            "remaining": round(interface.link_pause_remaining()),
        },
        "files": files,
        "connection_type": entry.data.get(CONF_CONNECTION_TYPE),
        "host": entry.data.get(CONF_CONNECTION_TCP_HOST),
    }


def _not_found(connection, msg) -> None:
    connection.send_error(msg["id"], "not_found", "Nie znaleziono załadowanego wpisu konfiguracyjnego")


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/ota_status", vol.Required("entry_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ota_status(hass, connection, msg) -> None:
    entry = _entry(hass, msg["entry_id"])
    if entry is None:
        _not_found(connection, msg)
        return
    files = await hass.async_add_executor_job(_list_files, hass)
    connection.send_result(msg["id"], _status(hass, entry, files))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/ota_start",
        vol.Required("entry_id"): str,
        vol.Required("file"): str,
        vol.Optional("address", default=""): vol.All(str, vol.Length(max=64)),
        vol.Optional("mode", default="wifi"): vol.In(["wifi", "ble", "dfu"]),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ota_start(hass, connection, msg) -> None:
    entry = _entry(hass, msg["entry_id"])
    if entry is None:
        _not_found(connection, msg)
        return
    job = _job(hass, entry.entry_id)
    if job.running:
        connection.send_error(msg["id"], "busy", "Aktualizacja już trwa.")
        return
    name = _safe_name(msg["file"])
    path = _ota_dir(hass) / name
    try:
        data = await hass.async_add_executor_job(path.read_bytes)
        validate_firmware(name, data)
    except FileNotFoundError:
        connection.send_error(msg["id"], "no_file", "Nie ma takiego pliku — wyślij go najpierw.")
        return
    except OtaError as err:
        connection.send_error(msg["id"], "bad_file", str(err))
        return
    is_zip = dfu.is_dfu_zip(data)
    if msg["mode"] == "dfu" and not is_zip:
        connection.send_error(msg["id"], "bad_file", "Do nRF52 potrzebna jest paczka DFU (.zip).")
        return
    mode = "dfu" if is_zip else msg["mode"]
    if not entry.runtime_data.client.interface.link_up:
        connection.send_error(msg["id"], "not_connected", "Integracja nie jest teraz połączona z radiem.")
        return

    address = msg["address"].strip()
    if address and not re.fullmatch(r"[0-9A-Za-z.\-:]+", address):
        connection.send_error(msg["id"], "bad_address", "Nieprawidłowy adres radia.")
        return

    job = _jobs(hass)[entry.entry_id] = OtaJob()  # świeży stan
    job.file = name
    job.started_at = time.time()
    job.task = hass.async_create_background_task(_run(hass, entry, job, data, address or None, mode), "meshtastic_ota")
    connection.send_result(msg["id"], {"started": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/ota_fetch",
        vol.Required("entry_id"): str,
        vol.Required("url"): vol.All(str, vol.Length(max=500)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ota_fetch(hass, connection, msg) -> None:
    """Pobierz plik firmware z adresu (np. z wydania na GitHubie) na serwer HA."""
    parsed = urlparse(msg["url"])
    if parsed.scheme != "https" or not parsed.netloc:
        connection.send_error(msg["id"], "bad_url", "Podaj adres zaczynający się od https://")
        return
    name = _safe_name(Path(parsed.path).name)
    try:
        async with async_get_clientsession(hass).get(msg["url"], timeout=aiohttp.ClientTimeout(total=120)) as response:
            if response.status != HTTPStatus.OK:
                connection.send_error(msg["id"], "download_failed", f"Serwer odpowiedział kodem {response.status}.")
                return
            data = await response.content.read(MAX_FIRMWARE_BYTES + 1)
    except (aiohttp.ClientError, TimeoutError) as err:
        connection.send_error(msg["id"], "download_failed", f"Nie udało się pobrać pliku: {err}")
        return
    try:
        validate_firmware(name, data)
    except OtaError as err:
        connection.send_error(msg["id"], "bad_file", str(err))
        return
    await hass.async_add_executor_job((_ota_dir(hass) / name).write_bytes, data)
    connection.send_result(msg["id"], {"name": name, "size": len(data)})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{WS_PREFIX}/ota_delete", vol.Required("entry_id"): str, vol.Required("file"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ota_delete(hass, connection, msg) -> None:
    path = _ota_dir(hass) / _safe_name(msg["file"])
    with contextlib.suppress(FileNotFoundError):
        await hass.async_add_executor_job(path.unlink)
    connection.send_result(msg["id"], {"deleted": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{WS_PREFIX}/link_pause",
        vol.Required("entry_id"): str,
        vol.Required("minutes"): vol.All(int, vol.Range(min=1, max=MAX_PAUSE_MINUTES)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_link_pause(hass, connection, msg) -> None:
    entry = _entry(hass, msg["entry_id"])
    if entry is None:
        _not_found(connection, msg)
        return
    if _job(hass, entry.entry_id).running:
        connection.send_error(msg["id"], "busy", "Trwa aktualizacja OTA — odłączenie jest już pod jej kontrolą.")
        return
    interface = entry.runtime_data.client.interface
    await interface.pause_link(msg["minutes"] * 60)
    connection.send_result(msg["id"], {"paused": True, "remaining": round(interface.link_pause_remaining())})


@websocket_api.websocket_command({vol.Required("type"): f"{WS_PREFIX}/link_resume", vol.Required("entry_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_link_resume(hass, connection, msg) -> None:
    entry = _entry(hass, msg["entry_id"])
    if entry is None:
        _not_found(connection, msg)
        return
    await entry.runtime_data.client.interface.resume_link()
    connection.send_result(msg["id"], {"paused": False})


class OtaUploadView(HomeAssistantView):
    """POST /api/meshtastic/ota_upload?name=firmware.bin (surowe bajty pliku w treści) -> {"name", "size"}."""

    url = UPLOAD_URL_PATH
    name = "api:meshtastic:ota_upload"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        user = request.get("hass_user")
        if user is None or not user.is_admin:
            return self.json_message("Wymagane uprawnienia administratora", HTTPStatus.FORBIDDEN, "forbidden")
        name = _safe_name(request.query.get("name", "firmware.bin"))
        data = await request.read()
        try:
            validate_firmware(name, data)
        except OtaError as err:
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST, "bad_file")
        hass: HomeAssistant = request.app["hass"]
        await hass.async_add_executor_job((_ota_dir(hass) / name).write_bytes, data)
        return self.json({"name": name, "size": len(data)})


def async_register_ota(hass: HomeAssistant) -> None:
    """Zarejestruj komendy i widok OTA. Błąd rejestracji nie może zatrzymać panelu."""
    try:
        for handler in (ws_ota_status, ws_ota_start, ws_ota_fetch, ws_ota_delete, ws_link_pause, ws_link_resume):
            websocket_api.async_register_command(hass, handler)
        hass.http.register_view(OtaUploadView())
    except Exception:  # noqa: BLE001
        _LOGGER.debug("OTA commands could not be registered", exc_info=True)
