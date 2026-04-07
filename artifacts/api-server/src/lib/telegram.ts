import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { logger } from "./logger.js";
import { getSettingValue } from "./settings-store.js";

let client: TelegramClient | null = null;
let clientConnected = false;

export function resetTelegramClient(): void {
  if (client) {
    try { client.disconnect(); } catch {}
  }
  client = null;
  clientConnected = false;
  logger.info("Telegram client reset (credentials changed)");
}

export async function getTelegramClient(): Promise<TelegramClient> {
  if (client && clientConnected) {
    return client;
  }

  const apiIdStr = await getSettingValue("telegram_api_id") || process.env.TELEGRAM_APP_ID || "";
  const apiHash = await getSettingValue("telegram_api_hash") || process.env.TELEGRAM_APP_HASH || "";
  const sessionString = await getSettingValue("telegram_session") || process.env.TELEGRAM_SESSION || "";
  const apiId = parseInt(apiIdStr, 10);

  if (!apiId || !apiHash || !sessionString) {
    throw new Error("Telegram API не настроен. Зайдите в Настройки и укажите App ID, App Hash и Session.");
  }

  const session = new StringSession(sessionString);
  client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    retryDelay: 2000,
    autoReconnect: true,
    requestRetries: 3,
  });

  await client.connect();
  clientConnected = true;
  logger.info("Telegram client connected");

  return client;
}

export async function fetchChatMessages(chatIdentifier: string, messagesCount: number): Promise<{
  title: string | null;
  username: string | null;
  membersCount: number | null;
  messages: string[];
}> {
  const tg = await getTelegramClient();

  const cleanIdentifier = chatIdentifier
    .replace("https://t.me/", "")
    .replace("http://t.me/", "")
    .replace("t.me/", "")
    .replace("@", "")
    .trim();

  const entity = await tg.getEntity(cleanIdentifier);

  let title: string | null = null;
  let username: string | null = null;
  let membersCount: number | null = null;

  if ("title" in entity) {
    title = (entity as { title?: string }).title ?? null;
  }
  if ("username" in entity) {
    username = (entity as { username?: string }).username ?? null;
  }
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
