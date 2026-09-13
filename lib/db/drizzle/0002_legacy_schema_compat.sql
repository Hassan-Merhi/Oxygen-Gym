-- Compatibility bridge for legacy Oxygen Gym databases created before stock FX metadata
-- was added to the canonical schema. This migration intentionally runs before
-- 0002_accounting_precision so that its ALTER COLUMN statements cannot fail on
-- columns that do not yet exist.

ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(20,8) NOT NULL DEFAULT 1;
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "total_cost_usd" numeric(20,6);
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "total_cost_cdf" numeric(20,6);
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "payment_id" integer;
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "ledger_entry_id" integer;
ALTER TABLE "stock_purchases" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint

-- Freeze a best-known FX rate onto legacy stock rows. Prefer an already-derived
-- CDF row's USD equivalent when available; otherwise use the configured gym rate.
UPDATE "stock_purchases" sp
SET "exchange_rate" = CASE
  WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'CDF'
    AND COALESCE(sp.total_cost_usd, 0) > 0
    AND COALESCE(sp.total_cost, 0) > 0
    THEN ROUND((sp.total_cost::numeric / NULLIF(sp.total_cost_usd::numeric, 0)), 8)
  ELSE COALESCE((SELECT s.usd_to_cdf_rate::numeric FROM settings s LIMIT 1), 2800::numeric)
END
WHERE COALESCE(sp.exchange_rate, 0) <= 1;

UPDATE "stock_purchases" sp
SET
  "total_cost_usd" = CASE
    WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'USD' THEN ROUND(COALESCE(sp.total_cost, 0)::numeric, 6)
    ELSE ROUND((COALESCE(sp.total_cost, 0)::numeric / NULLIF(sp.exchange_rate::numeric, 0)), 6)
  END,
  "total_cost_cdf" = CASE
    WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'CDF' THEN ROUND(COALESCE(sp.total_cost, 0)::numeric, 6)
    ELSE ROUND((COALESCE(sp.total_cost, 0)::numeric * sp.exchange_rate::numeric), 6)
  END
WHERE sp.total_cost_usd IS NULL OR sp.total_cost_cdf IS NULL;
