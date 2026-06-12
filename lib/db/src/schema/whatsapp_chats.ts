import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";

export const whatsappChatsTable = pgTable("whatsapp_chats", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  chatId: text("chat_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsappChat = typeof whatsappChatsTable.$inferSelect;
