import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });

export const membersTable = pgTable("members", {
  id: serial("id").primaryKey(),
  memberNumber: text("member_number").unique(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  emergencyContact: text("emergency_contact"),
  gender: text("gender"),
  planId: integer("plan_id"),
  planName: text("plan_name"),
  planPrice: money("plan_price"),
  joinDate: timestamp("join_date", { withTimezone: true }).notNull().defaultNow(),
  startDate: timestamp("start_date", { withTimezone: true }),
  expiryDate: timestamp("expiry_date", { withTimezone: true }),
  lastCheckIn: timestamp("last_check_in", { withTimezone: true }),
  amountPaid: money("amount_paid").default(0),
  discount: money("discount").default(0),
  balance: money("balance").default(0),
  currency: text("currency").notNull().default("USD"),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenUntil: timestamp("frozen_until", { withTimezone: true }),
  frozenDays: integer("frozen_days").default(0),
  status: text("status").notNull().default("active"),
  photoUrl: text("photo_url"),
  fingerprintId: text("fingerprint_id"),
  qrCodeId: text("qr_code_id"),
  notes: text("notes"),
  waChatId: text("wa_chat_id"),
  cashAccountId: integer("cash_account_id"),
  coachId: integer("coach_id"),
  commissionAmount: money("commission_amount").default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMemberSchema = createInsertSchema(membersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
