-- Phase 2 accounting correctness: deterministic money precision, locked FX, and canonical accounts.

-- Legacy tables that did not snapshot FX now receive a transaction-level rate.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(20,8) NOT NULL DEFAULT 1;
ALTER TABLE "supplier_credits" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(20,8) NOT NULL DEFAULT 1;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(20,8) NOT NULL DEFAULT 1;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "account" text NOT NULL DEFAULT 'cash';
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "payment_id" integer;
--> statement-breakpoint

-- Freeze a best-known FX rate onto legacy rows before application code relies on it.
UPDATE "expenses" e
SET "exchange_rate" = CASE
  WHEN e.currency = 'CDF' AND COALESCE(e.amount_usd, 0) > 0 THEN ROUND((e.amount::numeric / e.amount_usd::numeric), 8)
  ELSE COALESCE((SELECT s.usd_to_cdf_rate::numeric FROM settings s LIMIT 1), 2800::numeric)
END
WHERE e.exchange_rate = 1;

UPDATE "supplier_credits" sc
SET "exchange_rate" = COALESCE((SELECT s.usd_to_cdf_rate::numeric FROM settings s LIMIT 1), 2800::numeric)
WHERE sc.exchange_rate = 1;

UPDATE "supplier_payments" sp
SET "exchange_rate" = COALESCE(
  (SELECT sc.exchange_rate FROM supplier_credits sc WHERE sc.id = sp.credit_id),
  (SELECT s.usd_to_cdf_rate::numeric FROM settings s LIMIT 1),
  2800::numeric
)
WHERE sp.exchange_rate = 1;
--> statement-breakpoint

-- Core accounting journals.
ALTER TABLE "accounting_entries" ALTER COLUMN "debit_usd" TYPE numeric(20,6) USING ROUND("debit_usd"::numeric, 6);
ALTER TABLE "accounting_entries" ALTER COLUMN "credit_usd" TYPE numeric(20,6) USING ROUND("credit_usd"::numeric, 6);
ALTER TABLE "accounting_entries" ALTER COLUMN "debit_cdf" TYPE numeric(20,6) USING ROUND("debit_cdf"::numeric, 6);
ALTER TABLE "accounting_entries" ALTER COLUMN "credit_cdf" TYPE numeric(20,6) USING ROUND("credit_cdf"::numeric, 6);
ALTER TABLE "accounting_entries" ALTER COLUMN "amount" TYPE numeric(20,6) USING ROUND("amount"::numeric, 6);
ALTER TABLE "accounting_entries" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);

ALTER TABLE "cash_ledger" ALTER COLUMN "amount" TYPE numeric(20,6) USING ROUND("amount"::numeric, 6);
ALTER TABLE "cash_ledger" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);
ALTER TABLE "cash_ledger" ALTER COLUMN "amount_usd" TYPE numeric(20,6) USING ROUND("amount_usd"::numeric, 6);
ALTER TABLE "cash_ledger" ALTER COLUMN "amount_cdf" TYPE numeric(20,6) USING ROUND("amount_cdf"::numeric, 6);
ALTER TABLE "cash_ledger" ALTER COLUMN "balance_usd" TYPE numeric(20,6) USING ROUND("balance_usd"::numeric, 6);
ALTER TABLE "cash_ledger" ALTER COLUMN "balance_cdf" TYPE numeric(20,6) USING ROUND("balance_cdf"::numeric, 6);
--> statement-breakpoint

-- Operational financial records.
ALTER TABLE "payments" ALTER COLUMN "amount" TYPE numeric(20,6) USING ROUND("amount"::numeric, 6);
ALTER TABLE "payments" ALTER COLUMN "discount" TYPE numeric(20,6) USING ROUND("discount"::numeric, 6);
ALTER TABLE "payments" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);
ALTER TABLE "payments" ALTER COLUMN "amount_usd" TYPE numeric(20,6) USING ROUND("amount_usd"::numeric, 6);
ALTER TABLE "payments" ALTER COLUMN "amount_cdf" TYPE numeric(20,6) USING ROUND("amount_cdf"::numeric, 6);

