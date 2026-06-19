import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { paymentsTable, settingsTable, cashLedgerTable, membersTable, commissionsTable, vouchersTable } from "@workspace/db/schema";
import { eq, and, ilike, or, gte, lte, count, sum, desc, asc, not } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry, getCurrentBalance } from "../lib/ledger";
import { postDoubleEntry, reverseEntries, categoryAccountNames } from "../lib/accounting";

const router = Router();
router.use(requireAuth());

// ─── Helper: get exchange rate from settings ─────────────────────────────────
async function getExchangeRate(): Promise<number> {
  const [s] = await db.select({ rate: settingsTable.usdToCdfRate }).from(settingsTable);
  return s?.rate ?? 2800;
}

// ─── Helper: get caller name ─────────────────────────────────────────────────
function callerName(req: Request): string {
  return (req as unknown as { __gymproUserName?: string }).__gymproUserName ?? "System";
}

// ─── Summary ─────────────────────────────────────────────────────────────────
router.get("/summary", async (req: Request, res: Response) => {
  const [s] = await db.select({ rate: settingsTable.usdToCdfRate, currency: settingsTable.defaultCurrency }).from(settingsTable);
  const rate = s?.rate ?? 2800;
  const currency = s?.currency ?? "USD";

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const [
    payTodayIn, payTodayOut, payAllIn, payAllOut,
    vchTodayIn, vchTodayOut, vchAllIn, vchAllOut,
  ] = await Promise.all([
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.direction, "in"), eq(paymentsTable.status, "completed"), gte(paymentsTable.paymentDate, todayStart), lte(paymentsTable.paymentDate, todayEnd))),
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.direction, "out"), eq(paymentsTable.status, "completed"), gte(paymentsTable.paymentDate, todayStart), lte(paymentsTable.paymentDate, todayEnd))),
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.direction, "in"), eq(paymentsTable.status, "completed"))),
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.direction, "out"), eq(paymentsTable.status, "completed"))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.direction, "in"), eq(vouchersTable.status, "recorded"), gte(vouchersTable.voucherDate, todayStart), lte(vouchersTable.voucherDate, todayEnd))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.direction, "out"), eq(vouchersTable.status, "recorded"), gte(vouchersTable.voucherDate, todayStart), lte(vouchersTable.voucherDate, todayEnd))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.direction, "in"), eq(vouchersTable.status, "recorded"))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.direction, "out"), eq(vouchersTable.status, "recorded"))),
  ]);

  const n = (v: unknown) => Number(v ?? 0);
  const cashInToday    = n(payTodayIn[0]?.usd)  + n(vchTodayIn[0]?.usd);
  const cashOutToday   = n(payTodayOut[0]?.usd) + n(vchTodayOut[0]?.usd);
  const cashInTodayCdf = n(payTodayIn[0]?.cdf)  + n(vchTodayIn[0]?.cdf);
  const cashOutTodayCdf= n(payTodayOut[0]?.cdf) + n(vchTodayOut[0]?.cdf);
  const totalIn        = n(payAllIn[0]?.usd)    + n(vchAllIn[0]?.usd);
  const totalOut       = n(payAllOut[0]?.usd)   + n(vchAllOut[0]?.usd);
  const totalInCdf     = n(payAllIn[0]?.cdf)    + n(vchAllIn[0]?.cdf);
  const totalOutCdf    = n(payAllOut[0]?.cdf)   + n(vchAllOut[0]?.cdf);
  const balanceUsd     = totalIn - totalOut;
  const balanceCdf     = totalInCdf - totalOutCdf;

  res.json({
    cashInToday,
    cashOutToday,
    cashInTodayCdf,
    cashOutTodayCdf,
    netCashToday:    cashInToday - cashOutToday,
    netCashTodayCdf: cashInTodayCdf - cashOutTodayCdf,
    balanceUsd,
    balanceCdf,
    currency,
    rate,
  });
});

// ─── List ─────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const {
    page = "1", limit = "20", search, direction, category, currency, dateFrom, dateTo,
    sortBy = "paymentDate", sortOrder = "desc",
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [
    // Product sales are tracked in the Sales module — exclude from Cash Book
    not(eq(paymentsTable.category, "product_sale")),
    // Cancelled (deleted) payments are hidden from the list
    not(eq(paymentsTable.status, "cancelled")),
  ];

  if (search) {
    conditions.push(
      or(
        ilike(paymentsTable.paymentNumber, `%${search}%`),
        ilike(paymentsTable.memberName, `%${search}%`),
        ilike(paymentsTable.notes, `%${search}%`),
        ilike(paymentsTable.linkedEntityName, `%${search}%`)
      ) as ReturnType<typeof eq>
    );
  }
  if (direction) conditions.push(eq(paymentsTable.direction, direction));
  if (category) conditions.push(eq(paymentsTable.category, category));
  if (currency) conditions.push(eq(paymentsTable.currency, currency));
  if (dateFrom) conditions.push(gte(paymentsTable.paymentDate, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(paymentsTable.paymentDate, new Date(dateTo + "T23:59:59")));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const order = sortOrder === "asc" ? asc(paymentsTable.paymentDate) : desc(paymentsTable.paymentDate);

  const [items, [totRow]] = await Promise.all([
    db.select().from(paymentsTable).where(where).orderBy(order).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(paymentsTable).where(where),
  ]);

  res.json({ items, total: Number(totRow.total), page: pageNum, limit: limitNum });
});

