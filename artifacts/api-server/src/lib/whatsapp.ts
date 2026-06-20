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
    const cur = member.currency ?? "USD";
    const fmtAmt = cur === "CDF"
      ? `FC ${Math.round(member.amountPaid).toLocaleString("fr-FR")}`
      : `$${member.amountPaid.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    lines.push(`💰 Montant payé : *${fmtAmt}*`);
  }
  if (member.expiryDate) {
    const d = new Date(member.expiryDate);
    lines.push(`📅 Expire le : ${d.toLocaleDateString("fr-FR")}`);
  }
  return lines.join("\n");
}

export function formatMemberInfoMessage(member: {
  name: string;
  phone?: string | null;
  planName?: string | null;
  amountPaid?: number | null;
  discount?: number | null;
  planPrice?: number | null;
  currency?: string | null;
  expiryDate?: Date | string | null;
  balance?: number | null;
}): string {
  const cur = member.currency ?? "USD";
  const isCdf = cur === "CDF";
  const fmtAmt = (n: number) => isCdf
    ? `FC ${Math.round(n).toLocaleString("fr-FR")}`
    : `$${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const lines = [`👤 *${member.name}*`];
  if (member.phone) lines.push(`📞 Tél : ${member.phone}`);
  if (member.planName) lines.push(`🏷️ Abonnement : ${member.planName}`);
  if (member.amountPaid != null) lines.push(`💰 Montant payé : *${fmtAmt(member.amountPaid)}*`);
  if (member.balance != null && member.balance !== 0)
    lines.push(`💳 Reste à payer : *${fmtAmt(member.balance)}*`);
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

interface ProductLine { name: string; qty: number; total: number; currency: string }
interface ExpenseLine { desc: string; amount: number; currency: string }

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
  const dayEnd   = new Date(`${lubDateStr}T23:59:59+02:00`);

  const [
    membershipRow,
    membershipCdfRow,
    incomeVouchersRow,
    expPayments,
    expVouchers,
    todaySales,
  ] = await Promise.all([
    // Membership in (USD) — payment records only
    db.select({ usd: sum(paymentsTable.amountUsd) })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.direction, "in"),
        eq(paymentsTable.status, "completed"),
        not(eq(paymentsTable.category, "product_sale")),
        gte(paymentsTable.paymentDate, dayStart),
        lte(paymentsTable.paymentDate, dayEnd),
      )),
    // Membership in (CDF)
    db.select({ cdf: sum(paymentsTable.amountCdf) })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.direction, "in"),
        eq(paymentsTable.status, "completed"),
        not(eq(paymentsTable.category, "product_sale")),
        gte(paymentsTable.paymentDate, dayStart),
        lte(paymentsTable.paymentDate, dayEnd),
      )),
    // Income vouchers (Cash Receipts etc.) — counted in Cash Book "Cash In"
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.direction, "in"),
        eq(vouchersTable.status, "recorded"),
        gte(vouchersTable.voucherDate, dayStart),
        lte(vouchersTable.voucherDate, dayEnd),
      )),
    // Expense payments (with description)
    db.select({
      notes:     paymentsTable.notes,
      amount:    paymentsTable.amount,
      currency:  paymentsTable.currency,
      amountUsd: paymentsTable.amountUsd,
      amountCdf: paymentsTable.amountCdf,
    })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.direction, "out"),
        eq(paymentsTable.status, "completed"),
        gte(paymentsTable.paymentDate, dayStart),
        lte(paymentsTable.paymentDate, dayEnd),
      )),
    // Expense vouchers (with description)
    db.select({
      description: vouchersTable.description,
      paidTo:      vouchersTable.paidTo,
      amount:      vouchersTable.amount,
      currency:    vouchersTable.currency,
      amountUsd:   vouchersTable.amountUsd,
      amountCdf:   vouchersTable.amountCdf,
    })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.direction, "out"),
        eq(vouchersTable.status, "recorded"),
        gte(vouchersTable.voucherDate, dayStart),
        lte(vouchersTable.voucherDate, dayEnd),
      )),
    // Full sale rows with JSONB items
    db.select({ items: salesTable.items, currency: salesTable.currency })
      .from(salesTable)
      .where(and(
        eq(salesTable.status, "completed"),
        gte(salesTable.saleDate, dayStart),
        lte(salesTable.saleDate, dayEnd),
      )),
  ]);

  const n = (v: unknown) => Number(v ?? 0);

  // ── Memberships ────────────────────────────────────────────────────────────
  const memberships    = n(membershipRow[0]?.usd);
  const membershipsCdf = n(membershipCdfRow[0]?.cdf);

  // ── Income vouchers (Cash Receipts etc.) — same as Cash Book "Cash In" ────
  const incomeVouchersUsd = n(incomeVouchersRow[0]?.usd);
  const incomeVouchersCdf = n(incomeVouchersRow[0]?.cdf);

  // ── Expenses (per-item detail) ─────────────────────────────────────────────
  const expenseLines: ExpenseLine[] = [
    ...expPayments.map(p => ({
      desc: p.notes?.trim() || "Dépense",
      amount: p.amount ?? 0,
      currency: p.currency ?? "USD",
    })),
    ...expVouchers.map(v => ({
      desc: v.description?.trim() || v.paidTo?.trim() || "Dépense",
      amount: v.amount ?? 0,
      currency: v.currency ?? "USD",
    })),
  ];
  const expenses    = expPayments.reduce((a, p) => a + n(p.amountUsd), 0)
                    + expVouchers.reduce((a, v) => a + n(v.amountUsd), 0);
  const expensesCdf = expPayments.reduce((a, p) => a + n(p.amountCdf), 0)
                    + expVouchers.reduce((a, v) => a + n(v.amountCdf), 0);

  // ── Sales (aggregate products across all today's sales) ────────────────────
  // Always use sale-level currency as the definitive source — per-item currency
  // can be stale or missing in older JSONB records.
  const productMap = new Map<string, ProductLine>();
  for (const sale of todaySales) {
    const saleCur = (sale.currency as string) || "USD";
    for (const item of sale.items ?? []) {
      const key = `${item.productName}::${saleCur}`;
      const existing = productMap.get(key);
      if (existing) {
        existing.qty   += item.quantity;
        existing.total += item.lineTotal;
      } else {
        productMap.set(key, { name: item.productName, qty: item.quantity, total: item.lineTotal, currency: saleCur });
      }
    }
  }
  const productLines = [...productMap.values()];
  const sales    = productLines.filter(p => p.currency === "USD").reduce((a, p) => a + p.total, 0);
  const salesCdf = productLines.filter(p => p.currency === "CDF").reduce((a, p) => a + p.total, 0);

  // ── Remaining (Memberships + income vouchers − expenses) ───────────────────
  const remaining    = memberships + incomeVouchersUsd - expenses;
  const remainingCdf = membershipsCdf + incomeVouchersCdf - expensesCdf;

  const [year, month, day] = lubDateStr.split("-");
  const friendlyDate = `${day}/${month}/${year}`;

  const message = formatDailySummaryMessage({
    date: friendlyDate,
    memberships, membershipsCdf,
    expenses, expensesCdf, expenseLines,
    sales, salesCdf, productLines,
    remaining, remainingCdf,
  });
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
  expenseLines: ExpenseLine[];
  sales: number;
  salesCdf: number;
  productLines: ProductLine[];
  remaining: number;
  remainingCdf: number;
}): string {
  const { date, memberships, membershipsCdf, expenseLines, productLines, remaining, remainingCdf } = opts;

  const fmtUsd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCdf = (n: number) => Math.round(n).toLocaleString("en-US");
  const fmtAmt = (amount: number, currency: string) =>
    currency === "CDF" ? `FC ${fmtCdf(amount)}` : `$${fmtUsd(amount)}`;

  const lines: string[] = [
    `📊 *Résumé de la journée — ${date}*`,
    ``,
    `🏋️ *Abonnements salle :*`,
    `   USD : *$${fmtUsd(memberships)}*`,
    `   CDF : *FC ${fmtCdf(membershipsCdf)}*`,
    ``,
  ];

  // ── Ventes boutique (per product) ─────────────────────────────────────────
  lines.push(`🛒 *Ventes produits :*`);
  if (productLines.length === 0) {
    lines.push(`   Aucune vente aujourd'hui`);
  } else {
    for (const p of productLines) {
      lines.push(`   ${p.name} x${p.qty} — ${fmtAmt(p.total, p.currency)}`);
    }
    const usdProducts = productLines.filter(p => p.currency === "USD");
    const cdfProducts = productLines.filter(p => p.currency === "CDF");
    lines.push(`   ─────────────────`);
    if (usdProducts.length > 0) {
      const total = usdProducts.reduce((a, p) => a + p.total, 0);
      lines.push(`   Total USD : *$${fmtUsd(total)}*`);
    }
    if (cdfProducts.length > 0) {
      const total = cdfProducts.reduce((a, p) => a + p.total, 0);
      lines.push(`   Total CDF : *FC ${fmtCdf(total)}*`);
    }
  }
  lines.push(``);

  // ── Dépenses du jour (per expense) ────────────────────────────────────────
  lines.push(`💸 *Dépenses du jour :*`);
  if (expenseLines.length === 0) {
    lines.push(`   Aucune dépense aujourd'hui`);
  } else {
    for (const e of expenseLines) {
      lines.push(`   ${e.desc} — ${fmtAmt(e.amount, e.currency)}`);
    }
    const usdExp = expenseLines.filter(e => e.currency === "USD");
    const cdfExp = expenseLines.filter(e => e.currency === "CDF");
    lines.push(`   ─────────────────`);
    if (usdExp.length > 0) {
      const total = usdExp.reduce((a, e) => a + e.amount, 0);
      lines.push(`   Total USD : *$${fmtUsd(total)}*`);
    }
    if (cdfExp.length > 0) {
      const total = cdfExp.reduce((a, e) => a + e.amount, 0);
      lines.push(`   Total CDF : *FC ${fmtCdf(total)}*`);
    }
  }
  lines.push(``);

  // ── Caisse restante ────────────────────────────────────────────────────────
  const remainEmoji = remaining >= 0 ? "✅" : "🔴";
  lines.push(`${remainEmoji} *Caisse restante :*`);
  lines.push(`   USD : *$${fmtUsd(remaining)}*`);
  lines.push(`   CDF : *FC ${fmtCdf(remainingCdf)}*`);
  lines.push(``);
  lines.push(`_OxygenGym — rapport automatique_`);

  return lines.join("\n");
}
