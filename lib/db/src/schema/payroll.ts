import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const payrollTable = pgTable("payroll", {
  id: serial("id").primaryKey(),
  payrollNumber: text("payroll_number").unique(),
  userId: integer("user_id"),
  userName: text("user_name").notNull(),
  month: integer("month").notNull(),   // 1–12
  year: integer("year").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  amountUsd: doublePrecision("amount_usd"),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // 'pending' | 'paid'
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPayrollSchema = createInsertSchema(payrollTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayroll = z.infer<typeof insertPayrollSchema>;
export type Payroll = typeof payrollTable.$inferSelect;
