import { pgTable, text, serial, timestamp, doublePrecision, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface SaleItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  currency: string;
}

export const salesTable = pgTable("sales", {
  id: serial("id").primaryKey(),
  saleNumber: text("sale_number").unique(),
  items: jsonb("items").$type<SaleItem[]>().default([]),
  totalAmount: doublePrecision("total_amount").notNull().default(0),
  totalAmountUsd: doublePrecision("total_amount_usd"),
  costTotal: doublePrecision("cost_total").notNull().default(0),
  costTotalUsd: doublePrecision("cost_total_usd"),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes"),
  saleDate: timestamp("sale_date", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("completed"), // 'completed' | 'cancelled'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSaleSchema = createInsertSchema(salesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type Sale = typeof salesTable.$inferSelect;
