import { Api } from "telegram";
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

function extractTitle(titleField: unknown): string | null {
  if (!titleField) return null;
  if (typeof titleField === "string") return titleField;
  if (typeof titleField === "object" && titleField !== null && "text" in titleField) {
    return (titleField as { text?: string }).text ?? null;
  }
  return null;
}

function chatObjectToExtracted(
  peer: Api.TypeChat | Api.TypeUser
): ExtractedChat | null {
  try {
    if (peer instanceof Api.Channel) {
      const username = peer.username ?? null;

      // channels/supergroups with username can be accessed by @username
      // those without username are private — skip them (can't join by identifier)
      if (!username) {
        logger.debug({ id: peer.id?.toString(), title: peer.title }, "Skipping private channel (no username)");
        return null;
      }

      return {
        identifier: `@${username}`,
        title: peer.title ?? null,
        username,
        type: peer.megagroup ? "supergroup" : "channel",
      };
    }

    if (peer instanceof Api.Chat) {
      // Regular groups are private, skip
      return null;
    }

    return null;
  } catch (err) {
    logger.warn({ err }, "Failed to process peer");
    return null;
  }
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

    logger.info(
      {
        slug,
        resultType: result.className,
        // Log available keys for debugging
        keys: Object.keys(result),
      },
      "Folder invite check result"
    );

    const chats: ExtractedChat[] = [];
    let folderTitle: string | null = null;

    if (result instanceof Api.chatlists.ChatlistInviteAlready) {
      folderTitle = extractTitle((result.filter as { title?: unknown } | undefined)?.title);

      // The actual chat objects are in result.chats and result.users
      // result.alreadyPeers and result.missingPeers are just TypePeer references
      const chatObjects = (result as unknown as { chats?: Api.TypeChat[]; users?: Api.TypeUser[] });
      const allObjects = [
        ...(chatObjects.chats ?? []),
        ...(chatObjects.users ?? []),
      ];

      logger.info({ slug, objectCount: allObjects.length }, "ChatlistInviteAlready chat objects");

      for (const obj of allObjects) {
        const chat = chatObjectToExtracted(obj as Api.TypeChat);
        if (chat) chats.push(chat);
      }
    } else if (result instanceof Api.chatlists.ChatlistInvite) {
      folderTitle = extractTitle((result as unknown as { title?: unknown }).title);

      // result.peers is TypePeer[] references; full objects are in result.chats / result.users
      const chatObjects = (result as unknown as { chats?: Api.TypeChat[]; users?: Api.TypeUser[] });
      const allObjects = [
        ...(chatObjects.chats ?? []),
        ...(chatObjects.users ?? []),
      ];

      logger.info(
        {
          slug,
          peerCount: result.peers?.length,
          chatObjectCount: allObjects.length,
          folderTitle,
        },
        "ChatlistInvite objects breakdown"
      );

      for (const obj of allObjects) {
        const chat = chatObjectToExtracted(obj as Api.TypeChat);
        if (chat) chats.push(chat);
      }
    } else {
      logger.warn({ slug, resultType: result.className }, "Unknown result type from CheckChatlistInvite");
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
