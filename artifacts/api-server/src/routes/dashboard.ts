import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { membersTable, paymentsTable, vouchersTable } from "@workspace/db/schema";
import { and, gte, isNull, eq, inArray, lte, sql, count } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  lubumbashiTodayStart,
  lubumbashiTodayEnd,
  lubumbashiMonthBounds,
  lubumbashiYearBounds,
} from "../lib/timezone";

const router = Router();
router.use(requireAuth());

/**
 * The dashboard shows four numbers and nothing else:
 *   1. active members right now
 *   2. total revenue  — today / this month / this year
 *   3. total expenses — today / this month / this year
 *   4. total profit   — today / this month / this year / all time
 *
 * Revenue and expenses use the same money-in / money-out definitions as
 * GET /accounts/summary (the cash page), so the two pages always agree:
 *   revenue  = completed payments (direction 'in')  + recorded vouchers (direction 'in')
 *   expenses = completed payments (direction 'out') + recorded vouchers (direction 'out')
 *   profit   = revenue - expenses
 *
 * All amounts are normalized to USD.
 */

/** Money-in categories (matches GET /accounts/summary). */
const REVENUE_CATEGORIES = ["membership", "product_sale", "other"];
/** Money-out categories (matches GET /accounts/summary). */
const EXPENSE_CATEGORIES = ["expense", "payroll", "stock_purchase", "other"];

interface Period {
  start: Date;
  end: Date;
}

async function getRate(): Promise<number> {
  const s = await db.query.settingsTable.findFirst();
  return s?.usdToCdfRate ?? 2800;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * USD value of a row: prefer the stored amount_usd, otherwise convert the raw
 * amount with the configured CDF rate (legacy rows have no amount_usd).
 */
function usdOf(
  amount: AnyPgColumn,
  currency: AnyPgColumn,
  amountUsd: AnyPgColumn,
  rate: number,
) {
  return sql<number>`COALESCE(
    ${amountUsd},
    CASE WHEN ${currency} = 'USD'
      THEN ${amount}
      ELSE ${amount} / CAST(${rate} AS DOUBLE PRECISION)
    END
  )`;
}

async function sumPaymentsUsd(
  direction: "in" | "out",
  categories: string[],
  rate: number,
  period?: Period,
): Promise<number> {
  const total = sql<number>`COALESCE(SUM(${usdOf(
    paymentsTable.amount,
    paymentsTable.currency,
    paymentsTable.amountUsd,
    rate,
  )}), 0)`;

  const conditions = [
    eq(paymentsTable.direction, direction),
    eq(paymentsTable.status, "completed"),
    inArray(paymentsTable.category, categories),
  ];
  if (period) {
    conditions.push(gte(paymentsTable.paymentDate, period.start));
    conditions.push(lte(paymentsTable.paymentDate, period.end));
  }

  const rows = await db
    .select({ total })
    .from(paymentsTable)
    .where(and(...conditions));

  return Number(rows[0]?.total ?? 0);
}

async function sumVouchersUsd(
  direction: "in" | "out",
  rate: number,
  period?: Period,
): Promise<number> {
  const total = sql<number>`COALESCE(SUM(${usdOf(
    vouchersTable.amount,
    vouchersTable.currency,
    vouchersTable.amountUsd,
    rate,
  )}), 0)`;

  const conditions = [
    eq(vouchersTable.direction, direction),
    eq(vouchersTable.status, "recorded"),
  ];
  if (period) {
    conditions.push(gte(vouchersTable.voucherDate, period.start));
    conditions.push(lte(vouchersTable.voucherDate, period.end));
  }

  const rows = await db.select({ total }).from(vouchersTable).where(and(...conditions));

  return Number(rows[0]?.total ?? 0);
}

async function revenueUsd(rate: number, period?: Period): Promise<number> {
  const [pay, vch] = await Promise.all([
    sumPaymentsUsd("in", REVENUE_CATEGORIES, rate, period),
    sumVouchersUsd("in", rate, period),
  ]);
  return pay + vch;
}

async function expensesUsd(rate: number, period?: Period): Promise<number> {
  const [pay, vch] = await Promise.all([
    sumPaymentsUsd("out", EXPENSE_CATEGORIES, rate, period),
    sumVouchersUsd("out", rate, period),
  ]);
  return pay + vch;
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
router.get("/kpis", async (req: Request, res: Response) => {
  try {
    const rate = await getRate();

    const day: Period = { start: lubumbashiTodayStart(), end: lubumbashiTodayEnd() };
    const month: Period = lubumbashiMonthBounds();
    const year: Period = lubumbashiYearBounds();

    const [activeMembers, revByPeriod, expByPeriod, revAllTime, expAllTime] = await Promise.all([
      countActiveMembers(),
      Promise.all([day, month, year].map((p) => revenueUsd(rate, p))),
      Promise.all([day, month, year].map((p) => expensesUsd(rate, p))),
      revenueUsd(rate),
      expensesUsd(rate),
    ]);

    const [revDay, revMonth, revYear] = revByPeriod;
    const [expDay, expMonth, expYear] = expByPeriod;

    res.json({
      activeMembers: { count: activeMembers },
      revenue: {
        day: round2(revDay),
        month: round2(revMonth),
        year: round2(revYear),
      },
      expenses: {
        day: round2(expDay),
        month: round2(expMonth),
        year: round2(expYear),
      },
      profit: {
        day: round2(revDay - expDay),
        month: round2(revMonth - expMonth),
        year: round2(revYear - expYear),
        total: round2(revAllTime - expAllTime),
      },
      currency: "USD",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard KPIs");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
