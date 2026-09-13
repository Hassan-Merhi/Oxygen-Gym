import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { cashLedgerTable, settingsTable } from "@workspace/db/schema";
import { and, gte, lte, eq, count, desc } from "drizzle-orm";
import { GetLedgerBalanceResponse, ListLedgerQueryParams, ListLedgerResponse, SetOpeningBalanceBody, SetOpeningBalanceResponse } from "@workspace/api-zod";
import { getCurrentBalance, appendLedgerEntry } from "../lib/ledger";
import { postDoubleEntry } from "../lib/accounting";
import { parseBody, parseQuery, sendContract } from "../http/contracts";

const router = Router();
router.use(requireAuth());

router.get("/balance", async (req: Request, res: Response) => {
  const balance = await getCurrentBalance();
  sendContract(req, res, GetLedgerBalanceResponse, balance);
});

router.post("/opening-balance", async (req: Request, res: Response) => {
  const body = parseBody(req, res, SetOpeningBalanceBody);
  if (!body) return;
  const { targetAmountUsd, date, notes } = body;

  if (!Number.isFinite(targetAmountUsd) || targetAmountUsd < 0) {
    res.status(400).json({ error: "targetAmountUsd must be a non-negative number" });
    return;
  }

  const [currentBalance, [settingsRow]] = await Promise.all([
    getCurrentBalance(),
    db.select({ usdToCdfRate: settingsTable.usdToCdfRate }).from(settingsTable).limit(1),
  ]);

  const exchangeRate = Number(settingsRow?.usdToCdfRate ?? 2800);
  const delta = targetAmountUsd - currentBalance.balanceUsd;

  if (Math.abs(delta) < 0.001) {
    sendContract(req, res, SetOpeningBalanceResponse, { ok: true, skipped: true, balance: currentBalance });
    return;
  }

  const entryDate = date ? new Date(date) : new Date();
  const amount = Math.abs(delta);
  const description = notes ?? "Opening balance adjustment";
  const createdBy = req.__gymproUser ? String(req.__gymproUser.id) : undefined;
  const sourceNumber = `OPENING-${Date.now()}`;

  await appendLedgerEntry({
    entryDate,
    sourceType: "opening_balance",
    sourceNumber,
    direction: delta > 0 ? "in" : "out",
    amount,
    currency: "USD",
    exchangeRate,
    description,
    createdBy,
  });

  await postDoubleEntry({
    entryDate,
    sourceType: "opening_balance",
    sourceNumber,
    debitName: delta > 0 ? "Cash" : "Opening Balance Equity",
    debitType: delta > 0 ? "asset" : "equity",
    creditName: delta > 0 ? "Opening Balance Equity" : "Cash",
    creditType: delta > 0 ? "equity" : "asset",
    amount,
    amountUsd: amount,
    amountCdf: amount * exchangeRate,
    currency: "USD",
    exchangeRate,
    description,
    createdBy,
  });

  const newBalance = await getCurrentBalance();
  sendContract(req, res, SetOpeningBalanceResponse, { ok: true, skipped: false, balance: newBalance });
});

router.get("/", async (req: Request, res: Response) => {
  const query = parseQuery(req, res, ListLedgerQueryParams);
  if (!query) return;
  const pageNum = Math.max(1, query.page ?? 1);
  const limitNum = Math.min(200, Math.max(1, query.limit ?? 50));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [];
  if (query.direction) conditions.push(eq(cashLedgerTable.direction, query.direction));
  if (query.dateFrom) conditions.push(gte(cashLedgerTable.entryDate, new Date(query.dateFrom)));
  if (query.dateTo) conditions.push(lte(cashLedgerTable.entryDate, new Date(query.dateTo + "T23:59:59")));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [items, [totRow]] = await Promise.all([
    db.select().from(cashLedgerTable).where(where).orderBy(desc(cashLedgerTable.id)).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(cashLedgerTable).where(where),
  ]);

  sendContract(req, res, ListLedgerResponse, { items, total: Number(totRow.total), page: pageNum, limit: limitNum });
});

export default router;
