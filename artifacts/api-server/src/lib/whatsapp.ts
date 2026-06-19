import { db } from "@workspace/db";
import { whatsappChatsTable, paymentsTable, vouchersTable, salesTable } from "@workspace/db/schema";
import { eq, and, gte, lte, sum, not } from "drizzle-orm";
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

export async function sendDailySummaryNow(): Promise<{ memberships: number; expenses: number; sales: number; remaining: number }> {
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

  const [
    membershipRow,
    membershipCdfRow,
    payOutRow,
    vchOutRow,
    salesUsdRow,
    salesCdfRow,
  ] = await Promise.all([
    // Today: membership payments in (completed, exclude product_sale)
    db.select({ usd: sum(paymentsTable.amountUsd) })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.direction, "in"),
        eq(paymentsTable.status, "completed"),
        not(eq(paymentsTable.category, "product_sale")),
        gte(paymentsTable.paymentDate, dayStart),
        lte(paymentsTable.paymentDate, dayEnd),
      )),
    db.select({ cdf: sum(paymentsTable.amountCdf) })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.direction, "in"),
        eq(paymentsTable.status, "completed"),
        not(eq(paymentsTable.category, "product_sale")),
        gte(paymentsTable.paymentDate, dayStart),
        lte(paymentsTable.paymentDate, dayEnd),
      )),
    // Today: expenses — payments out (completed)
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.direction, "out"),
        eq(paymentsTable.status, "completed"),
        gte(paymentsTable.paymentDate, dayStart),
        lte(paymentsTable.paymentDate, dayEnd),
      )),
    // Today: expenses — vouchers out (recorded)
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.direction, "out"),
        eq(vouchersTable.status, "recorded"),
        gte(vouchersTable.voucherDate, dayStart),
        lte(vouchersTable.voucherDate, dayEnd),
      )),
    // Today: stock/POS sales in USD (currency='USD' only — avoids CDF-converted amounts bleeding into USD)
    db.select({ usd: sum(salesTable.totalAmountUsd) })
      .from(salesTable)
      .where(and(
        eq(salesTable.status, "completed"),
        eq(salesTable.currency, "USD"),
        gte(salesTable.saleDate, dayStart),
        lte(salesTable.saleDate, dayEnd),
      )),
    // Today: stock/POS sales in CDF (currency='CDF' only)
    db.select({ cdf: sum(salesTable.totalAmount) })
      .from(salesTable)
      .where(and(
        eq(salesTable.status, "completed"),
        eq(salesTable.currency, "CDF"),
        gte(salesTable.saleDate, dayStart),
        lte(salesTable.saleDate, dayEnd),
      )),
  ]);

  const n = (v: unknown) => Number(v ?? 0);
  const memberships    = n(membershipRow[0]?.usd);
  const membershipsCdf = n(membershipCdfRow[0]?.cdf);
  const expenses       = n(payOutRow[0]?.usd) + n(vchOutRow[0]?.usd);
  const expensesCdf    = n(payOutRow[0]?.cdf) + n(vchOutRow[0]?.cdf);
  const sales          = n(salesUsdRow[0]?.usd);   // USD sales only
  const salesCdf       = n(salesCdfRow[0]?.cdf);   // CDF sales only

  // Caisse restante = today's net (memberships + sales − expenses)
  const remaining    = memberships + sales - expenses;
  const remainingCdf = membershipsCdf + salesCdf - expensesCdf;

  const [year, month, day] = lubDateStr.split("-");
  const friendlyDate = `${day}/${month}/${year}`;

  const message = formatDailySummaryMessage({ date: friendlyDate, memberships, membershipsCdf, expenses, expensesCdf, sales, salesCdf, remaining, remainingCdf });
  await sendToAllChats(instanceId, token, message);

  logger.info({ memberships, expenses, sales, remaining }, "Daily cash summary sent");
  return { memberships, expenses, sales, remaining };
}

export function formatDailySummaryMessage(opts: {
  date: string;
  memberships: number;
  membershipsCdf: number;
  expenses: number;
  expensesCdf: number;
  sales: number;
  salesCdf: number;
  remaining: number;
  remainingCdf: number;
}): string {
  const { date, memberships, membershipsCdf, expenses, expensesCdf, sales, salesCdf, remaining, remainingCdf } = opts;
  const usd = (n: number) =>
    n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cdf = (n: number) =>
    Math.round(n).toLocaleString("fr-FR");
  const remainEmoji = remaining >= 0 ? "✅" : "🔴";
  return [
    `📊 *Résumé de la journée — ${date}*`,
    ``,
    `🏋️ *Abonnements salle :*`,
    `   USD : *$${usd(memberships)}*`,
    `   CDF : *FC ${cdf(membershipsCdf)}*`,
    ``,
    `💸 *Dépenses du jour :*`,
    `   USD : *$${usd(expenses)}*`,
    `   CDF : *FC ${cdf(expensesCdf)}*`,
    ``,
    `🛒 *Ventes boutique :*`,
    `   USD : *$${usd(sales)}*`,
    `   CDF : *FC ${cdf(salesCdf)}*`,
    ``,
    `${remainEmoji} *Caisse restante :*`,
    `   USD : *$${usd(remaining)}*`,
    `   CDF : *FC ${cdf(remainingCdf)}*`,
    ``,
    `_OxygenGym — rapport automatique_`,
  ].join("\n");
}
