import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });

export const staffEmployeesTable = pgTable("staff_employees", {
  id: serial("id").primaryKey(),
  staffNumber: text("staff_number").unique(),
  linkedUserId: integer("linked_user_id"),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  jobTitle: text("job_title"),
  hireDate: timestamp("hire_date", { withTimezone: true }),
  salary: money("salary").notNull().default(0),
  salaryCurrency: text("salary_currency").notNull().default("USD"),
  paymentFrequency: text("payment_frequency").notNull().default("monthly"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStaffEmployeeSchema = createInsertSchema(staffEmployeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffEmployee = z.infer<typeof insertStaffEmployeeSchema>;
export type StaffEmployee = typeof staffEmployeesTable.$inferSelect;
