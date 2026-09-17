-- High-traffic read-path indexes for Oxygen Gym.
-- Each index is idempotent so the migration is safe on existing production data.

CREATE INDEX IF NOT EXISTS "members_status_expiry_idx"
  ON "members" ("status", "expiry_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_deleted_status_join_idx"
  ON "members" ("deleted_at", "status", "join_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_deleted_plan_join_idx"
  ON "members" ("deleted_at", "plan_id", "join_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_status_date_idx"
  ON "payments" ("status", "payment_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_member_date_idx"
  ON "payments" ("member_id", "payment_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_direction_category_date_idx"
  ON "payments" ("direction", "category", "payment_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vouchers_status_deleted_date_idx"
  ON "vouchers" ("status", "deleted_at", "voucher_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vouchers_direction_date_idx"
  ON "vouchers" ("direction", "voucher_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_status_date_idx"
  ON "sales" ("status", "sale_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_status_quantity_idx"
  ON "products" ("status", "quantity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_status_name_idx"
  ON "products" ("status", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_purchases_product_date_idx"
  ON "stock_purchases" ("product_id", "purchase_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_status_idx"
  ON "payroll" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_reads_user_key_idx"
  ON "notification_reads" ("user_id", "notification_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "check_ins_member_date_idx"
  ON "check_ins" ("member_id", "checked_in_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_logs_entity_date_idx"
  ON "activity_logs" ("entity", "entity_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_ledger_direction_date_idx"
  ON "cash_ledger" ("direction", "entry_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_ledger_source_date_idx"
  ON "cash_ledger" ("source_type", "entry_date" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_entries_account_date_idx"
  ON "accounting_entries" ("account_id", "entry_date" DESC);
