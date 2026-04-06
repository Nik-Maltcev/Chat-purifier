import { Router } from "express";
import { extractChatsFromFolderLink } from "../lib/telegram-folders.js";

const router = Router();

router.post("/folders/extract", async (req, res) => {
  const { folderLinks } = req.body as { folderLinks?: unknown };

  if (!Array.isArray(folderLinks) || folderLinks.length === 0) {
    res.status(400).json({ error: "folderLinks must be a non-empty array of strings" });
    return;
  }

  const links = (folderLinks as unknown[])
    .filter((l) => typeof l === "string")
    .slice(0, 50) as string[];

  const results = [];

  for (const link of links) {
    const result = await extractChatsFromFolderLink(link.trim());
    results.push(result);
  }

  const allChats: string[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    for (const chat of result.chats) {
      const key = chat.identifier.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        allChats.push(chat.identifier);
      }
    }
  }

  res.json({
    results,
    allChats,
    totalUnique: allChats.length,
  });
});

export default router;
