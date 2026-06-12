import { db } from "@workspace/db";
import { whatsappChatsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const GREEN_API_BASE = "https://api.green-api.com";

async function sendMessage(instanceId: string, token: string, chatId: string, message: string): Promise<void> {
  const url = `${GREEN_API_BASE}/waInstance${instanceId}/sendMessage/${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Green API error ${res.status}: ${text}`);
  }
}

/**
 * Send message to all enabled chats.
 * Returns true if at least one chat was sent to successfully.
 */
export async function sendToAllChats(instanceId: string, token: string, message: string): Promise<boolean> {
  const chats = await db.select().from(whatsappChatsTable).where(eq(whatsappChatsTable.enabled, true));
  if (chats.length === 0) return false;

  const results = await Promise.allSettled(
    chats.map((chat) => sendMessage(instanceId, token, chat.chatId, message))
  );

  let anySuccess = false;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      anySuccess = true;
    } else {
      logger.error({ err: r.reason, chatId: chats[i].chatId }, "WhatsApp send failed");
    }
  }
  return anySuccess;
}

export function formatNewMemberMessage(member: {
  name: string;
  phone?: string | null;
  planName?: string | null;
  amountPaid?: number | null;
  currency?: string | null;
  expiryDate?: Date | string | null;
}): string {
  const lines = [
    `🆕 *Nouveau membre — ${member.name}*`,
  ];
  if (member.phone) lines.push(`📞 Tél : ${member.phone}`);
  if (member.planName) lines.push(`🏷️ Abonnement : ${member.planName}`);
  if (member.amountPaid != null) {
    lines.push(`💰 Montant payé : ${member.amountPaid} ${member.currency ?? "USD"}`);
  }
  if (member.expiryDate) {
    const d = new Date(member.expiryDate);
    lines.push(`📅 Expire le : ${d.toLocaleDateString("fr-FR")}`);
  }
  return lines.join("\n");
}

export function formatExpiryReminderMessage(member: {
  name: string;
  phone?: string | null;
  planName?: string | null;
  expiryDate?: Date | string | null;
}, daysLeft: number): string {
  const emoji = daysLeft <= 2 ? "🚨" : "⚠️";
  const dayWord = daysLeft <= 1 ? "jour" : "jours";
  const lines = [
    `${emoji} *Expiration imminente — ${member.name}*`,
    `⏳ Dans ${daysLeft} ${dayWord}`,
  ];
  if (member.phone) lines.push(`📞 Tél : ${member.phone}`);
  if (member.planName) lines.push(`🏷️ Abonnement : ${member.planName}`);
  if (member.expiryDate) {
    const d = new Date(member.expiryDate);
    lines.push(`📅 Expire le : ${d.toLocaleDateString("fr-FR")}`);
  }
  return lines.join("\n");
}
