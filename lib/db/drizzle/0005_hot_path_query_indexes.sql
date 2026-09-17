-- Phase 4: indexes matched to the slow production read paths.
-- All indexes are idempotent and preserve existing accounting semantics.

-- Canonical Cash stream: only completed physical-cash payments participate.
CREATE INDEX IF NOT EXISTS "payments_cash_statement_date_idx"
  ON "payments" ("payment_date", "id")
  WHERE "status" = 'completed'
    AND LOWER(REPLACE(TRIM(COALESCE(NULLIF("account", ''), 'cash')), '_', ' '))
      IN ('cash', 'physical cash', 'cash account');
--> statement-breakpoint

-- Legacy member cash-receipt de-duplication probes member/day/currency/amount.
CREATE INDEX IF NOT EXISTS "payments_membership_cash_match_idx"
  ON "payments" ("member_id", "payment_date", "currency", "amount")
  WHERE "status" = 'completed'
    AND "category" = 'membership'
    AND LOWER(REPLACE(TRIM(COALESCE(NULLIF("account", ''), 'cash')), '_', ' '))
      IN ('cash', 'physical cash', 'cash account');
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vouchers_cash_statement_date_idx"
  ON "vouchers" ("voucher_date", "id")
  WHERE "status" = 'recorded'
    AND "deleted_at" IS NULL
    AND LOWER(REPLACE(TRIM(COALESCE(NULLIF("account", ''), 'cash')), '_', ' '))
      IN ('cash', 'physical cash', 'cash account');
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "stock_purchases_cash_statement_date_idx"
  ON "stock_purchases" ("purchase_date", "id")
  WHERE "paid_from_cash" = 1;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "supplier_payments_statement_date_idx"
  ON "supplier_payments" ("payment_date", "id");
--> statement-breakpoint

-- Non-cash account statements order by account/date/id.
CREATE INDEX IF NOT EXISTS "accounting_entries_account_date_id_idx"
  ON "accounting_entries" ("account_id", "entry_date", "id");
--> statement-breakpoint

-- Voucher list defaults: recorded, non-deleted, newest first.
CREATE INDEX IF NOT EXISTS "vouchers_recorded_date_id_idx"
  ON "vouchers" ("voucher_date" DESC, "id" DESC)
  WHERE "status" = 'recorded' AND "deleted_at" IS NULL;
--> statement-breakpoint

-- Notification count/detail hot paths.
CREATE INDEX IF NOT EXISTS "members_active_expiry_notification_idx"
  ON "members" ("expiry_date", "id")
  WHERE "status" = 'active';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "members_frozen_notification_idx"
  ON "members" ("id")
  WHERE "status" = 'frozen';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "members_inactive_notification_idx"
  ON "members" ("id")
  WHERE "status" = 'inactive';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_active_quantity_notification_idx"
  ON "products" ("quantity", "id")
  WHERE "status" = 'active';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payroll_draft_notification_idx"
  ON "payroll" ("id")
  WHERE "status" = 'draft';
