import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  db,
  membersTable,
  checkInsTable,
  paymentsTable,
  expensesTable,
  productsTable,
  activityLogsTable,
  settingsTable,
} from "@workspace/db";
import { and, gte, lte, isNull, lt, desc, eq } from "drizzle-orm";
import { calculateProfit } from "../lib/profit";
import { lubumbashiTodayStart, lubumbashiTodayEnd } from "../lib/timezone";

const router = Router();
router.use(requireAuth());

function monthBounds(year: number, month: number): { from: Date; to: Date } {
  return {
    from: new Date(year, month - 1, 1),
    to: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function last12Months(): { year: number; month: number; label: string }[] {
  const result = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleString("en-US", { month: "short", year: "numeric" }),
    });
  }
  return result;
}

async function getRate(): Promise<number> {
  const s = await db.query.settingsTable.findFirst();
  return s?.usdToCdfRate ?? 2800;
}

function toUsd(amount: number, currency: string, rate: number): number {
  return currency === "USD" ? amount : amount / rate;
}

// GET /api/dashboard/kpis
router.get("/kpis", async (req, res) => {
  try {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
    const prevYear = curMonth === 1 ? curYear - 1 : curYear;
    const rate = await getRate();

    // ── 1. Active members ──────────────────────────────────────────────────
    const today = lubumbashiTodayStart();

    const allActiveMembers = await db
      .select({
        id: membersTable.id,
        name: membersTable.name,
        planName: membersTable.planName,
        expiryDate: membersTable.expiryDate,
      })
      .from(membersTable)
      .where(
        and(
          eq(membersTable.status, "active"),
          isNull(membersTable.deletedAt),
          gte(membersTable.expiryDate, today),
        ),
      );

    // ── 2. Monthly revenue ─────────────────────────────────────────────────
    const { from: curRevFrom, to: curRevTo } = monthBounds(curYear, curMonth);
    const { from: prevRevFrom, to: prevRevTo } = monthBounds(prevYear, prevMonth);

    const getRevenue = async (from: Date, to: Date) => {
      const rows = await db
        .select({ amount: paymentsTable.amount, currency: paymentsTable.currency })
        .from(paymentsTable)
        .where(
          and(
            eq(paymentsTable.status, "completed"),
            gte(paymentsTable.paymentDate, from),
            lte(paymentsTable.paymentDate, to),
          ),
        );
      return rows.reduce((acc, r) => acc + toUsd(r.amount, r.currency, rate), 0);
    };

    const [curRevenue, prevRevenue] = await Promise.all([
      getRevenue(curRevFrom, curRevTo),
      getRevenue(prevRevFrom, prevRevTo),
    ]);

    // ── 3. Monthly expenses ────────────────────────────────────────────────
    const getExpenses = async (from: Date, to: Date) => {
      const rows = await db
        .select({ amount: expensesTable.amount, currency: expensesTable.currency })
        .from(expensesTable)
        .where(
          and(
            eq(expensesTable.type, "expense"),
            eq(expensesTable.status, "recorded"),
            gte(expensesTable.expenseDate, from),
            lte(expensesTable.expenseDate, to),
          ),
        );
      return rows.reduce((acc, r) => acc + toUsd(r.amount, r.currency, rate), 0);
    };

    const [curExpenses, prevExpenses] = await Promise.all([
      getExpenses(curRevFrom, curRevTo),
      getExpenses(prevRevFrom, prevRevTo),
    ]);

    // ── 4. Today's check-ins ───────────────────────────────────────────────
    const todayEnd = lubumbashiTodayEnd();

    const todayCheckins = await db
      .select({ checkedInAt: checkInsTable.checkedInAt })
      .from(checkInsTable)
      .where(
        and(
          gte(checkInsTable.checkedInAt, today),
          lte(checkInsTable.checkedInAt, todayEnd),
        ),
      );

    // Build hourly distribution (0–23)
    const hourlyCounts: Record<number, number> = {};
    for (let h = 0; h < 24; h++) hourlyCounts[h] = 0;
    for (const ci of todayCheckins) {
      if (ci.checkedInAt) {
        const h = new Date(ci.checkedInAt).getHours();
        hourlyCounts[h] = (hourlyCounts[h] ?? 0) + 1;
      }
    }
    const hourly = Object.entries(hourlyCounts).map(([hour, count]) => ({
      hour: parseInt(hour),
      count,
    }));

    // ── 5. Expiring soon ───────────────────────────────────────────────────
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    const in14 = new Date(today); in14.setDate(in14.getDate() + 14);
    const in30 = new Date(today); in30.setDate(in30.getDate() + 30);

    const expiringRows = await db
      .select({
        id: membersTable.id,
        name: membersTable.name,
        planName: membersTable.planName,
        expiryDate: membersTable.expiryDate,
      })
      .from(membersTable)
      .where(
        and(
          eq(membersTable.status, "active"),
          isNull(membersTable.deletedAt),
          gte(membersTable.expiryDate, today),
          lte(membersTable.expiryDate, in30),
        ),
      );

    const withDays = expiringRows.map((m) => ({
      id: m.id,
      name: m.name,
      planName: m.planName,
      expiryDate: m.expiryDate?.toISOString() ?? null,
      daysRemaining: m.expiryDate
        ? Math.max(0, Math.ceil((m.expiryDate.getTime() - today.getTime()) / 86400000))
        : 0,
    }));

    const expiringSoon = {
      in7Days: withDays.filter((m) => m.daysRemaining <= 7),
      in14Days: withDays.filter((m) => m.daysRemaining <= 14),
      in30Days: withDays,
    };

    // ── 6. Low stock ───────────────────────────────────────────────────────
    const lowStockProducts = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        quantity: productsTable.quantity,
        alertQuantity: productsTable.alertQuantity,
      })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.status, "active"),
          isNull(productsTable.deletedAt),
          lte(productsTable.quantity, productsTable.alertQuantity),
        ),
      );

    // ── 7. Profit ──────────────────────────────────────────────────────────
    const [curProfit, prevProfit] = await Promise.all([
      calculateProfit(curRevFrom, curRevTo),
      calculateProfit(prevRevFrom, prevRevTo),
    ]);

    // ── Charts: last 12 months ─────────────────────────────────────────────
    const months = last12Months();

    const revenueChart = await Promise.all(
      months.map(async ({ year, month, label }) => {
        const { from, to } = monthBounds(year, month);
        const amount = await getRevenue(from, to);
        return { month: label, amount: Math.round(amount * 100) / 100 };
      }),
    );

    const expenseChart = await Promise.all(
      months.map(async ({ year, month, label }) => {
        const { from, to } = monthBounds(year, month);
        const amount = await getExpenses(from, to);
        return { month: label, amount: Math.round(amount * 100) / 100 };
      }),
    );

    // Membership growth: new members per month
    const membershipGrowth = await Promise.all(
      months.map(async ({ year, month, label }) => {
        const { from, to } = monthBounds(year, month);
        const rows = await db
          .select({ id: membersTable.id })
          .from(membersTable)
          .where(
            and(
              isNull(membersTable.deletedAt),
              gte(membersTable.createdAt, from),
              lte(membersTable.createdAt, to),
            ),
          );
        return { month: label, count: rows.length };
      }),
    );

    // ── Recent activity ────────────────────────────────────────────────────
    const recentActivity = await db
      .select()
      .from(activityLogsTable)
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(10);

    const kpis = {
      activeMembers: { count: allActiveMembers.length },
      monthlyRevenue: {
        current: Math.round(curRevenue * 100) / 100,
        previous: Math.round(prevRevenue * 100) / 100,
        changePercent: pctChange(curRevenue, prevRevenue),
        currency: "USD",
      },
      monthlyExpenses: {
        current: Math.round(curExpenses * 100) / 100,
        previous: Math.round(prevExpenses * 100) / 100,
        changePercent: pctChange(curExpenses, prevExpenses),
      },
      todayCheckins: { count: todayCheckins.length, hourly },
      expiringSoon,
      lowStock: lowStockProducts,
      profit: {
        current: Math.round(curProfit.profit * 100) / 100,
        previous: Math.round(prevProfit.profit * 100) / 100,
        changePercent: pctChange(curProfit.profit, prevProfit.profit),
      },
      revenueChart,
      expenseChart,
      membershipGrowth,
      recentActivity,
    };

    res.json(kpis);
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard KPIs");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
