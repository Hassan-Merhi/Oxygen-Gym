import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });
const fx = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });

export const payrollTable = pgTable("payroll", {
  id: serial("id").primaryKey(),
  payrollNumber: text("payroll_number").unique(),
  staffEmployeeId: integer("staff_employee_id"),
  staffName: text("user_name").notNull(),
  staffNumber: text("staff_number"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  baseSalary: money("amount").notNull().default(0),
  bonus: money("bonus").notNull().default(0),
  deduction: money("deduction").notNull().default(0),
  netPay: money("net_pay").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: fx("exchange_rate").notNull().default(1),
  netPayUsd: money("amount_usd"),
  commissionBonus: money("commission_bonus").notNull().default(0),
  notes: text("notes"),
  status: text("status").notNull().default("draft"),
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
