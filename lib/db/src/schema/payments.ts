import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  paymentNumber: text("payment_number").unique(),
  // direction: 'in' (received) | 'out' (paid)
  direction: text("direction").notNull().default("in"),
  // category: membership | product_sale | expense | payroll | stock_purchase | other
  category: text("category").notNull().default("membership"),
  // Legacy type field kept for backward compat
  type: text("type").notNull().default("membership"),
  // Linked entity (optional)
  linkedEntity: text("linked_entity"),        // 'member' | 'vendor' | 'staff' | 'customer'
  linkedEntityId: integer("linked_entity_id"),
  linkedEntityName: text("linked_entity_name"),
  // Plan info (for membership payments)
  memberId: integer("member_id"),
  memberName: text("member_name"),
  planId: integer("plan_id"),
  planName: text("plan_name"),
  // Financials
  amount: doublePrecision("amount").notNull().default(0),
  discount: doublePrecision("discount").default(0),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: doublePrecision("exchange_rate").notNull().default(1),
  amountUsd: doublePrecision("amount_usd"),
  amountCdf: doublePrecision("amount_cdf"),
  account: text("account").notNull().default("cash"),
  // Meta
  notes: text("notes"),
  paymentDate: timestamp("payment_date", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("completed"), // 'completed' | 'cancelled'
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
