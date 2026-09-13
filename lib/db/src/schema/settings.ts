import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const fx = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  gymName: text("gym_name").notNull().default("My Gym"),
  phone: text("phone"),
  address: text("address"),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  usdToCdfRate: fx("usd_to_cdf_rate").notNull().default(2800),
  language: text("language").notNull().default("fr"),
  logoUrl: text("logo_url"),
  receiptLogoUrl: text("receipt_logo_url"),
  receiptHeader: text("receipt_header"),
  receiptFooter: text("receipt_footer"),
  membershipCardFooter: text("membership_card_footer"),
  backupEnabled: text("backup_enabled").notNull().default("false"),
  backupTime: text("backup_time").notNull().default("02:00"),
  greenApiInstanceId: text("green_api_instance_id"),
  greenApiToken: text("green_api_token"),
  dailySummaryEnabled: text("daily_summary_enabled").notNull().default("false"),
  dailySummaryHour: integer("daily_summary_hour").notNull().default(21),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
