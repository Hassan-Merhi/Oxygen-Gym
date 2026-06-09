import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  planNumber: text("plan_number").unique(),
  name: text("name").notNull(),
  description: text("description"),
  durationDays: integer("duration_days").notNull().default(30),
  price: doublePrecision("price").notNull().default(0),
  currency: text("currency").notNull().default("USD"), // 'USD' | 'CDF'
  status: text("status").notNull().default("active"), // 'active' | 'archived' | 'deleted'
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
