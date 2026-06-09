import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  productNumber: text("product_number").unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
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

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
