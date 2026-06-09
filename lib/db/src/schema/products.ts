import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  productNumber: text("product_number").unique(),
  name: text("name").notNull(),
  barcode: text("barcode").unique(),
  description: text("description"),
  category: text("category"),
  supplier: text("supplier"),
  notes: text("notes"),
  quantity: integer("quantity").notNull().default(0),
  alertQuantity: integer("alert_quantity").notNull().default(5),
  costPrice: doublePrecision("cost_price").notNull().default(0),
  sellingPrice: doublePrecision("selling_price").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("active"), // 'active' | 'archived' | 'deleted'
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const stockPurchasesTable = pgTable("stock_purchases", {
  id: serial("id").primaryKey(),
  purchaseNumber: text("purchase_number").unique(),
  productId: integer("product_id").notNull(),
  productName: text("product_name"),
  quantityAdded: integer("quantity_added").notNull().default(0),
  costPerUnit: doublePrecision("cost_per_unit").notNull().default(0),
  totalCost: doublePrecision("total_cost").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: doublePrecision("exchange_rate").notNull().default(1),
  totalCostUsd: doublePrecision("total_cost_usd"),
  totalCostCdf: doublePrecision("total_cost_cdf"),
  supplier: text("supplier"),
  notes: text("notes"),
  paidFromCash: integer("paid_from_cash").notNull().default(0), // boolean as 0/1
  paymentId: integer("payment_id"),
  ledgerEntryId: integer("ledger_entry_id"),
  purchaseDate: timestamp("purchase_date", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;

export const insertStockPurchaseSchema = createInsertSchema(stockPurchasesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStockPurchase = z.infer<typeof insertStockPurchaseSchema>;
export type StockPurchase = typeof stockPurchasesTable.$inferSelect;
