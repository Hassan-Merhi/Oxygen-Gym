import { getExchangeRate } from "../../shared/accounting/currency";
import { addMoney, subtractMoney } from "../../shared/accounting/decimal";
import { getPnlTransactions, getProfitAndLoss, resolvePeriod, type PnlTransaction } from "./ledger-reports";

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year!, month! - 1, 1)));
}

/**
 * Detailed profit and loss for a period, read from the general ledger.
 * Amounts use the FX rate locked on each entry, so changing today's rate never
 * rewrites history.
 */
export async function getFinancialReport(input: { period?: string; dateFrom?: string; dateTo?: string }) {
  const range = resolvePeriod(input.period, input.dateFrom, input.dateTo);
  const [pnl, transactions, rate] = await Promise.all([
    getProfitAndLoss({ from: range.from, to: range.to }),
    getPnlTransactions({ from: range.from, to: range.to }),
    getExchangeRate(),
  ]);

  const monthMap = new Map<string, {
    key: string;
    label: string;
    revenueUsd: number;
    revenueCdf: number;
    expensesUsd: number;
    expensesCdf: number;
    transactions: PnlTransaction[];
  }>();
  for (const transaction of transactions) {
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
    period: range.period,
    dateFrom: range.from?.toISOString() ?? null,
    dateTo: range.to?.toISOString() ?? null,
    rate,
    currency: { base: "USD", display: "CDF" },
    revenue: pnl.revenue,
    expenses: pnl.expenses,
    net: pnl.net,
    categories: pnl.categories,
    months,
  };
}
