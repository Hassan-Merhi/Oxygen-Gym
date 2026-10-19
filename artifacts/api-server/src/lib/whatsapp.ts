import { db } from "@workspace/db";
import { whatsappChatsTable, salesTable, productsTable } from "@workspace/db/schema";
import { eq, and, gte, lte, not, isNull } from "drizzle-orm";
import { logger } from "./logger";
import { ACCOUNTS } from "./accounting";
import { getCashMovements, getCurrentBalance, summarizeMovements } from "./ledger";
import { businessDateKey, lubumbashiTodayEnd, lubumbashiTodayStart } from "./timezone";
import { getProfitAndLoss } from "../domains/accounting/ledger-reports";

const GREEN_API_BASE = "https://api.greenapi.com";

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

// ── Receipt for a single payment ────────────────────────────────────────────

export function formatReceiptMessage(opts: {
  memberName?: string | null;
  planName?: string | null;
  category?: string | null;
  amount?: number | null;
  currency?: string | null;
  paymentDate?: Date | string | null;
  gymName?: string | null;
}): string {
  const cur = (opts.currency ?? "USD") as string;
  const isCdf = cur === "CDF";
  const fmtAmt = (n: number) => isCdf
    ? `FC ${Math.round(n).toLocaleString("fr-FR")}`
    : `$${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const lines: string[] = [`🧾 *Reçu — ${opts.gymName ?? "GymPro"}*`, ``];
  if (opts.memberName) lines.push(`👤 ${opts.memberName}`);
  if (opts.planName)   lines.push(`📋 ${opts.planName}`);
  else if (opts.category) lines.push(`🏷️ ${opts.category}`);
  if (opts.amount != null) lines.push(`💰 *${fmtAmt(opts.amount)}*`);
  if (opts.paymentDate) {
    const d = new Date(opts.paymentDate as string);
    lines.push(`📅 ${d.toLocaleDateString("fr-FR")}`);
  }
  lines.push(``, `_Merci pour votre confiance !_`);
  return lines.join("\n");
}

// ── Low-stock helper (shared with daily summary) ────────────────────────────

interface LowStockItem { name: string; quantity: number; alertQuantity: number }

export async function getLowStockProducts(): Promise<LowStockItem[]> {
  const rows = await db
    .select({ name: productsTable.name, quantity: productsTable.quantity, alertQuantity: productsTable.alertQuantity })
    .from(productsTable)
    .where(and(
      eq(productsTable.status, "active"),
      isNull(productsTable.deletedAt),
      lte(productsTable.quantity, productsTable.alertQuantity),
    ));
  return rows.map(r => ({ name: r.name, quantity: r.quantity ?? 0, alertQuantity: r.alertQuantity ?? 5 }));
}

interface ProductLine { name: string; qty: number; total: number; currency: string }
interface ExpenseLine { desc: string; amount: number; currency: string }

export async function sendDailySummaryNow(): Promise<{ memberships: number; expenses: number; sales: number; remaining: number }> {
  const settings = await db.query.settingsTable.findFirst();
  if (!settings?.greenApiInstanceId || !settings?.greenApiToken) {
    throw new Error("Green API credentials not configured");
  }

  const { greenApiInstanceId: instanceId, greenApiToken: token } = settings;

  // The report covers today's business day (21:00 → 21:00 Lubumbashi), the
  // same day boundary as the Cash Book, Dashboard and Profit & Loss.
  const dayStart = lubumbashiTodayStart();
  const dayEnd = lubumbashiTodayEnd();
  const lubDateStr = businessDateKey(new Date());

  const [pnl, cashToday, todaySales, drawerBalance] = await Promise.all([
    getProfitAndLoss({ from: dayStart, to: dayEnd }),
    getCashMovements({ dateFrom: dayStart, dateTo: dayEnd }),
    // Full sale rows with JSONB items (for product breakdown display only)
    db.select({ items: salesTable.items, currency: salesTable.currency })
      .from(salesTable)
      .where(and(
        eq(salesTable.status, "completed"),
        gte(salesTable.saleDate, dayStart),
        lte(salesTable.saleDate, dayEnd),
      )),
    getCurrentBalance(),
  ]);

  // ── Memberships: Membership Revenue posted today ──────────────────────────
  const memberships = pnl.categories.find((row) => row.category === ACCOUNTS.MEMBERSHIP_REVENUE)?.usd ?? 0;

  // ── Money out of the drawer today (expenses, payroll, stock, suppliers) ───
  const outflows = cashToday.filter((movement) => movement.direction === "out");
  const expenseLines: ExpenseLine[] = outflows.map((movement) => ({
    desc: movement.description?.trim() || movement.category || "Dépense",
    amount: movement.amount,
    currency: movement.currency,
  }));
  const cashSummary = summarizeMovements(cashToday);
  const expenses = cashSummary.outBookUsd;

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

  // ── Remaining cash is the running drawer balance, not today’s net flow. ──
  // The business day resets at 21:00, but cash carried forward (including
  // opening/cutover entries) must still appear in the morning WhatsApp report.
  // Match the Accounts page USD-equivalent drawer balance at the current FX rate.
  const remaining = drawerBalance.balanceUsd;

  const [year, month, day] = lubDateStr.split("-");
  const friendlyDate = `${day}/${month}/${year}`;

  const lowStock = await getLowStockProducts();

  const message = formatDailySummaryMessage({
    date: friendlyDate,
    memberships,
    expenses, expenseLines,
    sales, salesCdf, productLines,
    remaining,
    lowStock,
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
  lowStock?: LowStockItem[];
}): string {
  const { date, memberships, expenseLines, productLines, remaining, lowStock } = opts;

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

  // ── Stock faible (alertes) ─────────────────────────────────────────────────
  if (lowStock && lowStock.length > 0) {
    lines.push(`⚠️ *Stock faible :*`);
    for (const p of lowStock) {
      lines.push(`   ${p.name} — ${p.quantity} restant(s)`);
    }
    lines.push(``);
  }

  lines.push(`_OxygenGym — rapport automatique_`);

  return lines.join("\n");
}
