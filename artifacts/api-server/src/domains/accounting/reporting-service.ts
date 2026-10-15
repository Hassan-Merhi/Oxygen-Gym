import { db } from "@workspace/db";
import { chartOfAccountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ACCOUNTS, MONEY_ACCOUNTS, normalizeName } from "../../lib/accounting";
import {
  countLedgerLines,
  getCashMovements,
  getCurrentBalance,
  getLedgerLines,
  getMoneyBalance,
  lineToMovement,
  summarizeMovements,
  withRunningBalance,
} from "../../lib/ledger";
import { lubumbashiMonthBounds, lubumbashiTodayEnd, lubumbashiTodayStart } from "../../lib/timezone";
import { addMoney, subtractMoney } from "../../shared/accounting/decimal";
import { notFound } from "../../shared/http/errors";
import { getProfitAndLoss, resolvePeriod } from "./ledger-reports";

export interface AccountMovementListInput {
  page: number;
  limit: number;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  currency?: string;
}

/** Headline figures for the Accounts page: drawer balance, today and this month. */
export async function getAccountsSummary() {
  const now = new Date();
  const today = { from: lubumbashiTodayStart(now), to: lubumbashiTodayEnd(now) };
  const month = lubumbashiMonthBounds(now);
  const [balance, todayPnl, monthPnl, todayCash, monthCash] = await Promise.all([
    getCurrentBalance(),
    getProfitAndLoss(today),
    getProfitAndLoss({ from: month.start, to: month.end }),
    getCashMovements({ dateFrom: today.from, dateTo: today.to }),
    getCashMovements({ dateFrom: month.start, dateTo: month.end }),
  ]);
  const todaySummary = summarizeMovements(todayCash);
  const monthSummary = summarizeMovements(monthCash);

  return {
    rate: balance.rate,
    cash: {
      balanceUsd: balance.balanceUsd,
      balanceCdf: balance.balanceCdf,
      nativeUsd: balance.nativeUsd,
      nativeCdf: balance.nativeCdf,
      todayInUsd: todaySummary.inBookUsd,
      todayOutUsd: todaySummary.outBookUsd,
      monthInUsd: monthSummary.inBookUsd,
      monthOutUsd: monthSummary.outBookUsd,
    },
    sales: {
      todayUsd: todayPnl.revenue.usd,
      todayCdf: todayPnl.revenue.cdf,
      monthUsd: monthPnl.revenue.usd,
      monthCdf: monthPnl.revenue.cdf,
    },
    expenses: {
      todayUsd: todayPnl.expenses.usd,
      todayCdf: todayPnl.expenses.cdf,
      monthUsd: monthPnl.expenses.usd,
      monthCdf: monthPnl.expenses.cdf,
    },
    profit: {
      todayUsd: todayPnl.net.usd,
      todayCdf: todayPnl.net.cdf,
      monthUsd: monthPnl.net.usd,
      monthCdf: monthPnl.net.cdf,
    },
  };
}

async function listPnlLines(type: "income" | "expense", input: AccountMovementListInput) {
  const query = {
    accountTypes: [type],
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    excludeClosing: true,
    search: input.search,
  };
  const [lines, total] = await Promise.all([
    getLedgerLines({ ...query, order: "desc", limit: input.limit, offset: (input.page - 1) * input.limit }),
    countLedgerLines(query),
  ]);
  const items = lines
    .map((line) => {
      const usd = type === "income" ? subtractMoney(line.creditUsd, line.debitUsd) : subtractMoney(line.debitUsd, line.creditUsd);
      const cdf = type === "income" ? subtractMoney(line.creditCdf, line.debitCdf) : subtractMoney(line.debitCdf, line.creditCdf);
      return {
        id: `entry-${line.entryId}`,
        sourceType: line.sourceType,
        sourceNumber: line.sourceNumber,
        date: line.date.toISOString(),
        description: line.description,
        party: line.party,
        category: line.accountName,
        amount: line.amount,
        currency: line.currency,
        amountUsd: usd,
        amountCdf: cdf,
        createdBy: line.createdBy,
      };
    })
    .filter((item) => !input.currency || item.currency === input.currency.toUpperCase());
  return { items, total, page: input.page, limit: input.limit };
}

