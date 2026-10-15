/**
 * Financial statements built only from the general ledger.
 *
 * Revenue and expenses are the movements of income and expense accounts at the
 * FX rate locked on each entry. Period-closing journals are excluded from P&L
 * views (they only move the period's result into Retained Earnings).
 */
import { db, type DbExecutor } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getLedgerLines, type LedgerLine } from "../../lib/ledger";
import {
  businessDateKey,
  businessDateRange,
  lubumbashiMonthBounds,
  lubumbashiTodayEnd,
  lubumbashiTodayStart,
  lubumbashiYearBounds,
} from "../../lib/timezone";
import { addMoney, money, subtractMoney } from "../../shared/accounting/decimal";
import { badRequest } from "../../shared/http/errors";

export type ReportPeriod = "today" | "month" | "last_month" | "year" | "all" | "custom";

export interface DateRange {
  from?: Date;
  to?: Date;
}

/** Resolve a named period (or a YYYY-MM-DD custom range) into business-day bounds. */
export function resolvePeriod(period: string | undefined, dateFrom?: string, dateTo?: string, now = new Date()): { period: ReportPeriod; from?: Date; to?: Date } {
  const selected = (["today", "month", "last_month", "year", "all", "custom"].includes(period ?? "") ? period : "month") as ReportPeriod;
  if (selected === "custom") {
    const valid = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!valid(dateFrom) || !valid(dateTo) || dateFrom! > dateTo!) {
      throw badRequest("A valid start and end date are required for a custom range.");
    }
    const { start, end } = businessDateRange(dateFrom!, dateTo!);
    return { period: selected, from: start, to: end };
  }
  if (selected === "all") return { period: selected };
  if (selected === "today") return { period: selected, from: lubumbashiTodayStart(now), to: lubumbashiTodayEnd(now) };
  if (selected === "year") {
    const { start, end } = lubumbashiYearBounds(now);
    return { period: selected, from: start, to: end };
  }
  if (selected === "last_month") {
    const current = lubumbashiMonthBounds(now);
    const previous = lubumbashiMonthBounds(new Date(current.start.getTime() - 1));
    return { period: selected, from: previous.start, to: previous.end };
  }
  const current = lubumbashiMonthBounds(now);
  return { period: selected, from: current.start, to: current.end };
}

export interface AccountTotal {
  accountId: number;
  name: string;
  type: string;
  debitUsd: number;
  creditUsd: number;
  debitCdf: number;
  creditCdf: number;
}

/** Debit/credit totals per account over a range (or all time). */
export async function getAccountTotals(
  range: DateRange & { excludeClosing?: boolean } = {},
  executor: DbExecutor = db,
): Promise<AccountTotal[]> {
  const result = await executor.execute(sql`
    SELECT a.id, a.name, a.type,
           COALESCE(SUM(e.debit_usd), 0) AS debit_usd, COALESCE(SUM(e.credit_usd), 0) AS credit_usd,
           COALESCE(SUM(e.debit_cdf), 0) AS debit_cdf, COALESCE(SUM(e.credit_cdf), 0) AS credit_cdf
    FROM accounting_entries e
    JOIN chart_of_accounts a ON a.id = e.account_id
    WHERE TRUE
      ${range.from ? sql`AND e.entry_date >= ${range.from}` : sql``}
      ${range.to ? sql`AND e.entry_date <= ${range.to}` : sql``}
      ${range.excludeClosing ? sql`AND e.source_type <> 'period_close'` : sql``}
    GROUP BY a.id, a.name, a.type
    ORDER BY a.type, a.name
  `);
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    accountId: Number(row.id),
    name: String(row.name),
    type: String(row.type),
    debitUsd: money(Number(row.debit_usd ?? 0)),
    creditUsd: money(Number(row.credit_usd ?? 0)),
    debitCdf: money(Number(row.debit_cdf ?? 0)),
    creditCdf: money(Number(row.credit_cdf ?? 0)),
  }));
}

export interface Amount {
  usd: number;
  cdf: number;
}

function credit(total: AccountTotal): Amount {
  return { usd: subtractMoney(total.creditUsd, total.debitUsd), cdf: subtractMoney(total.creditCdf, total.debitCdf) };
}

function debit(total: AccountTotal): Amount {
  return { usd: subtractMoney(total.debitUsd, total.creditUsd), cdf: subtractMoney(total.debitCdf, total.creditCdf) };
}

function sumAmounts(values: Amount[]): Amount {
  return { usd: addMoney(...values.map((value) => value.usd)), cdf: addMoney(...values.map((value) => value.cdf)) };
}

export interface ProfitAndLoss {
  revenue: Amount;
  expenses: Amount;
  net: Amount;
  categories: Array<{ category: string; kind: "revenue" | "expense"; usd: number; cdf: number }>;
}

/** Profit and loss for a range, by income and expense account. */
export async function getProfitAndLoss(range: DateRange = {}, executor: DbExecutor = db): Promise<ProfitAndLoss> {
  const totals = await getAccountTotals({ ...range, excludeClosing: true }, executor);
  const revenueRows = totals.filter((row) => row.type === "income").map((row) => ({ name: row.name, amount: credit(row) }));
  const expenseRows = totals.filter((row) => row.type === "expense").map((row) => ({ name: row.name, amount: debit(row) }));
  const revenue = sumAmounts(revenueRows.map((row) => row.amount));
  const expenses = sumAmounts(expenseRows.map((row) => row.amount));
  const categories = [
    ...revenueRows.map((row) => ({ category: row.name, kind: "revenue" as const, ...row.amount })),
    ...expenseRows.map((row) => ({ category: row.name, kind: "expense" as const, ...row.amount })),
  ]
    .filter((row) => row.usd !== 0 || row.cdf !== 0)
    .sort((a, b) => (a.kind !== b.kind ? (a.kind === "revenue" ? -1 : 1) : b.usd - a.usd));
  return {
    revenue,
    expenses,
    net: { usd: subtractMoney(revenue.usd, expenses.usd), cdf: subtractMoney(revenue.cdf, expenses.cdf) },
    categories,
  };
}

