import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { db } from "@workspace/db";
import { membersTable, settingsTable, whatsappReminderLogsTable } from "@workspace/db/schema";
import { and, eq, gte, lte, isNull } from "drizzle-orm";
import { sendToAllChats, formatExpiryReminderMessage } from "./lib/whatsapp";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
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
