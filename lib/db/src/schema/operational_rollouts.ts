import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Singleton control-plane record for the staged operational rollout.
 *
 * The row is deliberately stored in the database rather than in process
 * environment so every application instance observes the same stage and the
 * promotion/rollback history can be audited.
 */
export const operationalRolloutsTable = pgTable("operational_rollouts", {
  id: integer("id").primaryKey(),
  featureKey: text("feature_key")
    .notNull()
    .default("phase-13-operational-rollout"),
  stage: text("stage").notNull().default("internal"),
  acknowledgedWarningKeys: jsonb("acknowledged_warning_keys")
    .$type<string[]>()
    .notNull()
    .default([]),
  updatedBy: integer("updated_by"),
  updatedByName: text("updated_by_name"),
  lastTransitionAt: timestamp("last_transition_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OperationalRollout = typeof operationalRolloutsTable.$inferSelect;