export interface TrialBalanceRow extends AccountTotal {
  balanceUsd: number;
  balanceCdf: number;
  normal: "debit" | "credit";
}

/** Trial balance as of a date: every account's debit and credit totals. */
export async function getTrialBalance(asOf?: Date, executor: DbExecutor = db) {
  const totals = await getAccountTotals({ to: asOf }, executor);
  const rows: TrialBalanceRow[] = totals.map((row) => {
    const normal = row.type === "asset" || row.type === "expense" ? "debit" : "credit";
    const amount = normal === "debit" ? debit(row) : credit(row);
    return { ...row, normal, balanceUsd: amount.usd, balanceCdf: amount.cdf };
  });
  const debitUsd = addMoney(...rows.map((row) => row.debitUsd));
  const creditUsd = addMoney(...rows.map((row) => row.creditUsd));
  const debitCdf = addMoney(...rows.map((row) => row.debitCdf));
  const creditCdf = addMoney(...rows.map((row) => row.creditCdf));
  return {
    asOf: (asOf ?? new Date()).toISOString(),
    rows: rows.filter((row) => row.debitUsd !== 0 || row.creditUsd !== 0 || row.debitCdf !== 0 || row.creditCdf !== 0),
    totals: { debitUsd, creditUsd, debitCdf, creditCdf },
    balanced: Math.abs(debitUsd - creditUsd) < 0.00001 && Math.abs(debitCdf - creditCdf) < 0.00001,
  };
}

/** Balance sheet as of a date. Profit not yet closed shows as current earnings. */
export async function getBalanceSheet(asOf?: Date, executor: DbExecutor = db) {
  const totals = await getAccountTotals({ to: asOf }, executor);
  const section = (type: string, sign: (row: AccountTotal) => Amount) => totals
    .filter((row) => row.type === type)
    .map((row) => ({ accountId: row.accountId, name: row.name, ...sign(row) }))
    .filter((row) => row.usd !== 0 || row.cdf !== 0);
  const assets = section("asset", debit);
  const liabilities = section("liability", credit);
  const equity = section("equity", credit);
  const income = sumAmounts(totals.filter((row) => row.type === "income").map(credit));
  const expense = sumAmounts(totals.filter((row) => row.type === "expense").map(debit));
  const currentEarnings = { usd: subtractMoney(income.usd, expense.usd), cdf: subtractMoney(income.cdf, expense.cdf) };
  const totalAssets = sumAmounts(assets);
  const totalLiabilities = sumAmounts(liabilities);
  const totalEquity = sumAmounts([...equity, currentEarnings]);
  const liabilitiesAndEquity = sumAmounts([totalLiabilities, totalEquity]);
  return {
    asOf: (asOf ?? new Date()).toISOString(),
    assets,
    liabilities,
    equity,
    currentEarnings,
    totals: { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity, liabilitiesAndEquity },
    balanced: Math.abs(totalAssets.usd - liabilitiesAndEquity.usd) < 0.00001
      && Math.abs(totalAssets.cdf - liabilitiesAndEquity.cdf) < 0.00001,
  };
}

export interface PnlTransaction {
  id: string;
  journalId: string;
  sourceType: string;
  sourceId: number | null;
  reference: string;
  date: string;
  dateKey: string;
  monthKey: string;
  kind: "revenue" | "expense";
  category: string;
  description: string;
  party: string;
  amountUsd: number;
  amountCdf: number;
}

/** Signed P&L lines for a range: revenue positive on income accounts, expenses positive on expense accounts. */
export async function getPnlTransactions(range: DateRange = {}, executor: DbExecutor = db): Promise<PnlTransaction[]> {
  const lines = await getLedgerLines({
    accountTypes: ["income", "expense"],
    dateFrom: range.from,
    dateTo: range.to,
    excludeClosing: true,
    order: "desc",
  }, executor);
  return lines.map((line: LedgerLine) => {
    const kind = line.accountType === "income" ? "revenue" as const : "expense" as const;
    const usd = kind === "revenue" ? subtractMoney(line.creditUsd, line.debitUsd) : subtractMoney(line.debitUsd, line.creditUsd);
    const cdf = kind === "revenue" ? subtractMoney(line.creditCdf, line.debitCdf) : subtractMoney(line.debitCdf, line.creditCdf);
    const dateKey = businessDateKey(line.date);
    return {
      id: `entry-${line.entryId}`,
      journalId: line.journalId,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      reference: line.sourceNumber ?? `${line.sourceType.toUpperCase()}-${line.sourceId ?? line.entryId}`,
      date: line.date.toISOString(),
      dateKey,
      monthKey: dateKey.slice(0, 7),
      kind,
      category: line.accountName,
      description: line.description,
      party: line.party || "—",
      amountUsd: usd,
      amountCdf: cdf,
    };
  });
}
