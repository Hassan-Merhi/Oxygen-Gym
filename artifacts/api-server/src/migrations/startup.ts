import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { seedDefaultAccounts } from "../lib/accounting";

const MIGRATION_TABLE = "app_migrations";

async function ensureMigrationLedger(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_migrations (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function claimMigration(key: string): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO app_migrations (key) VALUES (${key})
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `);
  return ((result as unknown as { rowCount?: number }).rowCount ?? 0) > 0;
}

async function markMigrationFailed(key: string): Promise<void> {
  await db.execute(sql`DELETE FROM app_migrations WHERE key = ${key}`);
}

async function runTrackedMigration(key: string, migrate: () => Promise<void>): Promise<void> {
  const claimed = await claimMigration(key);
  if (!claimed) return;
  try {
    await migrate();
    logger.info({ migration: key }, "Startup migration applied");
  } catch (err) {
    await markMigrationFailed(key).catch(() => undefined);
    throw err;
  }
}

export async function runStartupMigrations(): Promise<void> {
  await ensureMigrationLedger();

  await runTrackedMigration("schema-baseline-v1", async () => {
    await db.execute(sql`
      ALTER TABLE plans
        ADD COLUMN IF NOT EXISTS coach_id integer,
        ADD COLUMN IF NOT EXISTS coach_fee double precision DEFAULT 0,
        ADD COLUMN IF NOT EXISTS coach_name text
    `);

    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS cash_account_id integer,
        ADD COLUMN IF NOT EXISTS wa_chat_id TEXT
    `);

    await db.execute(sql`
      ALTER TABLE settings
        ADD COLUMN IF NOT EXISTS daily_summary_enabled TEXT NOT NULL DEFAULT 'false',
        ADD COLUMN IF NOT EXISTS daily_summary_hour INTEGER NOT NULL DEFAULT 21
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS supplier_credits (
        id SERIAL PRIMARY KEY,
        credit_number TEXT UNIQUE,
        supplier TEXT NOT NULL,
        description TEXT,
        product_id INTEGER,
        product_name TEXT,
        total_amount DOUBLE PRECISION NOT NULL,
        amount_paid DOUBLE PRECISION NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        purchase_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS supplier_payments (
        id SERIAL PRIMARY KEY,
        credit_id INTEGER NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_payments_member_id      ON payments(member_id);
      CREATE INDEX IF NOT EXISTS idx_payments_payment_date   ON payments(payment_date);
      CREATE INDEX IF NOT EXISTS idx_payments_status         ON payments(status);
      CREATE INDEX IF NOT EXISTS idx_check_ins_member_id     ON check_ins(member_id);
      CREATE INDEX IF NOT EXISTS idx_members_plan_id         ON members(plan_id);
      CREATE INDEX IF NOT EXISTS idx_members_expiry_date     ON members(expiry_date);
      CREATE INDEX IF NOT EXISTS idx_commissions_staff_id    ON commissions(staff_employee_id);
      CREATE INDEX IF NOT EXISTS idx_commissions_member_id   ON commissions(member_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id   ON activity_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_cash_ledger_source_id   ON cash_ledger(source_id)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS accounting_entries (
        id SERIAL PRIMARY KEY,
        entry_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source_type TEXT NOT NULL,
        source_id INTEGER,
        source_number TEXT,
        account_id INTEGER,
        account_name_snapshot TEXT,
        debit_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
        credit_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
        debit_cdf DOUBLE PRECISION NOT NULL DEFAULT 0,
        credit_cdf DOUBLE PRECISION NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        exchange_rate DOUBLE PRECISION NOT NULL DEFAULT 1,
        description TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_accounting_entries_source     ON accounting_entries(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_accounting_entries_account_id ON accounting_entries(account_id)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS migration_flags (
        key TEXT PRIMARY KEY,
        ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  });

  await runTrackedMigration("payment-date-backfill-v1", async () => {
    const result = await db.execute(sql`
      UPDATE payments
      SET payment_date = m.start_date
      FROM members m
      WHERE payments.member_id = m.id
        AND m.start_date IS NOT NULL
        AND payments.category = 'membership'
        AND DATE(payments.payment_date AT TIME ZONE 'UTC')
            != DATE(m.start_date AT TIME ZONE 'UTC')
    `);
    logger.info({ fixed: (result as unknown as { rowCount?: number }).rowCount ?? 0 }, "Payment dates reconciled");
  });

  await runTrackedMigration("cdf-rate-repair-v1", async () => {
    const payments = await db.execute(sql`
      WITH rate AS (SELECT COALESCE(usd_to_cdf_rate, 2800) AS r FROM settings LIMIT 1)
      UPDATE payments
      SET amount_usd = amount / (SELECT r FROM rate), exchange_rate = (SELECT r FROM rate)
      WHERE currency = 'CDF' AND exchange_rate < 10
    `);
    const sales = await db.execute(sql`
      WITH rate AS (SELECT COALESCE(usd_to_cdf_rate, 2800) AS r FROM settings LIMIT 1)
      UPDATE sales
      SET total_amount_usd = total_amount / (SELECT r FROM rate),
          total_profit_usd = total_profit / (SELECT r FROM rate),
          exchange_rate = (SELECT r FROM rate)
      WHERE currency = 'CDF' AND exchange_rate < 10
    `);
    logger.info({
      repairedPayments: (payments as unknown as { rowCount?: number }).rowCount ?? 0,
      repairedSales: (sales as unknown as { rowCount?: number }).rowCount ?? 0,
    }, "CDF historical exchange rates reconciled");
  });

  await runTrackedMigration("cash-wipe-v1", async () => {
    const legacyFlag = await db.execute(sql`
      INSERT INTO migration_flags (key) VALUES ('cash_wipe_v1')
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);
    const shouldWipe = ((legacyFlag as unknown as { rowCount?: number }).rowCount ?? 0) > 0;
    if (!shouldWipe) return;
    await db.execute(sql`DELETE FROM accounting_entries`);
    await db.execute(sql`DELETE FROM commissions`);
    await db.execute(sql`DELETE FROM expenses`);
    await db.execute(sql`DELETE FROM vouchers`);
    await db.execute(sql`DELETE FROM payments`);
    await db.execute(sql`DELETE FROM sales`);
    await db.execute(sql`DELETE FROM cash_ledger`);
    logger.info("Legacy one-time cash wipe completed");
  });

  await runTrackedMigration("voucher-dedupe-v1", async () => {
    const result = await db.execute(sql`
      UPDATE vouchers
      SET status = 'cancelled', updated_at = NOW()
      WHERE linked_entity = 'member'
        AND voucher_type = 'cash_receipt'
        AND status = 'recorded'
        AND deleted_at IS NULL
        AND id NOT IN (
          SELECT DISTINCT ON (linked_entity_id) id
          FROM vouchers
          WHERE linked_entity = 'member'
            AND voucher_type = 'cash_receipt'
            AND status = 'recorded'
            AND deleted_at IS NULL
          ORDER BY linked_entity_id, id DESC
        )
    `);
    logger.info({ cancelled: (result as unknown as { rowCount?: number }).rowCount ?? 0 }, "Duplicate membership vouchers reconciled");
  });

  await runTrackedMigration("sales-cashbook-backfill-v1", async () => {
    const legacyFlag = await db.execute(sql`
      INSERT INTO migration_flags (key) VALUES ('sales_cashbook_backfill_v1')
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);
    if (((legacyFlag as unknown as { rowCount?: number }).rowCount ?? 0) === 0) return;

    const result = await db.execute(sql`
      INSERT INTO payments (
        payment_number, direction, category, type,
        linked_entity, linked_entity_id, linked_entity_name,
        amount, currency, exchange_rate, amount_usd, amount_cdf,
        account, notes, payment_date, status, created_by
      )
      SELECT
        s.sale_number,
        'in',
        'product_sale',
        'product_sale',
        'sale',
        s.id,
        s.sale_number,
        s.total_amount,
        s.currency,
        COALESCE(s.exchange_rate, 2800),
        CASE WHEN s.currency = 'USD' THEN s.total_amount ELSE s.total_amount / COALESCE(s.exchange_rate, 2800) END,
        CASE WHEN s.currency = 'CDF' THEN s.total_amount ELSE s.total_amount * COALESCE(s.exchange_rate, 2800) END,
        'cash',
        NULL,
        s.sale_date,
        'completed',
        s.created_by
      FROM sales s
      WHERE s.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.linked_entity = 'sale'
            AND p.linked_entity_id = s.id
            AND p.status = 'completed'
        )
    `);
    logger.info({ backfilled: (result as unknown as { rowCount?: number }).rowCount ?? 0 }, "Completed sales backfilled to cash book");
  });

  await seedDefaultAccounts();
  logger.info({ migrationLedger: MIGRATION_TABLE }, "Startup migrations complete");
}
