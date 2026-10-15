import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db/schema";
import { and, gte, isNull, eq, count } from "drizzle-orm";
import {
  lubumbashiTodayStart,
  lubumbashiTodayEnd,
  lubumbashiMonthBounds,
  lubumbashiYearBounds,
} from "../lib/timezone";
import { getExchangeRate } from "../shared/accounting/currency";
import { getProfitAndLoss } from "../domains/accounting/ledger-reports";

const router = Router();
router.use(requireAuth());

/**
 * The dashboard shows four numbers:
 *   1. active members right now
 *   2. revenue  — today / this month / this year (income accounts)
 *   3. expenses — today / this month / this year (expense accounts, incl. cost of goods sold)
 *   4. profit   — today / this month / this year / all time
 *
 * Every figure is read from the general ledger with the FX rate locked on each
 * entry, the same source as Profit & Loss and Financials, so the screens agree.
 * Buying stock is not an expense; its cost is expensed when the goods are sold.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Members whose subscription is still valid right now. */
async function countActiveMembers(): Promise<number> {
  const today = lubumbashiTodayStart();
  const rows = await db
    .select({ count: count() })
    .from(membersTable)
    .where(
      and(
        eq(membersTable.status, "active"),
        isNull(membersTable.deletedAt),
        gte(membersTable.expiryDate, today),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

// GET /api/dashboard/kpis
router.get("/kpis", async (_req: Request, res: Response) => {
  const month = lubumbashiMonthBounds();
  const year = lubumbashiYearBounds();
  const [rate, activeMembers, day, monthPnl, yearPnl, allTime] = await Promise.all([
    getExchangeRate(),
    countActiveMembers(),
    getProfitAndLoss({ from: lubumbashiTodayStart(), to: lubumbashiTodayEnd() }),
    getProfitAndLoss({ from: month.start, to: month.end }),
    getProfitAndLoss({ from: year.start, to: year.end }),
    getProfitAndLoss(),
  ]);

  res.json({
    activeMembers: { count: activeMembers },
    revenue: { day: round2(day.revenue.usd), month: round2(monthPnl.revenue.usd), year: round2(yearPnl.revenue.usd) },
    expenses: { day: round2(day.expenses.usd), month: round2(monthPnl.expenses.usd), year: round2(yearPnl.expenses.usd) },
    profit: {
      day: round2(day.net.usd),
      month: round2(monthPnl.net.usd),
      year: round2(yearPnl.net.usd),
      total: round2(allTime.net.usd),
    },
    currency: "USD",
    rate,
  });
});

export default router;
