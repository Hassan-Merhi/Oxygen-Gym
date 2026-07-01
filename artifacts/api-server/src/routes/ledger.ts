import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { cashLedgerTable } from "@workspace/db/schema";
import { and, gte, lte, eq, count, desc } from "drizzle-orm";
import { getCurrentBalance, appendLedgerEntry } from "../lib/ledger";
import { settingsTable } from "@workspace/db/schema";

const router = Router();
router.use(requireAuth());

router.get("/balance", async (_req: Request, res: Response) => {
  const balance = await getCurrentBalance();
  res.json(balance);
});

// POST /api/ledger/opening-balance
// Sets a new starting balance by inserting an adjustment entry.
// Nothing is deleted — existing history is preserved.
router.post("/opening-balance", async (req: Request, res: Response) => {
  const { targetAmountUsd, date, notes } = req.body as {
    targetAmountUsd: number;
    date?: string;
    notes?: string;
  };

  if (typeof targetAmountUsd !== "number" || isNaN(targetAmountUsd) || targetAmountUsd < 0) {
    res.status(400).json({ error: "targetAmountUsd must be a non-negative number" });
    return;
  }

  // Get current running balance and exchange rate
  const [currentBalance, [settingsRow]] = await Promise.all([
    getCurrentBalance(),
    db.select({ usdToCdfRate: settingsTable.usdToCdfRate }).from(settingsTable).limit(1),
  ]);

  const exchangeRate = Number(settingsRow?.usdToCdfRate ?? 2800);
  const delta = targetAmountUsd - currentBalance.balanceUsd;

  if (Math.abs(delta) < 0.001) {
    // Balance already matches — no entry needed
    res.json({ ok: true, skipped: true, balance: currentBalance });
    return;
  }

  const entryDate = date ? new Date(date) : new Date();

  await appendLedgerEntry({
    entryDate,
    sourceType: "opening_balance",
    direction: delta > 0 ? "in" : "out",
    amount: Math.abs(delta),
    currency: "USD",
    exchangeRate,
    description: notes ?? "Opening balance adjustment",
    createdBy: (req as any).auth?.userId,
  });

  const newBalance = await getCurrentBalance();
  res.json({ ok: true, skipped: false, balance: newBalance });
});

router.get("/", async (req: Request, res: Response) => {
  const { page = "1", limit = "50", dateFrom, dateTo, direction } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [];
  if (direction) conditions.push(eq(cashLedgerTable.direction, direction));
  if (dateFrom) conditions.push(gte(cashLedgerTable.entryDate, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(cashLedgerTable.entryDate, new Date(dateTo + "T23:59:59")));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, [totRow]] = await Promise.all([
    db.select().from(cashLedgerTable).where(where).orderBy(desc(cashLedgerTable.id)).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(cashLedgerTable).where(where),
  ]);

  res.json({ items, total: Number(totRow.total), page: pageNum, limit: limitNum });
});

export default router;
