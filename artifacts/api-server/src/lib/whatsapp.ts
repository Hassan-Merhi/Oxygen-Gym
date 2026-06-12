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

export async function sendToAllChats(instanceId: string, token: string, message: string): Promise<void> {
  const chats = await db.select().from(whatsappChatsTable).where(eq(whatsappChatsTable.enabled, true));
  await Promise.allSettled(
    chats.map((chat) =>
      sendMessage(instanceId, token, chat.chatId, message).catch((err) =>
        logger.error({ err, chatId: chat.chatId }, "WhatsApp send failed")
      )
    )
  );
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
    "🆕 *New Member Joined*",
    `👤 Name: ${member.name}`,
  ];
  if (member.phone) lines.push(`📞 Phone: ${member.phone}`);
  if (member.planName) lines.push(`🏷️ Plan: ${member.planName}`);
  if (member.amountPaid != null) {
    lines.push(`💰 Amount Paid: ${member.amountPaid} ${member.currency ?? "USD"}`);
  }
  if (member.expiryDate) {
    const d = new Date(member.expiryDate);
    lines.push(`📅 Expires: ${d.toLocaleDateString()}`);
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
  const lines = [
    `${emoji} *Subscription Expiring Soon*`,
    `👤 Member: ${member.name}`,
  ];
  if (member.phone) lines.push(`📞 Phone: ${member.phone}`);
  if (member.planName) lines.push(`🏷️ Plan: ${member.planName}`);
  if (member.expiryDate) {
    const d = new Date(member.expiryDate);
    lines.push(`📅 Expires: ${d.toLocaleDateString()} (in ${daysLeft} day${daysLeft !== 1 ? "s" : ""})`);
  }
  return lines.join("\n");
}
