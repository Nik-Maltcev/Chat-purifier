/**
 * Auto-restart: on server startup, resume all sessions that were not manually stopped.
 * Also fixes "stuck" chats that were left in fetching/analyzing state.
 */
import { db, sessionsTable, chatResultsTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { startProcessor } from "./processor.js";
import { logger } from "./logger.js";

export async function autoRestartSessions(): Promise<void> {
  try {
    // Find all sessions that should auto-resume:
    // - status is 'running' (server was killed mid-run) or 'paused' (auto-paused by quota/FloodWait)
    // - autoRestart = true (not manually stopped by user)
    const sessions = await db.select().from(sessionsTable);
    const eligible = sessions.filter(
      (s) => s.autoRestart && (s.status === "running" || s.status === "paused")
    );

    if (eligible.length === 0) {
      logger.info("Авторестарт: нет сессий для возобновления");
      return;
    }

    for (const session of eligible) {
      // Fix stuck chats: fetching/analyzing → pending (they never finished)
      const stuck = await db.select().from(chatResultsTable)
        .where(
          and(
            eq(chatResultsTable.sessionId, session.id),
            inArray(chatResultsTable.status, ["fetching", "analyzing"])
          )
        );

      if (stuck.length > 0) {
        await db.update(chatResultsTable)
          .set({ status: "pending", updatedAt: new Date() })
          .where(
            and(
              eq(chatResultsTable.sessionId, session.id),
              inArray(chatResultsTable.status, ["fetching", "analyzing"])
            )
          );
        logger.info(
          { sessionId: session.id, count: stuck.length },
          "Авторестарт: зависшие чаты сброшены в pending"
        );
      }

      logger.info(
        { sessionId: session.id, name: session.name, prevStatus: session.status },
        "Авторестарт: возобновляю сессию"
      );

      // Small stagger to not hammer Telegram simultaneously
      await new Promise((r) => setTimeout(r, 2000));
      startProcessor(session.id);
    }

    logger.info({ count: eligible.length }, "Авторестарт завершён");
  } catch (err) {
    logger.error({ err }, "Ошибка авторестарта сессий");
  }
}
