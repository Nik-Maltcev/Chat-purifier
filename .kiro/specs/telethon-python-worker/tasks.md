# Implementation Plan: Telethon Python Worker

## Overview

Реализация Python-воркера на базе FastAPI + Telethon, заменяющего gramjs-клиент в Node.js API-сервере. Воркер предоставляет два HTTP-эндпоинта (`POST /fetch-messages`, `GET /health`) и взаимодействует с Node.js через HTTP. Node.js API-сервер получает новый модуль `telegram-worker-client.ts`, а `processor.ts` переключается с прямых вызовов gramjs на HTTP-запросы к воркеру.

## Tasks

- [x] 1. Создать структуру Python-воркера и конфигурацию
  - Создать директорию `python-worker/` с файлами: `worker.py`, `app.py`, `config.py`, `logger.py`, `models.py`, `requirements.txt`
  - В `config.py` реализовать чтение `DATABASE_URL` (обязательный, exit с ненулевым кодом если не задан), `WORKER_PORT` (default 8001), `LOG_LEVEL` (default INFO)
  - В `logger.py` настроить structlog для вывода JSON-строк в stdout
  - В `requirements.txt` зафиксировать версии: `telethon`, `fastapi`, `uvicorn[standard]`, `asyncpg`, `sqlalchemy[asyncio]`, `pydantic`, `structlog`, `hypothesis`, `pytest`, `pytest-asyncio`, `httpx`
  - В `worker.py` реализовать точку входа: запуск uvicorn с параметрами из `config.py`
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1_

- [x] 2. Реализовать Pydantic-модели и конвертацию сессий
  - [x] 2.1 Создать `models.py` с моделями `FetchMessagesRequest`, `FetchMessagesResponse`, `ErrorResponse`
    - `FetchMessagesRequest`: `chat_identifier: str`, `messages_count: int`, `account_id: int`
    - `FetchMessagesResponse`: `title`, `username`, `members_count`, `messages: list[str]`, `last_message_date`
    - `ErrorResponse`: `error: str`, опциональные `detail`, `wait_seconds`, `account_id`, `code`
    - _Requirements: 6.2, 6.4_

  - [x] 2.2 Создать `session_compat.py` с функцией `gramjs_to_telethon_session(gramjs_session: str) -> StringSession`
    - Если строка начинается с `"1"` — убрать первый символ (версионный префикс gramjs)
    - Вернуть `StringSession(raw)`
    - _Requirements: 2.1, 2.2_

  - [ ]* 2.3 Написать property-тест для конвертации сессий
    - **Property 8: Сессия не перезаписывается после успешного подключения**
    - **Validates: Requirements 2.4**
    - Проверить, что `gramjs_to_telethon_session("1" + payload)` и `gramjs_to_telethon_session(payload)` дают одинаковый результат

- [x] 3. Реализовать подключение к PostgreSQL и модуль `db.py`
  - Создать `db.py`: asyncpg-пул соединений, инициализируемый из `DATABASE_URL`
  - Реализовать функцию `get_account_by_id(account_id: int) -> dict | None` — SELECT из `telegram_accounts`
  - Реализовать функцию `update_account_status(account_id: int, status: str, flood_wait_until: datetime | None)` — UPDATE `telegram_accounts`
  - Реализовать функцию `get_active_accounts() -> list[dict]` — SELECT WHERE status='active' ORDER BY priority DESC
  - Логировать ошибки подключения к БД без раскрытия `DATABASE_URL`
  - _Requirements: 7.1, 5.1, 5.2, 5.3, 5.4, 8.6_

- [x] 4. Реализовать пул Telethon-клиентов (`client_pool.py`)
  - [x] 4.1 Создать `client_pool.py` с классом `ClientPool`
    - Хранить per-account клиенты в словаре `{account_id: TelegramClient}`
    - Метод `get_or_create(account: dict) -> TelegramClient`: возвращает существующий подключённый клиент или создаёт новый
    - При создании клиента: конвертировать сессию через `gramjs_to_telethon_session`, настроить SOCKS5-прокси если заданы `proxy_host`/`proxy_port`
    - Метод `remove(account_id: int)`: отключить и удалить клиент из пула
    - _Requirements: 1.1, 1.2, 1.5, 2.1, 2.2_

  - [x] 4.2 Реализовать reconnect-логику в `client_pool.py`
    - При неожиданном разрыве: 5 попыток переподключения с задержками 3s, 6s, 12s, 24s, 48s
    - Если все попытки неудачны — удалить клиент из пула, залогировать WARNING
    - _Requirements: 1.6_

  - [ ]* 4.3 Написать property-тест для очистки пула клиентов
    - **Property 7: Очистка пула клиентов при flood_wait/banned**
    - **Validates: Requirements 5.6**
    - После вызова `pool.remove(account_id)` пул не должен содержать клиента для этого `account_id`

