import { pgTable, text, serial, timestamp, doublePrecision, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface SaleItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;       // per-unit discount in sale currency
  lineTotal: number;      // (unitPrice - discount) * quantity
  costPrice: number;      // average cost at time of sale (in sale currency)
  profit: number;         // lineTotal - costPrice * quantity
  currency: string;
}

export const salesTable = pgTable("sales", {
  id: serial("id").primaryKey(),
  saleNumber: text("sale_number").unique(),
  items: jsonb("items").$type<SaleItem[]>().default([]),
  // Totals in sale currency
  totalAmount: doublePrecision("total_amount").notNull().default(0),
  totalDiscount: doublePrecision("total_discount").notNull().default(0),
  totalCost: doublePrecision("cost_total").notNull().default(0),
  totalProfit: doublePrecision("total_profit").notNull().default(0),
  // USD equivalents
  totalAmountUsd: doublePrecision("total_amount_usd"),
  totalCostUsd: doublePrecision("cost_total_usd"),
  totalProfitUsd: doublePrecision("total_profit_usd"),
  // Payment
  currency: text("currency").notNull().default("USD"),
  exchangeRate: doublePrecision("exchange_rate").notNull().default(1),
  paymentAmount: doublePrecision("payment_amount").notNull().default(0),
  changeDue: doublePrecision("change_due").notNull().default(0),
  paymentId: integer("payment_id"),
  // Meta
  notes: text("notes"),
  createdBy: text("created_by"),
  saleDate: timestamp("sale_date", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("completed"), // 'completed' | 'voided'
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSaleSchema = createInsertSchema(salesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type Sale = typeof salesTable.$inferSelect;
