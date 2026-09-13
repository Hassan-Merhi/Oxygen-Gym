import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { db } from "@workspace/db";
import { membersTable, whatsappReminderLogsTable, plansTable } from "@workspace/db/schema";
import { and, eq, gte, lte, isNull, isNotNull, gt } from "drizzle-orm";
import { sendDailySummaryNow, sendDirectMessage, formatExpiryReminderMessage } from "./lib/whatsapp";

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

// Database schema changes are applied explicitly by the versioned Drizzle
// migration command during deployment. Runtime startup must never alter schema,
// repair historical rows, seed data, or perform destructive maintenance.
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
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
    // and whose plan duration is >= 7 days (weekly/monthly/quarterly — not daily).
    const candidates = await db
      .select({ member: membersTable })
      .from(membersTable)
      .innerJoin(plansTable, eq(plansTable.id, membersTable.planId))
      .where(
        and(
          isNull(membersTable.deletedAt),
          eq(membersTable.status, "active"),
          isNotNull(membersTable.waChatId),
          gte(membersTable.expiryDate, windowStart),
          lte(membersTable.expiryDate, windowEnd),
          gt(plansTable.durationDays, 1),
        )
      )
      .then((rows) => rows.map((row) => row.member));

    if (candidates.length === 0) return;

    // Filter out those who already received a '24h' reminder.
    const alreadySent = await db
      .select({ memberId: whatsappReminderLogsTable.memberId })
      .from(whatsappReminderLogsTable)
      .where(
        and(
          eq(whatsappReminderLogsTable.reminderType, "24h"),
          gte(whatsappReminderLogsTable.sentAt, new Date(now.getTime() - 48 * 60 * 60 * 1000)),
        )
      );
    const sentSet = new Set(alreadySent.map((row) => row.memberId));

    const toSend = candidates.filter((member) => !sentSet.has(member.id));
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
      }),
    );
  } catch (err) {
    logger.error({ err }, "24h expiry reminder job failed");
  }
});
