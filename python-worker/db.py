"""
PostgreSQL connection module using asyncpg.

Provides a module-level connection pool and async functions for
reading and updating telegram_accounts records.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

import asyncpg

from config import DATABASE_URL
from logger import get_logger

logger = get_logger(__name__)

# Module-level pool — None until init_db() is called.
_pool: asyncpg.Pool | None = None


async def init_db() -> None:
    """Create the asyncpg connection pool from DATABASE_URL."""
    global _pool
    try:
        _pool = await asyncpg.create_pool(DATABASE_URL)
        logger.info("db_pool_created")
    except Exception as exc:
        # Log the exception type only — never log DATABASE_URL value.
        logger.error(
            "DB connection error",
            exc_type=type(exc).__name__,
        )
        raise


async def close_db() -> None:
    """Close the asyncpg connection pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("db_pool_closed")


def _record_to_dict(record: asyncpg.Record) -> dict:
    """Convert an asyncpg Record to a plain dict."""
    return dict(record)


async def get_account_by_id(account_id: int) -> Optional[dict]:
    """
    SELECT all fields from telegram_accounts WHERE id = account_id.

    Returns a dict of column→value, or None if no row found.
    """
    assert _pool is not None, "DB pool is not initialised — call init_db() first"
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM telegram_accounts WHERE id = $1",
            account_id,
        )
    if row is None:
        return None
    return _record_to_dict(row)


async def update_account_status(
    account_id: int,
    status: str,
    flood_wait_until: Optional[datetime] = None,
) -> None:
    """
    UPDATE telegram_accounts SET status=..., flood_wait_until=... WHERE id=...

    Pass flood_wait_until=None to clear the column (sets it to NULL).
    """
    assert _pool is not None, "DB pool is not initialised — call init_db() first"
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE telegram_accounts
               SET status = $1,
                   flood_wait_until = $2
             WHERE id = $3
            """,
            status,
            flood_wait_until,
            account_id,
        )


async def get_active_accounts() -> list[dict]:
    """
    SELECT all fields from telegram_accounts WHERE status='active'
    ORDER BY priority DESC NULLS LAST.

    Returns a list of dicts (one per row).
    """
    assert _pool is not None, "DB pool is not initialised — call init_db() first"
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT *
              FROM telegram_accounts
             WHERE status = 'active'
             ORDER BY priority DESC NULLS LAST
            """
        )
    return [_record_to_dict(row) for row in rows]


async def reset_expired_flood_wait() -> None:
    """Reset flood_wait accounts whose flood_wait_until has passed."""
    assert _pool is not None, "DB pool is not initialised — call init_db() first"
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE telegram_accounts
               SET status = 'active', flood_wait_until = NULL
             WHERE status = 'flood_wait'
               AND flood_wait_until <= NOW()
            """
        )