ALTER TABLE "vouchers" ALTER COLUMN "amount" TYPE numeric(20,6) USING ROUND("amount"::numeric, 6);
ALTER TABLE "vouchers" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);
ALTER TABLE "vouchers" ALTER COLUMN "amount_usd" TYPE numeric(20,6) USING ROUND("amount_usd"::numeric, 6);
ALTER TABLE "vouchers" ALTER COLUMN "amount_cdf" TYPE numeric(20,6) USING ROUND("amount_cdf"::numeric, 6);

ALTER TABLE "sales" ALTER COLUMN "total_amount" TYPE numeric(20,6) USING ROUND("total_amount"::numeric, 6);
ALTER TABLE "sales" ALTER COLUMN "total_discount" TYPE numeric(20,6) USING ROUND("total_discount"::numeric, 6);
ALTER TABLE "sales" ALTER COLUMN "cost_total" TYPE numeric(20,6) USING ROUND("cost_total"::numeric, 6);
ALTER TABLE "sales" ALTER COLUMN "total_profit" TYPE numeric(20,6) USING ROUND("total_profit"::numeric, 6);
ALTER TABLE "sales" ALTER COLUMN "total_amount_usd" TYPE numeric(20,6) USING ROUND("total_amount_usd"::numeric, 6);
ALTER TABLE "sales" ALTER COLUMN "cost_total_usd" TYPE numeric(20,6) USING ROUND("cost_total_usd"::numeric, 6);
ALTER TABLE "sales" ALTER COLUMN "total_profit_usd" TYPE numeric(20,6) USING ROUND("total_profit_usd"::numeric, 6);
ALTER TABLE "sales" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);
ALTER TABLE "sales" ALTER COLUMN "payment_amount" TYPE numeric(20,6) USING ROUND("payment_amount"::numeric, 6);
ALTER TABLE "sales" ALTER COLUMN "change_due" TYPE numeric(20,6) USING ROUND("change_due"::numeric, 6);
--> statement-breakpoint

-- Inventory valuation and supplier liabilities.
ALTER TABLE "products" ALTER COLUMN "cost_price" TYPE numeric(20,6) USING ROUND("cost_price"::numeric, 6);
ALTER TABLE "products" ALTER COLUMN "selling_price" TYPE numeric(20,6) USING ROUND("selling_price"::numeric, 6);
ALTER TABLE "stock_purchases" ALTER COLUMN "cost_per_unit" TYPE numeric(20,6) USING ROUND("cost_per_unit"::numeric, 6);
ALTER TABLE "stock_purchases" ALTER COLUMN "total_cost" TYPE numeric(20,6) USING ROUND("total_cost"::numeric, 6);
ALTER TABLE "stock_purchases" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);
ALTER TABLE "stock_purchases" ALTER COLUMN "total_cost_usd" TYPE numeric(20,6) USING ROUND("total_cost_usd"::numeric, 6);
ALTER TABLE "stock_purchases" ALTER COLUMN "total_cost_cdf" TYPE numeric(20,6) USING ROUND("total_cost_cdf"::numeric, 6);
ALTER TABLE "supplier_credits" ALTER COLUMN "total_amount" TYPE numeric(20,6) USING ROUND("total_amount"::numeric, 6);
ALTER TABLE "supplier_credits" ALTER COLUMN "amount_paid" TYPE numeric(20,6) USING ROUND("amount_paid"::numeric, 6);
ALTER TABLE "supplier_credits" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);
ALTER TABLE "supplier_payments" ALTER COLUMN "amount" TYPE numeric(20,6) USING ROUND("amount"::numeric, 6);
ALTER TABLE "supplier_payments" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);
--> statement-breakpoint

