"""
Account manager module.

Provides helpers for selecting the next available Telegram account and
marking accounts as flood_wait or banned. Interacts with the DB via db.py
and removes clients from the shared ClientPool when an account becomes
unavailable.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from client_pool import ClientPool
from db import get_active_accounts, reset_expired_flood_wait, update_account_status
from logger import get_logger

logger = get_logger(__name__)

# Injected at startup via set_client_pool().
_pool: Optional[ClientPool] = None


def set_client_pool(pool: ClientPool) -> None:
    """Inject the shared ClientPool instance used by mark_flood_wait / mark_banned."""
    global _pool
    _pool = pool


async def get_next_available_account() -> Optional[dict]:
    """
    Return the highest-priority active TelegramAccount, or None if none exist.

    Before querying active accounts, expired flood_wait accounts are
    automatically reset to 'active' so they become eligible again.
    """
    # Auto-recover accounts whose flood_wait window has expired.
    await reset_expired_flood_wait()

    accounts = await get_active_accounts()
    if not accounts:
        return None

    # get_active_accounts() already orders by priority DESC NULLS LAST,
    # so the first element is the highest-priority account.
    return accounts[0]


async def mark_flood_wait(
    account_id: int,
    wait_seconds: int,
    account: Optional[dict] = None,
) -> None:
    """
    Mark a TelegramAccount as flood_wait and remove it from the client pool.

    Sets status='flood_wait' and flood_wait_until=now+wait_seconds in the DB,
    then disconnects and removes the Telethon client from the pool.

    Logs at WARNING level: account_id, wait_seconds, proxy_host (if available).
    Never logs session, api_hash, or proxy_password.
    """
    flood_wait_until = datetime.utcnow() + timedelta(seconds=wait_seconds)
    await update_account_status(account_id, "flood_wait", flood_wait_until)

    if _pool is not None:
        await _pool.remove(account_id)

    log_ctx: dict = {
        "account_id": account_id,
        "wait_seconds": wait_seconds,
    }
    if account is not None:
        proxy_host = account.get("proxy_host") or None
        if proxy_host:
            log_ctx["proxy_host"] = proxy_host

    logger.warning("account_flood_wait", **log_ctx)


async def mark_banned(
    account_id: int,
    error_code: str = "",
    account: Optional[dict] = None,
) -> None:
    """
    Mark a TelegramAccount as banned and remove it from the client pool.

    Sets status='banned' and clears flood_wait_until in the DB, then
    disconnects and removes the Telethon client from the pool.

    Logs at ERROR level: account_id, error_code.
    Never logs session or api_hash.
    """
    await update_account_status(account_id, "banned", None)

    if _pool is not None:
        await _pool.remove(account_id)

    log_ctx: dict = {"account_id": account_id}
    if error_code:
        log_ctx["error_code"] = error_code

    logger.error("account_banned", **log_ctx)
