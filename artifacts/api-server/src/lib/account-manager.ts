/**
 * Multi-account manager for Telegram.
 * Tracks status of each account (active / flood_wait / banned)
 * and picks the best available account for each request.
 */
import { db, telegramAccountsTable } from "@workspace/db";
import type { TelegramAccount } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "./logger.js";

export type { TelegramAccount };

/**
 * Returns the best available account:
 * - Prefers "active" accounts ordered by priority desc
 * - If all are in flood_wait, returns the one whose flood_wait expires soonest
 * - If all are banned/disabled, returns null
 */
export async function getNextAvailableAccount(): Promise<TelegramAccount | null> {
  const accounts = await db.select().from(telegramAccountsTable);
  if (accounts.length === 0) return null;

  const now = new Date();

  // Auto-recover flood_wait accounts whose timer has expired
  const recovered = accounts.filter(
    (a) => a.status === "flood_wait" && a.floodWaitUntil && a.floodWaitUntil <= now
  );
  for (const a of recovered) {
    await db.update(telegramAccountsTable)
      .set({ status: "active", floodWaitUntil: null, updatedAt: new Date() })
      .where(eq(telegramAccountsTable.id, a.id));
    a.status = "active";
    a.floodWaitUntil = null;
    logger.info({ accountId: a.id, label: a.label }, "Аккаунт восстановлен после FloodWait");
  }

  // Active accounts — sorted by priority descending
  const active = accounts
    .filter((a) => a.status === "active")
    .sort((a, b) => b.priority - a.priority);

  if (active.length > 0) return active[0];

  // All in flood_wait? Return soonest-expiring
  const inFloodWait = accounts.filter(
    (a) => a.status === "flood_wait" && a.floodWaitUntil && a.floodWaitUntil > now
  );
  if (inFloodWait.length > 0) {
    inFloodWait.sort((a, b) => a.floodWaitUntil!.getTime() - b.floodWaitUntil!.getTime());
    return inFloodWait[0]; // Caller should check status and wait
  }

  return null; // All banned or disabled
}

/**
 * Returns milliseconds until the next account becomes available.
 * Returns 0 if any active account exists, or positive ms to wait.
 */
export async function msUntilNextAccountAvailable(): Promise<number> {
  const accounts = await db.select().from(telegramAccountsTable);
  const now = new Date();

  const hasActive = accounts.some((a) => a.status === "active");
  if (hasActive) return 0;

  const floodWaiting = accounts
    .filter((a) => a.status === "flood_wait" && a.floodWaitUntil && a.floodWaitUntil > now)
    .sort((a, b) => a.floodWaitUntil!.getTime() - b.floodWaitUntil!.getTime());

  if (floodWaiting.length > 0) {
    return Math.max(0, floodWaiting[0].floodWaitUntil!.getTime() - now.getTime());
  }

  return -1; // All banned
}

export async function markAccountFloodWait(accountId: number, waitSeconds: number): Promise<void> {
  const until = new Date(Date.now() + waitSeconds * 1000);
  await db.update(telegramAccountsTable)
    .set({ status: "flood_wait", floodWaitUntil: until, updatedAt: new Date() })
    .where(eq(telegramAccountsTable.id, accountId));
  logger.warn({ accountId, waitSeconds, until }, "Аккаунт в FloodWait");
}

export async function markAccountBanned(accountId: number): Promise<void> {
  await db.update(telegramAccountsTable)
    .set({ status: "banned", floodWaitUntil: null, updatedAt: new Date() })
    .where(eq(telegramAccountsTable.id, accountId));
  logger.error({ accountId }, "Аккаунт заблокирован (banned)");
}

export async function markAccountActive(accountId: number): Promise<void> {
  await db.update(telegramAccountsTable)
    .set({ status: "active", floodWaitUntil: null, updatedAt: new Date() })
    .where(eq(telegramAccountsTable.id, accountId));
  logger.info({ accountId }, "Аккаунт активен");
}

export async function hasAnyAccount(): Promise<boolean> {
  const rows = await db.select().from(telegramAccountsTable);
  return rows.length > 0;
}
