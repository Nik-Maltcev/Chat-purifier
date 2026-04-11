import { Router } from "express";
import { db, sessionsTable, chatResultsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  CreateSessionBody,
  GetSessionParams,
  StartSessionParams,
  StopSessionParams,
  GetSessionChatsParams,
  GetSessionChatsQueryParams,
  GetSessionSummaryParams,
  ExportSessionParams,
  ExportSessionQueryParams,
} from "@workspace/api-zod";
import { startProcessor, stopProcessor } from "../lib/processor.js";

const router = Router();

router.post("/sessions", async (req, res) => {
  const body = CreateSessionBody.parse(req.body);

  const lines = body.chatList
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    res.status(400).json({ error: "No valid chat identifiers provided" });
    return;
  }

  const [session] = await db
    .insert(sessionsTable)
    .values({
      name: body.name,
      delaySeconds: body.delaySeconds ?? 12,
      messagesCount: body.messagesCount ?? 50,
      totalChats: lines.length,
      processedChats: 0,
      status: "idle",
    })
    .returning();

  await db.insert(chatResultsTable).values(
    lines.map((identifier) => ({
      sessionId: session.id,
      chatIdentifier: identifier,
      status: "pending" as const,
      verdict: "pending" as const,
    }))
  );

  res.status(201).json(formatSession(session));
});

router.get("/sessions", async (_req, res) => {
  const sessions = await db.select().from(sessionsTable).orderBy(sessionsTable.createdAt);
  res.json(sessions.map(formatSession));
});

router.get("/sessions/:sessionId", async (req, res) => {
  const { sessionId } = GetSessionParams.parse({ sessionId: Number(req.params.sessionId) });
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(formatSession(session));
});

router.post("/sessions/:sessionId/start", async (req, res) => {
  const { sessionId } = StartSessionParams.parse({ sessionId: Number(req.params.sessionId) });
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.status === "running") {
    res.json(formatSession(session));
    return;
  }

  // Mark autoRestart=true so server restarts pick this up
  await db.update(sessionsTable)
    .set({ autoRestart: true, updatedAt: new Date() })
    .where(eq(sessionsTable.id, sessionId));

  await startProcessor(sessionId);

  const [updated] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  res.json(formatSession(updated));
});

router.post("/sessions/:sessionId/stop", async (req, res) => {
  const { sessionId } = StopSessionParams.parse({ sessionId: Number(req.params.sessionId) });
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  stopProcessor(sessionId);

  // autoRestart=false means "user manually stopped, don't auto-resume"
  await db
    .update(sessionsTable)
    .set({ status: "paused", autoRestart: false, updatedAt: new Date() })
    .where(eq(sessionsTable.id, sessionId));

  const [updated] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  res.json(formatSession(updated));
});

router.get("/sessions/:sessionId/chats", async (req, res) => {
  const { sessionId } = GetSessionChatsParams.parse({ sessionId: Number(req.params.sessionId) });
  const query = GetSessionChatsQueryParams.parse(req.query);

  const conditions = [eq(chatResultsTable.sessionId, sessionId)];

  if (query.verdict) {
    conditions.push(eq(chatResultsTable.verdict, query.verdict as "keep" | "filter" | "pending" | "error"));
  }

  if (query.status) {
    conditions.push(eq(chatResultsTable.status, query.status as "pending" | "fetching" | "analyzing" | "done" | "error" | "skipped"));
  }

  const chats = await db
    .select()
    .from(chatResultsTable)
    .where(and(...conditions))
    .orderBy(chatResultsTable.id);

  res.json(chats.map(formatChat));
});

router.get("/sessions/:sessionId/summary", async (req, res) => {
  const { sessionId } = GetSessionSummaryParams.parse({ sessionId: Number(req.params.sessionId) });

  const chats = await db
    .select()
    .from(chatResultsTable)
    .where(eq(chatResultsTable.sessionId, sessionId));

  const keep = chats.filter((c) => c.verdict === "keep").length;
  const filter = chats.filter((c) => c.verdict === "filter").length;
  const errors = chats.filter((c) => c.verdict === "error").length;
  const pending = chats.filter((c) => c.verdict === "pending").length;
  const processed = chats.filter((c) => c.status === "done" || c.status === "error" || c.status === "skipped").length;

  const scored = chats.filter((c) => c.score !== null);
  const avgScore = scored.length > 0
    ? scored.reduce((sum, c) => sum + (c.score ?? 0), 0) / scored.length
    : null;

  const spamScored = chats.filter((c) => c.spamScore !== null);
  const avgSpamScore = spamScored.length > 0
    ? spamScored.reduce((sum, c) => sum + (c.spamScore ?? 0), 0) / spamScored.length
    : null;

  res.json({
    sessionId,
    total: chats.length,
    processed,
    keep,
    filter,
    errors,
    pending,
    avgScore: avgScore !== null ? Math.round(avgScore * 10) / 10 : null,
    avgSpamScore: avgSpamScore !== null ? Math.round(avgSpamScore * 10) / 10 : null,
  });
});

router.get("/sessions/:sessionId/export", async (req, res) => {
  const { sessionId } = ExportSessionParams.parse({ sessionId: Number(req.params.sessionId) });
  const query = ExportSessionQueryParams.parse(req.query);

  const targetVerdict = query.verdict ?? "keep";

  let chats;
  if (targetVerdict === "all") {
    chats = await db
      .select()
      .from(chatResultsTable)
      .where(eq(chatResultsTable.sessionId, sessionId))
      .orderBy(chatResultsTable.id);
  } else {
    chats = await db
      .select()
      .from(chatResultsTable)
      .where(
        and(
          eq(chatResultsTable.sessionId, sessionId),
          eq(chatResultsTable.verdict, targetVerdict as "keep" | "filter")
        )
      )
      .orderBy(chatResultsTable.id);
  }

  const header = "chat_identifier,chat_title,chat_username,members_count,country,verdict,score,spam_score,activity_score,topic_score,summary";
  const rows = chats.map((c) => [
    csvEscape(c.chatIdentifier),
    csvEscape(c.chatTitle ?? ""),
    csvEscape(c.chatUsername ? `@${c.chatUsername}` : ""),
    c.membersCount ?? "",
    csvEscape(c.country ?? ""),
    c.verdict ?? "",
    c.score ?? "",
    c.spamScore ?? "",
    c.activityScore ?? "",
    c.topicScore ?? "",
    csvEscape(c.aiSummary ?? ""),
  ].join(","));

  const csv = [header, ...rows].join("\n");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(csv);
});

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatSession(session: typeof sessionsTable.$inferSelect) {
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    totalChats: session.totalChats,
    processedChats: session.processedChats,
    delaySeconds: session.delaySeconds,
    messagesCount: session.messagesCount,
    autoRestart: session.autoRestart,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function formatChat(chat: typeof chatResultsTable.$inferSelect) {
  return {
    id: chat.id,
    sessionId: chat.sessionId,
    chatIdentifier: chat.chatIdentifier,
    chatTitle: chat.chatTitle ?? null,
    chatUsername: chat.chatUsername ?? null,
    membersCount: chat.membersCount ?? null,
    status: chat.status,
    verdict: chat.verdict,
    score: chat.score ?? null,
    spamScore: chat.spamScore ?? null,
    activityScore: chat.activityScore ?? null,
    topicScore: chat.topicScore ?? null,
    aiSummary: chat.aiSummary ?? null,
    country: chat.country ?? null,
    errorMessage: chat.errorMessage ?? null,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

export default router;
