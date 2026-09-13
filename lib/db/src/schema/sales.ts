import { pgTable, text, serial, timestamp, numeric, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });
const fx = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });

export interface SaleItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  costPrice: number;
  profit: number;
  currency: string;
}

export const salesTable = pgTable("sales", {
  id: serial("id").primaryKey(),
  saleNumber: text("sale_number").unique(),
  items: jsonb("items").$type<SaleItem[]>().default([]),
  totalAmount: money("total_amount").notNull().default(0),
  totalDiscount: money("total_discount").notNull().default(0),
  totalCost: money("cost_total").notNull().default(0),
  totalProfit: money("total_profit").notNull().default(0),
  totalAmountUsd: money("total_amount_usd"),
  totalCostUsd: money("cost_total_usd"),
  totalProfitUsd: money("total_profit_usd"),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: fx("exchange_rate").notNull().default(1),
  paymentAmount: money("payment_amount").notNull().default(0),
  changeDue: money("change_due").notNull().default(0),
  paymentId: integer("payment_id"),
  notes: text("notes"),
  createdBy: text("created_by"),
  saleDate: timestamp("sale_date", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("completed"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSaleSchema = createInsertSchema(salesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type Sale = typeof salesTable.$inferSelect;
