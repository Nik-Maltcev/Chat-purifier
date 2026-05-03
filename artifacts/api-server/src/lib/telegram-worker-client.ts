import { logger } from "./logger.js";
import type { TelegramAccount } from "./account-manager.js";

const WORKER_URL = process.env.TELEGRAM_WORKER_URL ?? "http://localhost:8001";

export interface FetchMessagesResult {
  title: string | null;
  username: string | null;
  membersCount: number | null;
  messages: string[];
  lastMessageDate: Date | null;
}

interface WorkerSuccessBody {
  title: string | null;
  username: string | null;
  members_count: number | null;
  messages: string[];
  last_message_date: string | null;
}

interface WorkerErrorBody {
  error: string;
  detail?: string;
  wait_seconds?: number;
  account_id?: number;
  code?: string;
}

export async function fetchChatMessagesViaWorker(
  chatIdentifier: string,
  messagesCount: number,
  account: TelegramAccount
): Promise<FetchMessagesResult> {
  logger.debug(
    { workerUrl: WORKER_URL, accountId: account.id, chatIdentifier, messagesCount },
    "Sending fetch-messages request to Python worker"
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  let response: Response;
  try {
    response = await fetch(`${WORKER_URL}/fetch-messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_identifier: chatIdentifier,
        messages_count: messagesCount,
        account_id: account.id,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : "Worker network error";
    logger.error({ err, workerUrl: WORKER_URL, accountId: account.id }, "Network error calling Python worker");
    throw new Error(message);
  } finally {
    clearTimeout(timeoutId);
  }

  logger.info(
    { workerUrl: WORKER_URL, accountId: account.id, status: response.status },
    "Received response from Python worker"
  );

  if (response.status === 200) {
    const body = (await response.json()) as WorkerSuccessBody;
    return {
      title: body.title,
      username: body.username,
      membersCount: body.members_count,
      messages: body.messages,
      lastMessageDate: body.last_message_date ? new Date(body.last_message_date) : null,
    };
  }

  // Parse error body for all non-200 responses
  let errorBody: WorkerErrorBody | null = null;
  try {
    errorBody = (await response.json()) as WorkerErrorBody;
  } catch {
    // Body may not be JSON
  }

  switch (response.status) {
    case 429: {
      // FloodWait — throw object compatible with getFloodWaitSeconds() in telegram.ts
      // getFloodWaitSeconds() checks err.seconds (number)
      const waitSeconds = errorBody?.wait_seconds ?? 60;
      throw { seconds: waitSeconds };
    }

    case 401: {
      // Auth error — throw object compatible with isAuthError() in telegram.ts
      // isAuthError() checks err.message or err.errorMessage for auth error codes
      const code = errorBody?.code ?? "AUTH_KEY_UNREGISTERED";
      throw { message: code, errorMessage: code };
    }

    case 503: {
      throw new Error("no_accounts_available");
    }

    case 404: {
      throw new Error(`account_not_found: ${account.id}`);
    }

    default: {
      // 500 and any other unexpected status
      throw new Error(errorBody?.detail ?? `Worker error: ${response.status}`);
    }
  }
}
