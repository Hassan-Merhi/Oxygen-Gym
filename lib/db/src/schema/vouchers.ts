import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// voucherType: cash_receipt | cash_payment | expense | customer_payment
// cash_receipt → direction in (increases cash)
// cash_payment → direction out (decreases cash)
// expense      → direction out (expense)
// customer_payment → direction in (increases cash)
export const vouchersTable = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  voucherNumber: text("voucher_number").unique(),
  voucherType: text("voucher_type").notNull().default("cash_receipt"),
  direction: text("direction").notNull().default("in"), // 'in' | 'out'
  voucherDate: timestamp("voucher_date", { withTimezone: true }).notNull().defaultNow(),
  paidTo: text("paid_to"),         // vendor / person name for out vouchers
  receivedFrom: text("received_from"), // person name for in vouchers
  linkedEntity: text("linked_entity"),
  linkedEntityId: integer("linked_entity_id"),
  linkedEntityName: text("linked_entity_name"),
  amount: doublePrecision("amount").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: doublePrecision("exchange_rate").notNull().default(1),
  amountUsd: doublePrecision("amount_usd"),
  amountCdf: doublePrecision("amount_cdf"),
  account: text("account").notNull().default("cash"),
  category: text("category"),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("recorded"), // 'recorded' | 'cancelled'
  createdBy: text("created_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVoucherSchema = createInsertSchema(vouchersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVoucher = z.infer<typeof insertVoucherSchema>;
export type Voucher = typeof vouchersTable.$inferSelect;
