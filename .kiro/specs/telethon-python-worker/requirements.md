# Requirements Document

## Introduction

Данная фича заменяет текущую реализацию Telegram-клиента на базе gramjs (Node.js) на отдельный Python-воркер, использующий библиотеку Telethon. Node.js API-сервер остаётся без изменений и продолжает управлять сессиями, аккаунтами и результатами через базу данных. Python-воркер берёт на себя всю работу с Telegram MTProto: получение сообщений из чатов, извлечение чатов из папок (addlist), управление подключениями и обработку FloodWait/бан-ошибок. Взаимодействие между Node.js API и Python-воркером осуществляется через общую базу данных PostgreSQL.

## Glossary

- **Worker**: Python-процесс на базе Telethon, выполняющий запросы к Telegram MTProto API.
- **API_Server**: Существующий Node.js/Express сервер, управляющий сессиями, аккаунтами и результатами.
- **Telethon**: Python-библиотека для работы с Telegram MTProto API.
- **TelegramAccount**: Запись в таблице `telegram_accounts` БД, содержащая `api_id`, `api_hash`, `session`, настройки прокси и статус.
- **ChatResult**: Запись в таблице `chat_results` БД, описывающая один чат в рамках сессии.
- **Session**: Запись в таблице `sessions` БД, описывающая задание на обработку списка чатов.
- **FloodWait**: Ошибка Telegram API, требующая паузы перед следующим запросом.
- **StringSession**: Строковое представление Telegram-сессии, совместимое между gramjs и Telethon.
- **SOCKS5_Proxy**: Прокси-сервер типа SOCKS5, настраиваемый на уровне аккаунта.
- **MTProto**: Протокол Telegram для взаимодействия с API.

---

## Requirements

### Requirement 1: Инициализация и подключение воркера

**User Story:** As a system operator, I want the Python worker to start up and connect to Telegram using accounts from the database, so that it can process chat requests without manual intervention.

#### Acceptance Criteria

1. WHEN the Worker starts, THE Worker SHALL read all TelegramAccount records with `status = 'active'` from the database.
2. WHEN a TelegramAccount has `proxy_host` and `proxy_port` set, THE Worker SHALL establish the Telegram connection through the specified SOCKS5_Proxy.
3. IF a TelegramAccount has an empty or invalid `session` string, THEN THE Worker SHALL log an error for that account and skip it without crashing.
4. IF a TelegramAccount has an empty `api_id` or `api_hash`, THEN THE Worker SHALL log an error for that account and skip it without crashing.
5. THE Worker SHALL maintain a per-account Telethon client pool, reusing existing connected clients across requests.
6. WHEN a Telethon client disconnects unexpectedly, THE Worker SHALL attempt to reconnect up to 5 times with a 3-second delay between attempts before marking the account as unavailable.

---

### Requirement 2: Совместимость строковых сессий

**User Story:** As a developer, I want the Python worker to reuse existing Telegram session strings stored in the database, so that accounts do not need to be re-authenticated.

#### Acceptance Criteria

1. THE Worker SHALL accept session strings in the gramjs `StringSession` format stored in the `telegram_accounts.session` column.
2. WHEN a session string is loaded, THE Worker SHALL use Telethon's `StringSession` to initialise the client without triggering a new authentication flow.
3. IF a session string is invalid or expired, THEN THE Worker SHALL mark the corresponding TelegramAccount as `status = 'banned'` in the database and log the error.
4. THE Worker SHALL NOT modify or overwrite the session string in the database after a successful connection.

---

### Requirement 3: Получение сообщений из чата

**User Story:** As the processing pipeline, I want the Python worker to fetch recent messages from a Telegram chat, so that the AI analysis step has content to evaluate.

#### Acceptance Criteria

1. WHEN the Worker receives a fetch request for a `chat_identifier`, THE Worker SHALL resolve the identifier to a Telegram entity and return `title`, `username`, `members_count`, up to `messages_count` recent text messages, and `last_message_date`.
2. THE Worker SHALL accept `chat_identifier` values in the following formats: `@username`, `https://t.me/username`, `t.me/username`, and bare `username`.
3. WHEN a chat has no accessible text messages, THE Worker SHALL return an empty messages list without raising an error.
4. IF the Telegram API returns a FloodWait error during message fetching, THEN THE Worker SHALL propagate the FloodWait error including the wait duration in seconds to the caller.
5. IF the Telegram API returns an auth error (AUTH_KEY_UNREGISTERED, SESSION_REVOKED, USER_DEACTIVATED, USER_DEACTIVATED_BAN, AUTH_KEY_INVALID, AUTH_KEY_PERM_EMPTY, SESSION_EXPIRED), THEN THE Worker SHALL propagate the auth error to the caller.
6. WHEN fetching messages, THE Worker SHALL skip messages with empty or whitespace-only text.

