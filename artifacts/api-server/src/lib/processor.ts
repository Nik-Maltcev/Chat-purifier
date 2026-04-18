/**
 * Anti-ban Telegram processor with:
 * 1. Pull-based (one chat at a time from DB) — FloodWait chats go back to pending & get retried
 * 2. FloodWait detection & automatic wait (respects Telegram's exact wait time + buffer)
 * 3. Random jitter ±30% on every delay — looks human, not a bot
 * 4. Exponential backoff on consecutive errors
 * 5. Automatic "human break" every 50 chats (2-5 min pause)
 * 6. Abortable sleeps — stop button works instantly during any wait
 * 7. Fresh session config on every iteration — delay changes take effect immediately
 * 8. Daily quota — auto-pause when daily limit reached, resumes next day
 * 9. Multi-account — auto-switches between accounts on FloodWait, waits if all banned
 */
import { db, sessionsTable, chatResultsTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { fetchChatMessages, getFloodWaitSeconds, isAuthError, resetAllClients, disconnectClientForAccount } from "./telegram.js";
import { analyzeChat } from "./deepseek.js";
import { logger } from "./logger.js";
import { getSettingValue } from "./settings-store.js";
import {
  getNextAvailableAccount,
  markAccountFloodWait,
  markAccountBanned,
  hasAnyAccount,
  msUntilNextAccountAvailable,
  type TelegramAccount,
} from "./account-manager.js";

const activeProcessors = new Map<number, AbortController>();

/** Returns how many chats have been processed today (UTC day boundary). */
export async function getDailyProcessedCount(): Promise<number> {
  const todayMidnight = new Date();
  todayMidnight.setUTCHours(0, 0, 0, 0);
  const rows = await db.select().from(chatResultsTable)
    .where(
      and(
        gte(chatResultsTable.updatedAt, todayMidnight),
      )
    );
  return rows.filter(r => r.status === "done" || r.status === "skipped" || r.status === "error").length;
}

/** Returns the daily quota limit from settings (default 150). */
async function getDailyQuota(): Promise<number> {
  const val = await getSettingValue("daily_quota");
  const n = parseInt(val || "150", 10);
  return isNaN(n) || n <= 0 ? 150 : n;
}

/**
 * Abortable sleep: returns true if slept full time, false if aborted.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return; }
    const timer = setTimeout(() => resolve(true), ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(false); }, { once: true });
  });
}

/** Add ±30% jitter to a delay */
function withJitter(ms: number): number {
  const factor = 0.7 + Math.random() * 0.6; // 0.7–1.3
  return Math.round(ms * factor);
}

function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec}с`;
  return `${Math.floor(sec / 60)}м ${sec % 60}с`;
}

export function startProcessor(sessionId: number): void {
  if (activeProcessors.has(sessionId)) return;
  const controller = new AbortController();
  activeProcessors.set(sessionId, controller);
  processSession(sessionId, controller.signal).catch((err) => {
    logger.error({ err, sessionId }, "Processor crashed");
  });
}

export function stopProcessor(sessionId: number): void {
  const controller = activeProcessors.get(sessionId);
  if (controller) {
    controller.abort();
    activeProcessors.delete(sessionId);
    // Reset all telegram clients to stop background reconnect loops
    resetAllClients();
    logger.info({ sessionId }, "Processor stopped, clients reset");
  }
}

export function isProcessorRunning(sessionId: number): boolean {
  return activeProcessors.has(sessionId);
}

async function updateProgress(sessionId: number): Promise<void> {
  const all = await db.select().from(chatResultsTable)
    .where(eq(chatResultsTable.sessionId, sessionId));
  const finished = all.filter(c =>
    c.status === "done" || c.status === "error" || c.status === "skipped"
  ).length;
  await db.update(sessionsTable)
    .set({ processedChats: finished, updatedAt: new Date() })
    .where(eq(sessionsTable.id, sessionId));
}

/**
 * Get the best available account. If all are in FloodWait, waits until the soonest one recovers.
 * Returns null if all are banned.
 */
async function waitForAvailableAccount(signal: AbortSignal): Promise<TelegramAccount | null> {
  while (true) {
    if (signal.aborted) return null;

    const account = await getNextAvailableAccount();
    if (!account) return null; // All banned

    if (account.status === "active") return account;

    // Account is in flood_wait — wait until it recovers
    const msWait = await msUntilNextAccountAvailable();
    if (msWait <= 0) {
      // Should be available now — loop again
      continue;
    }
    if (msWait < 0) return null; // All banned

    const waitSec = Math.ceil(msWait / 1000);
    logger.warn(
      { waitSec: formatSeconds(waitSec) },
      `Все аккаунты в FloodWait. Ожидание ${formatSeconds(waitSec + 60)} до восстановления`
    );
    const resumed = await abortableSleep(msWait + 60_000, signal);
    if (!resumed) return null;
  }
}

async function processSession(sessionId: number, signal: AbortSignal): Promise<void> {
  try {
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
    if (!session) {
      logger.error({ sessionId }, "Session not found");
      activeProcessors.delete(sessionId);
      return;
    }

    await db.update(sessionsTable)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(sessionsTable.id, sessionId));

    const useMultiAccount = await hasAnyAccount();
    if (!useMultiAccount) {
      logger.error({ sessionId }, "Нет аккаунтов Telegram — добавьте аккаунт в настройках");
      await db.update(sessionsTable).set({ status: "error", updatedAt: new Date() }).where(eq(sessionsTable.id, sessionId));
      activeProcessors.delete(sessionId);
      return;
    }

    let consecutiveErrors = 0;
    let totalProcessed = 0;

    // PULL-BASED LOOP: fetch one pending chat at a time
    while (true) {
      if (signal.aborted) {
        await db.update(sessionsTable)
          .set({ status: "paused", updatedAt: new Date() })
          .where(eq(sessionsTable.id, sessionId));
        activeProcessors.delete(sessionId);
        return;
      }

      // Always fetch fresh session config (delay may have been changed by user)
      const [freshSession] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
      if (!freshSession) break;

      // Get next pending chat
      const [chat] = await db.select().from(chatResultsTable)
        .where(and(
          eq(chatResultsTable.sessionId, sessionId),
          eq(chatResultsTable.status, "pending")
        ))
        .limit(1);

      if (!chat) break; // All done

      // TECHNIQUE 8: Daily quota check
      const [dailyCount, dailyQuota] = await Promise.all([getDailyProcessedCount(), getDailyQuota()]);
      if (dailyCount >= dailyQuota) {
        const now = new Date();
        const nextMidnight = new Date();
        nextMidnight.setUTCHours(24, 0, 0, 0);
        const msUntilMidnight = nextMidnight.getTime() - now.getTime();

        logger.warn(
          { dailyCount, dailyQuota, msUntilMidnight },
          `Дневная квота достигнута (${dailyCount}/${dailyQuota}). Пауза до следующего дня.`
        );

        await db.update(sessionsTable).set({
          status: "paused",
          updatedAt: new Date(),
        }).where(eq(sessionsTable.id, sessionId));

        await abortableSleep(msUntilMidnight + 60_000, signal);

        if (signal.aborted) {
          activeProcessors.delete(sessionId);
          return;
        }

        await db.update(sessionsTable).set({
          status: "running",
          updatedAt: new Date(),
        }).where(eq(sessionsTable.id, sessionId));
        continue;
      }

      // TECHNIQUE 9: Get available Telegram account
      const currentAccount = await waitForAvailableAccount(signal);
      if (!currentAccount) {
        logger.error({ sessionId }, "Все аккаунты Telegram заблокированы — остановка сессии");
        await db.update(sessionsTable).set({
          status: "paused",
          updatedAt: new Date(),
        }).where(eq(sessionsTable.id, sessionId));
        activeProcessors.delete(sessionId);
        return;
      }

      logger.info(
        {
          sessionId,
          chatId: chat.id,
          identifier: chat.chatIdentifier,
          dailyCount,
          dailyQuota,
          account: `${currentAccount.label} (#${currentAccount.id})`,
        },
        "Processing chat"
      );

      // TECHNIQUE 5: Human-like break every 50 chats
      if (totalProcessed > 0 && totalProcessed % 50 === 0) {
        const breakSec = Math.floor(120 + Math.random() * 180); // 2–5 min
        logger.info({ breakSec }, `Human-like break after ${totalProcessed} chats`);
        const resumed = await abortableSleep(breakSec * 1000, signal);
        if (!resumed) {
          await db.update(sessionsTable).set({ status: "paused", updatedAt: new Date() }).where(eq(sessionsTable.id, sessionId));
          activeProcessors.delete(sessionId);
          return;
        }
      }

      const processSingleChat = async (): Promise<"done" | "flood_wait" | "auth_error" | "error"> => {
        try {
          await db.update(chatResultsTable)
            .set({ status: "fetching", updatedAt: new Date() })
            .where(eq(chatResultsTable.id, chat.id));

          const result = await fetchChatMessages(
            chat.chatIdentifier,
            freshSession.messagesCount,
            currentAccount,
          );
          const title = result.title;
          const username = result.username;
          const membersCount = result.membersCount;
          const messages = result.messages;

          if (messages.length === 0) {
            await db.update(chatResultsTable).set({
              status: "skipped",
              verdict: "filter",
              chatTitle: title,
              chatUsername: username,
              membersCount,
              aiSummary: "Нет доступных сообщений",
              updatedAt: new Date(),
            }).where(eq(chatResultsTable.id, chat.id));
          } else {
            await db.update(chatResultsTable)
              .set({ status: "analyzing", chatTitle: title, chatUsername: username, membersCount, updatedAt: new Date() })
              .where(eq(chatResultsTable.id, chat.id));

            const analysis = await analyzeChat(title, messages);

            await db.update(chatResultsTable).set({
              status: "done",
              verdict: analysis.verdict,
              score: analysis.score,
              spamScore: analysis.spamScore,
              activityScore: analysis.activityScore,
              topicScore: analysis.topicScore,
              aiSummary: analysis.summary,
              country: analysis.country,
              updatedAt: new Date(),
            }).where(eq(chatResultsTable.id, chat.id));
          }

          return "done";
        } catch (err) {
          // TECHNIQUE 2: FloodWait detection
          const floodSec = getFloodWaitSeconds(err);
          if (floodSec !== null) {
            const waitSec = floodSec + 60;
            logger.warn({ 
              floodSec, 
              waitSec: formatSeconds(waitSec),
              accountId: currentAccount.id,
              accountLabel: currentAccount.label,
              proxyHost: currentAccount.proxyHost,
              proxyPort: currentAccount.proxyPort,
              proxyUsername: currentAccount.proxyUsername,
            }, "FloodWait — переключаем аккаунт");

            // Mark this account as flood_wait
            if (currentAccount) {
              await markAccountFloodWait(currentAccount.id, waitSec);
            }

            // Reset chat to pending so it gets retried with another account
            await db.update(chatResultsTable)
              .set({ status: "pending", updatedAt: new Date() })
              .where(eq(chatResultsTable.id, chat.id));

            return "flood_wait";
          }

          // Auth / ban error
          if (isAuthError(err) && currentAccount) {
            logger.error({ err, accountId: currentAccount.id }, "Auth error detected — marking account as banned");
            await markAccountBanned(currentAccount.id);
            await db.update(chatResultsTable)
              .set({ status: "pending", updatedAt: new Date() })
              .where(eq(chatResultsTable.id, chat.id));
            return "auth_error";
          }

          // Regular error — log full details
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error({ err, chatId: chat.id, identifier: chat.chatIdentifier, accountId: currentAccount?.id }, "Chat processing error");
          await db.update(chatResultsTable).set({
            status: "error",
            verdict: "error",
            errorMessage: errMsg.slice(0, 500),
            updatedAt: new Date(),
          }).where(eq(chatResultsTable.id, chat.id));
          return "error";
        }
      };

      const result = await processSingleChat();

      if (result === "flood_wait" || result === "auth_error") {
        // Don't count as processed — will be retried with different account
        consecutiveErrors = 0;
        
        // Wait 5 minutes before switching to next account — let Telegram cool down
        logger.info("Пауза 5 минут перед переключением на другой аккаунт");
        const resumed = await abortableSleep(300_000, signal);
        if (!resumed) {
          await db.update(sessionsTable).set({ status: "paused", updatedAt: new Date() }).where(eq(sessionsTable.id, sessionId));
          activeProcessors.delete(sessionId);
          return;
        }
        
        // Also disconnect the flood-waited client to free resources
        if (currentAccount) {
          disconnectClientForAccount(currentAccount.id);
        }
        
        continue;
      }

      totalProcessed++;
      await updateProgress(sessionId);

      if (result === "error") {
        consecutiveErrors++;
        // TECHNIQUE 4: Exponential backoff on consecutive errors
        if (consecutiveErrors >= 3) {
          const backoffSec = Math.min(consecutiveErrors * 45, 300);
          logger.warn({ consecutiveErrors, backoffSec }, "Consecutive errors — exponential backoff");
          const resumed = await abortableSleep(backoffSec * 1000, signal);
          if (!resumed) {
            await db.update(sessionsTable).set({ status: "paused", updatedAt: new Date() }).where(eq(sessionsTable.id, sessionId));
            activeProcessors.delete(sessionId);
            return;
          }
        }
      } else {
        consecutiveErrors = 0;
      }

      // TECHNIQUE 3: Wait with ±30% random jitter before next chat
      const baseMs = freshSession.delaySeconds * 1000;
      const delayMs = withJitter(baseMs);
      logger.info({ delayMs: Math.round(delayMs / 1000) + "с" }, "Ждём перед следующим чатом");

      const resumed = await abortableSleep(delayMs, signal);
      if (!resumed) {
        await db.update(sessionsTable).set({ status: "paused", updatedAt: new Date() }).where(eq(sessionsTable.id, sessionId));
        activeProcessors.delete(sessionId);
        return;
      }
    }

    if (!signal.aborted) {
      await db.update(sessionsTable)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(sessionsTable.id, sessionId));
      logger.info({ sessionId, totalProcessed }, "Session completed");
    }
  } catch (err) {
    logger.error({ err, sessionId }, "Session processor fatal error");
    await db.update(sessionsTable)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(sessionsTable.id, sessionId));
  } finally {
    activeProcessors.delete(sessionId);
  }
}
