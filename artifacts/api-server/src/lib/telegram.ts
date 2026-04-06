import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { logger } from "./logger.js";

let client: TelegramClient | null = null;
let clientConnected = false;

export async function getTelegramClient(): Promise<TelegramClient> {
  if (client && clientConnected) {
    return client;
  }

  const apiId = parseInt(process.env.TELEGRAM_APP_ID || "0", 10);
  const apiHash = process.env.TELEGRAM_APP_HASH || "";
  const sessionString = process.env.TELEGRAM_SESSION || "";

  if (!apiId || !apiHash || !sessionString) {
    throw new Error("Missing TELEGRAM_APP_ID, TELEGRAM_APP_HASH, or TELEGRAM_SESSION environment variables");
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
