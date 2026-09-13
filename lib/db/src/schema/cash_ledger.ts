import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });
const fx = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });

// Immutable ledger — every cash movement appends a row
// sourceType: payment | voucher | sale | payroll | stock_purchase | supplier_payment | balance_payment
export const cashLedgerTable = pgTable("cash_ledger", {
  id: serial("id").primaryKey(),
  entryDate: timestamp("entry_date", { withTimezone: true }).notNull().defaultNow(),
  sourceType: text("source_type").notNull(),
  sourceNumber: text("source_number"),
  sourceId: integer("source_id"),
  direction: text("direction").notNull(), // 'in' | 'out'
  amount: money("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: fx("exchange_rate").notNull().default(1),
  amountUsd: money("amount_usd").notNull(),
  amountCdf: money("amount_cdf").notNull(),
  balanceUsd: money("balance_usd").notNull().default(0),
  balanceCdf: money("balance_cdf").notNull().default(0),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCashLedgerSchema = createInsertSchema(cashLedgerTable).omit({ id: true, createdAt: true });
export type InsertCashLedger = z.infer<typeof insertCashLedgerSchema>;
export type CashLedger = typeof cashLedgerTable.$inferSelect;
