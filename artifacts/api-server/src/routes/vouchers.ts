import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { vouchersTable, settingsTable } from "@workspace/db/schema";
import { eq, and, ilike, or, gte, lte, count, isNull, desc } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry } from "../lib/ledger";
import { postDoubleEntry, reverseEntries, categoryAccountNames } from "../lib/accounting";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return (req as unknown as { __gymproUserName?: string }).__gymproUserName ?? "System";
}

async function getExchangeRate(): Promise<number> {
  const [s] = await db.select({ rate: settingsTable.usdToCdfRate }).from(settingsTable);
  return s?.rate ?? 2800;
}

function voucherDirection(voucherType: string): "in" | "out" {
  return ["cash_receipt", "customer_payment"].includes(voucherType) ? "in" : "out";
}

// ─── List ─────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const { page = "1", limit = "20", search, voucherType, currency, dateFrom, dateTo } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [
    isNull(vouchersTable.deletedAt) as ReturnType<typeof eq>,
    eq(vouchersTable.status, "recorded"),
  ];

  if (search) {
    conditions.push(
      or(
        ilike(vouchersTable.voucherNumber, `%${search}%`),
        ilike(vouchersTable.description, `%${search}%`),
        ilike(vouchersTable.paidTo, `%${search}%`),
        ilike(vouchersTable.receivedFrom, `%${search}%`)
      ) as ReturnType<typeof eq>
    );
  }
  if (voucherType) conditions.push(eq(vouchersTable.voucherType, voucherType));
  if (currency) conditions.push(eq(vouchersTable.currency, currency));
  if (dateFrom) conditions.push(gte(vouchersTable.voucherDate, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(vouchersTable.voucherDate, new Date(dateTo + "T23:59:59")));

  const where = and(...conditions);
  const [items, [totRow]] = await Promise.all([
    db.select().from(vouchersTable).where(where).orderBy(desc(vouchersTable.voucherDate)).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(vouchersTable).where(where),
  ]);

  res.json({ items, total: Number(totRow.total), page: pageNum, limit: limitNum });
});

// ─── Create ───────────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as {
    voucherType: string;
    voucherDate?: string;
    paidTo?: string;
    receivedFrom?: string;
    linkedEntity?: string;
    linkedEntityId?: number;
    linkedEntityName?: string;
    amount: number;
    currency: string;
    exchangeRate?: number;
    account?: string;
    category?: string;
    description: string;
  };

  if (!body.voucherType || body.amount === undefined || !body.currency || !body.description) {
    res.status(400).json({ error: "voucherType, amount, currency, description required" });
    return;
  }

  const exchangeRate = body.exchangeRate ?? (await getExchangeRate());
  const amountUsd = body.currency === "USD" ? body.amount : body.amount / exchangeRate;
  const amountCdf = body.currency === "CDF" ? body.amount : body.amount * exchangeRate;
  const direction = voucherDirection(body.voucherType);

  const voucherNumber = await getNextNumber("VCH");
  const createdBy = callerName(req);

  const [voucher] = await db.insert(vouchersTable).values({
    voucherNumber,
    voucherType: body.voucherType,
    direction,
    voucherDate: body.voucherDate ? new Date(body.voucherDate) : new Date(),
    paidTo: body.paidTo,
    receivedFrom: body.receivedFrom,
    linkedEntity: body.linkedEntity,
    linkedEntityId: body.linkedEntityId,
    linkedEntityName: body.linkedEntityName,
    amount: body.amount,
    currency: body.currency,
    exchangeRate,
    amountUsd,
    amountCdf,
    account: body.account ?? "cash",
    category: body.category,
    description: body.description,
    status: "recorded",
    createdBy,
  }).returning();

  await appendLedgerEntry({
    sourceType: "voucher",
    sourceNumber: voucherNumber,
    sourceId: voucher.id,
    direction,
    amount: body.amount,
    currency: body.currency,
    exchangeRate,
    description: body.description,
    createdBy,
  });

  // ── Double-entry accounting ──────────────────────────────────────────────
  try {
    const voucherCategory = direction === "in" ? "other" : "expense";
    const { debitName, debitType, creditName, creditType } = categoryAccountNames(
      voucherCategory,
      direction,
      body.account ?? "cash",
      body.category,
    );
    await postDoubleEntry({
      sourceType: "voucher",
      sourceId: voucher.id,
      sourceNumber: voucherNumber,
      debitName,
      debitType,
      creditName,
      creditType,
      amount: body.amount,
      amountUsd,
      amountCdf,
      currency: body.currency,
      exchangeRate,
      description: body.description,
      createdBy,
    });
  } catch { /* non-fatal */ }

  await logActivity(req, "voucher_created", "voucher", voucher.id, {
    number: voucherNumber,
    type: body.voucherType,
    amount: body.amount,
    currency: body.currency,
  });

  res.status(201).json(voucher);
});

// ─── Get single ───────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [voucher] = await db.select().from(vouchersTable)
    .where(and(eq(vouchersTable.id, id), isNull(vouchersTable.deletedAt)));
  if (!voucher) { res.status(404).json({ error: "Not found" }); return; }
  res.json(voucher);
});

