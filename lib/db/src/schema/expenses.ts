import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });
const fx = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  voucherNumber: text("voucher_number").unique(),
  type: text("type").notNull().default("expense"),
  category: text("category"),
  description: text("description").notNull(),
  amount: money("amount").notNull().default(0),
  amountUsd: money("amount_usd"),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: fx("exchange_rate").notNull().default(1),
  expenseDate: timestamp("expense_date", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("recorded"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;
