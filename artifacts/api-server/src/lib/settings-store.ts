import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getSettingValue(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

export async function setSettingValue(key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
