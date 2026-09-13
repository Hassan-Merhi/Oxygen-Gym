import { db } from "@workspace/db";
import { paymentsTable, salesTable, vouchersTable } from "@workspace/db/schema";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import {
  lubumbashiMonthBounds,
  lubumbashiTodayEnd,
  lubumbashiTodayStart,
  lubumbashiYearBounds,
} from "../../lib/timezone";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { addMoney, money, subtractMoney } from "../../shared/accounting/decimal";
import { badRequest } from "../../shared/http/errors";

export type FinancialPeriod = "today" | "month" | "last_month" | "year" | "custom";
type Kind = "revenue" | "expense";

type FinancialTransaction = {
  id: string;
  sourceType: "payment" | "voucher" | "sale_revenue" | "sale_cogs";
  sourceId: number;
  reference: string;
  date: string;
  dateKey: string;
  monthKey: string;
  kind: Kind;
  category: string;
  description: string;
  party: string;
  amountUsd: number;
  amountCdf: number;
};

const LUB_OFFSET_MS = 2 * 60 * 60 * 1000;

function localDateKey(value: Date): string {
  return new Date(value.getTime() + LUB_OFFSET_MS).toISOString().slice(0, 10);
}

function prettyCategory(value: string): string {
  return value.replace(/[_-]+/g, " ").trim().replace(/\b\w/g, (char) => char.toUpperCase());
}

function lockedAmounts(
  storedUsd: number | null | undefined,
  storedCdf: number | null | undefined,
  amount: number | null | undefined,
  currency: string | null | undefined,
  exchangeRate: number | null | undefined,
): { usd: number; cdf: number } {
  const raw = money(Number(amount ?? 0));
  const normalized = (currency ?? "USD").toUpperCase();
  const rate = Number(exchangeRate ?? 0);
  const fallback = rate > 0 ? toUsdCdf(raw, normalized, rate) : { amountUsd: normalized === "USD" ? raw : 0, amountCdf: normalized === "CDF" ? raw : 0 };
  return {
    usd: storedUsd !== null && storedUsd !== undefined && Number.isFinite(Number(storedUsd))
      ? money(Number(storedUsd))
      : fallback.amountUsd,
    cdf: storedCdf !== null && storedCdf !== undefined && Number.isFinite(Number(storedCdf))
      ? money(Number(storedCdf))
      : fallback.amountCdf,
  };
}

