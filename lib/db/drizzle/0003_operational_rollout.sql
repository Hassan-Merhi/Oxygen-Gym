-- Phase 13: singleton control-plane state for staged operational rollout.
-- The application is intentionally enabled for the internal cohort first.

CREATE TABLE IF NOT EXISTS "operational_rollouts" (
  "id" integer PRIMARY KEY NOT NULL,
  "feature_key" text DEFAULT 'phase-13-operational-rollout' NOT NULL,
  "stage" text DEFAULT 'internal' NOT NULL,
  "acknowledged_warning_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_by" integer,
  "updated_by_name" text,
  "last_transition_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "operational_rollouts_stage_check"
    CHECK ("stage" IN ('internal', 'canary', 'general'))
);
--> statement-breakpoint

INSERT INTO "operational_rollouts" ("id", "feature_key", "stage")
VALUES (1, 'phase-13-operational-rollout', 'internal')
ON CONFLICT ("id") DO NOTHING;
