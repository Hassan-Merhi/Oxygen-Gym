import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db, withTransaction } from "@workspace/db";
import {
  paymentsTable,
  membersTable,
  commissionsTable,
  vouchersTable,
  salesTable,
  plansTable,
} from "@workspace/db/schema";
import { eq, and, ilike, or, gte, lte, count, sum, desc, asc, not, inArray } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry } from "../lib/ledger";
import { postDoubleEntry, reverseEntries, categoryAccountNames } from "../lib/accounting";
import { lookupPhoneOnWhatsApp, sendDirectMessage, formatReceiptMessage } from "../lib/whatsapp";
import { lubumbashiTodayStart, lubumbashiTodayEnd } from "../lib/timezone";
import { getExchangeRate, getFinancialSettings } from "../repositories/settings";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return (req as unknown as { __gymproUserName?: string }).__gymproUserName ?? "System";
}

// ─── Summary ─────────────────────────────────────────────────────────────────
router.get("/summary", async (_req: Request, res: Response) => {
  const settings = await getFinancialSettings();
  const rate = settings.usdToCdfRate;
  const currency = settings.defaultCurrency;

  const todayStart = lubumbashiTodayStart();
  const todayEnd = lubumbashiTodayEnd();

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
  const cashInToday = n(payTodayIn[0]?.usd) + n(vchTodayIn[0]?.usd);
  const cashOutToday = n(payTodayOut[0]?.usd) + n(vchTodayOut[0]?.usd);
  const cashInTodayCdf = n(payTodayIn[0]?.cdf) + n(vchTodayIn[0]?.cdf);
  const cashOutTodayCdf = n(payTodayOut[0]?.cdf) + n(vchTodayOut[0]?.cdf);
  const totalIn = n(payAllIn[0]?.usd) + n(vchAllIn[0]?.usd);
  const totalOut = n(payAllOut[0]?.usd) + n(vchAllOut[0]?.usd);
  const totalInCdf = n(payAllIn[0]?.cdf) + n(vchAllIn[0]?.cdf);
  const totalOutCdf = n(payAllOut[0]?.cdf) + n(vchAllOut[0]?.cdf);

  res.json({
    cashInToday,
    cashOutToday,
    cashInTodayCdf,
    cashOutTodayCdf,
    netCashToday: cashInToday - cashOutToday,
    netCashTodayCdf: cashInTodayCdf - cashOutTodayCdf,
    balanceUsd: totalIn - totalOut,
    balanceCdf: totalInCdf - totalOutCdf,
    currency,
    rate,
  });
});

