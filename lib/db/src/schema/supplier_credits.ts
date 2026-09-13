import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supplierCreditsTable = pgTable("supplier_credits", {
  id: serial("id").primaryKey(),
  creditNumber: text("credit_number").unique(),
  supplier: text("supplier").notNull(),
  description: text("description"),
  productId: integer("product_id"),
  productName: text("product_name"),
  totalAmount: doublePrecision("total_amount").notNull(),
  amountPaid: doublePrecision("amount_paid").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  purchaseDate: timestamp("purchase_date", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  status: text("status").notNull().default("open"), // 'open' | 'paid'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const supplierPaymentsTable = pgTable("supplier_payments", {
  id: serial("id").primaryKey(),
  creditId: integer("credit_id").notNull(),
  amount: doublePrecision("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: doublePrecision("exchange_rate").notNull().default(1),
  amountUsd: doublePrecision("amount_usd"),
  amountCdf: doublePrecision("amount_cdf"),
  paymentDate: timestamp("payment_date", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplierCreditSchema = createInsertSchema(supplierCreditsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplierCredit = z.infer<typeof insertSupplierCreditSchema>;
export type SupplierCredit = typeof supplierCreditsTable.$inferSelect;
export type SupplierPayment = typeof supplierPaymentsTable.$inferSelect;