-- Payroll, memberships, pricing, commissions, and settings.
ALTER TABLE "payroll" ALTER COLUMN "amount" TYPE numeric(20,6) USING ROUND("amount"::numeric, 6);
ALTER TABLE "payroll" ALTER COLUMN "bonus" TYPE numeric(20,6) USING ROUND("bonus"::numeric, 6);
ALTER TABLE "payroll" ALTER COLUMN "deduction" TYPE numeric(20,6) USING ROUND("deduction"::numeric, 6);
ALTER TABLE "payroll" ALTER COLUMN "net_pay" TYPE numeric(20,6) USING ROUND("net_pay"::numeric, 6);
ALTER TABLE "payroll" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);
ALTER TABLE "payroll" ALTER COLUMN "amount_usd" TYPE numeric(20,6) USING ROUND("amount_usd"::numeric, 6);
ALTER TABLE "payroll" ALTER COLUMN "commission_bonus" TYPE numeric(20,6) USING ROUND("commission_bonus"::numeric, 6);
ALTER TABLE "staff_employees" ALTER COLUMN "salary" TYPE numeric(20,6) USING ROUND("salary"::numeric, 6);
ALTER TABLE "plans" ALTER COLUMN "price" TYPE numeric(20,6) USING ROUND("price"::numeric, 6);
ALTER TABLE "plans" ALTER COLUMN "coach_fee" TYPE numeric(20,6) USING ROUND("coach_fee"::numeric, 6);
ALTER TABLE "members" ALTER COLUMN "plan_price" TYPE numeric(20,6) USING ROUND("plan_price"::numeric, 6);
ALTER TABLE "members" ALTER COLUMN "amount_paid" TYPE numeric(20,6) USING ROUND("amount_paid"::numeric, 6);
ALTER TABLE "members" ALTER COLUMN "discount" TYPE numeric(20,6) USING ROUND("discount"::numeric, 6);
ALTER TABLE "members" ALTER COLUMN "balance" TYPE numeric(20,6) USING ROUND("balance"::numeric, 6);
ALTER TABLE "members" ALTER COLUMN "commission_amount" TYPE numeric(20,6) USING ROUND("commission_amount"::numeric, 6);
ALTER TABLE "commissions" ALTER COLUMN "amount" TYPE numeric(20,6) USING ROUND("amount"::numeric, 6);
ALTER TABLE "settings" ALTER COLUMN "usd_to_cdf_rate" TYPE numeric(20,8) USING ROUND("usd_to_cdf_rate"::numeric, 8);
ALTER TABLE "expenses" ALTER COLUMN "amount" TYPE numeric(20,6) USING ROUND("amount"::numeric, 6);
ALTER TABLE "expenses" ALTER COLUMN "amount_usd" TYPE numeric(20,6) USING ROUND("amount_usd"::numeric, 6);
ALTER TABLE "expenses" ALTER COLUMN "exchange_rate" TYPE numeric(20,8) USING ROUND("exchange_rate"::numeric, 8);
--> statement-breakpoint

-- Canonical chart of accounts. Existing canonical rows are corrected in-place;
-- user-created/custom accounts are preserved untouched.
INSERT INTO "chart_of_accounts" ("name", "type", "description", "is_active") VALUES
  ('Cash', 'asset', 'Physical cash on hand', true),
  ('Bank', 'asset', 'Bank account cash', true),
  ('Mobile Money', 'asset', 'Mobile money balance', true),
  ('Petty Cash', 'asset', 'Petty cash balance', true),
  ('Inventory', 'asset', 'Inventory at cost', true),
  ('Supplier Payables', 'liability', 'Amounts owed to suppliers', true),
  ('Membership Revenue', 'income', 'Membership revenue', true),
  ('Sales Revenue', 'income', 'Product sales revenue', true),
  ('Other Income', 'income', 'Other operating income', true),
  ('Cost of Goods Sold', 'expense', 'Cost of inventory sold', true),
  ('Payroll Expense', 'expense', 'Payroll expense', true),
  ('General Expense', 'expense', 'General operating expense', true),
  ('Other Expense', 'expense', 'Other operating expense', true)
ON CONFLICT ("name") DO UPDATE SET
  "type" = EXCLUDED."type",
  "description" = EXCLUDED."description",
  "is_active" = true;
