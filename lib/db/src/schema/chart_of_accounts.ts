import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chartOfAccountsTable = pgTable("chart_of_accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull().default("asset"), // asset | liability | income | expense | equity
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChartOfAccountSchema = createInsertSchema(chartOfAccountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChartOfAccount = z.infer<typeof insertChartOfAccountSchema>;
export type ChartOfAccount = typeof chartOfAccountsTable.$inferSelect;
