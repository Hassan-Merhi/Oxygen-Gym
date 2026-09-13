import { index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const financialIdempotencyTable = pgTable("financial_idempotency", {
  scope: text("scope").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("processing"),
  responseJson: jsonb("response_json").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.scope, table.idempotencyKey], name: "financial_idempotency_scope_key_pk" }),
  index("financial_idempotency_created_at_idx").on(table.createdAt),
]);

export type FinancialIdempotency = typeof financialIdempotencyTable.$inferSelect;
