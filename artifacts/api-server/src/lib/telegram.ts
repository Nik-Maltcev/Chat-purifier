import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { SocksProxyAgent } from "socks-proxy-agent";
import { logger } from "./logger.js";
import type { TelegramAccount } from "./account-manager.js";

// Per-account client pool
const clientPool = new Map<number, { client: TelegramClient; connected: boolean }>();

/**
 * Detect if an error is a FloodWait and return wait seconds, or null.
 */
export function getFloodWaitSeconds(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  if (typeof e.seconds === "number") return e.seconds;
  const msg = String(e.message || "");
  const m = msg.match(/FLOOD_WAIT[_\s]+(\d+)/i);
  if (m) return parseInt(m[1], 10);
  const em = String(e.errorMessage || "");
  const m2 = em.match(/FLOOD_WAIT[_\s]+(\d+)/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

/**
 * Check if an error looks like an auth/banned error.
 */
export function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const msg = String(e.message || e.errorMessage || "");
  return /auth_key|session_revoked|user_deactivated|banned|unauthorized/i.test(msg);
}

export async function getClientForAccount(account: TelegramAccount): Promise<TelegramClient> {
  const cached = clientPool.get(account.id);
  if (cached?.connected) return cached.client;

  const apiId = parseInt(account.apiId, 10);
  if (!apiId || !account.apiHash || !account.session) {
    throw new Error(`Аккаунт #${account.id} (${account.label}) не настроен корректно`);
  }

  // Disconnect old client if exists
  if (cached) {
    try { cached.client.disconnect(); } catch {}
  }

  const session = new StringSession(account.session);
  
  // Build client options
  const clientOptions: ConstructorParameters<typeof TelegramClient>[3] = {
    connectionRetries: 5,
    retryDelay: 3000,
    autoReconnect: true,
    requestRetries: 5,
    floodSleepThreshold: 120,
    sequentialUpdates: true,
  };

  // Add SOCKS5 proxy if configured
  if (account.proxyHost && account.proxyPort) {
    const proxyUrl = account.proxyUsername && account.proxyPassword
      ? `socks5://${account.proxyUsername}:${account.proxyPassword}@${account.proxyHost}:${account.proxyPort}`
      : `socks5://${account.proxyHost}:${account.proxyPort}`;
    
    const agent = new SocksProxyAgent(proxyUrl);
    clientOptions.networkSocket = agent as unknown as typeof clientOptions.networkSocket;
    logger.info({ accountId: account.id, label: account.label, proxyHost: account.proxyHost }, "Используем SOCKS5 прокси");
  }

  const client = new TelegramClient(session, apiId, account.apiHash, clientOptions);

  await client.connect();
  clientPool.set(account.id, { client, connected: true });
  logger.info({ accountId: account.id, label: account.label }, "Telegram клиент подключён");

  return client;
}

export function disconnectClientForAccount(accountId: number): void {
  const cached = clientPool.get(accountId);
  if (cached) {
    try { cached.client.disconnect(); } catch {}
    clientPool.delete(accountId);
    logger.info({ accountId }, "Telegram клиент отключён");
  }
}

export function resetAllClients(): void {
  for (const [id, entry] of clientPool) {
    try { entry.client.disconnect(); } catch {}
  }
  clientPool.clear();
  logger.info("Все Telegram клиенты сброшены");
}

/**
 * Wraps a promise with a timeout. Rejects if the promise doesn't resolve within the given time.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout: ${operation} took longer than ${Math.round(ms / 1000)}s`));
    }, ms);
    promise
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

export async function fetchChatMessages(
  chatIdentifier: string,
  messagesCount: number,
  account: TelegramAccount
): Promise<{
  title: string | null;
  username: string | null;
  membersCount: number | null;
  messages: string[];
}> {
  const tg = await getClientForAccount(account);

  const cleanIdentifier = chatIdentifier
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^t\.me\//i, "")
    .replace(/^@/, "")
    .trim();

  // 30 second timeout for getEntity
  const entity = await withTimeout(
    tg.getEntity(cleanIdentifier),
    30_000,
    `getEntity(${cleanIdentifier})`
  );

  let title: string | null = null;
  let username: string | null = null;
  let membersCount: number | null = null;

  if ("title" in entity) title = (entity as { title?: string }).title ?? null;
  if ("username" in entity) username = (entity as { username?: string }).username ?? null;
  if ("participantsCount" in entity) {
    membersCount = (entity as { participantsCount?: number }).participantsCount ?? null;
  }

  const messages: string[] = [];
  const iter = tg.iterMessages(entity, { limit: messagesCount });

  // 2 minute timeout for fetching all messages
  const startTime = Date.now();
  const maxDuration = 120_000; // 2 minutes max for message fetching

  for await (const msg of iter) {
    if (Date.now() - startTime > maxDuration) {
      logger.warn({ chatIdentifier, fetchedCount: messages.length }, "Message fetch timeout - returning partial results");
      break;
    }
    if (msg.message && msg.message.trim().length > 0) {
      messages.push(msg.message.trim());
    }
  }

  return { title, username, membersCount, messages };
}

// Legacy: kept for telegram-folders.ts which still uses settings-based client
import { getSettingValue } from "./settings-store.js";

let legacyClient: TelegramClient | null = null;
let legacyConnected = false;

export function resetTelegramClient(): void {
  if (legacyClient) {
    try { legacyClient.disconnect(); } catch {}
  }
  legacyClient = null;
  legacyConnected = false;
  resetAllClients();
}

export async function getTelegramClient(): Promise<TelegramClient> {
  if (legacyClient && legacyConnected) return legacyClient;

  const apiIdStr = await getSettingValue("telegram_api_id") || process.env.TELEGRAM_APP_ID || "";
  const apiHash = await getSettingValue("telegram_api_hash") || process.env.TELEGRAM_APP_HASH || "";
  const sessionString = await getSettingValue("telegram_session") || process.env.TELEGRAM_SESSION || "";
  const apiId = parseInt(apiIdStr, 10);

  if (!apiId || !apiHash || !sessionString) {
    throw new Error("Telegram API не настроен. Зайдите в Настройки.");
  }

  const session = new StringSession(sessionString);
  legacyClient = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    retryDelay: 3000,
    autoReconnect: true,
    requestRetries: 5,
    floodSleepThreshold: 120,
    sequentialUpdates: true,
  });

  await legacyClient.connect();
  legacyConnected = true;
  logger.info("Telegram legacy client connected");
  return legacyClient;
}

/**
 * Legacy version of fetchChatMessages that uses settings-based single account.
 */
export async function fetchChatMessagesLegacy(
  chatIdentifier: string,
  messagesCount: number
): Promise<{
  title: string | null;
  username: string | null;
  membersCount: number | null;
  messages: string[];
}> {
  const tg = await getTelegramClient();

  const cleanIdentifier = chatIdentifier
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^t\.me\//i, "")
    .replace(/^@/, "")
    .trim();

  // 30 second timeout for getEntity
  const entity = await withTimeout(
    tg.getEntity(cleanIdentifier),
    30_000,
    `getEntity(${cleanIdentifier})`
  );

  let title: string | null = null;
  let username: string | null = null;
  let membersCount: number | null = null;

  if ("title" in entity) title = (entity as { title?: string }).title ?? null;
  if ("username" in entity) username = (entity as { username?: string }).username ?? null;
  if ("participantsCount" in entity) {
    membersCount = (entity as { participantsCount?: number }).participantsCount ?? null;
  }

  const messages: string[] = [];
  const iter = tg.iterMessages(entity, { limit: messagesCount });

  // 2 minute timeout for fetching all messages
  const startTime = Date.now();
  const maxDuration = 120_000; // 2 minutes max for message fetching

  for await (const msg of iter) {
    if (Date.now() - startTime > maxDuration) {
      logger.warn({ chatIdentifier, fetchedCount: messages.length }, "Message fetch timeout - returning partial results");
      break;
    }
    if (msg.message && msg.message.trim().length > 0) {
      messages.push(msg.message.trim());
    }
  }

  return { title, username, membersCount, messages };
}
