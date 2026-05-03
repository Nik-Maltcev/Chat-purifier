"""
FastAPI application for the Telethon Python Worker.

Exposes two endpoints:
  GET  /health          — liveness check
  POST /fetch-messages  — fetch messages from a Telegram chat

Startup:
  - Initialises the asyncpg DB pool via init_db()
  - Creates a shared ClientPool and injects it into account_manager and telegram_client
  - Configures structured JSON logging

Shutdown:
  - Closes the asyncpg DB pool via close_db()
"""

from __future__ import annotations

import traceback

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
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

import account_manager
import telegram_client
from client_pool import ClientPool
from config import LOG_LEVEL
from db import close_db, get_account_by_id, init_db
from logger import configure_logging, get_logger
from models import FetchMessagesRequest, FetchMessagesResponse

logger = get_logger(__name__)

app = FastAPI()

# Auth errors that map to HTTP 401
_AUTH_ERRORS = (
    AuthKeyUnregisteredError,
    SessionRevokedError,
    UserDeactivatedError,
    UserDeactivatedBanError,
    AuthKeyInvalidError,
    AuthKeyPermEmptyError,
    SessionExpiredError,
)


# ---------------------------------------------------------------------------
# Lifecycle events
# ---------------------------------------------------------------------------


@app.on_event("startup")
async def startup() -> None:
    configure_logging(LOG_LEVEL)
    await init_db()
    pool = ClientPool()
    account_manager.set_client_pool(pool)
    telegram_client.set_client_pool(pool)
    logger.info("worker_started")


@app.on_event("shutdown")
async def shutdown() -> None:
    await close_db()
    logger.info("worker_stopped")


# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return HTTP 400 for Pydantic / FastAPI validation errors."""
    return JSONResponse(
        status_code=400,
        content={"error": "validation_error", "detail": str(exc)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Return HTTP 500 for any unhandled exception and log the full traceback."""
    logger.error(
        "unhandled_exception",
        error=str(exc),
        traceback=traceback.format_exc(),
    )
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "detail": str(exc)},
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    """Liveness check — always returns HTTP 200."""
    return {"status": "ok"}


@app.post("/fetch-messages", response_model=FetchMessagesResponse)
async def fetch_messages_endpoint(req: FetchMessagesRequest) -> FetchMessagesResponse:
    """
    Fetch recent messages from a Telegram chat.

    Loads the account by req.account_id, then delegates to telegram_client.fetch_messages().

    Error responses:
      404 — account not found
      429 — FloodWait (includes wait_seconds and account_id)
      401 — auth error (includes error code and account_id)
      503 — no active accounts available (should not normally occur here, but kept for completeness)
      500 — unhandled exception (caught by the global handler above)
    """
    # Load the account from the database
    account = await get_account_by_id(req.account_id)
    if account is None:
        return JSONResponse(
            status_code=404,
            content={"error": "account_not_found"},
        )

    try:
        result = await telegram_client.fetch_messages(
            req.chat_identifier,
            req.messages_count,
            account,
        )
        return result

    except FloodWaitError as exc:
        return JSONResponse(
            status_code=429,
            content={
                "error": "flood_wait",
                "wait_seconds": exc.seconds,
                "account_id": req.account_id,
            },
        )

    except _AUTH_ERRORS as exc:
        return JSONResponse(
            status_code=401,
            content={
                "error": "auth_error",
                "code": type(exc).__name__,
                "account_id": req.account_id,
            },
        )
