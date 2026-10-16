-- Ledger hardening: every posting belongs to a balanced journal, posted rows
-- are append-only, closed periods are locked, and supplier documents are
-- soft-deleted instead of removed.

ALTER TABLE "accounting_entries" ADD COLUMN IF NOT EXISTS "journal_id" text;
--> statement-breakpoint
UPDATE "accounting_entries"
SET "journal_id" = 'legacy:' || "source_type" || ':' || COALESCE("source_id"::text, "source_number", "id"::text)
WHERE "journal_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "accounting_entries" ALTER COLUMN "journal_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_entries_journal_idx" ON "accounting_entries" ("journal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_entries_account_date_idx" ON "accounting_entries" ("account_id", "entry_date", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_entries_date_idx" ON "accounting_entries" ("entry_date", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_entries_source_idx" ON "accounting_entries" ("source_type", "source_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "accounting_periods" (
  "id" serial PRIMARY KEY,
  "closed_through" timestamp with time zone NOT NULL,
  "journal_id" text,
  "net_income_usd" numeric(20, 6) DEFAULT 0 NOT NULL,
  "net_income_cdf" numeric(20, 6) DEFAULT 0 NOT NULL,
  "notes" text,
  "closed_by" text,
  "closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_periods_closed_through_idx" ON "accounting_periods" ("closed_through");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stock_adjustments" (
  "id" serial PRIMARY KEY,
  "adjustment_number" text UNIQUE,
  "product_id" integer NOT NULL,
  "product_name" text,
  "quantity_before" integer NOT NULL,
  "quantity_after" integer NOT NULL,
  "cost_before" numeric(20, 6) NOT NULL,
  "cost_after" numeric(20, 6) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "exchange_rate" numeric(20, 8) DEFAULT 1 NOT NULL,
  "value_change_usd" numeric(20, 6) DEFAULT 0 NOT NULL,
  "reason" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_adjustments_product_idx" ON "stock_adjustments" ("product_id", "created_at");
--> statement-breakpoint

ALTER TABLE "supplier_credits" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "supplier_credits" ADD COLUMN IF NOT EXISTS "deleted_by" text;
--> statement-breakpoint
ALTER TABLE "supplier_credits" ADD COLUMN IF NOT EXISTS "stock_purchase_id" integer;
--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "deleted_by" text;
--> statement-breakpoint
ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "payment_id" integer;
--> statement-breakpoint

INSERT INTO "chart_of_accounts" ("name", "type", "description", "is_active")
VALUES
  ('Retained Earnings', 'equity', 'Accumulated profit closed from prior periods', true),
  ('Opening Balance Equity', 'equity', 'Opening balances and one-time reconciliations', true),
  ('FX Gain/Loss', 'income', 'Gains (credit) and losses (debit) from USD/CDF revaluation', true),
  ('Cash Over/Short', 'expense', 'Differences found when counting the cash drawer', true),
  ('Inventory Adjustments', 'expense', 'Stock count corrections, damage and cost revaluation', true)
ON CONFLICT ("name") DO UPDATE SET "type" = EXCLUDED."type", "is_active" = true;
--> statement-breakpoint

-- Each journal must balance in both currencies once the transaction commits.
CREATE OR REPLACE FUNCTION "accounting_journal_balance_check"() RETURNS trigger AS $$
DECLARE
  usd_diff numeric;
  cdf_diff numeric;
BEGIN
  SELECT COALESCE(SUM("debit_usd" - "credit_usd"), 0), COALESCE(SUM("debit_cdf" - "credit_cdf"), 0)
    INTO usd_diff, cdf_diff
  FROM "accounting_entries"
  WHERE "journal_id" = NEW."journal_id";
  IF ABS(usd_diff) > 0.00001 OR ABS(cdf_diff) > 0.00001 THEN
    RAISE EXCEPTION 'Journal % is unbalanced (USD %, CDF %)', NEW."journal_id", usd_diff, cdf_diff;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "accounting_entries_balanced" ON "accounting_entries";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "accounting_entries_balanced"
  AFTER INSERT ON "accounting_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "accounting_journal_balance_check"();
--> statement-breakpoint

-- Posted entries are immutable. Corrections post a reversing journal.
-- Offline maintenance scripts may opt out with SET LOCAL oxygen_gym.ledger_maintenance = 'on'.
CREATE OR REPLACE FUNCTION "accounting_entries_append_only"() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('oxygen_gym.ledger_maintenance', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'accounting_entries is append-only; post a reversing journal instead';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "accounting_entries_immutable" ON "accounting_entries";
--> statement-breakpoint
CREATE TRIGGER "accounting_entries_immutable"
  BEFORE UPDATE OR DELETE ON "accounting_entries"
  FOR EACH ROW EXECUTE FUNCTION "accounting_entries_append_only"();
--> statement-breakpoint

-- Nothing may be posted into a closed period.
CREATE OR REPLACE FUNCTION "accounting_entries_period_lock"() RETURNS trigger AS $$
DECLARE
  locked_through timestamptz;
BEGIN
  SELECT MAX("closed_through") INTO locked_through FROM "accounting_periods";
  IF locked_through IS NOT NULL AND NEW."entry_date" <= locked_through THEN
    RAISE EXCEPTION 'Books are closed through %; date this entry after the close', locked_through;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "accounting_entries_period_lock" ON "accounting_entries";
--> statement-breakpoint
CREATE TRIGGER "accounting_entries_period_lock"
  BEFORE INSERT ON "accounting_entries"
  FOR EACH ROW EXECUTE FUNCTION "accounting_entries_period_lock"();
