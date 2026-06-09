import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const payrollTable = pgTable("payroll", {
  id: serial("id").primaryKey(),
  payrollNumber: text("payroll_number").unique(),
  // Staff employee link
  staffEmployeeId: integer("staff_employee_id"),
  staffName: text("user_name").notNull(),
  staffNumber: text("staff_number"),
  // Pay period
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  // Financials
  baseSalary: doublePrecision("amount").notNull().default(0),
  bonus: doublePrecision("bonus").notNull().default(0),
  deduction: doublePrecision("deduction").notNull().default(0),
  netPay: doublePrecision("net_pay").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: doublePrecision("exchange_rate").notNull().default(1),
  netPayUsd: doublePrecision("amount_usd"),
  // Status
  notes: text("notes"),
  status: text("status").notNull().default("draft"), // 'draft' | 'paid' | 'cancelled'
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidBy: text("paid_by"),
  paymentId: integer("payment_id"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: text("cancelled_by"),
  cancelReason: text("cancel_reason"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPayrollSchema = createInsertSchema(payrollTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayroll = z.infer<typeof insertPayrollSchema>;
export type Payroll = typeof payrollTable.$inferSelect;
