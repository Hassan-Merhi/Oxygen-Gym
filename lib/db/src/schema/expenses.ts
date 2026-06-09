import { pgTable, text, serial, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Vouchers / expense records
export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  voucherNumber: text("voucher_number").unique(),
  type: text("type").notNull().default("expense"), // 'expense' | 'income'
  category: text("category"),                       // 'rent' | 'utilities' | 'supplies' | 'other'
  description: text("description").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  amountUsd: doublePrecision("amount_usd"),
  currency: text("currency").notNull().default("USD"),
  expenseDate: timestamp("expense_date", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("recorded"), // 'recorded' | 'cancelled'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;
