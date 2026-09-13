import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });
const fx = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  paymentNumber: text("payment_number").unique(),
  direction: text("direction").notNull().default("in"),
  category: text("category").notNull().default("membership"),
  type: text("type").notNull().default("membership"),
  linkedEntity: text("linked_entity"),
  linkedEntityId: integer("linked_entity_id"),
  linkedEntityName: text("linked_entity_name"),
  memberId: integer("member_id"),
  memberName: text("member_name"),
  planId: integer("plan_id"),
  planName: text("plan_name"),
  amount: money("amount").notNull().default(0),
  discount: money("discount").default(0),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: fx("exchange_rate").notNull().default(1),
  amountUsd: money("amount_usd"),
  amountCdf: money("amount_cdf"),
  account: text("account").notNull().default("cash"),
  notes: text("notes"),
  paymentDate: timestamp("payment_date", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("completed"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
