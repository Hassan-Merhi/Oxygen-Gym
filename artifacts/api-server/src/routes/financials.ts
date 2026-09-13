import { contractQueryAs } from "../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import {
  paymentsTable,
  vouchersTable,
  salesTable,
  settingsTable,
} from "@workspace/db/schema";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import {
  lubumbashiMonthBounds,
  lubumbashiTodayEnd,
  lubumbashiTodayStart,
  lubumbashiYearBounds,
} from "../lib/timezone";

const router = Router();
router.use(requireAuth());

type Period = "today" | "month" | "last_month" | "year" | "custom";
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
const EPSILON = 0.000001;

function localDateKey(value: Date): string {
  return new Date(value.getTime() + LUB_OFFSET_MS).toISOString().slice(0, 10);
}

function prettyCategory(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function amountUsd(
  storedUsd: number | null | undefined,
  amount: number | null | undefined,
  currency: string | null | undefined,
  exchangeRate: number | null | undefined,
): number {
  if (storedUsd !== null && storedUsd !== undefined && Number.isFinite(Number(storedUsd))) {
    return Number(storedUsd);
  }
  const raw = Number(amount ?? 0);
  if ((currency ?? "USD").toUpperCase() === "USD") return raw;
  const rate = Number(exchangeRate ?? 0);
  return rate > 0 ? raw / rate : 0;
}

function rangeFor(period: Period, dateFrom?: string, dateTo?: string): { from: Date; to: Date } | null {
  const now = new Date();

  if (period === "custom") {
    if (!dateFrom || !dateTo) return null;
    const from = new Date(`${dateFrom}T00:00:00+02:00`);
    const to = new Date(`${dateTo}T23:59:59.999+02:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
    return { from, to };
  }

  if (period === "today") {
    return { from: lubumbashiTodayStart(now), to: lubumbashiTodayEnd(now) };
  }
  if (period === "year") {
    const { start, end } = lubumbashiYearBounds(now);
    return { from: start, to: end };
  }
  if (period === "last_month") {
    const current = lubumbashiMonthBounds(now);
    const { start, end } = lubumbashiMonthBounds(new Date(current.start.getTime() - 1));
    return { from: start, to: end };
  }
  const { start, end } = lubumbashiMonthBounds(now);
  return { from: start, to: end };
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

  // Stock purchases create inventory (an asset). They are not a P&L expense;
  // the expense is recognized as COGS when the stock is sold.
  if (category === "stock_purchase") return null;
  if (category === "payroll") return "Payroll";
  if (category === "expense") return "Expenses";
  if (category === "other") return "Other Expense";
  return prettyCategory(category || "Other Expense");
}

function isInventoryCategory(category?: string | null): boolean {
  const normalized = (category ?? "").toLowerCase().replace(/[ _-]+/g, "");
  return normalized === "inventory" || normalized === "stockpurchase" || normalized === "stock";
}

function addTransaction(
  list: FinancialTransaction[],
  input: Omit<FinancialTransaction, "date" | "dateKey" | "monthKey" | "amountCdf"> & { date: Date },
  rate: number,
): void {
  const dateKey = localDateKey(input.date);
  const usd = Math.abs(Number(input.amountUsd ?? 0));
  if (usd < EPSILON) return;
  list.push({
    ...input,
    date: input.date.toISOString(),
    dateKey,
    monthKey: dateKey.slice(0, 7),
    amountUsd: usd,
    amountCdf: usd * rate,
  });
}

router.get("/", async (req: Request, res: Response) => {
  const { period = "month", dateFrom, dateTo } = contractQueryAs<Record<string, string>>(req, ApiContracts.GetFinancialsQueryParams);
  const selectedPeriod: Period = ["today", "month", "last_month", "year", "custom"].includes(period)
    ? (period as Period)
    : "month";
  const range = rangeFor(selectedPeriod, dateFrom, dateTo);

  if (!range) {
    res.status(400).json({ error: "A valid start and end date are required for a custom range." });
    return;
  }

  const [settings] = await db.select({ rate: settingsTable.usdToCdfRate }).from(settingsTable).limit(1);
  const rate = Number(settings?.rate ?? 2800) > 0 ? Number(settings?.rate ?? 2800) : 2800;

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
      paymentDate: paymentsTable.paymentDate,
      notes: paymentsTable.notes,
      memberName: paymentsTable.memberName,
      linkedEntity: paymentsTable.linkedEntity,
      linkedEntityId: paymentsTable.linkedEntityId,
      linkedEntityName: paymentsTable.linkedEntityName,
      planName: paymentsTable.planName,
    })
      .from(paymentsTable)
      .where(and(
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
      voucherDate: vouchersTable.voucherDate,
      category: vouchersTable.category,
      description: vouchersTable.description,
      paidTo: vouchersTable.paidTo,
      receivedFrom: vouchersTable.receivedFrom,
      linkedEntityName: vouchersTable.linkedEntityName,
    })
      .from(vouchersTable)
      .where(and(
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
    })
      .from(salesTable)
      .where(and(
        eq(salesTable.status, "completed"),
        gte(salesTable.saleDate, range.from),
        lte(salesTable.saleDate, range.to),
      )),
  ]);

  const transactions: FinancialTransaction[] = [];

  for (const payment of payments) {
    // POS creates a linked payment for cash-book purposes. Product revenue is
    // read from the sale itself below so edits to sale date/value stay aligned
    // with COGS and the same sale is never counted twice.
    const isLinkedPosSale = payment.direction === "in"
      && payment.category === "product_sale"
      && payment.linkedEntity === "sale"
      && payment.linkedEntityId !== null;
    if (isLinkedPosSale) continue;

    const category = categoryForPayment(payment.category, payment.direction);
    if (!category) continue;
    const kind: Kind = payment.direction === "in" ? "revenue" : "expense";
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
      amountUsd: amountUsd(payment.amountUsd, payment.amount, payment.currency, payment.exchangeRate),
    }, rate);
  }

  for (const voucher of vouchers) {
    // Inventory purchases are balance-sheet movements, not period expenses.
    if (voucher.direction === "out" && isInventoryCategory(voucher.category)) continue;
    const kind: Kind = voucher.direction === "in" ? "revenue" : "expense";
    const fallback = kind === "revenue" ? "Other Income" : "Expenses";
    const category = voucher.category ? prettyCategory(voucher.category) : fallback;
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
      amountUsd: amountUsd(voucher.amountUsd, voucher.amount, voucher.currency, voucher.exchangeRate),
    }, rate);
  }

  for (const sale of sales) {
    const itemSummary = (sale.items ?? [])
      .map((item) => `${item.quantity > 1 ? `${item.quantity}× ` : ""}${item.productName}`)
      .join(", ");
    const saleDescription = itemSummary || sale.notes || "Product sale";

    // Gross sale value is revenue. Use salesTable as the authoritative source
    // so sale edits and the P&L period remain synchronized.
    addTransaction(transactions, {
      id: `sale-revenue-${sale.id}`,
      sourceType: "sale_revenue",
      sourceId: sale.id,
      reference: sale.saleNumber ?? `SALE-${sale.id}`,
      date: sale.saleDate,
      kind: "revenue",
      category: "Product Sales",
      description: saleDescription,
      party: "POS",
      amountUsd: amountUsd(sale.totalAmountUsd, sale.totalAmount, sale.currency, sale.exchangeRate),
    }, rate);

    // Product purchases are inventory assets. Recognize cost only when sold,
    // using the cost captured by the POS at the time of sale.
    addTransaction(transactions, {
      id: `sale-cogs-${sale.id}`,
      sourceType: "sale_cogs",
      sourceId: sale.id,
      reference: sale.saleNumber ?? `SALE-${sale.id}`,
      date: sale.saleDate,
      kind: "expense",
      category: "Cost of Goods Sold",
      description: saleDescription,
      party: "POS",
      amountUsd: amountUsd(sale.totalCostUsd, sale.totalCost, sale.currency, sale.exchangeRate),
    }, rate);
  }

  transactions.sort((a, b) => {
    const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
    return dateDiff !== 0 ? dateDiff : b.id.localeCompare(a.id);
  });

  const categoryMap = new Map<string, { category: string; kind: Kind; usd: number }>();
  const monthMap = new Map<string, {
    key: string;
    label: string;
    revenueUsd: number;
    expensesUsd: number;
    transactions: FinancialTransaction[];
  }>();

  let revenueUsd = 0;
  let expensesUsd = 0;

  for (const transaction of transactions) {
    if (transaction.kind === "revenue") revenueUsd += transaction.amountUsd;
    else expensesUsd += transaction.amountUsd;

    const categoryKey = `${transaction.kind}:${transaction.category}`;
    const category = categoryMap.get(categoryKey) ?? {
      category: transaction.category,
      kind: transaction.kind,
      usd: 0,
    };
    category.usd += transaction.amountUsd;
    categoryMap.set(categoryKey, category);

    const month = monthMap.get(transaction.monthKey) ?? {
      key: transaction.monthKey,
      label: monthLabel(transaction.monthKey),
      revenueUsd: 0,
      expensesUsd: 0,
      transactions: [],
    };
    if (transaction.kind === "revenue") month.revenueUsd += transaction.amountUsd;
    else month.expensesUsd += transaction.amountUsd;
    month.transactions.push(transaction);
    monthMap.set(transaction.monthKey, month);
  }

  const toMoney = (usd: number) => ({ usd, cdf: usd * rate });

  const categories = [...categoryMap.values()]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "revenue" ? -1 : 1;
      return b.usd - a.usd;
    })
    .map((category) => ({
      category: category.category,
      kind: category.kind,
      ...toMoney(category.usd),
    }));

  const months = [...monthMap.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((month) => ({
      key: month.key,
      label: month.label,
      revenue: toMoney(month.revenueUsd),
      expenses: toMoney(month.expensesUsd),
      net: toMoney(month.revenueUsd - month.expensesUsd),
      transactions: month.transactions,
    }));

  res.json({
    period: selectedPeriod,
    dateFrom: range.from.toISOString(),
    dateTo: range.to.toISOString(),
    rate,
    currency: { base: "USD", display: "CDF" },
    revenue: toMoney(revenueUsd),
    expenses: toMoney(expensesUsd),
    net: toMoney(revenueUsd - expensesUsd),
    categories,
    months,
  });
});

export default router;