import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });
const fx = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });

export const supplierCreditsTable = pgTable("supplier_credits", {
  id: serial("id").primaryKey(),
  creditNumber: text("credit_number").unique(),
  supplier: text("supplier").notNull(),
  description: text("description"),
  productId: integer("product_id"),
  productName: text("product_name"),
  totalAmount: money("total_amount").notNull(),
  amountPaid: money("amount_paid").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: fx("exchange_rate").notNull().default(1),
  purchaseDate: timestamp("purchase_date", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const supplierPaymentsTable = pgTable("supplier_payments", {
  id: serial("id").primaryKey(),
  creditId: integer("credit_id").notNull(),
  amount: money("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: fx("exchange_rate").notNull().default(1),
  account: text("account").notNull().default("cash"),
  paymentId: integer("payment_id"),
  paymentDate: timestamp("payment_date", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplierCreditSchema = createInsertSchema(supplierCreditsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplierCredit = z.infer<typeof insertSupplierCreditSchema>;
export type SupplierCredit = typeof supplierCreditsTable.$inferSelect;
export type SupplierPayment = typeof supplierPaymentsTable.$inferSelect;
