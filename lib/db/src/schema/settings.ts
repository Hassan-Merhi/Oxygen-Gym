import { pgTable, text, serial, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  gymName: text("gym_name").notNull().default("My Gym"),
  phone: text("phone"),
  address: text("address"),
  defaultCurrency: text("default_currency").notNull().default("USD"), // 'USD' | 'CDF'
  usdToCdfRate: doublePrecision("usd_to_cdf_rate").notNull().default(2800),
  language: text("language").notNull().default("en"), // 'en' | 'fr' | 'ar'
  receiptHeader: text("receipt_header"),
  receiptFooter: text("receipt_footer"),
  logoUrl: text("logo_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
