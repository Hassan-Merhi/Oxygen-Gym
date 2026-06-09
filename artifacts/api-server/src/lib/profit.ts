import { db, paymentsTable, expensesTable, payrollTable, salesTable, settingsTable } from "@workspace/db";
import { and, gte, lte, eq, sum } from "drizzle-orm";

async function getRate(): Promise<number> {
  const settings = await db.query.settingsTable.findFirst();
  return settings?.usdToCdfRate ?? 2800;
}

function toUsd(amount: number, currency: string, rate: number): number {
  if (currency === "USD") return amount;
  return amount / rate;
}

export interface ProfitBreakdown {
  totalRevenue: number;
  membershipRevenue: number;
  salesRevenue: number;
  cogs: number;
  expenses: number;
  payrollTotal: number;
  profit: number;
}

export async function calculateProfit(from: Date, to: Date): Promise<ProfitBreakdown> {
  const rate = await getRate();

  // Membership revenue
  const membershipRows = await db
    .select({ amount: paymentsTable.amount, currency: paymentsTable.currency })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.status, "completed"),
        gte(paymentsTable.paymentDate, from),
        lte(paymentsTable.paymentDate, to),
      ),
    );

  const membershipRevenue = membershipRows.reduce(
    (acc, r) => acc + toUsd(r.amount, r.currency, rate),
    0,
  );

  // Sales revenue + COGS
  const salesRows = await db
    .select({
      totalAmount: salesTable.totalAmount,
      costTotal: salesTable.costTotal,
      currency: salesTable.currency,
    })
    .from(salesTable)
    .where(
      and(
        eq(salesTable.status, "completed"),
        gte(salesTable.saleDate, from),
        lte(salesTable.saleDate, to),
      ),
    );

  const salesRevenue = salesRows.reduce(
    (acc, r) => acc + toUsd(r.totalAmount, r.currency, rate),
    0,
  );
  const cogs = salesRows.reduce(
    (acc, r) => acc + toUsd(r.costTotal, r.currency, rate),
    0,
  );

  // Expenses
  const expenseRows = await db
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

  const expenses = expenseRows.reduce(
    (acc, r) => acc + toUsd(r.amount, r.currency, rate),
    0,
  );

  // Payroll (paid only, by paid date)
  const payrollRows = await db
    .select({ amount: payrollTable.amount, currency: payrollTable.currency })
    .from(payrollTable)
    .where(
      and(
        eq(payrollTable.status, "paid"),
        gte(payrollTable.paidAt, from),
        lte(payrollTable.paidAt, to),
      ),
    );

  const payrollTotal = payrollRows.reduce(
    (acc, r) => acc + toUsd(r.amount, r.currency, rate),
    0,
  );

  const totalRevenue = membershipRevenue + salesRevenue;
  const profit = totalRevenue - cogs - expenses - payrollTotal;

  return {
    totalRevenue,
    membershipRevenue,
    salesRevenue,
    cogs,
    expenses,
    payrollTotal,
    profit,
  };
}

export async function calculateMonthlyRevenue(year: number, month: number): Promise<number> {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);
  const { totalRevenue } = await calculateProfit(from, to);
  return totalRevenue;
}

export async function calculateMonthlyExpenses(year: number, month: number): Promise<number> {
  const rate = await getRate();
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  const expenseRows = await db
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

  return expenseRows.reduce((acc, r) => acc + toUsd(r.amount, r.currency, rate), 0);
}
