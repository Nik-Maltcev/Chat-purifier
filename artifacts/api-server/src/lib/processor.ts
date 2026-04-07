/**
 * Anti-ban Telegram processor with:
 * 1. Pull-based (one chat at a time from DB) — FloodWait chats go back to pending & get retried
 * 2. FloodWait detection & automatic wait (respects Telegram's exact wait time + buffer)
 * 3. Random jitter ±30% on every delay — looks human, not a bot
 * 4. Exponential backoff on consecutive errors
 * 5. Automatic "human break" every 50 chats (2-5 min pause)
 * 6. Abortable sleeps — stop button works instantly during any wait
 * 7. Fresh session config on every iteration — delay changes take effect immediately
 */
import { db, sessionsTable, chatResultsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { fetchChatMessages, getFloodWaitSeconds } from "./telegram.js";
import { analyzeChat } from "./deepseek.js";
import { logger } from "./logger.js";

const activeProcessors = new Map<number, AbortController>();

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

/**
 * Add ±30% jitter to a delay (milliseconds). Min 5s.
 */
function withJitter(ms: number): number {
  const jitter = (Math.random() * 0.6 - 0.3) * ms;
  return Math.max(5000, Math.round(ms + jitter));
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}с`;
  return `${Math.floor(s / 60)}м ${s % 60}с`;
}

export async function startProcessor(sessionId: number): Promise<void> {
  if (activeProcessors.has(sessionId)) {
    logger.info({ sessionId }, "Processor already running");
    return;
  }
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
    logger.info({ sessionId }, "Processor stopped");
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

      logger.info({ sessionId, chatId: chat.id, identifier: chat.chatIdentifier }, "Processing chat");

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

      let floodWaitRetried = false;

      const processSingleChat = async (): Promise<"done" | "flood_wait" | "error"> => {
        try {
          await db.update(chatResultsTable)
            .set({ status: "fetching", updatedAt: new Date() })
            .where(eq(chatResultsTable.id, chat.id));

          const { title, username, membersCount, messages } = await fetchChatMessages(
            chat.chatIdentifier,
            freshSession.messagesCount
          );

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
              updatedAt: new Date(),
            }).where(eq(chatResultsTable.id, chat.id));
          }

          return "done";
        } catch (err) {
          // TECHNIQUE 2: FloodWait detection
          const floodSec = getFloodWaitSeconds(err);
          if (floodSec !== null) {
            const waitSec = floodSec + 60; // +60s safety buffer
            logger.warn({ floodSec, waitSec: formatSeconds(waitSec) }, "FloodWait — ждём и повторяем чат");

            // Reset chat to pending so it gets retried
            await db.update(chatResultsTable)
              .set({ status: "pending", updatedAt: new Date() })
              .where(eq(chatResultsTable.id, chat.id));

            const resumed = await abortableSleep(waitSec * 1000, signal);
            if (!resumed) return "error";
            return "flood_wait";
          }

          // Regular error
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error({ err, chatId: chat.id, identifier: chat.chatIdentifier }, "Chat processing error");
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

      if (result === "flood_wait") {
        // Don't count as processed, don't count as error — it'll be retried
        floodWaitRetried = true;
        consecutiveErrors = 0;
        // Continue loop immediately (no extra delay, we already waited)
        continue;
      }

      totalProcessed++;
      await updateProgress(sessionId);

      if (result === "error") {
        consecutiveErrors++;
        // TECHNIQUE 4: Exponential backoff on consecutive errors
        if (consecutiveErrors >= 3) {
          const backoffSec = Math.min(consecutiveErrors * 45, 300); // up to 5 min
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
