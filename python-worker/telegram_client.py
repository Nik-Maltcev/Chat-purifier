"""
Telegram client module.

Wraps Telethon to fetch messages from a chat using the shared ClientPool.
Handles FloodWait and auth errors by delegating to account_manager.
"""

from __future__ import annotations

from datetime import timezone
from typing import Optional

from telethon.errors import (
    AuthKeyInvalidError,
    AuthKeyPermEmptyError,
    AuthKeyUnregisteredError,
    FloodWaitError,
    SessionExpiredError,
    SessionRevokedError,
    UserDeactivatedBanError,
    UserDeactivatedError,
)

from account_manager import mark_banned, mark_flood_wait
from client_pool import ClientPool
from logger import get_logger
from models import FetchMessagesResponse

logger = get_logger(__name__)

# Injected at startup via set_client_pool().
_pool: Optional[ClientPool] = None

# Auth errors that indicate the session/account is no longer valid.
_AUTH_ERRORS = (
    AuthKeyUnregisteredError,
    SessionRevokedError,
    UserDeactivatedError,
    UserDeactivatedBanError,
    AuthKeyInvalidError,
    AuthKeyPermEmptyError,
    SessionExpiredError,
)


def set_client_pool(pool: ClientPool) -> None:
    """Inject the shared ClientPool instance used by fetch_messages."""
    global _pool
    _pool = pool


def normalize_chat_identifier(chat_identifier: str) -> str:
    """
    Normalize a Telegram chat identifier to a bare username/identifier.

    Strips leading/trailing whitespace, removes URL prefixes
    (https://t.me/ and t.me/), and removes a leading '@'.

    Examples:
        "@durov"            -> "durov"
        "https://t.me/durov" -> "durov"
        "t.me/durov"        -> "durov"
        "durov"             -> "durov"
    """
    identifier = chat_identifier.strip()

    if identifier.startswith("https://t.me/"):
        identifier = identifier[len("https://t.me/"):]
    elif identifier.startswith("t.me/"):
        identifier = identifier[len("t.me/"):]

    if identifier.startswith("@"):
        identifier = identifier[1:]

    return identifier


async def fetch_messages(
    chat_identifier: str,
    messages_count: int,
    account: dict,
) -> FetchMessagesResponse:
    """
    Fetch up to `messages_count` recent text messages from a Telegram chat.

    Uses the shared ClientPool to obtain a connected Telethon client for the
    given account. Normalizes the chat identifier before resolving the entity.
    Skips messages with empty or whitespace-only text.

    Raises:
        FloodWaitError: if Telegram returns a flood-wait; account is marked
            flood_wait in the DB before re-raising.
        AuthKeyUnregisteredError / SessionRevokedError / UserDeactivatedError /
        UserDeactivatedBanError / AuthKeyInvalidError / AuthKeyPermEmptyError /
        SessionExpiredError: if the session is invalid; account is marked
            banned in the DB before re-raising.
    """
    account_id: int = account["id"]

    # 1. Obtain a connected Telethon client from the pool.
    client = await _pool.get_or_create(account)

    # 2. Normalize the chat identifier.
    clean = normalize_chat_identifier(chat_identifier)

    try:
        # 3. Resolve the entity.
        entity = await client.get_entity(clean)

        # 4. Collect text messages, skipping empty/whitespace-only ones.
        collected = []
        async for msg in client.iter_messages(entity, limit=messages_count):
            if msg.text and msg.text.strip():
                collected.append(msg)

        # 5. Extract metadata from the entity.
        title: Optional[str] = getattr(entity, "title", None)
        username: Optional[str] = getattr(entity, "username", None)
        members_count: Optional[int] = getattr(entity, "participants_count", None)

        # 6. Determine last_message_date from the first collected message.
        last_message_date = None
        if collected:
            raw_date = collected[0].date
            if raw_date is not None:
                # Ensure the datetime is UTC-aware.
                if raw_date.tzinfo is None:
                    last_message_date = raw_date.replace(tzinfo=timezone.utc)
                else:
                    last_message_date = raw_date.astimezone(timezone.utc)

        return FetchMessagesResponse(
            title=title,
            username=username,
            members_count=members_count,
            messages=[msg.text for msg in collected],
            last_message_date=last_message_date,
        )

    except FloodWaitError as error:
        logger.warning(
            "telegram_flood_wait",
            account_id=account_id,
            wait_seconds=error.seconds,
        )
        await mark_flood_wait(account_id, error.seconds, account)
        raise

    except _AUTH_ERRORS as error:
        error_type = type(error).__name__
        logger.error(
            "telegram_auth_error",
            account_id=account_id,
            error_type=error_type,
        )
        await mark_banned(account_id, error_type, account)
        raise
