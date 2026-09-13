import cron from "node-cron";
import { db } from "@workspace/db";
import { membersTable, plansTable, whatsappReminderLogsTable } from "@workspace/db/schema";
import { and, eq, gte, lte, isNull, isNotNull, gt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendDailySummaryNow, sendDirectMessage, formatExpiryReminderMessage } from "../lib/whatsapp";

let scheduled = false;

export function scheduleBackgroundJobs(): void {
  if (scheduled) return;
  scheduled = true;

  cron.schedule("0 * * * *", async () => {
    try {
      const settings = await db.query.settingsTable.findFirst();
      if (!settings?.greenApiInstanceId || !settings.greenApiToken) return;
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

  cron.schedule("15 * * * *", async () => {
    try {
      const settings = await db.query.settingsTable.findFirst();
      if (!settings?.greenApiInstanceId || !settings.greenApiToken) return;

      const { greenApiInstanceId: instanceId, greenApiToken: token } = settings;
      const now = new Date();
      const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

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
          ),
        )
        .then((rows) => rows.map((row) => row.member));

      if (candidates.length === 0) return;

      const alreadySent = await db
        .select({ memberId: whatsappReminderLogsTable.memberId })
        .from(whatsappReminderLogsTable)
        .where(
          and(
            eq(whatsappReminderLogsTable.reminderType, "24h"),
            gte(whatsappReminderLogsTable.sentAt, new Date(now.getTime() - 48 * 60 * 60 * 1000)),
          ),
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
            await db.insert(whatsappReminderLogsTable).values({ memberId: member.id, reminderType: "24h" });
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
}
