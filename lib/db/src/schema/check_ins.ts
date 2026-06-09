import { pgTable, serial, timestamp, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const checkInsTable = pgTable("check_ins", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id"),
  memberName: text("member_name").notNull(),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCheckInSchema = createInsertSchema(checkInsTable).omit({ id: true });
export type InsertCheckIn = z.infer<typeof insertCheckInSchema>;
export type CheckIn = typeof checkInsTable.$inferSelect;
