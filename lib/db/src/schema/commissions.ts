import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });

export const commissionsTable = pgTable("commissions", {
  id: serial("id").primaryKey(),
  staffEmployeeId: integer("staff_employee_id").notNull(),
  memberId: integer("member_id"),
  memberName: text("member_name"),
  amount: money("amount").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("pending"),
  payrollId: integer("payroll_id"),
  note: text("note"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommissionSchema = createInsertSchema(commissionsTable).omit({ id: true, createdAt: true });
export type InsertCommission = z.infer<typeof insertCommissionSchema>;
export type Commission = typeof commissionsTable.$inferSelect;
