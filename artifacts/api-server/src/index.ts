import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { db } from "@workspace/db";
import { settingsTable, membersTable, whatsappReminderLogsTable } from "@workspace/db/schema";
import { sql, and, eq, gte, lte, isNull, isNotNull } from "drizzle-orm";
import { sendDailySummaryNow, lookupPhoneOnWhatsApp, sendDirectMessage, formatExpiryReminderMessage } from "./lib/whatsapp";
import { seedDefaultAccounts } from "./lib/accounting";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Safe startup migrations (add missing columns; idempotent) ─────────────────
async function runStartupMigrations() {
  try {
    await db.execute(sql`
      ALTER TABLE plans
        ADD COLUMN IF NOT EXISTS coach_id integer,
        ADD COLUMN IF NOT EXISTS coach_fee double precision DEFAULT 0,
        ADD COLUMN IF NOT EXISTS coach_name text
    `);

    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS cash_account_id integer
    `);

    const backfill = await db.execute(sql`
      UPDATE payments
      SET payment_date = m.start_date
      FROM members m
      WHERE payments.member_id = m.id
        AND m.start_date IS NOT NULL
        AND payments.category = 'membership'
        AND DATE(payments.payment_date AT TIME ZONE 'UTC')
            != DATE(m.start_date AT TIME ZONE 'UTC')
    `);
    const fixed = (backfill as unknown as { rowCount?: number }).rowCount ?? 0;
    if (fixed > 0) {
      logger.info({ fixed }, "Back-filled payment_date from member start_date");
    }

    await db.execute(sql`
      ALTER TABLE settings
        ADD COLUMN IF NOT EXISTS daily_summary_enabled TEXT NOT NULL DEFAULT 'false',
        ADD COLUMN IF NOT EXISTS daily_summary_hour INTEGER NOT NULL DEFAULT 21
    `);

    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS wa_chat_id TEXT
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

    // ── Create accounting_entries table if not present (idempotent) ────────────
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

    // ── Repair CDF records stored with wrong exchange_rate = 1 ────────────────
    const repairResult = await db.execute(sql`
      WITH rate AS (
        SELECT COALESCE(usd_to_cdf_rate, 2800) AS r FROM settings LIMIT 1
      )
      UPDATE payments
      SET
        amount_usd    = amount / (SELECT r FROM rate),
        exchange_rate = (SELECT r FROM rate)
      WHERE currency = 'CDF'
        AND exchange_rate < 10
    `);
    const repaired = (repairResult as unknown as { rowCount?: number }).rowCount ?? 0;
    if (repaired > 0) {
      logger.info({ repaired }, "Repaired CDF payment records with wrong exchange_rate");
    }

    const salesRepairResult = await db.execute(sql`
      WITH rate AS (
        SELECT COALESCE(usd_to_cdf_rate, 2800) AS r FROM settings LIMIT 1
      )
      UPDATE sales
      SET
        total_amount_usd  = total_amount  / (SELECT r FROM rate),
        total_profit_usd  = total_profit  / (SELECT r FROM rate),
        exchange_rate     = (SELECT r FROM rate)
      WHERE currency = 'CDF'
        AND exchange_rate < 10
    `);
    const repairedSales = (salesRepairResult as unknown as { rowCount?: number }).rowCount ?? 0;
    if (repairedSales > 0) {
      logger.info({ repairedSales }, "Repaired CDF sale records with wrong exchange_rate");
    }

    // ── One-time flag table for data wipes ───────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS migration_flags (
        key TEXT PRIMARY KEY,
        ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── One-time financial wipe (cash ledger, payments, vouchers, sales) ──────
    // Keeps members, plans, products/stock, staff, settings untouched.
    const wipeFlag = await db.execute(sql`
      INSERT INTO migration_flags (key) VALUES ('cash_wipe_v1')
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);
    const isFirstRun = (wipeFlag as unknown as { rowCount?: number }).rowCount ?? 0;
    if (isFirstRun > 0) {
      await db.execute(sql`DELETE FROM accounting_entries`);
      await db.execute(sql`DELETE FROM commissions`);
      await db.execute(sql`DELETE FROM expenses`);
      await db.execute(sql`DELETE FROM vouchers`);
      await db.execute(sql`DELETE FROM payments`);
      await db.execute(sql`DELETE FROM sales`);
      await db.execute(sql`DELETE FROM cash_ledger`);
      logger.info("One-time cash wipe complete — ledger, payments, vouchers, sales cleared");
    }

    // ── Cancel duplicate Cash Receipt vouchers per member (keep newest) ────────
    const dupResult = await db.execute(sql`
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
    const dupCancelled = (dupResult as unknown as { rowCount?: number }).rowCount ?? 0;
    if (dupCancelled > 0) {
      logger.info({ dupCancelled }, "Cancelled duplicate membership Cash Receipt vouchers");
    }

    // ── Backfill payment records for completed sales missing from Cash Book ──────
    // Uses a migration flag so it only runs once, even across restarts.
    const salesBackfillFlag = await db.execute(sql`
      INSERT INTO migration_flags (key) VALUES ('sales_cashbook_backfill_v1')
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);
    if (((salesBackfillFlag as unknown as { rowCount?: number }).rowCount ?? 0) > 0) {
      // Insert one payment row per completed sale that has no matching payment yet
      const backfillResult = await db.execute(sql`
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
          CASE WHEN s.currency = 'USD' THEN s.total_amount
               ELSE s.total_amount / COALESCE(s.exchange_rate, 2800) END,
          CASE WHEN s.currency = 'CDF' THEN s.total_amount
               ELSE s.total_amount * COALESCE(s.exchange_rate, 2800) END,
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
      const backfilled = (backfillResult as unknown as { rowCount?: number }).rowCount ?? 0;
      logger.info({ backfilled }, "Backfilled payment records for existing completed sales");
    }

    // ── Seed default chart of accounts (idempotent) ───────────────────────────
    await seedDefaultAccounts();

    logger.info("Startup migrations complete");
  } catch (err) {
    logger.error({ err }, "Startup migration failed");
  }
}

runStartupMigrations().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
});

// ── Daily cash summary — runs every hour, fires when Lubumbashi hour matches setting ─
cron.schedule("0 * * * *", async () => {
  try {
    const settings = await db.query.settingsTable.findFirst();
    if (!settings?.greenApiInstanceId || !settings?.greenApiToken) return;
    if (settings.dailySummaryEnabled !== "true") return;

    const lubumbashiHour = new Date(Date.now() + 2 * 60 * 60 * 1000).getUTCHours();
    const configuredHour = settings.dailySummaryHour ?? 21;
    if (lubumbashiHour !== configuredHour) return;

    logger.info({ lubumbashiHour }, "Running daily cash summary WhatsApp job");
    await sendDailySummaryNow();
  } catch (err) {
    logger.error({ err }, "Daily cash summary job failed");
  }
});

// ── 24-hour expiry reminder — runs every hour ─────────────────────────────────
// Finds active members whose subscription expires in 23–25 hours (catches the
// 24h mark once per day), have a waChatId resolved, and haven't received a
// '24h' reminder yet, then sends a personal WhatsApp message directly to them.
cron.schedule("15 * * * *", async () => {
  try {
    const settings = await db.query.settingsTable.findFirst();
    if (!settings?.greenApiInstanceId || !settings?.greenApiToken) return;

    const { greenApiInstanceId: instanceId, greenApiToken: token } = settings;

    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23h from now
    const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000); // 25h from now

    // Find active members expiring within the 23–25h window who have a waChatId
    const candidates = await db
      .select()
      .from(membersTable)
      .where(
        and(
          isNull(membersTable.deletedAt),
          eq(membersTable.status, "active"),
          isNotNull(membersTable.waChatId),
          gte(membersTable.expiryDate, windowStart),
          lte(membersTable.expiryDate, windowEnd),
        )
      );

    if (candidates.length === 0) return;

    // Filter out those who already received a '24h' reminder
    const alreadySent = await db
      .select({ memberId: whatsappReminderLogsTable.memberId })
      .from(whatsappReminderLogsTable)
      .where(
        and(
          eq(whatsappReminderLogsTable.reminderType, "24h"),
          gte(whatsappReminderLogsTable.sentAt, new Date(now.getTime() - 48 * 60 * 60 * 1000))
        )
      );
    const sentSet = new Set(alreadySent.map(r => r.memberId));

    const toSend = candidates.filter(m => !sentSet.has(m.id));
    if (toSend.length === 0) return;

    logger.info({ count: toSend.length }, "Sending 24h expiry reminders");

    await Promise.allSettled(
      toSend.map(async (member) => {
        try {
          const message = formatExpiryReminderMessage(member, 1);
          await sendDirectMessage(instanceId, token, member.waChatId!, message);
          await db.insert(whatsappReminderLogsTable).values({
            memberId: member.id,
            reminderType: "24h",
          });
          logger.info({ memberId: member.id, name: member.name }, "24h expiry reminder sent");
        } catch (err) {
          logger.error({ err, memberId: member.id }, "24h expiry reminder failed");
        }
      })
    );
  } catch (err) {
    logger.error({ err }, "24h expiry reminder job failed");
  }
});
