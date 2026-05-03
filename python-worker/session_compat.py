"""
Convert gramjs StringSession to Telethon StringSession.

gramjs web sessions use variable-length server hostnames (e.g. "pluto.web.telegram.org"),
while Telethon sessions use 4-byte packed IPv4 addresses. The binary formats differ,
so a simple prefix strip is not enough — we must unpack and repack.

Reference: https://gist.github.com/divyam234/127aae273a424f1e41c77eeae99503bf
"""

from __future__ import annotations

import base64
import ipaddress
import struct

from telethon.sessions import StringSession

# DC ID → IPv4 address mapping (production Telegram DCs)
DC_IP_MAP: dict[int, str] = {
    1: "149.154.175.53",
    2: "149.154.167.51",
    3: "149.154.175.100",
    4: "149.154.167.91",
    5: "91.108.56.130",
}


def _base64_decoded_length(s: str) -> int:
    """Calculate the decoded byte length of a base64url string."""
    padding = s.count("=") + s.count("\n") + s.count("\r")
    return int((3 * (len(s) / 4)) - padding)


def _unpack_gramjs_web(session_b64: str) -> tuple[int, bytes]:
    """
    Unpack a gramjs WEB StringSession (variable-length server hostname).
    Returns (dc_id, auth_key).
    """
    raw = base64.urlsafe_b64decode(session_b64 + "=" * (-len(session_b64) % 4))
    # Format: >BH{server_len}sH256s
    # The server_length field is at offset 1 (2 bytes, big-endian unsigned short)
    server_length = struct.unpack_from(">H", raw, 1)[0]
    fmt = ">BH{}sH256s".format(server_length)
    dc_id, _server_len, _server_addr, _port, auth_key = struct.unpack(fmt, raw)
    return dc_id, auth_key


def _unpack_gramjs_nonweb(session_b64: str) -> tuple[int, bytes]:
    """
    Unpack a gramjs non-web StringSession (same binary format as Telethon).
    Returns (dc_id, auth_key).
    """
    raw = base64.urlsafe_b64decode(session_b64 + "=" * (-len(session_b64) % 4))
    # IPv4 = 4 bytes, IPv6 = 16 bytes
    server_length = 4 if len(raw) == 263 else 16
    fmt = ">B{}sH256s".format(server_length)
    dc_id, _ip_bytes, _port, auth_key = struct.unpack(fmt, raw)
    return dc_id, auth_key


def _pack_telethon_session(dc_id: int, auth_key: bytes) -> str:
    """
    Pack dc_id + auth_key into Telethon StringSession format.
    Returns the full string including the "1" prefix.
    """
    ip_bytes = ipaddress.ip_address(DC_IP_MAP[dc_id]).packed  # 4 bytes
    packed = struct.pack(">B4sH256s", dc_id, ip_bytes, 443, auth_key)
    return "1" + base64.urlsafe_b64encode(packed).decode("ascii")


def gramjs_to_telethon_session(gramjs_session: str) -> StringSession:
    """
    Convert a gramjs StringSession to a Telethon StringSession.

    Handles both web sessions (variable-length hostname) and
    non-web sessions (4/16-byte IP address).
    """
    if not gramjs_session or not gramjs_session.startswith("1"):
        # Try as-is (might already be Telethon format)
        return StringSession(gramjs_session)

    payload = gramjs_session[1:]  # strip version prefix "1"

    # Determine if this is a web session or non-web session
    # by checking the decoded byte length.
    # Non-web IPv4: 1 + 4 + 2 + 256 = 263 bytes → base64 = 352 chars
    # Non-web IPv6: 1 + 16 + 2 + 256 = 275 bytes → base64 = 368 chars
    decoded_len = _base64_decoded_length(payload)

    if decoded_len in (263, 275):
        # Non-web session — same format as Telethon, just pass through
        return StringSession(payload)

    # Web session — needs conversion
    dc_id, auth_key = _unpack_gramjs_web(payload)
    telethon_str = _pack_telethon_session(dc_id, auth_key)
    # telethon_str already has "1" prefix, StringSession expects without it
    return StringSession(telethon_str[1:])
