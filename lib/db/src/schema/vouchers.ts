import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });
const fx = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });

export const vouchersTable = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  voucherNumber: text("voucher_number").unique(),
  voucherType: text("voucher_type").notNull().default("cash_receipt"),
  direction: text("direction").notNull().default("in"),
  voucherDate: timestamp("voucher_date", { withTimezone: true }).notNull().defaultNow(),
  paidTo: text("paid_to"),
  receivedFrom: text("received_from"),
  linkedEntity: text("linked_entity"),
  linkedEntityId: integer("linked_entity_id"),
  linkedEntityName: text("linked_entity_name"),
  amount: money("amount").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: fx("exchange_rate").notNull().default(1),
  amountUsd: money("amount_usd"),
  amountCdf: money("amount_cdf"),
  account: text("account").notNull().default("cash"),
  category: text("category"),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("recorded"),
  createdBy: text("created_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVoucherSchema = createInsertSchema(vouchersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVoucher = z.infer<typeof insertVoucherSchema>;
export type Voucher = typeof vouchersTable.$inferSelect;
