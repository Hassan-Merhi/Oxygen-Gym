import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Immutable ledger — every cash movement appends a row
// sourceType: payment | voucher | sale | payroll | stock_purchase | balance_payment
export const cashLedgerTable = pgTable("cash_ledger", {
  id: serial("id").primaryKey(),
  entryDate: timestamp("entry_date", { withTimezone: true }).notNull().defaultNow(),
  sourceType: text("source_type").notNull(),
  sourceNumber: text("source_number"),
  sourceId: integer("source_id"),
  direction: text("direction").notNull(), // 'in' | 'out'
  amount: doublePrecision("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: doublePrecision("exchange_rate").notNull().default(1),
  amountUsd: doublePrecision("amount_usd").notNull(),
  amountCdf: doublePrecision("amount_cdf").notNull(),
  balanceUsd: doublePrecision("balance_usd").notNull().default(0),
  balanceCdf: doublePrecision("balance_cdf").notNull().default(0),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCashLedgerSchema = createInsertSchema(cashLedgerTable).omit({ id: true, createdAt: true });
export type InsertCashLedger = z.infer<typeof insertCashLedgerSchema>;
export type CashLedger = typeof cashLedgerTable.$inferSelect;
