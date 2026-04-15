import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
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
 * Be strict to avoid false positives from proxy/network errors.
 */
export function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const msg = String(e.message || e.errorMessage || "").toUpperCase();
  
  // Only match specific Telegram API error codes
  const telegramAuthErrors = [
    "AUTH_KEY_UNREGISTERED",
    "AUTH_KEY_INVALID", 
    "AUTH_KEY_PERM_EMPTY",
    "SESSION_REVOKED",
    "SESSION_EXPIRED",
    "USER_DEACTIVATED",
    "USER_DEACTIVATED_BAN",
  ];
  
  return telegramAuthErrors.some(code => msg.includes(code));
}

// Lock to prevent concurrent client creation for the same account
const connectingLocks = new Map<number, Promise<TelegramClient>>();

export function getClientForAccount(account: TelegramAccount): Promise<TelegramClient> {
  const existing = connectingLocks.get(account.id);
  if (existing) return existing;

  const promise = _getClientForAccount(account).finally(() => {
    connectingLocks.delete(account.id);
  });
  connectingLocks.set(account.id, promise);
  return promise;
}

async function _getClientForAccount(account: TelegramAccount): Promise<TelegramClient> {
  // First, disconnect ALL other clients to prevent AUTH_KEY_DUPLICATED
  for (const [id, entry] of clientPool) {
    if (id !== account.id) {
      try { await entry.client.disconnect(); } catch {}
      clientPool.delete(id);
    }
  }

  const cached = clientPool.get(account.id);
  
  // Check if cached client is still connected
  if (cached) {
    try {
      if (cached.client.connected) {
        return cached.client;
      }
    } catch {}
    // Client disconnected or errored — clean up
    try { await cached.client.disconnect(); } catch {}
    clientPool.delete(account.id);
  }

  const apiId = parseInt(account.apiId, 10);
  if (!apiId || !account.apiHash || !account.session) {
    throw new Error(`Аккаунт #${account.id} (${account.label}) не настроен корректно`);
  }

  const session = new StringSession(account.session);
  
  // Build client options
  const clientOptions: ConstructorParameters<typeof TelegramClient>[3] = {
    connectionRetries: 5,
    retryDelay: 3000,
    autoReconnect: true,
    requestRetries: 5,
    floodSleepThreshold: 0, // Don't auto-sleep, we handle FloodWait ourselves
    sequentialUpdates: true,
  };

  // Add SOCKS5 proxy if configured (gramjs native proxy support)
  if (account.proxyHost && account.proxyPort) {
    clientOptions.proxy = {
      socksType: 5,
      ip: account.proxyHost,
      port: account.proxyPort,
      username: account.proxyUsername || undefined,
      password: account.proxyPassword || undefined,
    };
    logger.info({ accountId: account.id, label: account.label, proxyHost: account.proxyHost, proxyPort: account.proxyPort }, "Используем SOCKS5 прокси");
  }

  const client = new TelegramClient(session, apiId, account.apiHash, clientOptions);

  try {
    await client.connect();
    clientPool.set(account.id, { client, connected: true });
    logger.info({ accountId: account.id, label: account.label }, "Telegram клиент подключён");
    return client;
  } catch (err) {
    // Clean up on connection failure
    try { client.disconnect(); } catch {}
    logger.error({ err, accountId: account.id }, "Ошибка подключения Telegram клиента");
    throw err;
  }
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

  const entity = await tg.getEntity(cleanIdentifier);

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

  for await (const msg of iter) {
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

  const entity = await tg.getEntity(cleanIdentifier);

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

  for await (const msg of iter) {
    if (msg.message && msg.message.trim().length > 0) {
      messages.push(msg.message.trim());
    }
  }

  return { title, username, membersCount, messages };
}
