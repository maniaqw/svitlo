import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
export const reminderDeliveries = sqliteTable("reminder_deliveries", {
  key: text("key").primaryKey(),
  userId: text("user_id").notNull(),
  status: text("status").notNull(),
  createdAt: real("created_at").notNull(),
});
export const profiles = sqliteTable("telegram_profiles", {
  id: text("id").primaryKey(),
  region: text("region").notNull(),
  operator: text("operator").notNull(),
  queue: text("queue").notNull(),
  language: text("language").notNull().default("uk"),
  notifications: integer("notifications").notNull().default(0),
  botStarted: integer("bot_started").notNull().default(0),
  chatId: text("chat_id"),
  updatedAt: real("updated_at").notNull(),
});
export const snapshots = sqliteTable("source_snapshots", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(),
  fetchedAt: real("fetched_at").notNull(),
  attemptedAt: real("attempted_at").notNull(),
  error: text("error"),
  version: integer("version").notNull().default(1),
});
export const sourceLeases = sqliteTable("source_leases", {
  key: text("key").primaryKey(),
  checkedAt: real("checked_at").notNull(),
});
export const webhookUpdates = sqliteTable("webhook_updates", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  createdAt: real("created_at").notNull(),
});
