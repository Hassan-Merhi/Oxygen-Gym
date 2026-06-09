import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Membership payments and general income
export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  paymentNumber: text("payment_number").unique(),
  memberId: integer("member_id"),
  memberName: text("member_name"),
  planId: integer("plan_id"),
  planName: text("plan_name"),
  amount: doublePrecision("amount").notNull().default(0),
  discount: doublePrecision("discount").default(0),
  amountUsd: doublePrecision("amount_usd"),   // normalized for reporting
  currency: text("currency").notNull().default("USD"),
  type: text("type").notNull().default("membership"), // 'membership' | 'other'
  notes: text("notes"),
  paymentDate: timestamp("payment_date", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("completed"), // 'completed' | 'cancelled'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
