import { pgTable, text, serial, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pagePermissionsSchema = z.object({
  dashboard: z.boolean().default(false),
  members: z.boolean().default(false),
  plans: z.boolean().default(false),
  staff: z.boolean().default(false),
  payroll: z.boolean().default(false),
  payments: z.boolean().default(false),
  vouchers: z.boolean().default(false),
  accounts: z.boolean().default(false),
  stock: z.boolean().default(false),
  sales: z.boolean().default(false),
  settings: z.boolean().default(false),
  canViewCosts: z.boolean().default(false),
});

export type PagePermissions = z.infer<typeof pagePermissionsSchema>;

export const defaultAdminPermissions: PagePermissions = {
  dashboard: true,
  members: true,
  plans: true,
  staff: true,
  payroll: true,
  payments: true,
  vouchers: true,
  accounts: true,
  stock: true,
  sales: true,
  settings: true,
  canViewCosts: true,
};

export const defaultStaffPermissions: PagePermissions = {
  dashboard: true,
  members: false,
  plans: false,
  staff: false,
  payroll: false,
  payments: false,
  vouchers: false,
  accounts: false,
  stock: false,
  sales: false,
  settings: false,
  canViewCosts: false,
};

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  role: text("role").notNull().default("staff"), // 'admin' | 'staff'
  status: text("status").notNull().default("active"), // 'active' | 'inactive'
  permissions: jsonb("permissions").notNull().$type<PagePermissions>().default(defaultStaffPermissions),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
