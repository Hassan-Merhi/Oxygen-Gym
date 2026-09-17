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

interface AggregateTotals {
  revenue: { day: number; month: number; year: number; total: number };
  expenses: { day: number; month: number; year: number; total: number };
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

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

/**
 * Aggregate every dashboard period in one scan of payments instead of issuing
 * a separate SUM query for every direction + period combination.
 */
async function aggregatePaymentsUsd(
  rate: number,
  day: Period,
  month: Period,
  year: Period,
): Promise<AggregateTotals> {
  const usd = usdOf(
    paymentsTable.amount,
    paymentsTable.currency,
    paymentsTable.amountUsd,
    rate,
  );
  const revenue = and(
    eq(paymentsTable.direction, "in"),
    eq(paymentsTable.status, "completed"),
    inArray(paymentsTable.category, REVENUE_CATEGORIES),
  )!;
  const expenses = and(
    eq(paymentsTable.direction, "out"),
    eq(paymentsTable.status, "completed"),
    inArray(paymentsTable.category, EXPENSE_CATEGORIES),
  )!;

  const [row] = await db.select({
    revenueDay: sql<number>`COALESCE(SUM(CASE WHEN ${and(revenue, gte(paymentsTable.paymentDate, day.start), lte(paymentsTable.paymentDate, day.end))!} THEN ${usd} ELSE 0 END), 0)`,
    revenueMonth: sql<number>`COALESCE(SUM(CASE WHEN ${and(revenue, gte(paymentsTable.paymentDate, month.start), lte(paymentsTable.paymentDate, month.end))!} THEN ${usd} ELSE 0 END), 0)`,
    revenueYear: sql<number>`COALESCE(SUM(CASE WHEN ${and(revenue, gte(paymentsTable.paymentDate, year.start), lte(paymentsTable.paymentDate, year.end))!} THEN ${usd} ELSE 0 END), 0)`,
    revenueTotal: sql<number>`COALESCE(SUM(CASE WHEN ${revenue} THEN ${usd} ELSE 0 END), 0)`,
    expenseDay: sql<number>`COALESCE(SUM(CASE WHEN ${and(expenses, gte(paymentsTable.paymentDate, day.start), lte(paymentsTable.paymentDate, day.end))!} THEN ${usd} ELSE 0 END), 0)`,
    expenseMonth: sql<number>`COALESCE(SUM(CASE WHEN ${and(expenses, gte(paymentsTable.paymentDate, month.start), lte(paymentsTable.paymentDate, month.end))!} THEN ${usd} ELSE 0 END), 0)`,
    expenseYear: sql<number>`COALESCE(SUM(CASE WHEN ${and(expenses, gte(paymentsTable.paymentDate, year.start), lte(paymentsTable.paymentDate, year.end))!} THEN ${usd} ELSE 0 END), 0)`,
    expenseTotal: sql<number>`COALESCE(SUM(CASE WHEN ${expenses} THEN ${usd} ELSE 0 END), 0)`,
  }).from(paymentsTable);

  return {
    revenue: {
      day: toNumber(row?.revenueDay),
      month: toNumber(row?.revenueMonth),
      year: toNumber(row?.revenueYear),
      total: toNumber(row?.revenueTotal),
    },
    expenses: {
      day: toNumber(row?.expenseDay),
      month: toNumber(row?.expenseMonth),
      year: toNumber(row?.expenseYear),
      total: toNumber(row?.expenseTotal),
    },
  };
}

/** Same single-scan aggregation for recorded vouchers. */
async function aggregateVouchersUsd(
  rate: number,
  day: Period,
  month: Period,
  year: Period,
): Promise<AggregateTotals> {
  const usd = usdOf(
    vouchersTable.amount,
    vouchersTable.currency,
    vouchersTable.amountUsd,
    rate,
  );
  const revenue = and(
    eq(vouchersTable.direction, "in"),
    eq(vouchersTable.status, "recorded"),
  )!;
  const expenses = and(
    eq(vouchersTable.direction, "out"),
    eq(vouchersTable.status, "recorded"),
  )!;

  const [row] = await db.select({
    revenueDay: sql<number>`COALESCE(SUM(CASE WHEN ${and(revenue, gte(vouchersTable.voucherDate, day.start), lte(vouchersTable.voucherDate, day.end))!} THEN ${usd} ELSE 0 END), 0)`,
    revenueMonth: sql<number>`COALESCE(SUM(CASE WHEN ${and(revenue, gte(vouchersTable.voucherDate, month.start), lte(vouchersTable.voucherDate, month.end))!} THEN ${usd} ELSE 0 END), 0)`,
    revenueYear: sql<number>`COALESCE(SUM(CASE WHEN ${and(revenue, gte(vouchersTable.voucherDate, year.start), lte(vouchersTable.voucherDate, year.end))!} THEN ${usd} ELSE 0 END), 0)`,
    revenueTotal: sql<number>`COALESCE(SUM(CASE WHEN ${revenue} THEN ${usd} ELSE 0 END), 0)`,
    expenseDay: sql<number>`COALESCE(SUM(CASE WHEN ${and(expenses, gte(vouchersTable.voucherDate, day.start), lte(vouchersTable.voucherDate, day.end))!} THEN ${usd} ELSE 0 END), 0)`,
    expenseMonth: sql<number>`COALESCE(SUM(CASE WHEN ${and(expenses, gte(vouchersTable.voucherDate, month.start), lte(vouchersTable.voucherDate, month.end))!} THEN ${usd} ELSE 0 END), 0)`,
    expenseYear: sql<number>`COALESCE(SUM(CASE WHEN ${and(expenses, gte(vouchersTable.voucherDate, year.start), lte(vouchersTable.voucherDate, year.end))!} THEN ${usd} ELSE 0 END), 0)`,
    expenseTotal: sql<number>`COALESCE(SUM(CASE WHEN ${expenses} THEN ${usd} ELSE 0 END), 0)`,
  }).from(vouchersTable);

  return {
    revenue: {
      day: toNumber(row?.revenueDay),
      month: toNumber(row?.revenueMonth),
      year: toNumber(row?.revenueYear),
      total: toNumber(row?.revenueTotal),
    },
    expenses: {
      day: toNumber(row?.expenseDay),
      month: toNumber(row?.expenseMonth),
      year: toNumber(row?.expenseYear),
      total: toNumber(row?.expenseTotal),
    },
  };
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

    // Four database round-trips total for the endpoint:
    // settings rate, member count, one payments aggregate, one vouchers aggregate.
    const [activeMembers, paymentTotals, voucherTotals] = await Promise.all([
      countActiveMembers(),
      aggregatePaymentsUsd(rate, day, month, year),
      aggregateVouchersUsd(rate, day, month, year),
    ]);

    const revDay = paymentTotals.revenue.day + voucherTotals.revenue.day;
    const revMonth = paymentTotals.revenue.month + voucherTotals.revenue.month;
    const revYear = paymentTotals.revenue.year + voucherTotals.revenue.year;
    const revAllTime = paymentTotals.revenue.total + voucherTotals.revenue.total;
    const expDay = paymentTotals.expenses.day + voucherTotals.expenses.day;
    const expMonth = paymentTotals.expenses.month + voucherTotals.expenses.month;
    const expYear = paymentTotals.expenses.year + voucherTotals.expenses.year;
    const expAllTime = paymentTotals.expenses.total + voucherTotals.expenses.total;

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
