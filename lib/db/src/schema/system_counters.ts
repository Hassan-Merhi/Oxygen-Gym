import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const systemCountersTable = pgTable("system_counters", {
  entity: text("entity").primaryKey(),
  currentCount: integer("current_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SystemCounter = typeof systemCountersTable.$inferSelect;
