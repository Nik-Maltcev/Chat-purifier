import { db, sessionsTable, chatResultsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { fetchChatMessages } from "./telegram.js";
import { analyzeChat } from "./deepseek.js";
import { logger } from "./logger.js";

const activeProcessors = new Map<number, AbortController>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startProcessor(sessionId: number): Promise<void> {
  if (activeProcessors.has(sessionId)) {
    logger.info({ sessionId }, "Processor already running for session");
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

async function processSession(sessionId: number, signal: AbortSignal): Promise<void> {
  try {
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId));

    if (!session) {
      logger.error({ sessionId }, "Session not found");
      activeProcessors.delete(sessionId);
      return;
    }

    await db
      .update(sessionsTable)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(sessionsTable.id, sessionId));

    const pendingChats = await db
      .select()
      .from(chatResultsTable)
      .where(
        and(
          eq(chatResultsTable.sessionId, sessionId),
          eq(chatResultsTable.status, "pending")
        )
      );

    logger.info({ sessionId, count: pendingChats.length }, "Processing chats");

    for (let i = 0; i < pendingChats.length; i++) {
      if (signal.aborted) {
        logger.info({ sessionId }, "Processing aborted");
        await db
          .update(sessionsTable)
          .set({ status: "paused", updatedAt: new Date() })
          .where(eq(sessionsTable.id, sessionId));
        activeProcessors.delete(sessionId);
        return;
      }

      const chat = pendingChats[i];
      logger.info({ sessionId, chatId: chat.id, identifier: chat.chatIdentifier }, "Processing chat");

      try {
        await db
          .update(chatResultsTable)
          .set({ status: "fetching", updatedAt: new Date() })
          .where(eq(chatResultsTable.id, chat.id));

        const { title, username, membersCount, messages } = await fetchChatMessages(
          chat.chatIdentifier,
          session.messagesCount
        );

        if (messages.length === 0) {
          await db
            .update(chatResultsTable)
            .set({
              status: "skipped",
              verdict: "filter",
              chatTitle: title,
              chatUsername: username,
              membersCount,
              aiSummary: "Нет доступных сообщений",
              updatedAt: new Date(),
            })
            .where(eq(chatResultsTable.id, chat.id));
        } else {
          await db
            .update(chatResultsTable)
            .set({ status: "analyzing", chatTitle: title, chatUsername: username, membersCount, updatedAt: new Date() })
            .where(eq(chatResultsTable.id, chat.id));

          const analysis = await analyzeChat(title, messages);

          await db
            .update(chatResultsTable)
            .set({
              status: "done",
              verdict: analysis.verdict,
              score: analysis.score,
              spamScore: analysis.spamScore,
              activityScore: analysis.activityScore,
              topicScore: analysis.topicScore,
              aiSummary: analysis.summary,
              updatedAt: new Date(),
            })
            .where(eq(chatResultsTable.id, chat.id));
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ err, chatId: chat.id }, "Failed to process chat");

        await db
          .update(chatResultsTable)
          .set({
            status: "error",
            verdict: "error",
            errorMessage: errMsg.slice(0, 500),
            updatedAt: new Date(),
          })
          .where(eq(chatResultsTable.id, chat.id));
      }

      const processed = await db
        .select({ count: chatResultsTable.id })
        .from(chatResultsTable)
        .where(
          and(
            eq(chatResultsTable.sessionId, sessionId)
          )
        );

      const doneCount = await db
        .select()
        .from(chatResultsTable)
        .where(
          and(
            eq(chatResultsTable.sessionId, sessionId)
          )
        );

      const finishedCount = doneCount.filter(
        (c) => c.status === "done" || c.status === "error" || c.status === "skipped"
      ).length;

      await db
        .update(sessionsTable)
        .set({ processedChats: finishedCount, updatedAt: new Date() })
        .where(eq(sessionsTable.id, sessionId));

      if (i < pendingChats.length - 1 && !signal.aborted) {
        logger.info({ sessionId, delay: session.delaySeconds }, "Waiting before next chat");
        await sleep(session.delaySeconds * 1000);
      }
    }

    if (!signal.aborted) {
      await db
        .update(sessionsTable)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(sessionsTable.id, sessionId));
      logger.info({ sessionId }, "Session completed");
    }
  } catch (err) {
    logger.error({ err, sessionId }, "Session processor error");
    await db
      .update(sessionsTable)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(sessionsTable.id, sessionId));
  } finally {
    activeProcessors.delete(sessionId);
  }
}