---

### Requirement 5: Управление аккаунтами и FloodWait

**User Story:** As the processing pipeline, I want the Python worker to handle FloodWait and auth errors by updating account status in the database, so that the Node.js processor can switch accounts automatically.

#### Acceptance Criteria

1. WHEN a FloodWait error occurs for a TelegramAccount, THE Worker SHALL update `telegram_accounts.status = 'flood_wait'` and set `flood_wait_until` to the current time plus the wait duration in seconds.
2. WHEN an auth error occurs for a TelegramAccount, THE Worker SHALL update `telegram_accounts.status = 'banned'` in the database.
3. WHEN a TelegramAccount's `flood_wait_until` timestamp has passed, THE Worker SHALL automatically reset `status = 'active'` and clear `flood_wait_until` before selecting that account for a new request.
4. THE Worker SHALL select the TelegramAccount with the highest `priority` value among all accounts with `status = 'active'` for each new request.
5. IF no TelegramAccount with `status = 'active'` is available, THEN THE Worker SHALL return an error response indicating that all accounts are unavailable.
6. WHEN a TelegramAccount is marked as `flood_wait` or `banned`, THE Worker SHALL disconnect and remove the corresponding Telethon client from the client pool.

---

### Requirement 6: Интерфейс взаимодействия с API-сервером

**User Story:** As the Node.js API server, I want to delegate Telegram operations to the Python worker via a well-defined HTTP interface, so that the existing processor logic requires minimal changes.

#### Acceptance Criteria

1. THE Worker SHALL expose an HTTP API on a configurable port (default 8001) with the following endpoints:
   - `POST /fetch-messages` — fetch messages from a chat
   - `GET /health` — liveness check
2. WHEN `POST /fetch-messages` is called with `{ "chat_identifier": string, "messages_count": number, "account_id": number }`, THE Worker SHALL return `{ "title", "username", "members_count", "messages", "last_message_date" }`.
3. WHEN `GET /health` is called, THE Worker SHALL return `{ "status": "ok" }` with HTTP 200.
4. IF a request body is missing required fields, THEN THE Worker SHALL return HTTP 400 with a JSON error message.
5. IF an unhandled exception occurs during request processing, THEN THE Worker SHALL return HTTP 500 with a JSON error message and log the full traceback.

---

### Requirement 7: Конфигурация и запуск

**User Story:** As a system operator, I want to configure and start the Python worker using environment variables, so that it integrates cleanly into the existing deployment setup.

#### Acceptance Criteria

1. THE Worker SHALL read the database connection string from the `DATABASE_URL` environment variable.
2. THE Worker SHALL read the HTTP listen port from the `WORKER_PORT` environment variable, defaulting to `8001` if not set.
3. THE Worker SHALL read the log level from the `LOG_LEVEL` environment variable, defaulting to `INFO` if not set.
4. IF the `DATABASE_URL` environment variable is not set, THEN THE Worker SHALL exit with a non-zero exit code and log a descriptive error message.
5. THE Worker SHALL provide a `requirements.txt` (or `pyproject.toml`) listing all Python dependencies with pinned versions.
6. THE Worker SHALL be startable with a single command: `python worker.py` from the worker's root directory.

---

### Requirement 8: Логирование

**User Story:** As a developer, I want the Python worker to produce structured logs, so that I can diagnose issues in production.

#### Acceptance Criteria

1. THE Worker SHALL emit structured JSON log lines to stdout when `LOG_LEVEL=INFO` or higher.
2. WHEN a Telegram client connects successfully, THE Worker SHALL log the account ID and label at INFO level.
3. WHEN a FloodWait error occurs, THE Worker SHALL log the account ID, wait duration in seconds, and proxy host (if configured) at WARNING level.
4. WHEN an auth error occurs, THE Worker SHALL log the account ID and error code at ERROR level.
5. WHEN an unhandled exception occurs, THE Worker SHALL log the full traceback at ERROR level.
6. THE Worker SHALL NOT log raw session strings, API hashes, or proxy passwords in any log line.