// ─── Create ───────────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as {
    direction: string;
    category: string;
    linkedEntity?: string;
    linkedEntityId?: number;
    linkedEntityName?: string;
    memberId?: number;
    memberName?: string;
    planId?: number;
    planName?: string;
    amount: number;
    discount?: number;
    currency: string;
    exchangeRate?: number;
    account?: string;
    notes?: string;
    paymentDate?: string;
  };

  if (!body.direction || !body.category || body.amount === undefined || !body.currency) {
    res.status(400).json({ error: "direction, category, amount, currency required" });
    return;
  }

  const exchangeRate = body.exchangeRate ?? (await getExchangeRate());
  const amountUsd = body.currency === "USD" ? body.amount : body.amount / exchangeRate;
  const amountCdf = body.currency === "CDF" ? body.amount : body.amount * exchangeRate;

  const paymentNumber = await getNextNumber("PAY");
  const createdBy = callerName(req);

  const [payment] = await db.insert(paymentsTable).values({
    paymentNumber,
    direction: body.direction,
    category: body.category,
    type: body.category,
    linkedEntity: body.linkedEntity,
    linkedEntityId: body.linkedEntityId,
    linkedEntityName: body.linkedEntityName,
    memberId: body.memberId,
    memberName: body.memberName,
    planId: body.planId,
    planName: body.planName,
    amount: body.amount,
    discount: body.discount ?? 0,
    currency: body.currency,
    exchangeRate,
    amountUsd,
    amountCdf,
    account: body.account ?? "cash",
    notes: body.notes,
    paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
    status: "completed",
    createdBy,
  }).returning();

  await appendLedgerEntry({
    sourceType: "payment",
    sourceNumber: paymentNumber,
    sourceId: payment.id,
    direction: body.direction as "in" | "out",
    amount: body.amount,
    currency: body.currency,
    exchangeRate,
    description: `${body.category} — ${body.linkedEntityName ?? body.memberName ?? ""}`,
    createdBy,
  });

  // ── Double-entry accounting ──────────────────────────────────────────────
  try {
    const { debitName, debitType, creditName, creditType } = categoryAccountNames(
      body.category,
      body.direction as "in" | "out",
      body.account ?? "cash",
    );
    await postDoubleEntry({
      sourceType: "payment",
      sourceId: payment.id,
      sourceNumber: paymentNumber,
      debitName,
      debitType,
      creditName,
      creditType,
      amount: body.amount,
      amountUsd,
      amountCdf,
      currency: body.currency,
      exchangeRate,
      description: `${body.category} — ${body.linkedEntityName ?? body.memberName ?? ""}`,
      createdBy,
    });
  } catch { /* never let accounting entry creation break payment */ }

  // ── Auto-create commission if member has a coach assigned ────────────────
  if (body.memberId && body.direction === "in") {
    try {
      const [member] = await db.select().from(membersTable).where(eq(membersTable.id, body.memberId));
      if (member) {
        let coachId = member.coachId;
        let commissionAmount = member.commissionAmount ?? 0;
        if (!coachId && body.planId) {
          const { plansTable } = await import("@workspace/db/schema");
          const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, body.planId));
          if (plan?.coachId) {
            coachId = plan.coachId;
            commissionAmount = plan.coachFee ?? 0;
            await db.update(membersTable).set({ coachId: plan.coachId, commissionAmount: plan.coachFee ?? 0 }).where(eq(membersTable.id, body.memberId));
          }
        }
        if (coachId && commissionAmount > 0) {
          await db.insert(commissionsTable).values({
            staffEmployeeId: coachId,
            memberId: body.memberId,
            memberName: member.name,
            amount: commissionAmount,
            currency: body.currency,
            status: "pending",
            note: `Payment ${paymentNumber}`,
          });
        }
      }
    } catch { /* never let commission creation break payment */ }
  }

  await logActivity(req, "payment_recorded", "payment", payment.id, {
    number: paymentNumber,
    direction: body.direction,
    category: body.category,
    amount: body.amount,
    currency: body.currency,
  });

  res.status(201).json(payment);
});