// ─── List ─────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const {
    page = "1", limit = "20", search, direction, category, currency, dateFrom, dateTo,
    sortOrder = "desc",
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [
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

  const where = and(...conditions);
  const order = sortOrder === "asc" ? asc(paymentsTable.paymentDate) : desc(paymentsTable.paymentDate);

  const [items, [totRow]] = await Promise.all([
    db.select().from(paymentsTable).where(where).orderBy(order).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(paymentsTable).where(where),
  ]);

  const missingSaleIds = items
    .filter((p) => p.category === "product_sale" && !p.notes && p.linkedEntityId)
    .map((p) => p.linkedEntityId!);

  const saleItemMap = new Map<number, string>();
  if (missingSaleIds.length > 0) {
    const sales = await db
      .select({ id: salesTable.id, items: salesTable.items })
      .from(salesTable)
      .where(inArray(salesTable.id, missingSaleIds));
    for (const sale of sales) {
      const summary = (sale.items ?? [])
        .map((i: { quantity: number; productName: string }) =>
          i.quantity > 1 ? `${i.quantity}× ${i.productName}` : i.productName
        )
        .join(", ");
      if (summary) saleItemMap.set(sale.id, summary);
    }
  }

  const enriched = items.map((p) => {
    if (p.category === "product_sale" && !p.notes && p.linkedEntityId && saleItemMap.has(p.linkedEntityId)) {
      return { ...p, notes: saleItemMap.get(p.linkedEntityId) };
    }
    return p;
  });

  res.json({ items: enriched, total: Number(totRow.total), page: pageNum, limit: limitNum });
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
  if (!["in", "out"].includes(body.direction)) {
    res.status(400).json({ error: "direction must be in or out" });
    return;
  }
  if (body.amount < 0 || (body.discount ?? 0) < 0) {
    res.status(400).json({ error: "amount and discount cannot be negative" });
    return;
  }

  const exchangeRate = body.exchangeRate ?? (await getExchangeRate());
  const amountUsd = body.currency === "USD" ? body.amount : body.amount / exchangeRate;
  const amountCdf = body.currency === "CDF" ? body.amount : body.amount * exchangeRate;
  const createdBy = callerName(req);

  const payment = await withTransaction(async (tx) => {
    const paymentNumber = await getNextNumber("PAY", tx);
    const [created] = await tx.insert(paymentsTable).values({
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
    if (!created) throw new Error("Unable to create payment");

    if (body.amount > 0) {
      await appendLedgerEntry({
        sourceType: "payment",
        sourceNumber: paymentNumber,
        sourceId: created.id,
        direction: body.direction as "in" | "out",
        amount: body.amount,
        currency: body.currency,
        exchangeRate,
        description: `${body.category} — ${body.linkedEntityName ?? body.memberName ?? ""}`,
        createdBy,
      }, tx);

      const { debitName, debitType, creditName, creditType } = categoryAccountNames(
        body.category,
        body.direction as "in" | "out",
        body.account ?? "cash",
      );
      await postDoubleEntry({
        sourceType: "payment",
        sourceId: created.id,
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
      }, tx);
    }

    if (body.memberId && body.direction === "in") {
      const [member] = await tx.select().from(membersTable).where(eq(membersTable.id, body.memberId));
      if (member) {
        let coachId = member.coachId;
        let commissionAmount = member.commissionAmount ?? 0;
        if (!coachId && body.planId) {
          const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, body.planId));
          if (plan?.coachId) {
            coachId = plan.coachId;
            commissionAmount = plan.coachFee ?? 0;
            await tx
              .update(membersTable)
              .set({ coachId: plan.coachId, commissionAmount: plan.coachFee ?? 0 })
              .where(eq(membersTable.id, body.memberId));
          }
        }
        if (coachId && commissionAmount > 0) {
          await tx.insert(commissionsTable).values({
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
    }

    return created;
  });

  await logActivity(req, "payment_recorded", "payment", payment.id, {
    number: payment.paymentNumber,
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

  if (body.amount !== undefined && Number(body.amount) < 0) {
    res.status(400).json({ error: "Amount cannot be negative" });
    return;
  }
  if (body.discount !== undefined && Number(body.discount) < 0) {
    res.status(400).json({ error: "Discount cannot be negative" });
    return;
  }

  const result = await withTransaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, id))
      .for("update");
    if (!existing) return { kind: "not_found" as const };

    const allowed = ["direction","category","linkedEntity","linkedEntityId","linkedEntityName","memberId","memberName","planId","planName","amount","discount","currency","exchangeRate","account","notes","paymentDate"];
    const update: Record<string, unknown> = {};
    for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k]; }
    if (update.paymentDate) update.paymentDate = new Date(update.paymentDate as string);

    if (update.amount !== undefined || update.currency !== undefined || update.exchangeRate !== undefined) {
      const amt = Number(update.amount ?? existing.amount ?? 0);
      const cur = String(update.currency ?? existing.currency);
      const rate = Number(update.exchangeRate ?? existing.exchangeRate ?? await getExchangeRate(tx));
      update.exchangeRate = rate;
      update.amountUsd = cur === "USD" ? amt : amt / rate;
      update.amountCdf = cur === "CDF" ? amt : amt * rate;
    }

    const [payment] = await tx.update(paymentsTable).set(update).where(eq(paymentsTable.id, id)).returning();
    if (!payment) throw new Error("Unable to update payment");

    const oldAmount = existing.amount ?? 0;
    const newAmount = Number(update.amount ?? oldAmount);
    const oldDir = existing.direction as "in" | "out";
    const newDir = (update.direction as "in" | "out") ?? oldDir;
    const newCurrency = String(update.currency ?? existing.currency);
    const newExchangeRate = Number(update.exchangeRate ?? existing.exchangeRate ?? await getExchangeRate(tx));

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
        }, tx);
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
        }, tx);
      }

      await reverseEntries("payment", id, "payment_correction", callerName(req), tx);
      if (newAmount > 0) {
        const newAmountUsd = newCurrency === "USD" ? newAmount : newAmount / newExchangeRate;
        const newAmountCdf = newCurrency === "CDF" ? newAmount : newAmount * newExchangeRate;
        const { debitName, debitType, creditName, creditType } = categoryAccountNames(
          String(update.category ?? existing.category ?? "other"),
          newDir,
          String(update.account ?? existing.account ?? "cash"),
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
        }, tx);
      }
    }

    return { kind: "ok" as const, payment };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  await logActivity(req, "payment_edited", "payment", id, { number: result.payment.paymentNumber });
  res.json(result.payment);
});