function rangeFor(period: FinancialPeriod, dateFrom?: string, dateTo?: string): { from: Date; to: Date } {
  const now = new Date();
  if (period === "custom") {
    if (!dateFrom || !dateTo) throw badRequest("A valid start and end date are required for a custom range.");
    const from = new Date(`${dateFrom}T00:00:00+02:00`);
    const to = new Date(`${dateTo}T23:59:59.999+02:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw badRequest("A valid start and end date are required for a custom range.");
    return { from, to };
  }
  if (period === "today") return { from: lubumbashiTodayStart(now), to: lubumbashiTodayEnd(now) };
  if (period === "year") {
    const { start, end } = lubumbashiYearBounds(now);
    return { from: start, to: end };
  }
  if (period === "last_month") {
    const current = lubumbashiMonthBounds(now);
    const previous = lubumbashiMonthBounds(new Date(current.start.getTime() - 1));
    return { from: previous.start, to: previous.end };
  }
  const current = lubumbashiMonthBounds(now);
  return { from: current.start, to: current.end };
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function categoryForPayment(category: string, direction: string): string | null {
  if (direction === "in") {
    if (category === "membership") return "Membership";
    if (category === "product_sale") return "Product Sales";
    if (category === "other") return "Other Income";
    return prettyCategory(category || "Other Income");
  }

  // Asset purchases and liability settlements are cash outflows, not P&L expenses.
  if (category === "stock_purchase" || category === "supplier_payment") return null;
  if (category === "payroll") return "Payroll";
  if (category === "expense") return "General Expenses";
  if (category === "other") return "Other Expense";
  return prettyCategory(category || "Other Expense");
}

function isInventoryCategory(category?: string | null): boolean {
  const normalized = (category ?? "").toLowerCase().replace(/[ _-]+/g, "");
  return normalized === "inventory" || normalized === "stockpurchase" || normalized === "stock";
}

function addTransaction(
  list: FinancialTransaction[],
  input: Omit<FinancialTransaction, "date" | "dateKey" | "monthKey"> & { date: Date },
): void {
  const usd = money(Math.abs(input.amountUsd));
  const cdf = money(Math.abs(input.amountCdf));
  if (usd === 0 && cdf === 0) return;
  const dateKey = localDateKey(input.date);
  list.push({
    ...input,
    date: input.date.toISOString(),
    dateKey,
    monthKey: dateKey.slice(0, 7),
    amountUsd: usd,
    amountCdf: cdf,
  });
}

export async function getFinancialReport(input: { period?: string; dateFrom?: string; dateTo?: string }) {
  const selectedPeriod: FinancialPeriod = ["today", "month", "last_month", "year", "custom"].includes(input.period ?? "month")
    ? input.period as FinancialPeriod
    : "month";
  const range = rangeFor(selectedPeriod, input.dateFrom, input.dateTo);
  const currentRate = await getExchangeRate();

  const [payments, vouchers, sales] = await Promise.all([
    db.select({
      id: paymentsTable.id,
      paymentNumber: paymentsTable.paymentNumber,
      direction: paymentsTable.direction,
      category: paymentsTable.category,
      amount: paymentsTable.amount,
      currency: paymentsTable.currency,
      exchangeRate: paymentsTable.exchangeRate,
      amountUsd: paymentsTable.amountUsd,
      amountCdf: paymentsTable.amountCdf,
      paymentDate: paymentsTable.paymentDate,
      notes: paymentsTable.notes,
      memberId: paymentsTable.memberId,
      memberName: paymentsTable.memberName,
      linkedEntity: paymentsTable.linkedEntity,
      linkedEntityId: paymentsTable.linkedEntityId,
      linkedEntityName: paymentsTable.linkedEntityName,
      planName: paymentsTable.planName,
    }).from(paymentsTable).where(and(
      eq(paymentsTable.status, "completed"),
      gte(paymentsTable.paymentDate, range.from),
      lte(paymentsTable.paymentDate, range.to),
    )),
    db.select({
      id: vouchersTable.id,
      voucherNumber: vouchersTable.voucherNumber,
      voucherType: vouchersTable.voucherType,
      direction: vouchersTable.direction,
      amount: vouchersTable.amount,
      currency: vouchersTable.currency,
      exchangeRate: vouchersTable.exchangeRate,
      amountUsd: vouchersTable.amountUsd,
      amountCdf: vouchersTable.amountCdf,
      voucherDate: vouchersTable.voucherDate,
      category: vouchersTable.category,
      description: vouchersTable.description,
      paidTo: vouchersTable.paidTo,
      receivedFrom: vouchersTable.receivedFrom,
      linkedEntity: vouchersTable.linkedEntity,
      linkedEntityId: vouchersTable.linkedEntityId,
      linkedEntityName: vouchersTable.linkedEntityName,
    }).from(vouchersTable).where(and(
      eq(vouchersTable.status, "recorded"),
      isNull(vouchersTable.deletedAt),
      gte(vouchersTable.voucherDate, range.from),
      lte(vouchersTable.voucherDate, range.to),
    )),
    db.select({
      id: salesTable.id,
      saleNumber: salesTable.saleNumber,
      saleDate: salesTable.saleDate,
      totalAmount: salesTable.totalAmount,
      totalAmountUsd: salesTable.totalAmountUsd,
      totalCost: salesTable.totalCost,
      totalCostUsd: salesTable.totalCostUsd,
      currency: salesTable.currency,
      exchangeRate: salesTable.exchangeRate,
      notes: salesTable.notes,
      items: salesTable.items,
    }).from(salesTable).where(and(
      eq(salesTable.status, "completed"),
      gte(salesTable.saleDate, range.from),
      lte(salesTable.saleDate, range.to),
    )),
  ]);

  const membershipPaymentMemberIds = new Set(
    payments
      .filter((payment) => payment.direction === "in" && payment.category === "membership" && payment.memberId !== null)
      .map((payment) => payment.memberId as number),
  );

  const transactions: FinancialTransaction[] = [];
  for (const payment of payments) {
    const linkedPosSale = payment.direction === "in"
      && payment.category === "product_sale"
      && payment.linkedEntity === "sale"
      && payment.linkedEntityId !== null;
    if (linkedPosSale) continue;
    const category = categoryForPayment(payment.category, payment.direction);
    if (!category) continue;
    const kind: Kind = payment.direction === "in" ? "revenue" : "expense";
    const amounts = lockedAmounts(payment.amountUsd, payment.amountCdf, payment.amount, payment.currency, payment.exchangeRate);
    addTransaction(transactions, {
      id: `payment-${payment.id}`,
      sourceType: "payment",
      sourceId: payment.id,
      reference: payment.paymentNumber ?? `PAY-${payment.id}`,
      date: payment.paymentDate,
      kind,
      category,
      description: payment.notes || payment.planName || category,
      party: payment.memberName || payment.linkedEntityName || "—",
      amountUsd: amounts.usd,
      amountCdf: amounts.cdf,
    });
  }

  for (const voucher of vouchers) {
    const duplicateMembershipReceipt = voucher.linkedEntity === "member"
      && voucher.linkedEntityId !== null
      && voucher.voucherType === "cash_receipt"
      && membershipPaymentMemberIds.has(voucher.linkedEntityId);
    if (duplicateMembershipReceipt) continue;
    if (voucher.direction === "out" && isInventoryCategory(voucher.category)) continue;
    const kind: Kind = voucher.direction === "in" ? "revenue" : "expense";
    const fallback = kind === "revenue" ? "Other Income" : "General Expenses";
    const category = voucher.category ? prettyCategory(voucher.category) : fallback;
    const amounts = lockedAmounts(voucher.amountUsd, voucher.amountCdf, voucher.amount, voucher.currency, voucher.exchangeRate);
    addTransaction(transactions, {
      id: `voucher-${voucher.id}`,
      sourceType: "voucher",
      sourceId: voucher.id,
      reference: voucher.voucherNumber ?? `VCH-${voucher.id}`,
      date: voucher.voucherDate,
      kind,
      category,
      description: voucher.description || prettyCategory(voucher.voucherType),
      party: voucher.paidTo || voucher.receivedFrom || voucher.linkedEntityName || "—",
      amountUsd: amounts.usd,
      amountCdf: amounts.cdf,
    });
  }

  for (const sale of sales) {
    const itemSummary = (sale.items ?? []).map((item) => `${item.quantity > 1 ? `${item.quantity}× ` : ""}${item.productName}`).join(", ");
    const description = itemSummary || sale.notes || "Product sale";
    const revenue = lockedAmounts(sale.totalAmountUsd, undefined, sale.totalAmount, sale.currency, sale.exchangeRate);
    const cogs = lockedAmounts(sale.totalCostUsd, undefined, sale.totalCost, sale.currency, sale.exchangeRate);
    addTransaction(transactions, {
      id: `sale-revenue-${sale.id}`,
      sourceType: "sale_revenue",
      sourceId: sale.id,
      reference: sale.saleNumber ?? `SALE-${sale.id}`,
      date: sale.saleDate,
      kind: "revenue",
      category: "Product Sales",
      description,
      party: "POS",
      amountUsd: revenue.usd,
      amountCdf: revenue.cdf,
    });
    addTransaction(transactions, {
      id: `sale-cogs-${sale.id}`,
      sourceType: "sale_cogs",
      sourceId: sale.id,
      reference: sale.saleNumber ?? `SALE-${sale.id}`,
      date: sale.saleDate,
      kind: "expense",
      category: "Cost of Goods Sold",
      description,
      party: "POS",
      amountUsd: cogs.usd,
      amountCdf: cogs.cdf,
    });
  }

  transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.id.localeCompare(a.id));
  const categoryMap = new Map<string, { category: string; kind: Kind; usd: number; cdf: number }>();
  const monthMap = new Map<string, { key: string; label: string; revenueUsd: number; revenueCdf: number; expensesUsd: number; expensesCdf: number; transactions: FinancialTransaction[] }>();
  let revenueUsd = 0;
  let revenueCdf = 0;
  let expensesUsd = 0;
  let expensesCdf = 0;

  for (const transaction of transactions) {
    if (transaction.kind === "revenue") {
      revenueUsd = addMoney(revenueUsd, transaction.amountUsd);
      revenueCdf = addMoney(revenueCdf, transaction.amountCdf);
    } else {
      expensesUsd = addMoney(expensesUsd, transaction.amountUsd);
      expensesCdf = addMoney(expensesCdf, transaction.amountCdf);
    }
    const categoryKey = `${transaction.kind}:${transaction.category}`;
    const category = categoryMap.get(categoryKey) ?? { category: transaction.category, kind: transaction.kind, usd: 0, cdf: 0 };
    category.usd = addMoney(category.usd, transaction.amountUsd);
    category.cdf = addMoney(category.cdf, transaction.amountCdf);
    categoryMap.set(categoryKey, category);

    const month = monthMap.get(transaction.monthKey) ?? {
      key: transaction.monthKey,
      label: monthLabel(transaction.monthKey),
      revenueUsd: 0,
      revenueCdf: 0,
      expensesUsd: 0,
      expensesCdf: 0,
      transactions: [],
    };
    if (transaction.kind === "revenue") {
      month.revenueUsd = addMoney(month.revenueUsd, transaction.amountUsd);
      month.revenueCdf = addMoney(month.revenueCdf, transaction.amountCdf);
    } else {
      month.expensesUsd = addMoney(month.expensesUsd, transaction.amountUsd);
      month.expensesCdf = addMoney(month.expensesCdf, transaction.amountCdf);
    }
    month.transactions.push(transaction);
    monthMap.set(transaction.monthKey, month);
  }

  const categories = [...categoryMap.values()]
    .sort((a, b) => a.kind !== b.kind ? (a.kind === "revenue" ? -1 : 1) : b.usd - a.usd)
    .map((category) => ({ category: category.category, kind: category.kind, usd: category.usd, cdf: category.cdf }));
  const months = [...monthMap.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((month) => ({
      key: month.key,
      label: month.label,
      revenue: { usd: month.revenueUsd, cdf: month.revenueCdf },
      expenses: { usd: month.expensesUsd, cdf: month.expensesCdf },
      net: {
        usd: subtractMoney(month.revenueUsd, month.expensesUsd),
        cdf: subtractMoney(month.revenueCdf, month.expensesCdf),
      },
      transactions: month.transactions,
    }));

  return {
    period: selectedPeriod,
    dateFrom: range.from.toISOString(),
    dateTo: range.to.toISOString(),
    rate: currentRate,
    currency: { base: "USD", display: "CDF" },
    revenue: { usd: revenueUsd, cdf: revenueCdf },
    expenses: { usd: expensesUsd, cdf: expensesCdf },
    net: {
      usd: subtractMoney(revenueUsd, expensesUsd),
      cdf: subtractMoney(revenueCdf, expensesCdf),
    },
    categories,
    months,
  };
}
