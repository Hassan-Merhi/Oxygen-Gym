import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { sendDailySummaryNow } from "./lib/whatsapp";

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

    // Add cash_account_id column to members if missing
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS cash_account_id integer
    `);

    // Back-fill payment_date to match the member's start_date for all membership
    // payments where the dates differ (handles historical entries recorded on today's date).
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

    // Idempotent performance indexes
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

    // Check current Lubumbashi hour (UTC+2) against configured hour
    const lubumbashiHour = new Date(Date.now() + 2 * 60 * 60 * 1000).getUTCHours();
    const configuredHour = settings.dailySummaryHour ?? 21;
    if (lubumbashiHour !== configuredHour) return;

    logger.info({ lubumbashiHour }, "Running daily cash summary WhatsApp job");
    await sendDailySummaryNow();
  } catch (err) {
    logger.error({ err }, "Daily cash summary job failed");
  }
});
