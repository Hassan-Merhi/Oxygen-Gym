import { db } from "@workspace/db";
import { paymentsTable, vouchersTable } from "@workspace/db/schema";
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, not, or, sql } from "drizzle-orm";
import { getCurrentBalance } from "../../lib/ledger";
import { addMoney, money, subtractMoney } from "../../shared/accounting/decimal";
import { getFinancialReport } from "./financials-service";

export interface AccountMovementListInput {
  page: number;
  limit: number;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  currency?: string;
}

function toDateKey(value?: Date): string | undefined {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

async function cashMovementForRange(from: Date, to: Date) {
  const result = await db.execute(sql`
    WITH payment_values AS (
      SELECT
        direction,
        COALESCE(amount_usd, CASE
          WHEN currency = 'USD' THEN amount
          WHEN COALESCE(exchange_rate, 0) > 0 THEN amount / exchange_rate
          ELSE 0 END) AS usd,
        COALESCE(amount_cdf, CASE
          WHEN currency = 'CDF' THEN amount
          WHEN COALESCE(exchange_rate, 0) > 0 THEN amount * exchange_rate
          ELSE 0 END) AS cdf
      FROM payments
      WHERE status = 'completed'
        AND payment_date BETWEEN ${from} AND ${to}
        AND LOWER(REPLACE(TRIM(COALESCE(account, 'cash')), '_', ' ')) = 'cash'
    ),
    voucher_values AS (
      SELECT
        v.direction,
        COALESCE(v.amount_usd, CASE
          WHEN v.currency = 'USD' THEN v.amount
          WHEN COALESCE(v.exchange_rate, 0) > 0 THEN v.amount / v.exchange_rate
          ELSE 0 END) AS usd,
        COALESCE(v.amount_cdf, CASE
          WHEN v.currency = 'CDF' THEN v.amount
          WHEN COALESCE(v.exchange_rate, 0) > 0 THEN v.amount * v.exchange_rate
          ELSE 0 END) AS cdf
      FROM vouchers v
      WHERE v.status = 'recorded'
        AND v.deleted_at IS NULL
        AND v.voucher_date BETWEEN ${from} AND ${to}
        AND LOWER(REPLACE(TRIM(COALESCE(v.account, 'cash')), '_', ' ')) = 'cash'
        AND NOT (
          v.linked_entity = 'member'
          AND v.voucher_type = 'cash_receipt'
          AND EXISTS (
            SELECT 1 FROM payments p
            WHERE p.member_id = v.linked_entity_id
              AND p.category = 'membership'
              AND p.status = 'completed'
          )
        )
    ),
    stock_cash AS (
      SELECT
        -COALESCE(SUM(COALESCE(total_cost_usd, CASE
          WHEN currency = 'USD' THEN total_cost
          WHEN COALESCE(exchange_rate, 0) > 0 THEN total_cost / exchange_rate
          ELSE 0 END)), 0) AS usd,
        -COALESCE(SUM(COALESCE(total_cost_cdf, CASE
          WHEN currency = 'CDF' THEN total_cost
          WHEN COALESCE(exchange_rate, 0) > 0 THEN total_cost * exchange_rate
          ELSE 0 END)), 0) AS cdf
      FROM stock_purchases sp
      WHERE paid_from_cash = 1
        AND purchase_date BETWEEN ${from} AND ${to}
        AND (payment_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM payments p2 WHERE p2.id = sp.payment_id AND p2.status = 'completed'
        ))
    ),
    movements AS (
      SELECT CASE WHEN direction='in' THEN usd ELSE -usd END AS usd,
             CASE WHEN direction='in' THEN cdf ELSE -cdf END AS cdf,
             direction
      FROM payment_values
      UNION ALL
      SELECT CASE WHEN direction='in' THEN usd ELSE -usd END,
             CASE WHEN direction='in' THEN cdf ELSE -cdf END,
             direction
      FROM voucher_values
    )
    SELECT
      COALESCE(SUM(CASE WHEN direction='in' THEN usd ELSE 0 END), 0) AS in_usd,
      COALESCE(SUM(CASE WHEN direction='in' THEN cdf ELSE 0 END), 0) AS in_cdf,
      COALESCE(-SUM(CASE WHEN direction='out' THEN usd ELSE 0 END), 0) - stock_cash.usd AS out_usd,
      COALESCE(-SUM(CASE WHEN direction='out' THEN cdf ELSE 0 END), 0) - stock_cash.cdf AS out_cdf
    FROM movements, stock_cash
    GROUP BY stock_cash.usd, stock_cash.cdf
  `);
  const row = result.rows[0] as Record<string, string | number | null> | undefined;
  return {
    inUsd: money(Number(row?.in_usd ?? 0)),
    inCdf: money(Number(row?.in_cdf ?? 0)),
    outUsd: money(Number(row?.out_usd ?? 0)),
    outCdf: money(Number(row?.out_cdf ?? 0)),
  };
}

export async function getAccountsSummary() {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const [balance, todayReport, monthReport, todayCash, monthCash] = await Promise.all([
    getCurrentBalance(),
    getFinancialReport({ period: "today" }),
    getFinancialReport({ period: "month" }),
    cashMovementForRange(todayStart, todayEnd),
    cashMovementForRange(monthStart, monthEnd),
  ]);

  return {
    cash: {
      balanceUsd: balance.balanceUsd,
      balanceCdf: balance.balanceCdf,
      todayInUsd: todayCash.inUsd,
      todayOutUsd: todayCash.outUsd,
      monthInUsd: monthCash.inUsd,
      monthOutUsd: monthCash.outUsd,
    },
    sales: {
      todayUsd: todayReport.revenue.usd,
      todayCdf: todayReport.revenue.cdf,
      monthUsd: monthReport.revenue.usd,
      monthCdf: monthReport.revenue.cdf,
    },
    expenses: {
      todayUsd: todayReport.expenses.usd,
      todayCdf: todayReport.expenses.cdf,
      monthUsd: monthReport.expenses.usd,
      monthCdf: monthReport.expenses.cdf,
    },
    profit: {
      todayUsd: todayReport.net.usd,
      todayCdf: todayReport.net.cdf,
      monthUsd: monthReport.net.usd,
      monthCdf: monthReport.net.cdf,
    },
  };
}

export async function getProfitLoss(input: { period: string; dateFrom?: Date; dateTo?: Date }) {
  const report = await getFinancialReport({
    period: input.period,
    dateFrom: toDateKey(input.dateFrom),
    dateTo: toDateKey(input.dateTo),
  });
  return {
    period: report.period,
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
    revenue: report.revenue,
    expenses: report.expenses,
    net: report.net,
    breakdown: Object.fromEntries(
      report.categories.map((row) => [row.category, { usd: row.usd, cdf: row.cdf, kind: row.kind }]),
    ),
  };
}

/** P&L expense movements only: excludes inventory purchases and supplier-liability settlements. */
export async function listAccountExpenses(input: AccountMovementListInput) {
  const nonExpensePaymentCategories = ["membership", "product_sale", "stock_purchase", "supplier_payment"];
  const payConditions: ReturnType<typeof eq>[] = [
    eq(paymentsTable.direction, "out"),
    eq(paymentsTable.status, "completed"),
    not(inArray(paymentsTable.category, nonExpensePaymentCategories)) as ReturnType<typeof eq>,
  ];
  const voucherConditions: ReturnType<typeof eq>[] = [
    eq(vouchersTable.direction, "out"),
    eq(vouchersTable.status, "recorded"),
    isNull(vouchersTable.deletedAt) as ReturnType<typeof eq>,
    or(
      isNull(vouchersTable.category),
      not(inArray(vouchersTable.category, ["inventory", "stock_purchase", "stock"])),
    ) as ReturnType<typeof eq>,
  ];
  if (input.dateFrom) {
    payConditions.push(gte(paymentsTable.paymentDate, input.dateFrom));
    voucherConditions.push(gte(vouchersTable.voucherDate, input.dateFrom));
  }
  if (input.dateTo) {
    payConditions.push(lte(paymentsTable.paymentDate, input.dateTo));
    voucherConditions.push(lte(vouchersTable.voucherDate, input.dateTo));
  }
  if (input.currency) {
    payConditions.push(eq(paymentsTable.currency, input.currency));
    voucherConditions.push(eq(vouchersTable.currency, input.currency));
  }
  if (input.search) {
    payConditions.push(or(
      ilike(paymentsTable.paymentNumber, `%${input.search}%`),
      ilike(paymentsTable.linkedEntityName, `%${input.search}%`),
      ilike(paymentsTable.notes, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
    voucherConditions.push(or(
      ilike(vouchersTable.voucherNumber, `%${input.search}%`),
      ilike(vouchersTable.paidTo, `%${input.search}%`),
      ilike(vouchersTable.description, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
  }

  const offset = (input.page - 1) * input.limit;
  const fetchLimit = input.limit + offset;
  const [payments, vouchers, [paymentCount], [voucherCount]] = await Promise.all([
    db.select().from(paymentsTable).where(and(...payConditions)).orderBy(desc(paymentsTable.paymentDate)).limit(fetchLimit),
    db.select().from(vouchersTable).where(and(...voucherConditions)).orderBy(desc(vouchersTable.voucherDate)).limit(fetchLimit),
    db.select({ total: count() }).from(paymentsTable).where(and(...payConditions)),
    db.select({ total: count() }).from(vouchersTable).where(and(...voucherConditions)),
  ]);

  const items = [
    ...payments.map((payment) => ({
      id: `pay-${payment.id}`,
      sourceType: "payment",
      sourceNumber: payment.paymentNumber,
      date: payment.paymentDate,
      description: payment.notes ?? payment.category,
      party: payment.linkedEntityName ?? "",
      category: payment.category,
      amount: payment.amount,
      currency: payment.currency,
      amountUsd: money(payment.amountUsd ?? 0),
      amountCdf: money(payment.amountCdf ?? 0),
      createdBy: payment.createdBy,
    })),
    ...vouchers.map((voucher) => ({
      id: `vch-${voucher.id}`,
      sourceType: "voucher",
      sourceNumber: voucher.voucherNumber,
      date: voucher.voucherDate,
      description: voucher.description,
      party: voucher.paidTo ?? voucher.linkedEntityName ?? "",
      category: voucher.category ?? voucher.voucherType,
      amount: voucher.amount,
      currency: voucher.currency,
      amountUsd: money(voucher.amountUsd ?? 0),
      amountCdf: money(voucher.amountCdf ?? 0),
      createdBy: voucher.createdBy,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(offset, offset + input.limit);

  return {
    items,
    total: Number(paymentCount.total) + Number(voucherCount.total),
    page: input.page,
    limit: input.limit,
  };
}
