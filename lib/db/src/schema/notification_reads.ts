import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const notificationReadsTable = pgTable("notification_reads", {
  id: serial("id").primaryKey(),
  userClerkId: text("user_clerk_id").notNull(),
  notificationKey: text("notification_key").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationRead = typeof notificationReadsTable.$inferSelect;
