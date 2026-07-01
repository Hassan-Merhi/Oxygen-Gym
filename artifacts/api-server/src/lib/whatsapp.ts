import { db } from "@workspace/db";
import { whatsappChatsTable, paymentsTable, vouchersTable, salesTable } from "@workspace/db/schema";
import { eq, and, gte, lte, sum, not } from "drizzle-orm";
import { logger } from "./logger";

const GREEN_API_BASE = "https://api.green-api.com";

/**
 * Strip all non-digit characters from a phone number, then call Green API's
 * checkWhatsapp endpoint to verify it exists and get the chatId.
 * Returns the chatId (e.g. "243812345678@c.us") or null if not found / error.
 */
export async function lookupPhoneOnWhatsApp(
  phone: string,
  instanceId: string,
  token: string,
): Promise<string | null> {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  try {
    const url = `${GREEN_API_BASE}/waInstance${instanceId}/checkWhatsapp/${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: digits }),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok || !body.existsWhatsapp) return null;
    return (body.chatId as string) ?? `${digits}@c.us`;
  } catch {
    return null;
  }
}

/**
 * Send a WhatsApp message directly to a single member's personal chat.
 */
export async function sendDirectMessage(
  instanceId: string,
  token: string,
  chatId: string,
  message: string,
): Promise<void> {
  return sendMessage(instanceId, token, chatId, message);
}

async function sendMessage(instanceId: string, token: string, chatId: string, message: string): Promise<void> {
  const url = `${GREEN_API_BASE}/waInstance${instanceId}/sendMessage/${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Green API error ${res.status}: ${JSON.stringify(body)}`);
  }
  // Green API returns {"idMessage":"..."} on success.
  // If the instance is disconnected it still returns 200 but with a typeError or no idMessage.
  if (!body.idMessage) {
    throw new Error(`Green API did not queue message: ${JSON.stringify(body)}`);
  }
}

export async function checkInstanceState(instanceId: string, token: string): Promise<string> {
  const url = `${GREEN_API_BASE}/waInstance${instanceId}/getStateInstance/${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Green API state check failed: ${res.status}`);
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return (body.stateInstance as string) ?? "unknown";
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

  // Report covers the full calendar day in Lubumbashi time (UTC+2):
  // 00:00:00 → 23:59:59.999. Transactions at any hour of the day are
  // included in that day's report, with no 9 PM cut-off.
  const dayStart = new Date(`${lubDateStr}T00:00:00+02:00`);
  const dayEnd   = new Date(`${lubDateStr}T23:59:59.999+02:00`);

  const [
    membershipRow,
    allPaymentsInRow,
    incomeVouchersRow,
    expPayments,
    expVouchers,
    todaySales,
  ] = await Promise.all([
    // Membership in (USD) — excludes product_sale, for display only
    db.select({ usd: sum(paymentsTable.amountUsd) })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.direction, "in"),
        eq(paymentsTable.status, "completed"),
        not(eq(paymentsTable.category, "product_sale")),
        gte(paymentsTable.paymentDate, dayStart),
        lte(paymentsTable.paymentDate, dayEnd),
      )),
    // All payments in (USD) — including product_sale, used for remaining calc
    db.select({ usd: sum(paymentsTable.amountUsd) })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.direction, "in"),
        eq(paymentsTable.status, "completed"),
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
    // Full sale rows with JSONB items (for product breakdown display only)
    db.select({ items: salesTable.items, currency: salesTable.currency })
      .from(salesTable)
      .where(and(
        eq(salesTable.status, "completed"),
        gte(salesTable.saleDate, dayStart),
        lte(salesTable.saleDate, dayEnd),
      )),
  ]);

  const n = (v: unknown) => Number(v ?? 0);

  // ── Memberships (for display — excludes product_sale) ─────────────────────
  const memberships = n(membershipRow[0]?.usd);

  // ── All payments in (for remaining calc — matches Net Today) ──────────────
  const allPaymentsInUsd = n(allPaymentsInRow[0]?.usd);

  // ── Income vouchers (Cash Receipts etc.) — same as Cash Book "Cash In" ────
  const incomeVouchersUsd = n(incomeVouchersRow[0]?.usd);

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
  const expenses = expPayments.reduce((a, p) => a + n(p.amountUsd), 0)
                 + expVouchers.reduce((a, v) => a + n(v.amountUsd), 0);

  // ── Sales (aggregate products for display only) ────────────────────────────
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

  // ── Remaining = all cash in (payments + vouchers) − all cash out ───────────
  // Matches the Net Today figure from the cashbook exactly.
  const remaining = allPaymentsInUsd + incomeVouchersUsd - expenses;

  const [year, month, day] = lubDateStr.split("-");
  const friendlyDate = `${day}/${month}/${year}`;

  const message = formatDailySummaryMessage({
    date: friendlyDate,
    memberships,
    expenses, expenseLines,
    sales, salesCdf, productLines,
    remaining,
  });
  await sendToAllChats(instanceId, token, message);

  logger.info({ memberships, expenses, sales, remaining }, "Daily cash summary sent");
  return { memberships, expenses, sales, remaining };
}

export function formatDailySummaryMessage(opts: {
  date: string;
  memberships: number;
  expenses: number;
  expenseLines: ExpenseLine[];
  sales: number;
  salesCdf: number;
  productLines: ProductLine[];
  remaining: number;
}): string {
  const { date, memberships, expenseLines, productLines, remaining } = opts;

  const fmtUsd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCdf = (n: number) => Math.round(n).toLocaleString("fr-FR");
  const fmtAmt = (amount: number, currency: string) =>
    currency === "CDF" ? `FC ${fmtCdf(amount)}` : `$${fmtUsd(amount)}`;

  const lines: string[] = [
    `📊 *Résumé de la journée — ${date}*`,
    ``,
    `🏋️ *Abonnements salle :*`,
    `   *$${fmtUsd(memberships)}*`,
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
  lines.push(`   *$${fmtUsd(remaining)}*`);
  lines.push(``);
  lines.push(`_OxygenGym — rapport automatique_`);

  return lines.join("\n");
}
