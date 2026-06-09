import { Router, type Request, type Response } from "express";
import { requireAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { cashLedgerTable } from "@workspace/db/schema";
import { and, gte, lte, eq, count, desc } from "drizzle-orm";
import { getCurrentBalance } from "../lib/ledger";

const router = Router();
router.use(requireAuth());

router.get("/balance", async (_req: Request, res: Response) => {
  const balance = await getCurrentBalance();
  res.json(balance);
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
