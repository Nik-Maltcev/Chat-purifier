# Workspace

## Overview

Telegram Chat Analyzer — инструмент для массовой проверки Telegram-чатов на тему эмиграции. Выгружает последние сообщения из каждого чата и анализирует их через DeepSeek V3 AI.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Telegram**: gramjs (MTProto), session string auth
- **AI**: DeepSeek V3 (`deepseek-chat` model via `api.deepseek.com`)

## Artifacts

- **`artifacts/tg-chat-analyzer`** — React+Vite фронтенд (порт 18820), previewPath `/`
- **`artifacts/api-server`** — Express API сервер (порт 8080), previewPath `/api`

## Features

- Создание сессий анализа с произвольным списком чатов
- Фоновая обработка с задержками (настраиваемые, default 30s) для защиты от блокировки Telegram
- **Извлечение чатов из Telegram папок** (t.me/addlist/...) через MTProto API
- Анализ через DeepSeek V3 AI: спам, активность, релевантность, вердикт keep/filter
- Экспорт результатов в CSV
- **Страница Настроек** в UI — все реквизиты хранятся в БД (не env vars)
- Интерфейс полностью на русском языке

## DB Schema

- `sessions` — сессии анализа (status, delay, progress)
- `chat_results` — результаты по каждому чату (verdict, scores, summary)
- `settings` — ключ-значение для хранения реквизитов (Telegram API, DeepSeek key, defaults)

## Settings (хранятся в таблице settings)

- `telegram_api_id` — Telegram App ID
- `telegram_api_hash` — Telegram App Hash
- `telegram_session` — Session строка gramjs
- `deepseek_api_key` — API ключ DeepSeek V3
- `default_delay_seconds` — задержка по умолчанию
- `default_messages_count` — кол-во сообщений по умолчанию

## Critical notes

- **bufferutil stubs**: `/home/runner/workspace/node_modules/bufferutil/` и `utf-8-validate/` — ручные stubs, нужны gramjs. При потере после pnpm install — пересоздать.
- **Port conflicts**: порт 8080 может конфликтовать — перед рестартом запускать `fuser -k 8080/tcp`
- **zod import**: в API-сервере использовать `import { z } from "zod"` (не `zod/v4`)
- **Settings fallback**: `telegram.ts` и `deepseek.ts` сначала читают из DB, потом из env vars