// ─── Update ───────────────────────────────────────────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;

  const [existing] = await db.select().from(vouchersTable).where(and(eq(vouchersTable.id, id), isNull(vouchersTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const allowed = ["voucherType","voucherDate","paidTo","receivedFrom","linkedEntity","linkedEntityId","linkedEntityName","amount","currency","exchangeRate","account","category","description"];
  const update: Record<string, unknown> = {};
  for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k]; }
  if (update.voucherDate) update.voucherDate = new Date(update.voucherDate as string);

  // Recompute derived USD/CDF columns whenever amount, currency, or rate changes
  if (update.amount !== undefined || update.currency !== undefined || update.exchangeRate !== undefined) {
    const amt = (update.amount as number) ?? existing.amount ?? 0;
    const cur = (update.currency as string) ?? existing.currency;
    // Always use current settings rate when none is explicitly provided,
    // so that editing any voucher picks up a global rate change.
    const rate = (update.exchangeRate as number) ?? await getExchangeRate();
    update.exchangeRate = rate;
    update.amountUsd = cur === "USD" ? amt : amt / rate;
    update.amountCdf = cur === "CDF" ? amt : amt * rate;
  }

  const [voucher] = await db.update(vouchersTable).set(update).where(eq(vouchersTable.id, id)).returning();
  if (!voucher) { res.status(404).json({ error: "Not found" }); return; }

  // ── Ledger + accounting correction ──────────────────────────────────────
  const oldAmount = existing.amount ?? 0;
  const newAmount = (update.amount as number) ?? oldAmount;
  const newVoucherType = (update.voucherType as string) ?? existing.voucherType;
  const oldDir = voucherDirection(existing.voucherType);
  const newDir = voucherDirection(newVoucherType);
  const newCurrency = (update.currency as string) ?? existing.currency;
  const newExchangeRate = (update.exchangeRate as number) ?? existing.exchangeRate ?? await getExchangeRate();

  const financialsChanged =
    existing.status === "recorded" &&
    (oldAmount !== newAmount ||
     oldDir !== newDir ||
     existing.currency !== newCurrency ||
     Math.abs((existing.exchangeRate ?? 1) - newExchangeRate) > 0.0001);

  if (financialsChanged) {
    if (oldAmount > 0) {
      await appendLedgerEntry({
        sourceType: "voucher_correction",
        sourceNumber: existing.voucherNumber ?? undefined,
        sourceId: id,
        direction: oldDir === "in" ? "out" : "in",
        amount: oldAmount,
        currency: existing.currency,
        exchangeRate: existing.exchangeRate ?? newExchangeRate,
        description: `Correction: reversed voucher ${existing.voucherNumber ?? id}`,
      });
    }
    if (newAmount > 0) {
      await appendLedgerEntry({
        sourceType: "voucher_correction",
        sourceNumber: existing.voucherNumber ?? undefined,
        sourceId: id,
        direction: newDir,
        amount: newAmount,
        currency: newCurrency,
        exchangeRate: newExchangeRate,
        description: `Correction: updated voucher ${existing.voucherNumber ?? id}`,
      });
    }
    // Reverse and repost accounting entries
    try {
      await reverseEntries("voucher", id, "voucher_correction", callerName(req));
      if (newAmount > 0) {
        const newAmountUsd = newCurrency === "USD" ? newAmount : newAmount / newExchangeRate;
        const newAmountCdf = newCurrency === "CDF" ? newAmount : newAmount * newExchangeRate;
        const voucherCategory = newDir === "in" ? "other" : "expense";
        const { debitName, debitType, creditName, creditType } = categoryAccountNames(
          voucherCategory,
          newDir,
          ((update.account as string) ?? existing.account) || "cash",
          ((update.category as string) ?? existing.category) ?? undefined,
        );
        await postDoubleEntry({
          sourceType: "voucher_correction",
          sourceId: id,
          sourceNumber: existing.voucherNumber ?? undefined,
          debitName,
          debitType,
          creditName,
          creditType,
          amount: newAmount,
          amountUsd: newAmountUsd,
          amountCdf: newAmountCdf,
          currency: newCurrency,
          exchangeRate: newExchangeRate,
          description: `Corrected voucher ${existing.voucherNumber ?? id}`,
          createdBy: callerName(req),
        });
      }
    } catch { /* non-fatal */ }
  }

  await logActivity(req, "voucher_edited", "voucher", id, { number: voucher.voucherNumber });
  res.json(voucher);
});

// ─── Delete / cancel ─────────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(vouchersTable).where(and(eq(vouchersTable.id, id), isNull(vouchersTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const [voucher] = await db.update(vouchersTable)
    .set({ status: "cancelled", deletedAt: new Date() })
    .where(and(eq(vouchersTable.id, id), isNull(vouchersTable.deletedAt)))
    .returning();
  if (!voucher) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "recorded" && (existing.amount ?? 0) > 0) {
    const rate = existing.exchangeRate ?? await getExchangeRate();
    const dir = existing.direction as "in" | "out";
    await appendLedgerEntry({
      sourceType: "voucher_reversal",
      sourceNumber: existing.voucherNumber ?? undefined,
      sourceId: id,
      direction: dir === "in" ? "out" : "in",
      amount: existing.amount!,
      currency: existing.currency,
      exchangeRate: rate,
      description: `Cancelled voucher ${existing.voucherNumber ?? id}`,
    });
    try {
      await reverseEntries("voucher", id, "voucher_reversal", callerName(req));
    } catch { /* non-fatal */ }
  }
  await logActivity(req, "voucher_archived", "voucher", id, { number: voucher.voucherNumber });
  res.json({ ok: true });
});

export default router;
