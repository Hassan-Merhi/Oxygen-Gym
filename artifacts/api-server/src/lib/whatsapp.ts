import { db } from "@workspace/db";
import { whatsappChatsTable, paymentsTable, vouchersTable } from "@workspace/db/schema";
import { eq, and, gte, lte, sum } from "drizzle-orm";
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
  exchangeRate?: number | null;
  expiryDate?: Date | string | null;
}): string {
  const lines = [
    `🆕 *Nouveau membre — ${member.name}*`,
  ];
  if (member.phone) lines.push(`📞 Tél : ${member.phone}`);
  if (member.planName) lines.push(`🏷️ Abonnement : ${member.planName}`);
  if (member.amountPaid != null) {
    const rate = member.exchangeRate ?? 1;
    const amountUsd = member.currency === "CDF"
      ? member.amountPaid / rate
      : member.amountPaid;
    const fmtUsd = amountUsd.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    lines.push(`💰 Montant payé : *${fmtUsd} USD*`);
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

export async function sendDailySummaryNow(): Promise<{ cashIn: number; expenses: number; remaining: number }> {
  const settings = await db.query.settingsTable.findFirst();
  if (!settings?.greenApiInstanceId || !settings?.greenApiToken) {
    throw new Error("Green API credentials not configured");
  }

  const { greenApiInstanceId: instanceId, greenApiToken: token } = settings;

  const lubOffsetMs = 2 * 60 * 60 * 1000;
  const lubNow = new Date(Date.now() + lubOffsetMs);
  const lubDateStr = lubNow.toISOString().slice(0, 10);

  const dayStart = new Date(`${lubDateStr}T00:00:00+02:00`);
  const dayEnd = new Date(`${lubDateStr}T23:59:59+02:00`);

  const [payInRow, payOutRow, vchInRow, vchOutRow] = await Promise.all([
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.direction, "in"), gte(paymentsTable.paymentDate, dayStart), lte(paymentsTable.paymentDate, dayEnd))),
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.direction, "out"), gte(paymentsTable.paymentDate, dayStart), lte(paymentsTable.paymentDate, dayEnd))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.direction, "in"), eq(vouchersTable.status, "recorded"), gte(vouchersTable.voucherDate, dayStart), lte(vouchersTable.voucherDate, dayEnd))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.direction, "out"), eq(vouchersTable.status, "recorded"), gte(vouchersTable.voucherDate, dayStart), lte(vouchersTable.voucherDate, dayEnd))),
  ]);

  const n = (v: unknown) => Number(v ?? 0);
  const cashIn      = n(payInRow[0]?.usd)  + n(vchInRow[0]?.usd);
  const cashInCdf   = n(payInRow[0]?.cdf)  + n(vchInRow[0]?.cdf);
  const expenses    = n(payOutRow[0]?.usd) + n(vchOutRow[0]?.usd);
  const expensesCdf = n(payOutRow[0]?.cdf) + n(vchOutRow[0]?.cdf);
  const remaining    = cashIn - expenses;
  const remainingCdf = cashInCdf - expensesCdf;

  const [year, month, day] = lubDateStr.split("-");
  const friendlyDate = `${day}/${month}/${year}`;

  const message = formatDailySummaryMessage({ date: friendlyDate, cashIn, cashInCdf, expenses, expensesCdf, remaining, remainingCdf });
  await sendToAllChats(instanceId, token, message);

  logger.info({ cashIn, expenses, remaining }, "Daily cash summary sent");
  return { cashIn, expenses, remaining };
}

export function formatDailySummaryMessage(opts: {
  date: string;
  cashIn: number;
  cashInCdf: number;
  expenses: number;
  expensesCdf: number;
  remaining: number;
  remainingCdf: number;
}): string {
  const { date, cashIn, cashInCdf, expenses, expensesCdf, remaining, remainingCdf } = opts;
  const usd = (n: number) =>
    n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cdf = (n: number) =>
    Math.round(n).toLocaleString("fr-FR");
  const remainEmoji = remaining >= 0 ? "✅" : "🔴";
  return [
    `📊 *Résumé de la journée — ${date}*`,
    ``,
    `💵 *Encaissé du jour :*`,
    `   USD : *$${usd(cashIn)}*`,
    `   CDF : *FC ${cdf(cashInCdf)}*`,
    ``,
    `💸 *Dépenses du jour :*`,
    `   USD : *$${usd(expenses)}*`,
    `   CDF : *FC ${cdf(expensesCdf)}*`,
    ``,
    `${remainEmoji} *Solde net du jour :*`,
    `   USD : *$${usd(remaining)}*`,
    `   CDF : *FC ${cdf(remainingCdf)}*`,
    ``,
    `_OxygenGym — rapport automatique_`,
  ].join("\n");
}
