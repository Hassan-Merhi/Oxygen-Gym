-- Phase 1 Render hotfix: repair legacy financial schemas used by the canonical cash ledger.
--
-- Production has existed in more than one schema state (older db:push baselines and
-- newer Drizzle migrations). The ledger query must never assume that a historical
-- database already contains the FX snapshot columns introduced later.
--
-- This migration is intentionally idempotent so it is safe on fully-current,
-- partially-migrated, and legacy databases.

-- Stock purchases: the ledger reads these columns directly.
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(20,8) NOT NULL DEFAULT 1;
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "total_cost_usd" numeric(20,6);
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "total_cost_cdf" numeric(20,6);
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "payment_id" integer;
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "ledger_entry_id" integer;
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint

-- Supplier credits/payments: older production schemas were created before these
-- transaction-level FX fields existed, while current application code reads them.
ALTER TABLE "supplier_credits" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(20,8) NOT NULL DEFAULT 1;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(20,8) NOT NULL DEFAULT 1;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "amount_usd" numeric(20,6);
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "amount_cdf" numeric(20,6);
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "account" text NOT NULL DEFAULT 'cash';
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "payment_id" integer;
--> statement-breakpoint

-- Backfill only missing/legacy FX snapshots. Keep already-valid historical rates.
UPDATE "supplier_credits" sc
SET "exchange_rate" = COALESCE(
  (SELECT s.usd_to_cdf_rate::numeric FROM settings s LIMIT 1),
  2800::numeric
)
WHERE COALESCE(sc.exchange_rate, 0) <= 1;

UPDATE "stock_purchases" sp
SET "exchange_rate" = CASE
  WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'CDF'
    AND COALESCE(sp.total_cost_usd, 0) > 0
    AND COALESCE(sp.total_cost, 0) > 0
    THEN ROUND((sp.total_cost::numeric / NULLIF(sp.total_cost_usd::numeric, 0)), 8)
  ELSE COALESCE(
    (SELECT s.usd_to_cdf_rate::numeric FROM settings s LIMIT 1),
    2800::numeric
  )
END
WHERE COALESCE(sp.exchange_rate, 0) <= 1;

UPDATE "supplier_payments" sp
SET "exchange_rate" = COALESCE(
  (SELECT sc.exchange_rate FROM supplier_credits sc WHERE sc.id = sp.credit_id),
  (SELECT s.usd_to_cdf_rate::numeric FROM settings s LIMIT 1),
  2800::numeric
)
WHERE COALESCE(sp.exchange_rate, 0) <= 1;
--> statement-breakpoint

-- Reconstruct derived currency values only when they are absent. These are snapshots
-- for audit/history; existing non-null derived values remain untouched.
UPDATE "stock_purchases" sp
SET
  "total_cost_usd" = CASE
    WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'USD'
      THEN ROUND(COALESCE(sp.total_cost, 0)::numeric, 6)
    ELSE ROUND((COALESCE(sp.total_cost, 0)::numeric / NULLIF(sp.exchange_rate::numeric, 0)), 6)
  END,
  "total_cost_cdf" = CASE
    WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'CDF'
      THEN ROUND(COALESCE(sp.total_cost, 0)::numeric, 6)
    ELSE ROUND((COALESCE(sp.total_cost, 0)::numeric * sp.exchange_rate::numeric), 6)
  END
WHERE sp.total_cost_usd IS NULL OR sp.total_cost_cdf IS NULL;

UPDATE "supplier_payments" sp
SET
  "amount_usd" = CASE
    WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'USD'
      THEN ROUND(COALESCE(sp.amount, 0)::numeric, 6)
    ELSE ROUND((COALESCE(sp.amount, 0)::numeric / NULLIF(sp.exchange_rate::numeric, 0)), 6)
  END,
  "amount_cdf" = CASE
    WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'CDF'
      THEN ROUND(COALESCE(sp.amount, 0)::numeric, 6)
    ELSE ROUND((COALESCE(sp.amount, 0)::numeric * sp.exchange_rate::numeric), 6)
  END
WHERE sp.amount_usd IS NULL OR sp.amount_cdf IS NULL;
