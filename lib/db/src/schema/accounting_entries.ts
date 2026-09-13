import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });
const fx = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });

export const accountingEntriesTable = pgTable("accounting_entries", {
  id: serial("id").primaryKey(),
  entryDate: timestamp("entry_date", { withTimezone: true }).notNull().defaultNow(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id"),
  sourceNumber: text("source_number"),
  accountId: integer("account_id"),
  accountNameSnapshot: text("account_name_snapshot"),
  debitUsd: money("debit_usd").notNull().default(0),
  creditUsd: money("credit_usd").notNull().default(0),
  debitCdf: money("debit_cdf").notNull().default(0),
  creditCdf: money("credit_cdf").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  amount: money("amount").notNull().default(0),
  exchangeRate: fx("exchange_rate").notNull().default(1),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAccountingEntrySchema = createInsertSchema(accountingEntriesTable).omit({ id: true, createdAt: true });
export type InsertAccountingEntry = z.infer<typeof insertAccountingEntrySchema>;
export type AccountingEntry = typeof accountingEntriesTable.$inferSelect;