/** Revenue lines (income accounts) newest first. */
export function listAccountSales(input: AccountMovementListInput) {
  return listPnlLines("income", input);
}

/** Expense lines (expense accounts) newest first. Inventory purchases and supplier settlements are not expenses. */
export function listAccountExpenses(input: AccountMovementListInput) {
  return listPnlLines("expense", input);
}

export async function getProfitLoss(input: { period: string; dateFrom?: string; dateTo?: string }) {
  const range = resolvePeriod(input.period, input.dateFrom, input.dateTo);
  const pnl = await getProfitAndLoss({ from: range.from, to: range.to });
  return {
    period: range.period,
    dateFrom: range.from?.toISOString() ?? "",
    dateTo: range.to?.toISOString() ?? "",
    revenue: pnl.revenue,
    expenses: pnl.expenses,
    net: pnl.net,
    breakdown: Object.fromEntries(pnl.categories.map((row) => [row.category, { usd: row.usd, cdf: row.cdf, kind: row.kind }])),
  };
}

/**
 * Statement of any chart account from the ledger. Money accounts (Cash, Bank,
 * Mobile Money) also carry per-currency running balances; every account carries
 * a running USD book balance in its normal direction.
 */
export async function getAccountStatement(id: number, dateFrom?: Date, dateTo?: Date) {
  const [account] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, id)).limit(1);
  if (!account) throw notFound("Account not found");
  const debitNormal = account.type === "asset" || account.type === "expense";

  const [openingTotals] = dateFrom
    ? await getLedgerLines({ accountId: id, dateTo: new Date(dateFrom.getTime() - 1) }).then((lines) => [lines.reduce(
      (sum, line) => ({
        usd: addMoney(sum.usd, debitNormal ? subtractMoney(line.debitUsd, line.creditUsd) : subtractMoney(line.creditUsd, line.debitUsd)),
        cdf: addMoney(sum.cdf, debitNormal ? subtractMoney(line.debitCdf, line.creditCdf) : subtractMoney(line.creditCdf, line.debitCdf)),
      }),
      { usd: 0, cdf: 0 },
    )])
    : [{ usd: 0, cdf: 0 }];

  const isMoney = MONEY_ACCOUNTS.map((name) => name.toLowerCase()).includes(normalizeName(account.name).toLowerCase());
  const nativeOpening = isMoney && dateFrom
    ? await getMoneyBalance({ accountNames: [account.name], before: dateFrom })
    : { usd: 0, cdf: 0, bookUsd: 0, bookCdf: 0 };

  const lines = await getLedgerLines({ accountId: id, dateFrom, dateTo });
  let running = openingTotals!.usd;
  let runningCdf = openingTotals!.cdf;
  const native = withRunningBalance(lines.map(lineToMovement), nativeOpening);
  const rows = lines.map((line, index) => {
    running = addMoney(running, debitNormal ? subtractMoney(line.debitUsd, line.creditUsd) : subtractMoney(line.creditUsd, line.debitUsd));
    runningCdf = addMoney(runningCdf, debitNormal ? subtractMoney(line.debitCdf, line.creditCdf) : subtractMoney(line.creditCdf, line.debitCdf));
    return {
      id: line.entryId,
      journalId: line.journalId,
      date: line.date,
      description: line.description,
      party: line.party || line.sourceNumber || "",
      counterAccount: line.counterAccount,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      sourceNumber: line.sourceNumber,
      amount: line.amount,
      currency: line.currency,
      debitUsd: line.debitUsd,
      creditUsd: line.creditUsd,
      debitCdf: line.debitCdf,
      creditCdf: line.creditCdf,
      exchangeRate: line.exchangeRate,
      runningBalance: running,
      runningBalanceCdf: runningCdf,
      ...(isMoney ? { nativeBalanceUsd: native[index]!.balanceUsd, nativeBalanceCdf: native[index]!.balanceCdf } : {}),
    };
  });

  return {
    account,
    openingBalance: openingTotals!.usd,
    openingBalanceCdf: openingTotals!.cdf,
    closingBalance: running,
    closingBalanceCdf: runningCdf,
    ...(isMoney ? { openingNative: { usd: nativeOpening.usd, cdf: nativeOpening.cdf } } : {}),
    rows,
  };
}

export const CASH_ACCOUNT = ACCOUNTS.CASH;
