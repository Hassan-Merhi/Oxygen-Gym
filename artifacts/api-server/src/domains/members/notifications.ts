import { db } from "@workspace/db";
import { membersTable, whatsappReminderLogsTable } from "@workspace/db/schema";
import type { Member } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  formatMemberInfoMessage,
  formatNewMemberMessage,
  lookupPhoneOnWhatsApp,
  sendToAllChats,
} from "../../lib/whatsapp";
import { logger } from "../../lib/logger";

async function getWhatsAppSettings() {
  const settings = await db.query.settingsTable.findFirst();
  if (!settings?.greenApiInstanceId || !settings.greenApiToken) return null;
  return {
    instanceId: settings.greenApiInstanceId,
    token: settings.greenApiToken,
    rate: settings.usdToCdfRate ?? 1,
  };
}

export function notifyNewMember(member: Member): void {
  void (async () => {
    const settings = await getWhatsAppSettings();
    if (!settings) return;

    if (member.phone) {
      const chatId = await lookupPhoneOnWhatsApp(member.phone, settings.instanceId, settings.token);
      if (chatId) {
        await db.update(membersTable).set({ waChatId: chatId }).where(eq(membersTable.id, member.id));
        logger.info({ memberId: member.id, chatId }, "WhatsApp chatId resolved for new member");
      }
    }

    const message = formatNewMemberMessage({ ...member, exchangeRate: settings.rate });
    const sent = await sendToAllChats(settings.instanceId, settings.token, message);
    if (sent) {
      await db.insert(whatsappReminderLogsTable).values({
        memberId: member.id,
        reminderType: "new_member",
      });
    }
  })().catch((err) => logger.error({ err, memberId: member.id }, "WhatsApp new-member notification failed"));
}

export function refreshMemberWhatsAppIdentity(member: Member, previousPhone?: string | null): void {
  const phoneChanged = member.phone !== previousPhone;
  const needsLookup = phoneChanged || (member.phone && !member.waChatId);
  if (!needsLookup || !member.phone) return;

  void (async () => {
    const settings = await getWhatsAppSettings();
    if (!settings) return;
    const chatId = await lookupPhoneOnWhatsApp(member.phone!, settings.instanceId, settings.token);
    if (!chatId) return;
    await db.update(membersTable).set({ waChatId: chatId }).where(eq(membersTable.id, member.id));
    logger.info({ memberId: member.id, chatId }, "WhatsApp chatId resolved/updated for member");
  })().catch((err) => logger.error({ err, memberId: member.id }, "WhatsApp chatId re-lookup failed"));
}

export function notifyMemberRenewal(member: Member): void {
  void (async () => {
    const settings = await getWhatsAppSettings();
    if (!settings) return;
    const message = formatMemberInfoMessage({
      name: member.name,
      phone: member.phone,
      planName: member.planName,
      amountPaid: member.amountPaid,
      currency: member.currency,
      expiryDate: member.expiryDate,
      balance: member.balance,
    });
    await sendToAllChats(settings.instanceId, settings.token, message);
  })().catch((err) => logger.error({ err, memberId: member.id }, "WhatsApp renewal notification failed"));
}
