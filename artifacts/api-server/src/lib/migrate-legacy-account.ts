/**
 * Auto-migration: if telegram_accounts table is empty and old settings have
 * telegram credentials, create "Аккаунт 1" automatically.
 */
import { db, telegramAccountsTable } from "@workspace/db";
import { getAllSettings } from "./settings-store.js";
import { logger } from "./logger.js";

let migrationDone = false;

export async function migrateLegacyAccountIfNeeded(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;

  try {
    const existing = await db.select().from(telegramAccountsTable);
    if (existing.length > 0) return; // Already has accounts

    const settings = await getAllSettings();
    const apiId = settings["telegram_api_id"] || "";
    const apiHash = settings["telegram_api_hash"] || "";
    const session = settings["telegram_session"] || "";

    if (!apiId || !apiHash || !session) return; // Nothing to migrate

    await db.insert(telegramAccountsTable).values({
      label: "Аккаунт 1",
      apiId,
      apiHash,
      session,
      status: "active",
      priority: 0,
    });

    logger.info("Автомиграция: настройки Telegram перенесены в таблицу аккаунтов (Аккаунт 1)");
  } catch (err) {
    logger.error({ err }, "Ошибка автомиграции аккаунта");
  }
}
