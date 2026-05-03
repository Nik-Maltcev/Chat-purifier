"""
Convert gramjs StringSession to Telethon StringSession.

gramjs web sessions use variable-length server hostnames,
while Telethon sessions use 4-byte packed IPv4 addresses.

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


def _b64decode(s: str) -> bytes:
    """Decode base64url with auto-padding."""
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _try_unpack_web(raw: bytes) -> tuple[int, bytes] | None:
    """Try to unpack as gramjs WEB session. Returns (dc_id, auth_key) or None."""
    try:
        if len(raw) < 5:
            return None
        dc_id = struct.unpack_from(">B", raw, 0)[0]
        if dc_id not in DC_IP_MAP:
            return None
        server_length = struct.unpack_from(">H", raw, 1)[0]
        expected = 1 + 2 + server_length + 2 + 256  # B + H + server + H + auth_key
        if len(raw) != expected:
            return None
        fmt = ">BH{}sH256s".format(server_length)
        dc_id, _slen, _saddr, _port, auth_key = struct.unpack(fmt, raw)
        return dc_id, auth_key
    except (struct.error, ValueError):
        return None


def _try_unpack_nonweb(raw: bytes) -> tuple[int, bytes] | None:
    """Try to unpack as gramjs non-web / Telethon session. Returns (dc_id, auth_key) or None."""
    try:
        # IPv4: 1+4+2+256 = 263, IPv6: 1+16+2+256 = 275
        if len(raw) == 263:
            ip_len = 4
        elif len(raw) == 275:
            ip_len = 16
        else:
            return None
        fmt = ">B{}sH256s".format(ip_len)
        dc_id, _ip, _port, auth_key = struct.unpack(fmt, raw)
        if dc_id not in DC_IP_MAP:
            return None
        return dc_id, auth_key
    except (struct.error, ValueError):
        return None


def _pack_telethon(dc_id: int, auth_key: bytes) -> str:
    """
    Pack into Telethon StringSession format.
    Returns the FULL string including "1" prefix and base64 WITH padding.
    Telethon expects: "1" + base64url_with_padding(pack(">B4sH256s", ...))
    """
    ip_bytes = ipaddress.ip_address(DC_IP_MAP[dc_id]).packed
    packed = struct.pack(">B4sH256s", dc_id, ip_bytes, 443, auth_key)
    return "1" + base64.urlsafe_b64encode(packed).decode("ascii")


def gramjs_to_telethon_session(gramjs_session: str) -> StringSession:
    """
    Convert a gramjs StringSession to a Telethon StringSession.
    Handles web sessions, non-web sessions, and already-Telethon sessions.
    """
    if not gramjs_session:
        raise ValueError("Empty session string")

    # Strip the "1" version prefix if present
    if gramjs_session.startswith("1"):
        payload = gramjs_session[1:]
    else:
        payload = gramjs_session

    raw = _b64decode(payload)

    # Try non-web first (same format as Telethon — most common for non-browser clients)
    result = _try_unpack_nonweb(raw)
    if result:
        dc_id, auth_key = result
        telethon_b64 = _pack_telethon(dc_id, auth_key)
        return StringSession(telethon_b64)

    # Try web format (variable-length hostname)
    result = _try_unpack_web(raw)
    if result:
        dc_id, auth_key = result
        telethon_b64 = _pack_telethon(dc_id, auth_key)
        return StringSession(telethon_b64)

    # Last resort: try passing directly to Telethon
    try:
        return StringSession(payload)
    except ValueError:
        pass

    raise ValueError(
        f"Cannot convert session string (decoded length={len(raw)}, "
        f"payload length={len(payload)})"
    )
