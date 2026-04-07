import { Router } from "express";
import { getAllSettings, setSettingValue } from "../lib/settings-store.js";
import { resetTelegramClient } from "../lib/telegram.js";

const router = Router();

const SENSITIVE_KEYS = ["telegram_api_id", "telegram_api_hash", "telegram_session", "deepseek_api_key"];

router.get("/settings", async (_req, res) => {
  const all = await getAllSettings();
  const masked: Record<string, string> = {};
  for (const key of SENSITIVE_KEYS) {
    const val = all[key] ?? "";
    if (key === "telegram_session" && val.length > 10) {
      masked[key] = val.slice(0, 6) + "..." + val.slice(-4);
    } else if ((key === "deepseek_api_key" || key === "telegram_api_hash") && val.length > 8) {
      masked[key] = val.slice(0, 4) + "..." + val.slice(-4);
    } else {
      masked[key] = val;
    }
  }
  masked["default_delay_seconds"] = all["default_delay_seconds"] ?? "30";
  masked["default_messages_count"] = all["default_messages_count"] ?? "50";
  res.json(masked);
});

router.get("/settings/raw", async (_req, res) => {
  const all = await getAllSettings();
  const out: Record<string, string> = {};
  for (const key of SENSITIVE_KEYS) {
    out[key] = all[key] ?? "";
  }
  out["default_delay_seconds"] = all["default_delay_seconds"] ?? "30";
  out["default_messages_count"] = all["default_messages_count"] ?? "50";
  res.json(out);
});

router.post("/settings", async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const allowed = [...SENSITIVE_KEYS, "default_delay_seconds", "default_messages_count"];
  let telegramChanged = false;

  for (const key of allowed) {
    if (key in body && typeof body[key] === "string") {
      const val = (body[key] as string).trim();
      if (val !== "") {
        await setSettingValue(key, val);
        if (["telegram_api_id", "telegram_api_hash", "telegram_session"].includes(key)) {
          telegramChanged = true;
        }
      }
    }
  }

  if (telegramChanged) {
    resetTelegramClient();
  }

  res.json({ ok: true });
});

export default router;
