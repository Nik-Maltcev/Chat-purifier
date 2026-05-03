from telethon.sessions import StringSession


def gramjs_to_telethon_session(gramjs_session: str) -> StringSession:
    """
    Convert a gramjs StringSession (with "1" version prefix) to a Telethon StringSession.
    gramjs non-web StringSession format: "1" + base64url(binary_payload)
    Telethon StringSession format: base64url(binary_payload)
    The binary payload format is identical between both libraries.
    """
    if gramjs_session.startswith("1"):
        raw = gramjs_session[1:]  # strip gramjs version prefix
    else:
        raw = gramjs_session  # already in Telethon format
    return StringSession(raw)
