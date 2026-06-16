import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { db } from "@workspace/db";
import { membersTable, settingsTable, whatsappReminderLogsTable } from "@workspace/db/schema";
import { and, eq, gte, lte, isNull, sql } from "drizzle-orm";
import { sendToAllChats, formatExpiryReminderMessage, sendDailySummaryNow } from "./lib/whatsapp";

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

// ── Daily WhatsApp expiry reminders — runs every day at 09:00 ─────────────────
cron.schedule("0 9 * * *", async () => {
  logger.info("Running WhatsApp expiry reminder job");
  try {
    const settings = await db.query.settingsTable.findFirst();
    if (!settings?.greenApiInstanceId || !settings?.greenApiToken) return;

    const { greenApiInstanceId: instanceId, greenApiToken: token } = settings;
    const now = new Date();

    // Helper: check if reminder already sent
    async function alreadySent(memberId: number, reminderType: string): Promise<boolean> {
      const [existing] = await db
        .select()
        .from(whatsappReminderLogsTable)
        .where(
          and(
            eq(whatsappReminderLogsTable.memberId, memberId),
            eq(whatsappReminderLogsTable.reminderType, reminderType)
          )
        )
        .limit(1);
      return !!existing;
    }

    // Helper: log a sent reminder
    async function logReminder(memberId: number, reminderType: string): Promise<void> {
      await db.insert(whatsappReminderLogsTable).values({ memberId, reminderType });
    }

    // ── 5-day reminder ────────────────────────────────────────────────────────
    const fiveDaysStart = new Date(now);
    fiveDaysStart.setDate(fiveDaysStart.getDate() + 5);
    fiveDaysStart.setHours(0, 0, 0, 0);
    const fiveDaysEnd = new Date(fiveDaysStart);
    fiveDaysEnd.setHours(23, 59, 59, 999);

    const expiring5 = await db.select().from(membersTable).where(
      and(
        eq(membersTable.status, "active"),
        isNull(membersTable.deletedAt),
        gte(membersTable.expiryDate, fiveDaysStart),
        lte(membersTable.expiryDate, fiveDaysEnd)
      )
    );

    for (const member of expiring5) {
      if (await alreadySent(member.id, "5day")) continue;
      const message = formatExpiryReminderMessage(member, 5);
      const sent = await sendToAllChats(instanceId, token, message);
      if (sent) await logReminder(member.id, "5day");
    }

    // ── 1–2 day reminder ──────────────────────────────────────────────────────
    const twoDaysStart = new Date(now);
    twoDaysStart.setDate(twoDaysStart.getDate() + 1);
    twoDaysStart.setHours(0, 0, 0, 0);
    const twoDaysEnd = new Date(now);
    twoDaysEnd.setDate(twoDaysEnd.getDate() + 2);
    twoDaysEnd.setHours(23, 59, 59, 999);

    const expiring2 = await db.select().from(membersTable).where(
      and(
        eq(membersTable.status, "active"),
        isNull(membersTable.deletedAt),
        gte(membersTable.expiryDate, twoDaysStart),
        lte(membersTable.expiryDate, twoDaysEnd)
      )
    );

    for (const member of expiring2) {
      const daysLeft = Math.ceil((new Date(member.expiryDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (await alreadySent(member.id, "2day")) continue;
      const message = formatExpiryReminderMessage(member, daysLeft);
      const sent = await sendToAllChats(instanceId, token, message);
      if (sent) await logReminder(member.id, "2day");
    }

    logger.info("WhatsApp expiry reminder job completed");
  } catch (err) {
    logger.error({ err }, "WhatsApp expiry reminder job failed");
  }
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