- [x] 5. Реализовать `account_manager.py`
  - [x] 5.1 Создать `account_manager.py` с функцией `get_next_available_account() -> dict | None`
    - Читать аккаунты из БД через `db.py`
    - Автовосстанавливать аккаунты с истёкшим `flood_wait_until` (UPDATE status='active', flood_wait_until=NULL)
    - Выбирать аккаунт с наибольшим `priority` среди `status='active'`
    - Если нет активных — вернуть `None`
    - _Requirements: 5.3, 5.4, 5.5_

  - [x] 5.2 Реализовать функции `mark_flood_wait(account_id, wait_seconds)` и `mark_banned(account_id)` в `account_manager.py`
    - `mark_flood_wait`: UPDATE status='flood_wait', flood_wait_until=now+wait_seconds, затем `client_pool.remove(account_id)`
    - `mark_banned`: UPDATE status='banned', затем `client_pool.remove(account_id)`
    - Логировать: account_id, wait_seconds/error_code, proxy_host (если задан) — без паролей и сессий
    - _Requirements: 5.1, 5.2, 5.6, 8.3, 8.4, 8.6_

  - [ ]* 5.3 Написать property-тест для выбора аккаунта по приоритету
    - **Property 5: Выбор аккаунта с наивысшим приоритетом**
    - **Validates: Requirements 5.4**
    - Для любого непустого списка активных аккаунтов с разными `priority` — всегда выбирается аккаунт с max priority

  - [ ]* 5.4 Написать property-тест для автовосстановления аккаунта
    - **Property 6: Автовосстановление аккаунта после FloodWait**
    - **Validates: Requirements 5.3**
    - Аккаунт с `flood_wait_until` в прошлом должен получить `status='active'` перед выбором

- [x] 6. Реализовать `telegram_client.py` — обёртку над Telethon
  - [x] 6.1 Создать `telegram_client.py` с функцией `fetch_messages(chat_identifier: str, messages_count: int, account: dict) -> FetchMessagesResponse`
    - Нормализовать `chat_identifier`: убрать `https://t.me/`, `t.me/`, `@`
    - Вызвать `client.get_entity(clean_identifier)`, затем `client.iter_messages(entity, limit=messages_count)`
    - Пропускать сообщения с пустым или whitespace-only текстом
    - Извлекать `title`, `username`, `participants_count`, `last_message_date`
    - _Requirements: 3.1, 3.2, 3.3, 3.6_

  - [x] 6.2 Реализовать обработку ошибок Telegram в `telegram_client.py`
    - При `FloodWaitError`: вызвать `mark_flood_wait(account_id, error.seconds)`, пробросить ошибку
    - При auth-ошибках (`AuthKeyUnregisteredError`, `SessionRevokedError`, `UserDeactivatedError`, `UserDeactivatedBanError`, `AuthKeyInvalidError`, `AuthKeyPermEmptyError`, `SessionExpiredError`): вызвать `mark_banned(account_id)`, пробросить ошибку
    - Логировать account_id и код ошибки без сессии/api_hash
    - _Requirements: 3.4, 3.5, 5.1, 5.2, 8.3, 8.4, 8.6_

  - [ ]* 6.3 Написать property-тест для нормализации chat_identifier
    - **Property 2: Нормализация chat_identifier**
    - **Validates: Requirements 3.2**
    - Для любого username `u`: `@u`, `https://t.me/u`, `t.me/u`, `u` нормализуются к одному bare-идентификатору

  - [ ]* 6.4 Написать property-тест для фильтрации пустых сообщений
    - **Property 3: Фильтрация пустых сообщений**
    - **Validates: Requirements 3.6**
    - Для любого списка сообщений с произвольным количеством пустых/whitespace строк — результат не содержит ни одной такой строки

  - [ ]* 6.5 Написать property-тест для точной передачи wait_seconds
    - **Property 4: Точная передача wait_seconds при FloodWait**
    - **Validates: Requirements 3.4**
    - Для любого `wait_seconds` в [1, 86400] — значение в ответе воркера совпадает с исходным

