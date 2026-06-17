import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountingEntriesTable = pgTable("accounting_entries", {
  id: serial("id").primaryKey(),
  entryDate: timestamp("entry_date", { withTimezone: true }).notNull().defaultNow(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id"),
  sourceNumber: text("source_number"),
  accountId: integer("account_id"),
  accountNameSnapshot: text("account_name_snapshot"),
  debitUsd: doublePrecision("debit_usd").notNull().default(0),
  creditUsd: doublePrecision("credit_usd").notNull().default(0),
  debitCdf: doublePrecision("debit_cdf").notNull().default(0),
  creditCdf: doublePrecision("credit_cdf").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  amount: doublePrecision("amount").notNull().default(0),
  exchangeRate: doublePrecision("exchange_rate").notNull().default(1),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAccountingEntrySchema = createInsertSchema(accountingEntriesTable).omit({ id: true, createdAt: true });
export type InsertAccountingEntry = z.infer<typeof insertAccountingEntrySchema>;
export type AccountingEntry = typeof accountingEntriesTable.$inferSelect;
