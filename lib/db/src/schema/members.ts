import { pgTable, text, serial, timestamp, integer, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membersTable = pgTable("members", {
  id: serial("id").primaryKey(),
  memberNumber: text("member_number").unique(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  emergencyContact: text("emergency_contact"),
  gender: text("gender"),                          // 'male' | 'female' | 'other'
  // Plan info (denormalized for display speed)
  planId: integer("plan_id"),
  planName: text("plan_name"),
  planPrice: doublePrecision("plan_price"),
  // Dates
  joinDate: timestamp("join_date", { withTimezone: true }).notNull().defaultNow(),
  startDate: timestamp("start_date", { withTimezone: true }),
  expiryDate: timestamp("expiry_date", { withTimezone: true }),
  lastCheckIn: timestamp("last_check_in", { withTimezone: true }),
  // Financial
  amountPaid: doublePrecision("amount_paid").default(0),
  discount: doublePrecision("discount").default(0),
  balance: doublePrecision("balance").default(0),
  currency: text("currency").notNull().default("USD"),
  // Freeze
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenUntil: timestamp("frozen_until", { withTimezone: true }),
  frozenDays: integer("frozen_days").default(0),
  // Status: 'active' | 'expired' | 'frozen' | 'inactive' | 'archived' | 'deleted'
  status: text("status").notNull().default("active"),
  // Identifiers & media
  photoUrl: text("photo_url"),
  fingerprintId: text("fingerprint_id"),
  qrCodeId: text("qr_code_id"),
  notes: text("notes"),
  // Coach commission
  coachId: integer("coach_id"),
  commissionAmount: doublePrecision("commission_amount").default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMemberSchema = createInsertSchema(membersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
