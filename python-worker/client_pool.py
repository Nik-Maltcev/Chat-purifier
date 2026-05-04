import asyncio
from typing import Optional

import socks
from telethon import TelegramClient
from telethon.sessions import StringSession

from logger import get_logger
from session_compat import gramjs_to_telethon_session

logger = get_logger(__name__)

# Reconnect delay schedule: 3s, 6s, 12s, 24s, 48s (5 attempts)
_RECONNECT_DELAYS = [3, 6, 12, 24, 48]


class ClientPool:
    """
    Maintains a per-account pool of connected Telethon TelegramClient instances.
    Clients are keyed by account_id and reused across requests.
    """

    def __init__(self) -> None:
        self._clients: dict[int, TelegramClient] = {}

    async def get_or_create(self, account: dict) -> TelegramClient:
        """
        Return an existing connected client for the account, or create and connect a new one.

        The account dict must contain:
          - id (int): account identifier
          - session (str): gramjs StringSession string
          - api_id (int | str): Telegram API ID
          - api_hash (str): Telegram API Hash
          - proxy_host (str | None): optional SOCKS5 proxy host
          - proxy_port (int | None): optional SOCKS5 proxy port
          - proxy_username (str | None): optional proxy username
          - proxy_password (str | None): optional proxy password
          - label (str | None): optional human-readable label for logging
        """
        account_id: int = account["id"]

        existing = self._clients.get(account_id)
        if existing is not None and existing.is_connected():
            return existing

        # Build Telethon StringSession from gramjs session string
        session: StringSession = gramjs_to_telethon_session(account["session"])

        api_id = int(account["api_id"])
        api_hash: str = account["api_hash"]

        # Configure SOCKS5 proxy if proxy_host and proxy_port are provided
        proxy_host: Optional[str] = account.get("proxy_host") or None
        proxy_port_raw = account.get("proxy_port")
        proxy_port: Optional[int] = int(proxy_port_raw) if proxy_port_raw else None

        proxy = None
        if proxy_host and proxy_port:
            proxy_username: Optional[str] = account.get("proxy_username") or None
            proxy_password: Optional[str] = account.get("proxy_password") or None
            proxy = (
                socks.PROXY_TYPE_SOCKS5,
                proxy_host,
                proxy_port,
                True,
                proxy_username,
                proxy_password,
            )

        client = TelegramClient(
            session,
            api_id,
            api_hash,
            proxy=proxy,
            receive_updates=False,
            flood_sleep_threshold=0,
        )
        await client.connect()

        self._clients[account_id] = client

        # Log successful connection — never log session, api_hash, or proxy_password
        label: Optional[str] = account.get("label") or None
        log_ctx: dict = {"account_id": account_id}
        if label:
            log_ctx["label"] = label
        if proxy_host:
            log_ctx["proxy_host"] = proxy_host

        logger.info("telethon_client_connected", **log_ctx)

        return client

    async def remove(self, account_id: int) -> None:
        """
        Disconnect and remove the client for the given account_id from the pool.
        Exceptions during disconnect are caught and logged.
        """
        client = self._clients.pop(account_id, None)
        if client is None:
            return

        try:
            await client.disconnect()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "telethon_client_disconnect_error",
                account_id=account_id,
                error=str(exc),
            )

    async def _reconnect(self, account_id: int, account: dict) -> None:
        """
        Attempt to reconnect a disconnected client with exponential backoff.

        Delays: 3s, 6s, 12s, 24s, 48s (5 attempts total).
        If all attempts fail, the client is removed from the pool and a WARNING is logged.
        """
        client = self._clients.get(account_id)
        if client is None:
            # Client was already removed (e.g. banned/flood_wait), nothing to do
            return

        for attempt, delay in enumerate(_RECONNECT_DELAYS, start=1):
            await asyncio.sleep(delay)

            # Re-check: client may have been removed while we were sleeping
            client = self._clients.get(account_id)
            if client is None:
                return

            try:
                await client.connect()
                if client.is_connected():
                    logger.info(
                        "telethon_client_reconnected",
                        account_id=account_id,
                        attempt=attempt,
                    )
                    return
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "telethon_client_reconnect_attempt_failed",
                    account_id=account_id,
                    attempt=attempt,
                    error=str(exc),
                )

        # All 5 attempts exhausted
        logger.warning(
            "telethon_client_reconnect_failed_all_attempts",
            account_id=account_id,
        )
        await self.remove(account_id)

    async def _monitor_disconnection(self, account_id: int, account: dict) -> None:
        """
        Wait for the client's disconnected future and trigger reconnect logic
        when an unexpected disconnection occurs.
        """
        client = self._clients.get(account_id)
        if client is None:
            return

        try:
            # client.disconnected is a Future that resolves when the connection drops
            await client.disconnected
        except Exception:  # noqa: BLE001
            pass

        # Only attempt reconnect if the client is still in the pool
        # (i.e. not intentionally removed via remove())
        if account_id in self._clients:
            logger.warning(
                "telethon_client_unexpected_disconnect",
                account_id=account_id,
            )
            await self._reconnect(account_id, account)
