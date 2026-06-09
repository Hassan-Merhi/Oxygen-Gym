import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
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
  viewCost: z.boolean().default(false),
  viewProfit: z.boolean().default(false),
  viewAccounting: z.boolean().default(false),
  manageStaff: z.boolean().default(false),
  manageSettings: z.boolean().default(false),
  managePayroll: z.boolean().default(false),
  manageInventory: z.boolean().default(false),
  manageMembers: z.boolean().default(false),
  managePlans: z.boolean().default(false),
});

export type PagePermissions = z.infer<typeof pagePermissionsSchema>;

export const defaultAdminPermissions: PagePermissions = {
  dashboard: true, members: true, plans: true, staff: true,
  payroll: true, payments: true, vouchers: true, accounts: true,
  stock: true, sales: true, settings: true,
  viewCost: true, viewProfit: true, viewAccounting: true,
  manageStaff: true, manageSettings: true, managePayroll: true,
  manageInventory: true, manageMembers: true, managePlans: true,
};

export const defaultManagerPermissions: PagePermissions = {
  dashboard: true, members: true, plans: true, staff: true,
  payroll: true, payments: true, vouchers: true, accounts: false,
  stock: true, sales: true, settings: false,
  viewCost: true, viewProfit: true, viewAccounting: false,
  manageStaff: true, manageSettings: false, managePayroll: true,
  manageInventory: true, manageMembers: true, managePlans: true,
};

export const defaultStaffPermissions: PagePermissions = {
  dashboard: true, members: false, plans: false, staff: false,
  payroll: false, payments: false, vouchers: false, accounts: false,
  stock: false, sales: false, settings: false,
  viewCost: false, viewProfit: false, viewAccounting: false,
  manageStaff: false, manageSettings: false, managePayroll: false,
  manageInventory: false, manageMembers: false, managePlans: false,
};

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // Kept for display / backward compat
  name: text("name").notNull(),
  email: text("email").unique(),
  phone: text("phone"),
  clerkUserId: text("clerk_user_id").unique(),
  role: text("role").notNull().default("staff"),
  status: text("status").notNull().default("active"),
  permissions: jsonb("permissions").notNull().$type<PagePermissions>().default(defaultStaffPermissions),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
