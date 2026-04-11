import { Router } from "express";
import { db, telegramAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { disconnectClientForAccount } from "../lib/telegram.js";
import { markAccountActive } from "../lib/account-manager.js";

const router = Router();

function maskSession(session: string): string {
  if (session.length <= 10) return session;
  return session.slice(0, 6) + "..." + session.slice(-4);
}

function maskHash(hash: string): string {
  if (hash.length <= 8) return hash;
  return hash.slice(0, 4) + "..." + hash.slice(-4);
}

router.get("/accounts", async (_req, res) => {
  const accounts = await db.select().from(telegramAccountsTable)
    .orderBy(telegramAccountsTable.priority);
  const masked = accounts.map((a) => ({
    id: a.id,
    label: a.label,
    apiId: a.apiId,
    apiHash: maskHash(a.apiHash),
    session: maskSession(a.session),
    status: a.status,
    floodWaitUntil: a.floodWaitUntil,
    priority: a.priority,
    proxyHost: a.proxyHost,
    proxyPort: a.proxyPort,
    proxyUsername: a.proxyUsername,
    proxyPassword: a.proxyPassword ? "***" : null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
  res.json(masked);
});

router.post("/accounts", async (req, res) => {
  const { label, apiId, apiHash, session, priority, proxyHost, proxyPort, proxyUsername, proxyPassword } = req.body as Record<string, string>;
  if (!apiId || !apiHash || !session) {
    res.status(400).json({ error: "apiId, apiHash, session обязательны" });
    return;
  }
  const [created] = await db.insert(telegramAccountsTable).values({
    label: label?.trim() || "Аккаунт",
    apiId: apiId.trim(),
    apiHash: apiHash.trim(),
    session: session.trim(),
    priority: parseInt(priority || "0", 10) || 0,
    status: "active",
    proxyHost: proxyHost?.trim() || null,
    proxyPort: proxyPort ? parseInt(proxyPort, 10) || null : null,
    proxyUsername: proxyUsername?.trim() || null,
    proxyPassword: proxyPassword?.trim() || null,
  }).returning();
  res.json({ ok: true, id: created.id });
});

router.put("/accounts/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { label, apiId, apiHash, session, priority, status, proxyHost, proxyPort, proxyUsername, proxyPassword } = req.body as Record<string, string>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (label !== undefined) updates.label = label.trim();
  if (apiId !== undefined && apiId.trim()) updates.apiId = apiId.trim();
  if (apiHash !== undefined && apiHash.trim() && !apiHash.includes("...")) updates.apiHash = apiHash.trim();
  if (session !== undefined && session.trim() && !session.includes("...")) updates.session = session.trim();
  if (priority !== undefined) updates.priority = parseInt(priority, 10) || 0;
  if (status !== undefined && ["active", "disabled"].includes(status)) {
    updates.status = status;
    if (status === "active") updates.floodWaitUntil = null;
  }
  
  // Proxy settings - allow clearing by passing empty string
  if (proxyHost !== undefined) updates.proxyHost = proxyHost.trim() || null;
  if (proxyPort !== undefined) updates.proxyPort = proxyPort ? parseInt(proxyPort, 10) || null : null;
  if (proxyUsername !== undefined) updates.proxyUsername = proxyUsername.trim() || null;
  if (proxyPassword !== undefined && proxyPassword !== "***") updates.proxyPassword = proxyPassword.trim() || null;

  await db.update(telegramAccountsTable).set(updates as never).where(eq(telegramAccountsTable.id, id));

  // Reconnect client with new credentials
  disconnectClientForAccount(id);
  res.json({ ok: true });
});

router.delete("/accounts/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  disconnectClientForAccount(id);
  await db.delete(telegramAccountsTable).where(eq(telegramAccountsTable.id, id));
  res.json({ ok: true });
});

router.post("/accounts/:id/reset-ban", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await markAccountActive(id);
  disconnectClientForAccount(id);
  res.json({ ok: true });
});

export default router;
