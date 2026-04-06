import { Api, TelegramClient } from "telegram";
import { getTelegramClient } from "./telegram.js";
import { logger } from "./logger.js";

export interface ExtractedChat {
  identifier: string;
  title: string | null;
  username: string | null;
  type: "channel" | "group" | "supergroup" | "unknown";
}

export interface FolderExtractResult {
  folderLink: string;
  folderTitle: string | null;
  chats: ExtractedChat[];
  error: string | null;
}

function extractAddlistSlug(link: string): string | null {
  const cleaned = link.trim();
  const match = cleaned.match(/(?:https?:\/\/)?t\.me\/addlist\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

export async function extractChatsFromFolderLink(folderLink: string): Promise<FolderExtractResult> {
  const slug = extractAddlistSlug(folderLink);

  if (!slug) {
    return {
      folderLink,
      folderTitle: null,
      chats: [],
      error: "Invalid folder link. Expected format: t.me/addlist/SLUG",
    };
  }

  try {
    const tg = await getTelegramClient();

    const result = await tg.invoke(
      new Api.chatlists.CheckChatlistInvite({ slug })
    );

    logger.info({ slug, resultType: result.className }, "Folder invite check result");

    const chats: ExtractedChat[] = [];
    let folderTitle: string | null = null;

    if (result instanceof Api.chatlists.ChatlistInviteAlready) {
      folderTitle = (result.filter as { title?: { text?: string } } | undefined)?.title?.text ?? null;
      for (const peer of (result.alreadyPeers || [])) {
        const chat = peerToExtractedChat(peer);
        if (chat) chats.push(chat);
      }
      for (const peer of (result.missingPeers || [])) {
        const chat = peerToExtractedChat(peer);
        if (chat) chats.push(chat);
      }
    } else if (result instanceof Api.chatlists.ChatlistInvite) {
      folderTitle = (result as { title?: string | { text?: string } }).title
        ? typeof (result as { title: string | { text?: string } }).title === "string"
          ? (result as { title: string }).title
          : ((result as { title: { text?: string } }).title.text ?? null)
        : null;
      for (const peer of (result.peers || [])) {
        const chat = peerToExtractedChat(peer);
        if (chat) chats.push(chat);
      }
    }

    logger.info({ slug, folderTitle, chatCount: chats.length }, "Extracted chats from folder");

    return {
      folderLink,
      folderTitle,
      chats,
      error: null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, folderLink }, "Failed to extract chats from folder");
    return {
      folderLink,
      folderTitle: null,
      chats: [],
      error: errMsg.slice(0, 500),
    };
  }
}

function peerToExtractedChat(
  peer: Api.TypeChat | Api.TypeUser
): ExtractedChat | null {
  try {
    if (peer instanceof Api.Channel) {
      const username = peer.username ?? null;
      const identifier = username
        ? `@${username}`
        : null;

      if (!identifier) return null;

      return {
        identifier,
        title: peer.title ?? null,
        username,
        type: peer.megagroup ? "supergroup" : "channel",
      };
    }

    if (peer instanceof Api.Chat) {
      return null;
    }

    return null;
  } catch (err) {
    logger.warn({ err }, "Failed to process peer");
    return null;
  }
}