- [x] 7. Реализовать FastAPI-приложение (`app.py`)
  - [x] 7.1 Создать `app.py` с эндпоинтами `POST /fetch-messages` и `GET /health`
    - `GET /health`: возвращает `{"status": "ok"}` с HTTP 200
    - `POST /fetch-messages`: валидирует тело через `FetchMessagesRequest`, вызывает `fetch_messages()`, возвращает `FetchMessagesResponse`
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 7.2 Реализовать обработку ошибок в `app.py`
    - HTTP 400 при ошибке валидации Pydantic (отсутствующие/неверные поля)
    - HTTP 429 при FloodWait: `{"error": "flood_wait", "wait_seconds": N, "account_id": N}`
    - HTTP 401 при auth error: `{"error": "auth_error", "code": "...", "account_id": N}`
    - HTTP 503 при отсутствии активных аккаунтов: `{"error": "no_accounts_available"}`
    - HTTP 500 при необработанном исключении: `{"error": "internal_error", "detail": "..."}` + логировать traceback
    - _Requirements: 6.4, 6.5, 5.5_

  - [ ]* 7.3 Написать property-тест для валидации входящего запроса
    - **Property 10: Валидация входящего запроса**
    - **Validates: Requirements 6.4**
    - Для любого запроса с отсутствующим хотя бы одним обязательным полем — ответ HTTP 400

  - [ ]* 7.4 Написать property-тест для отсутствия секретов в логах
    - **Property 11: Отсутствие чувствительных данных в логах**
    - **Validates: Requirements 8.6**
    - Для любой конфигурации аккаунта — ни одна строка лога не содержит значений `session`, `api_hash`, `proxy_password`

- [x] 8. Checkpoint — проверить Python-воркер
  - Убедиться, что все тесты проходят: `pytest python-worker/tests/ -v`
  - Убедиться, что воркер запускается командой `python worker.py` из директории `python-worker/`
  - Убедиться, что `GET /health` возвращает `{"status": "ok"}`
  - Задать пользователю вопросы, если что-то неясно.

- [x] 9. Создать `telegram-worker-client.ts` в Node.js API-сервере
  - [x] 9.1 Создать файл `artifacts/api-server/src/lib/telegram-worker-client.ts`
    - Реализовать функцию `fetchChatMessagesViaWorker(chatIdentifier: string, messagesCount: number, account: TelegramAccount): Promise<FetchMessagesResult>`
    - Читать URL воркера из `process.env.TELEGRAM_WORKER_URL` (default `http://localhost:8001`)
    - Отправлять `POST /fetch-messages` с телом `{chat_identifier, messages_count, account_id: account.id}`
    - При HTTP 200 — возвращать `{title, username, membersCount, messages, lastMessageDate}`
    - _Requirements: 6.1, 6.2_

  - [x] 9.2 Реализовать маппинг ошибок воркера в `telegram-worker-client.ts`
    - HTTP 429 → бросать объект с `seconds: body.wait_seconds` (совместимо с `getFloodWaitSeconds()` в `processor.ts`)
    - HTTP 401 → бросать объект с `message: body.code` (совместимо с `isAuthError()` в `processor.ts`)
    - HTTP 503 → бросать `Error("no_accounts_available")`
    - HTTP 500 / сетевая ошибка → бросать `Error(body.detail)`
    - _Requirements: 6.4, 6.5_

  - [ ]* 9.3 Написать unit-тесты для `telegram-worker-client.ts`
    - Тест: успешный ответ 200 → корректный `FetchMessagesResult`
    - Тест: ответ 429 → объект с `seconds`
    - Тест: ответ 401 → объект с `message` содержащим auth error code
    - Тест: ответ 503 → Error с "no_accounts_available"

- [x] 10. Обновить `processor.ts` для использования Python-воркера
  - Заменить импорт `fetchChatMessages` из `./telegram.js` на `fetchChatMessagesViaWorker` из `./telegram-worker-client.js`
  - Убрать импорт `disconnectClientForAccount` и `resetAllClients` из `./telegram.js` (воркер управляет пулом самостоятельно)
  - Заменить вызов `fetchChatMessages(chat.chatIdentifier, freshSession.messagesCount, currentAccount)` на `fetchChatMessagesViaWorker(chat.chatIdentifier, freshSession.messagesCount, currentAccount)`
  - Убедиться, что обработка FloodWait и auth-ошибок в `processor.ts` остаётся без изменений (воркер возвращает совместимые структуры ошибок)
  - _Requirements: 6.1, 6.2, 6.4, 6.5_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Убедиться, что TypeScript компилируется без ошибок: `tsc --noEmit` в `artifacts/api-server/`
  - Убедиться, что все Python-тесты проходят: `pytest python-worker/tests/ -v`
  - Задать пользователю вопросы, если что-то неясно.

## Notes

- Задачи, помеченные `*`, опциональны и могут быть пропущены для ускорения MVP
- Каждая задача ссылается на конкретные требования для трассируемости
- Property-тесты используют Hypothesis (Python) — минимум 100 итераций на каждый тест
- Воркер управляет пулом Telethon-клиентов самостоятельно; Node.js больше не вызывает `disconnectClientForAccount` / `resetAllClients`
- Конвертация gramjs → Telethon StringSession: убрать первый символ `"1"` (версионный префикс)
- Ошибки воркера (HTTP 429, 401) спроектированы совместимо с существующей логикой `getFloodWaitSeconds()` и `isAuthError()` в `processor.ts`
