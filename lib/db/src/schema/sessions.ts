import { pgTable, serial, text, integer, timestamp, pgEnum, primaryKey, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionStatusEnum = pgEnum("session_status", [
  "idle",
  "running",
  "paused",
  "completed",
  "error",
]);

export const chatStatusEnum = pgEnum("chat_status", [
  "pending",
  "fetching",
  "analyzing",
  "done",
  "error",
  "skipped",
]);

export const chatVerdictEnum = pgEnum("chat_verdict", [
  "keep",
  "filter",
  "pending",
  "error",
]);

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: sessionStatusEnum("status").notNull().default("idle"),
  totalChats: integer("total_chats").notNull().default(0),
  processedChats: integer("processed_chats").notNull().default(0),
  delaySeconds: integer("delay_seconds").notNull().default(12),
  messagesCount: integer("messages_count").notNull().default(50),
  autoRestart: boolean("auto_restart").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const chatResultsTable = pgTable("chat_results", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  chatIdentifier: text("chat_identifier").notNull(),
  chatTitle: text("chat_title"),
  chatUsername: text("chat_username"),
  membersCount: integer("members_count"),
  status: chatStatusEnum("status").notNull().default("pending"),
  verdict: chatVerdictEnum("verdict").notNull().default("pending"),
  score: integer("score"),
  spamScore: integer("spam_score"),
  activityScore: integer("activity_score"),
  topicScore: integer("topic_score"),
  aiSummary: text("ai_summary"),
  country: text("country"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const settingsTable = pgTable("settings", {
  key: text("key").notNull().primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "flood_wait",
  "banned",
  "disabled",
]);

export const telegramAccountsTable = pgTable("telegram_accounts", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().default("Аккаунт"),
  apiId: text("api_id").notNull(),
  apiHash: text("api_hash").notNull(),
  session: text("session").notNull(),
  status: accountStatusEnum("status").notNull().default("active"),
  floodWaitUntil: timestamp("flood_wait_until"),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertChatResultSchema = createInsertSchema(chatResultsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type ChatResult = typeof chatResultsTable.$inferSelect;
export type InsertChatResult = z.infer<typeof insertChatResultSchema>;
export type TelegramAccount = typeof telegramAccountsTable.$inferSelect;