// ─── Update ───────────────────────────────────────────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;

  const [existing] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (body.amount !== undefined && Number(body.amount) < 0) {
    res.status(400).json({ error: "Amount cannot be negative" });
    return;
  }
  if (body.discount !== undefined && Number(body.discount) < 0) {
    res.status(400).json({ error: "Discount cannot be negative" });
    return;
  }

  const allowed = ["direction","category","linkedEntity","linkedEntityId","linkedEntityName","memberId","memberName","planId","planName","amount","discount","currency","exchangeRate","account","notes","paymentDate"];
  const update: Record<string, unknown> = {};
  for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k]; }
  if (update.paymentDate) update.paymentDate = new Date(update.paymentDate as string);

  // Recompute derived USD/CDF columns whenever amount, currency, or rate changes
  if (update.amount !== undefined || update.currency !== undefined || update.exchangeRate !== undefined) {
    const amt = (update.amount as number) ?? existing.amount ?? 0;
    const cur = (update.currency as string) ?? existing.currency;
    const rate = (update.exchangeRate as number) ?? existing.exchangeRate ?? await getExchangeRate();
    update.amountUsd = cur === "USD" ? amt : amt / rate;
    update.amountCdf = cur === "CDF" ? amt : amt * rate;
  }

  const [payment] = await db.update(paymentsTable).set(update).where(eq(paymentsTable.id, id)).returning();
  if (!payment) { res.status(404).json({ error: "Not found" }); return; }

  // ── Ledger + accounting correction ──────────────────────────────────────
  const oldAmount = existing.amount ?? 0;
  const newAmount = (update.amount as number) ?? oldAmount;
  const oldDir = existing.direction as "in" | "out";
  const newDir = (update.direction as "in" | "out") ?? oldDir;
  const newCurrency = (update.currency as string) ?? existing.currency;
  const newExchangeRate = (update.exchangeRate as number) ?? existing.exchangeRate ?? await getExchangeRate();

  const financialsChanged =
    oldAmount !== newAmount ||
    oldDir !== newDir ||
    existing.currency !== newCurrency ||
    Math.abs((existing.exchangeRate ?? 1) - newExchangeRate) > 0.0001;

  if (financialsChanged) {
    if (oldAmount > 0) {
      await appendLedgerEntry({
        sourceType: "payment_correction",
        sourceId: id,
        direction: oldDir === "in" ? "out" : "in",
        amount: oldAmount,
        currency: existing.currency,
        exchangeRate: existing.exchangeRate ?? newExchangeRate,
        description: `Correction: reversed payment ${existing.paymentNumber ?? id}`,
      });
    }
    if (newAmount > 0) {
      await appendLedgerEntry({
        sourceType: "payment_correction",
        sourceId: id,
        direction: newDir,
        amount: newAmount,
        currency: newCurrency,
        exchangeRate: newExchangeRate,
        description: `Correction: updated payment ${existing.paymentNumber ?? id}`,
      });
    }
    // Reverse existing accounting entries and post corrected ones
    try {
      await reverseEntries("payment", id, "payment_correction", callerName(req));
      if (newAmount > 0) {
        const newAmountUsd = newCurrency === "USD" ? newAmount : newAmount / newExchangeRate;
        const newAmountCdf = newCurrency === "CDF" ? newAmount : newAmount * newExchangeRate;
        const { debitName, debitType, creditName, creditType } = categoryAccountNames(
          ((update.category as string) ?? existing.category) || "other",
          newDir,
          ((update.account as string) ?? existing.account) || "cash",
        );
        await postDoubleEntry({
          sourceType: "payment_correction",
          sourceId: id,
          sourceNumber: existing.paymentNumber ?? undefined,
          debitName,
          debitType,
          creditName,
          creditType,
          amount: newAmount,
          amountUsd: newAmountUsd,
          amountCdf: newAmountCdf,
          currency: newCurrency,
          exchangeRate: newExchangeRate,
          description: `Corrected payment ${existing.paymentNumber ?? id}`,
          createdBy: callerName(req),
        });
      }
    } catch { /* accounting entry correction failure is non-fatal */ }
  }

  await logActivity(req, "payment_edited", "payment", id, { number: payment.paymentNumber });
  res.json(payment);
});

// ─── Delete / cancel ─────────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const [payment] = await db.update(paymentsTable)
    .set({ status: "cancelled" })
    .where(eq(paymentsTable.id, id))
    .returning();
  if (!payment) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "completed" && (existing.amount ?? 0) > 0) {
    const rate = existing.exchangeRate ?? await getExchangeRate();
    const dir = existing.direction as "in" | "out";
    await appendLedgerEntry({
      sourceType: "payment_reversal",
      sourceId: id,
      direction: dir === "in" ? "out" : "in",
      amount: existing.amount!,
      currency: existing.currency,
      exchangeRate: rate,
      description: `Cancelled payment ${existing.paymentNumber ?? id}`,
    });
    try {
      await reverseEntries("payment", id, "payment_reversal", callerName(req));
    } catch { /* non-fatal */ }
  }
  // If this is a membership payment, archive the linked member record
  if (existing.category === "membership" && existing.memberId) {
    await db.update(membersTable)
      .set({ status: "archived", deletedAt: new Date() })
      .where(eq(membersTable.id, existing.memberId));
  }
  await logActivity(req, "payment_archived", "payment", id, { number: payment.paymentNumber });
  res.json({ ok: true });
});

// Suppress unused import warning (cashLedgerTable imported in original, keep for compat)
void cashLedgerTable;
void getCurrentBalance;

export default router;
