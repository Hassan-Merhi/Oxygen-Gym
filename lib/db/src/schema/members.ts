import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membersTable = pgTable("members", {
  id: serial("id").primaryKey(),
  memberNumber: text("member_number").unique(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  planId: integer("plan_id"),
  planName: text("plan_name"),             // denormalized for display
  status: text("status").notNull().default("active"), // 'active' | 'inactive' | 'frozen' | 'archived' | 'deleted'
  expiryDate: timestamp("expiry_date", { withTimezone: true }),
  joinDate: timestamp("join_date", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMemberSchema = createInsertSchema(membersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
