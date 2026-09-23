# SPDX-FileCopyrightText: 2026 MT_SW
#
# SPDX-License-Identifier: MIT

"""Odszyfrowywanie pakietów Meshtastic z kanału (PSK -> AES-CTR).

Format jest ten sam co w firmware i we wszystkich klientach (meshtastic-python,
meshtastic-web, appce itd.) — nieudokumentowany w tym repozytorium, bo do tej
pory integracja nie musiała nic sama odszyfrowywać: radio po drugiej stronie
połączenia (serial/BLE/TCP) już oddaje pakiety odkodowane. Sniffer MQTT
odbiera surowe ramki wprost z brokera, więc potrzebuje tego samego algorytmu,
co reszta ekosystemu:

1. PSK z ustawień kanału (`channel.settings.psk`, base64) rozwijamy do
   klucza AES (`expand_psk`) — 1-bajtowy PSK to jeden z 10 wariantów
   domyślnego klucza, 16/32-bajtowy PSK to gotowy klucz AES-128/256.
2. Nonce (16 B) to numer pakietu (8 B LE) + numer węzła nadawcy (4 B LE) +
   4 zerowe bajty — te same dane, które są jawne w każdym ServiceEnvelope.
3. AES-256/128-CTR z tym kluczem i nonce'em jako początkowym licznikiem.

Błędny PSK albo uszkodzona ramka dają po prostu śmieci zamiast wyjątku (CTR
nie ma integralności) — dlatego wywołujący (mqtt_sniffer.py) nie ufa
odszyfrowanemu payloadowi, dopóki nie sparsuje się jako poprawny Data/MeshPacket.
"""

from __future__ import annotations

import struct

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

# Domyślny klucz kanału "LongFast" / preset "Default" — stały w całym ekosystemie
# Meshtastic od 2022 r. (firmware `Crypto.cpp`, meshtastic-python `crypto.py`).
_DEFAULT_PSK = bytes(
    [
        0xD4,
        0xF1,
        0xBB,
        0x3A,
        0x20,
        0x29,
        0x07,
        0x59,
        0xF0,
        0xBC,
        0xFF,
        0xAB,
        0xCF,
        0x4E,
        0x69,
        0x01,
    ]
)


def expand_psk(psk: bytes) -> bytes | None:
    """Zamień surowy PSK kanału na klucz AES.

    Zwraca None, gdy kanał jest jawnie nieszyfrowany (pusty PSK) — takiego
    kanału sniffer MQTT nie próbuje odszyfrowywać, tylko czyta wprost.
    """
    if len(psk) == 0:
        return None
    if len(psk) == 1:
        index = psk[0]
        if index == 0:
            return None
        if index == 1:
            return _DEFAULT_PSK
        # warianty 2..10: domyślny klucz z ostatnim bajtem = (index - 1)
        return _DEFAULT_PSK[:-1] + bytes([index - 1])
    if len(psk) in (16, 32):
        return psk
    # Długość spoza specyfikacji (klucz uszkodzony/nieprawidłowy w configu) —
    # nie ma sensu próbować, wywołujący zgłosi pakiet jako nieodczytany.
    return None


def build_nonce(packet_id: int, from_node: int) -> bytes:
    """16-bajtowy nonce AES-CTR: packet_id (8B LE) + from_node (4B LE) + 4 zera."""
    return struct.pack("<QI4x", packet_id & 0xFFFFFFFFFFFFFFFF, from_node & 0xFFFFFFFF)


def decrypt_payload(encrypted: bytes, psk: bytes, packet_id: int, from_node: int) -> bytes:
    """Odszyfruj `packet.encrypted` (AES-CTR) do surowego Data-protobuf.

    Nie waliduje wyniku — payload trzeba sparsować (mesh_pb2.Data) i sprawdzić,
    że się udało, zanim się mu zaufa.
    """
    key = expand_psk(psk)
    if key is None:
        msg = "PSK does not expand to a usable AES key"
        raise ValueError(msg)
    nonce = build_nonce(packet_id, from_node)
    algorithm = algorithms.AES(key)
    cipher = Cipher(algorithm, modes.CTR(nonce))
    decryptor = cipher.decryptor()
    return decryptor.update(encrypted) + decryptor.finalize()
