import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { paymentsTable, settingsTable, cashLedgerTable } from "@workspace/db/schema";
import { eq, and, ilike, or, gte, lte, count, sum, desc, asc } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry, getCurrentBalance } from "../lib/ledger";

const router = Router();
router.use(requireAuth());

// ─── Helper: get exchange rate from settings ─────────────────────────────────
async function getExchangeRate(): Promise<number> {
  const [s] = await db.select({ rate: settingsTable.usdToCdfRate }).from(settingsTable);
  return s?.rate ?? 1;
}

// ─── Helper: get caller name ─────────────────────────────────────────────────
function callerName(req: Request): string {
  return (req as unknown as { __gymproUserName?: string }).__gymproUserName ?? "System";
}

// ─── Summary ─────────────────────────────────────────────────────────────────
router.get("/summary", async (req: Request, res: Response) => {
  const [s] = await db.select({ rate: settingsTable.usdToCdfRate, currency: settingsTable.defaultCurrency }).from(settingsTable);
  const rate = s?.rate ?? 1;
  const currency = s?.currency ?? "USD";

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const todayEntries = await db
    .select({ direction: cashLedgerTable.direction, amountUsd: cashLedgerTable.amountUsd })
    .from(cashLedgerTable)
    .where(and(gte(cashLedgerTable.entryDate, todayStart), lte(cashLedgerTable.entryDate, todayEnd)));

  let cashInToday = 0;
  let cashOutToday = 0;
  for (const e of todayEntries) {
    if (e.direction === "in") cashInToday += e.amountUsd;
    else cashOutToday += e.amountUsd;
  }

  const { balanceUsd, balanceCdf } = await getCurrentBalance();

  res.json({
    cashInToday,
    cashOutToday,
    netCashToday: cashInToday - cashOutToday,
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

  const conditions: ReturnType<typeof eq>[] = [];

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
  const allowed = ["direction","category","linkedEntity","linkedEntityId","linkedEntityName","memberId","memberName","planId","planName","amount","discount","currency","exchangeRate","account","notes","paymentDate"];
  const update: Record<string, unknown> = {};
  for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k]; }
  if (update.paymentDate) update.paymentDate = new Date(update.paymentDate as string);

  const [payment] = await db.update(paymentsTable).set(update).where(eq(paymentsTable.id, id)).returning();
  if (!payment) { res.status(404).json({ error: "Not found" }); return; }
  await logActivity(req, "payment_edited", "payment", id, { number: payment.paymentNumber });
  res.json(payment);
});

// ─── Delete / cancel ─────────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [payment] = await db.update(paymentsTable)
    .set({ status: "cancelled" })
    .where(eq(paymentsTable.id, id))
    .returning();
  if (!payment) { res.status(404).json({ error: "Not found" }); return; }
  await logActivity(req, "payment_archived", "payment", id, { number: payment.paymentNumber });
  res.json({ ok: true });
});

export default router;
