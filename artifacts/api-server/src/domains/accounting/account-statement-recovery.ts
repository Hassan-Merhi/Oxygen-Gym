import { db } from "@workspace/db";
import { cashLedgerTable, chartOfAccountsTable } from "@workspace/db/schema";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { fxRate, money } from "../../shared/accounting/decimal";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { getAccountStatement } from "./accounts-service";
import { canonicalAccountType } from "./chart-service";

function isCashName(name: string) {
  return name.trim().toLowerCase() === "cash";
}

async function getAccount(id: number) {
  const [account] = await db.select().from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.id, id))
    .limit(1);
  return account;
}

async function getCashLedgerFallback(account: NonNullable<Awaited<ReturnType<typeof getAccount>>>, dateFrom?: Date, dateTo?: Date) {
  const conditions = [];
  if (dateFrom) conditions.push(gte(cashLedgerTable.entryDate, dateFrom));
  if (dateTo) conditions.push(lte(cashLedgerTable.entryDate, dateTo));

  const ledgerRows = await db.select().from(cashLedgerTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(cashLedgerTable.entryDate), asc(cashLedgerTable.id));
  const fallbackRate = await getExchangeRate();

  let runningBalance = 0;
  const rows = ledgerRows.map((row) => {
    const amount = money(Number(row.amount ?? 0));
    const nativeCurrency = (row.currency ?? "USD").toUpperCase();
    const currency = nativeCurrency === "USD" ? "USD" : "CDF";
    const storedRate = Number(row.exchangeRate ?? 0);
    const rate = storedRate >= 10 ? fxRate(storedRate) : fallbackRate;
    const converted = toUsdCdf(amount, currency, rate);
    const amountUsd = converted.amountUsd;
    const amountCdf = converted.amountCdf;
    if (row.direction === "out") runningBalance -= amountUsd;
    else runningBalance += amountUsd;

    return {
      id: row.id,
      date: row.entryDate,
      description: row.description ?? row.sourceType,
      party: row.sourceNumber ?? "",
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      amount,
      currency,
      debitUsd: row.direction === "out" ? 0 : amountUsd,
      creditUsd: row.direction === "out" ? amountUsd : 0,
      debitCdf: row.direction === "out" ? 0 : amountCdf,
      creditCdf: row.direction === "out" ? amountCdf : 0,
      exchangeRate: rate,
      runningBalance,
    };
  });

  const requiredType = canonicalAccountType(account.name);
  return {
    account: requiredType ? { ...account, type: requiredType, isActive: true } : account,
    rows,
  };
}

/**
 * Cash normally comes from the reconciled business-record stream in
 * accounts-service. If a legacy production schema/source makes that composite
 * query fail, or the reconstruction unexpectedly comes back empty while the
 * append-only cash ledger has history, recover from cash_ledger instead of
 * rendering false $0 totals. Non-cash account failures are never hidden.
 */
export async function getAccountStatementWithRecovery(id: number, dateFrom?: Date, dateTo?: Date) {
  try {
    const primary = await getAccountStatement(id, dateFrom, dateTo);
    if (!isCashName(primary.account.name) || primary.rows.length > 0) return primary;

    const fallback = await getCashLedgerFallback(primary.account, dateFrom, dateTo);
    return fallback.rows.length > 0 ? fallback : primary;
  } catch (error) {
    const account = await getAccount(id);
    if (!account || !isCashName(account.name)) throw error;

    const fallback = await getCashLedgerFallback(account, dateFrom, dateTo);
    if (fallback.rows.length > 0) return fallback;
    throw error;
  }
}
