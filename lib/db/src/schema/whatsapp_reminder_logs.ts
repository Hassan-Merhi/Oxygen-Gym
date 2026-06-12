import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const whatsappReminderLogsTable = pgTable("whatsapp_reminder_logs", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull(),
  reminderType: text("reminder_type").notNull(), // 'new_member' | '5day' | '2day'
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsappReminderLog = typeof whatsappReminderLogsTable.$inferSelect;
