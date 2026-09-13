-- Phase 2 baseline: versioned schema managed by the Drizzle migrator.
-- This migration is intentionally idempotent so it can baseline the existing
-- production database while also creating the current schema on a fresh DB.

CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "username" text NOT NULL UNIQUE,
  "password_hash" text,
  "last_login_at" timestamptz,
  "name" text NOT NULL,
  "email" text UNIQUE,
  "phone" text,
  "clerk_user_id" text UNIQUE,
  "role" text DEFAULT 'staff' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "permissions" jsonb DEFAULT '{"dashboard":true,"members":false,"plans":false,"staff":false,"payroll":false,"payments":false,"vouchers":false,"accounts":false,"stock":false,"sales":false,"settings":false,"viewCost":false,"viewProfit":false,"viewAccounting":false,"manageStaff":false,"manageSettings":false,"managePayroll":false,"manageInventory":false,"manageMembers":false,"managePlans":false}'::jsonb NOT NULL,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "gym_name" text DEFAULT 'My Gym' NOT NULL,
  "phone" text,
  "address" text,
  "default_currency" text DEFAULT 'USD' NOT NULL,
  "usd_to_cdf_rate" double precision DEFAULT 2800 NOT NULL,
  "language" text DEFAULT 'fr' NOT NULL,
  "logo_url" text,
  "receipt_logo_url" text,
  "receipt_header" text,
  "receipt_footer" text,
  "membership_card_footer" text,
  "backup_enabled" text DEFAULT 'false' NOT NULL,
  "backup_time" text DEFAULT '02:00' NOT NULL,
  "green_api_instance_id" text,
  "green_api_token" text,
  "daily_summary_enabled" text DEFAULT 'false' NOT NULL,
  "daily_summary_hour" integer DEFAULT 21 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "user_name" text DEFAULT 'System' NOT NULL,
  "action" text NOT NULL,
  "entity" text,
  "entity_id" integer,
  "details" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_counters" (
  "entity" text PRIMARY KEY NOT NULL,
  "current_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_number" text UNIQUE,
  "name" text NOT NULL,
  "description" text,
  "duration_days" integer DEFAULT 30 NOT NULL,
  "price" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "coach_id" integer,
  "coach_fee" double precision DEFAULT 0,
  "coach_name" text,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "members" (
  "id" serial PRIMARY KEY NOT NULL,
  "member_number" text UNIQUE,
  "name" text NOT NULL,
  "email" text,
  "phone" text,
  "address" text,
  "emergency_contact" text,
  "gender" text,
  "plan_id" integer,
  "plan_name" text,
  "plan_price" double precision,
  "join_date" timestamptz DEFAULT now() NOT NULL,
  "start_date" timestamptz,
  "expiry_date" timestamptz,
  "last_check_in" timestamptz,
  "amount_paid" double precision DEFAULT 0,
  "discount" double precision DEFAULT 0,
  "balance" double precision DEFAULT 0,
  "currency" text DEFAULT 'USD' NOT NULL,
  "frozen_at" timestamptz,
  "frozen_until" timestamptz,
  "frozen_days" integer DEFAULT 0,
  "status" text DEFAULT 'active' NOT NULL,
  "photo_url" text,
  "fingerprint_id" text,
  "qr_code_id" text,
  "notes" text,
  "wa_chat_id" text,
  "cash_account_id" integer,
  "coach_id" integer,
  "commission_amount" double precision DEFAULT 0,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "check_ins" (
  "id" serial PRIMARY KEY NOT NULL,
  "member_id" integer,
  "member_name" text NOT NULL,
  "checked_in_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "payment_number" text UNIQUE,
  "direction" text DEFAULT 'in' NOT NULL,
  "category" text DEFAULT 'membership' NOT NULL,
  "type" text DEFAULT 'membership' NOT NULL,
  "linked_entity" text,
  "linked_entity_id" integer,
  "linked_entity_name" text,
  "member_id" integer,
  "member_name" text,
  "plan_id" integer,
  "plan_name" text,
  "amount" double precision DEFAULT 0 NOT NULL,
  "discount" double precision DEFAULT 0,
  "currency" text DEFAULT 'USD' NOT NULL,
  "exchange_rate" double precision DEFAULT 1 NOT NULL,
  "amount_usd" double precision,
  "amount_cdf" double precision,
  "account" text DEFAULT 'cash' NOT NULL,
  "notes" text,
  "payment_date" timestamptz DEFAULT now() NOT NULL,
  "status" text DEFAULT 'completed' NOT NULL,
  "created_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
  "id" serial PRIMARY KEY NOT NULL,
  "voucher_number" text UNIQUE,
  "type" text DEFAULT 'expense' NOT NULL,
  "category" text,
  "description" text NOT NULL,
  "amount" double precision DEFAULT 0 NOT NULL,
  "amount_usd" double precision,
  "currency" text DEFAULT 'USD' NOT NULL,
  "expense_date" timestamptz DEFAULT now() NOT NULL,
  "status" text DEFAULT 'recorded' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_number" text UNIQUE,
  "name" text NOT NULL,
  "barcode" text UNIQUE,
  "description" text,
  "category" text,
  "supplier" text,
  "notes" text,
  "quantity" integer DEFAULT 0 NOT NULL,
  "alert_quantity" integer DEFAULT 5 NOT NULL,
  "cost_price" double precision DEFAULT 0 NOT NULL,
  "selling_price" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_purchases" (
  "id" serial PRIMARY KEY NOT NULL,
  "purchase_number" text UNIQUE,
  "product_id" integer NOT NULL,
  "product_name" text,
  "quantity_added" integer DEFAULT 0 NOT NULL,
  "cost_per_unit" double precision DEFAULT 0 NOT NULL,
  "total_cost" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "exchange_rate" double precision DEFAULT 1 NOT NULL,
  "total_cost_usd" double precision,
  "total_cost_cdf" double precision,
  "supplier" text,
  "notes" text,
  "paid_from_cash" integer DEFAULT 0 NOT NULL,
  "payment_id" integer,
  "ledger_entry_id" integer,
  "purchase_date" timestamptz DEFAULT now() NOT NULL,
  "created_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_employees" (
  "id" serial PRIMARY KEY NOT NULL,
  "staff_number" text UNIQUE,
  "linked_user_id" integer,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "job_title" text,
  "hire_date" timestamptz,
  "salary" double precision DEFAULT 0 NOT NULL,
  "salary_currency" text DEFAULT 'USD' NOT NULL,
  "payment_frequency" text DEFAULT 'monthly' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "notes" text,
  "created_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll" (
  "id" serial PRIMARY KEY NOT NULL,
  "payroll_number" text UNIQUE,
  "staff_employee_id" integer,
  "user_name" text NOT NULL,
  "staff_number" text,
  "period_start" timestamptz,
  "period_end" timestamptz,
  "amount" double precision DEFAULT 0 NOT NULL,
  "bonus" double precision DEFAULT 0 NOT NULL,
  "deduction" double precision DEFAULT 0 NOT NULL,
  "net_pay" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "exchange_rate" double precision DEFAULT 1 NOT NULL,
  "amount_usd" double precision,
  "commission_bonus" double precision DEFAULT 0 NOT NULL,
  "notes" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "paid_at" timestamptz,
  "paid_by" text,
  "payment_id" integer,
  "cancelled_at" timestamptz,
  "cancelled_by" text,
  "cancel_reason" text,
  "created_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales" (
  "id" serial PRIMARY KEY NOT NULL,
  "sale_number" text UNIQUE,
  "items" jsonb DEFAULT '[]'::jsonb,
  "total_amount" double precision DEFAULT 0 NOT NULL,
  "total_discount" double precision DEFAULT 0 NOT NULL,
  "cost_total" double precision DEFAULT 0 NOT NULL,
  "total_profit" double precision DEFAULT 0 NOT NULL,
  "total_amount_usd" double precision,
  "cost_total_usd" double precision,
  "total_profit_usd" double precision,
  "currency" text DEFAULT 'USD' NOT NULL,
  "exchange_rate" double precision DEFAULT 1 NOT NULL,
  "payment_amount" double precision DEFAULT 0 NOT NULL,
  "change_due" double precision DEFAULT 0 NOT NULL,
  "payment_id" integer,
  "notes" text,
  "created_by" text,
  "sale_date" timestamptz DEFAULT now() NOT NULL,
  "status" text DEFAULT 'completed' NOT NULL,
  "voided_at" timestamptz,
  "voided_by" text,
  "void_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vouchers" (
  "id" serial PRIMARY KEY NOT NULL,
  "voucher_number" text UNIQUE,
  "voucher_type" text DEFAULT 'cash_receipt' NOT NULL,
  "direction" text DEFAULT 'in' NOT NULL,
  "voucher_date" timestamptz DEFAULT now() NOT NULL,
  "paid_to" text,
  "received_from" text,
  "linked_entity" text,
  "linked_entity_id" integer,
  "linked_entity_name" text,
  "amount" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "exchange_rate" double precision DEFAULT 1 NOT NULL,
  "amount_usd" double precision,
  "amount_cdf" double precision,
  "account" text DEFAULT 'cash' NOT NULL,
  "category" text,
  "description" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'recorded' NOT NULL,
  "created_by" text,
  "deleted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_ledger" (
  "id" serial PRIMARY KEY NOT NULL,
  "entry_date" timestamptz DEFAULT now() NOT NULL,
  "source_type" text NOT NULL,
  "source_number" text,
  "source_id" integer,
  "direction" text NOT NULL,
  "amount" double precision NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "exchange_rate" double precision DEFAULT 1 NOT NULL,
  "amount_usd" double precision NOT NULL,
  "amount_cdf" double precision NOT NULL,
  "balance_usd" double precision DEFAULT 0 NOT NULL,
  "balance_cdf" double precision DEFAULT 0 NOT NULL,
  "description" text,
  "created_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_reads" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer,
  "user_clerk_id" text,
  "notification_key" text NOT NULL,
  "read_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL UNIQUE,
  "type" text DEFAULT 'asset' NOT NULL,
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "entry_date" timestamptz DEFAULT now() NOT NULL,
  "source_type" text NOT NULL,
  "source_id" integer,
  "source_number" text,
  "account_id" integer,
  "account_name_snapshot" text,
  "debit_usd" double precision DEFAULT 0 NOT NULL,
  "credit_usd" double precision DEFAULT 0 NOT NULL,
  "debit_cdf" double precision DEFAULT 0 NOT NULL,
  "credit_cdf" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "amount" double precision DEFAULT 0 NOT NULL,
  "exchange_rate" double precision DEFAULT 1 NOT NULL,
  "description" text,
  "created_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "staff_employee_id" integer NOT NULL,
  "member_id" integer,
  "member_name" text,
  "amount" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "payroll_id" integer,
  "note" text,
  "paid_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_chats" (
  "id" serial PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "chat_id" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_reminder_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "member_id" integer NOT NULL,
  "reminder_type" text NOT NULL,
  "sent_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_credits" (
  "id" serial PRIMARY KEY NOT NULL,
  "credit_number" text UNIQUE,
  "supplier" text NOT NULL,
  "description" text,
  "product_id" integer,
  "product_name" text,
  "total_amount" double precision NOT NULL,
  "amount_paid" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "purchase_date" timestamptz DEFAULT now() NOT NULL,
  "notes" text,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "credit_id" integer NOT NULL,
  "amount" double precision NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "payment_date" timestamptz DEFAULT now() NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Legacy compatibility for databases that predate the versioned migration system.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "coach_id" integer;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "coach_fee" double precision DEFAULT 0;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "coach_name" text;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "cash_account_id" integer;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "wa_chat_id" text;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "coach_id" integer;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "commission_amount" double precision DEFAULT 0;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "daily_summary_enabled" text DEFAULT 'false' NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "daily_summary_hour" integer DEFAULT 21 NOT NULL;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "cost_total_usd" double precision;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "voided_at" timestamptz;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "voided_by" text;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "void_reason" text;
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "payroll" ADD COLUMN IF NOT EXISTS "commission_bonus" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "payroll" ADD COLUMN IF NOT EXISTS "payment_id" integer;
ALTER TABLE "payroll" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
ALTER TABLE "payroll" ADD COLUMN IF NOT EXISTS "cancelled_by" text;
ALTER TABLE "payroll" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_payments_member_id" ON "payments" ("member_id");
CREATE INDEX IF NOT EXISTS "idx_payments_payment_date" ON "payments" ("payment_date");
CREATE INDEX IF NOT EXISTS "idx_payments_status" ON "payments" ("status");
CREATE INDEX IF NOT EXISTS "idx_check_ins_member_id" ON "check_ins" ("member_id");
CREATE INDEX IF NOT EXISTS "idx_members_plan_id" ON "members" ("plan_id");
CREATE INDEX IF NOT EXISTS "idx_members_expiry_date" ON "members" ("expiry_date");
CREATE INDEX IF NOT EXISTS "idx_commissions_staff_id" ON "commissions" ("staff_employee_id");
CREATE INDEX IF NOT EXISTS "idx_commissions_member_id" ON "commissions" ("member_id");
CREATE INDEX IF NOT EXISTS "idx_activity_logs_user_id" ON "activity_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_cash_ledger_source_id" ON "cash_ledger" ("source_id");
CREATE INDEX IF NOT EXISTS "idx_accounting_entries_source" ON "accounting_entries" ("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "idx_accounting_entries_account_id" ON "accounting_entries" ("account_id");
CREATE INDEX IF NOT EXISTS "idx_sales_sale_date" ON "sales" ("sale_date");
CREATE INDEX IF NOT EXISTS "idx_vouchers_voucher_date" ON "vouchers" ("voucher_date");
CREATE INDEX IF NOT EXISTS "idx_stock_purchases_product_id" ON "stock_purchases" ("product_id");
--> statement-breakpoint

INSERT INTO "chart_of_accounts" ("name", "type") VALUES
  ('Cash', 'asset'),
  ('Bank', 'asset'),
  ('Mobile Money', 'asset'),
  ('Inventory', 'asset'),
  ('Membership Revenue', 'income'),
  ('Sales Revenue', 'income'),
  ('Other Income', 'income'),
  ('General Expense', 'expense'),
  ('Payroll Expense', 'expense'),
  ('Other Expense', 'expense')
ON CONFLICT ("name") DO NOTHING;