// ─── Delete / cancel ─────────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const result = await withTransaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, id))
      .for("update");
    if (!existing) return { kind: "not_found" as const };

    const [payment] = await tx.update(paymentsTable)
      .set({ status: "cancelled" })
      .where(eq(paymentsTable.id, id))
      .returning();
    if (!payment) throw new Error("Unable to cancel payment");

    if (existing.status === "completed" && (existing.amount ?? 0) > 0) {
      const rate = existing.exchangeRate ?? await getExchangeRate(tx);
      const dir = existing.direction as "in" | "out";
      await appendLedgerEntry({
        sourceType: "payment_reversal",
        sourceId: id,
        direction: dir === "in" ? "out" : "in",
        amount: existing.amount!,
        currency: existing.currency,
        exchangeRate: rate,
        description: `Cancelled payment ${existing.paymentNumber ?? id}`,
      }, tx);
      await reverseEntries("payment", id, "payment_reversal", callerName(req), tx);
    }

    if (existing.category === "membership" && existing.memberId) {
      await tx.update(membersTable)
        .set({ status: "archived", deletedAt: new Date() })
        .where(eq(membersTable.id, existing.memberId));
    }

    return { kind: "ok" as const, payment };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  await logActivity(req, "payment_archived", "payment", id, { number: result.payment.paymentNumber });
  res.json({ ok: true });
});

// Historical cash cleanup used to live as an HTTP endpoint here. Phase 2 moves
// one-time repairs into guarded scripts under lib/db/scripts so they cannot be
// triggered accidentally through the running application.

// ─── Send WhatsApp receipt for a payment ──────────────────────────────────────
router.post("/:id/send-receipt", async (req: Request, res: Response) => {
  const paymentId = parseInt(req.params.id as string);
  if (isNaN(paymentId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1);
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }

  let phone: string | null = null;
  if (payment.memberId) {
    const [m] = await db.select({ phone: membersTable.phone }).from(membersTable).where(eq(membersTable.id, payment.memberId)).limit(1);
    phone = m?.phone ?? null;
  }
  if (!phone) { res.status(400).json({ error: "no_phone" }); return; }

  const settings = await db.query.settingsTable.findFirst();
  if (!settings?.greenApiInstanceId || !settings?.greenApiToken) {
    res.status(400).json({ error: "WhatsApp not configured" }); return;
  }

  const chatId = await lookupPhoneOnWhatsApp(phone, settings.greenApiInstanceId, settings.greenApiToken);
  if (!chatId) { res.status(400).json({ error: "not_on_whatsapp" }); return; }

  const msg = formatReceiptMessage({
    memberName: payment.memberName,
    planName: payment.planName,
    category: payment.category,
    amount: payment.amount,
    currency: payment.currency,
    paymentDate: payment.paymentDate,
    gymName: settings.gymName,
  });

  await sendDirectMessage(settings.greenApiInstanceId, settings.greenApiToken, chatId, msg);
  res.json({ ok: true });
});

export default router;
