# Workspace

## Overview

Telegram Chat Analyzer — инструмент для массовой проверки Telegram-чатов на тему эмиграции. Выгружает последние сообщения из каждого чата и анализирует их через Kimi AI.

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
- **AI**: Kimi (Moonshot AI) moonshot-v1-8k model

## Artifacts

- **`artifacts/tg-chat-analyzer`** — React+Vite фронтенд (порт 18820), previewPath `/`
- **`artifacts/api-server`** — Express API сервер (порт 8080), previewPath `/api`

## Features

- Создание сессий анализа с произвольным списком чатов
- Фоновая обработка с задержками (настраиваемые, default 12s) для защиты от блокировки Telegram
- **Извлечение чатов из Telegram папок** (t.me/addlist/...) через MTProto API
- Анализ через Kimi: спам-score, активность, релевантность теме, итоговая оценка
- Вердикт keep/filter для каждого чата
- Авто-обновление прогресса каждые 5 секунд
- Экспорт результатов в CSV

## Secrets Required

- `TELEGRAM_APP_ID` — App ID с my.telegram.org
- `TELEGRAM_APP_HASH` — App Hash с my.telegram.org
- `TELEGRAM_SESSION` — Session String (авторизованная сессия)
- `KIMI_API_KEY` — API ключ от Moonshot AI (platform.moonshot.cn)

## Notes

- `bufferutil` и `utf-8-validate` — stub-модули в `node_modules/` (нативные бинари не компилируются в Replit, websocket работает без них через JS fallback)
- Telegram клиент — синглтон, подключается при первом запросе

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
