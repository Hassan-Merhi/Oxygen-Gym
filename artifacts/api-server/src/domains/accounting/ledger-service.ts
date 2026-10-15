import { ACCOUNTS, MONEY_ACCOUNTS, getBooksLockedThrough, normalizeName, postJournal } from "../../lib/accounting";
import {
  getCashMovements,
  getCurrentBalance,
  getLedgerLines,
  getMoneyBalance,
  lineToMovement,
  summarizeMovements,
  withRunningBalance,
} from "../../lib/ledger";
import { businessDateKey } from "../../lib/timezone";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { money, subtractMoney } from "../../shared/accounting/decimal";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest } from "../../shared/http/errors";

export async function getLedgerBalance() {
  const [balance, lockedThrough] = await Promise.all([getCurrentBalance(), getBooksLockedThrough()]);
  return { ...balance, lockedThrough: lockedThrough?.toISOString() ?? null };
}

function moneyAccount(name?: string): string {
  const normalized = normalizeName(name ?? ACCOUNTS.CASH);
  if (!MONEY_ACCOUNTS.some((candidate) => candidate.toLowerCase() === normalized.toLowerCase())) {
    throw badRequest(`${normalized} is not a money account`);
  }
  return normalized;
}

/**
 * Cash Book: movements of one money account (default Cash) with the opening
 * balance before the range and a running balance per currency after each line.
 */
export async function listCashMovements(input: { account?: string; dateFrom?: Date; dateTo?: Date } = {}) {
  const account = moneyAccount(input.account);
  const [opening, movements, exchangeRate] = await Promise.all([
    input.dateFrom ? getMoneyBalance({ accountNames: [account], before: input.dateFrom }) : Promise.resolve({ usd: 0, cdf: 0, bookUsd: 0, bookCdf: 0 }),
    getCashMovements({ accountNames: [account], dateFrom: input.dateFrom, dateTo: input.dateTo }),
    getExchangeRate(),
  ]);
  const items = withRunningBalance(movements, opening).map((movement) => ({
    ...movement,
    date: movement.date.toISOString(),
    dateKey: businessDateKey(movement.date),
  }));
  const last = items.at(-1);
  return {
    account,
    exchangeRate,
    opening: { usd: opening.usd, cdf: opening.cdf },
    closing: { usd: last?.balanceUsd ?? opening.usd, cdf: last?.balanceCdf ?? opening.cdf },
    totals: summarizeMovements(movements),
    items,
  };
}

/**
 * Record a physical cash count. The difference between what was counted and
 * what the books expect is posted per currency against Cash Over/Short, or
 * against Opening Balance Equity when the account has no history yet (the very
 * first opening balance). Nothing is ever deleted.
 */
export async function recordCashCount(
  input: { countedUsd?: number; countedCdf?: number; date?: Date; notes?: string; account?: string },
  actor: string,
) {
  const account = moneyAccount(input.account);
  if (input.countedUsd === undefined && input.countedCdf === undefined) {
    throw badRequest("Enter the counted USD and/or CDF amount");
  }
  for (const [label, value] of [["USD", input.countedUsd], ["CDF", input.countedCdf]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw badRequest(`Counted ${label} must be a non-negative number`);
  }
  const entryDate = input.date ?? new Date();
  if (entryDate.getTime() > Date.now() + 60_000) throw badRequest("A cash count cannot be dated in the future");
  const exchangeRate = await getExchangeRate();

  const result = await withTransaction(async (tx) => {
    const [expected, history] = await Promise.all([
      getMoneyBalance({ accountNames: [account], asOf: entryDate }, tx),
      getLedgerLines({ accountNames: [account], dateTo: entryDate, limit: 1 }, tx),
    ]);
    const counter = history.length === 0 ? ACCOUNTS.OPENING_BALANCE_EQUITY : ACCOUNTS.CASH_OVER_SHORT;
    const counterType = history.length === 0 ? "equity" as const : "expense" as const;
    const lines = [];
    const adjustments: Array<{ currency: "USD" | "CDF"; expected: number; counted: number; difference: number }> = [];
    for (const currency of ["USD", "CDF"] as const) {
      const counted = currency === "USD" ? input.countedUsd : input.countedCdf;
      if (counted === undefined) continue;
      const current = currency === "USD" ? expected.usd : expected.cdf;
      const difference = subtractMoney(money(counted), current);
      adjustments.push({ currency, expected: current, counted: money(counted), difference });
      if (difference === 0) continue;
      const value = toUsdCdf(Math.abs(difference), currency, exchangeRate);
      const over = difference > 0;
      lines.push(
        {
          account,
          type: "asset" as const,
          amount: Math.abs(difference),
          currency,
          ...(over ? { debitUsd: value.amountUsd, debitCdf: value.amountCdf } : { creditUsd: value.amountUsd, creditCdf: value.amountCdf }),
        },
        {
          account: counter,
          type: counterType,
          amount: Math.abs(difference),
          currency,
          ...(over ? { creditUsd: value.amountUsd, creditCdf: value.amountCdf } : { debitUsd: value.amountUsd, debitCdf: value.amountCdf }),
        },
      );
    }
    const journalId = await postJournal({
      entryDate,
      sourceType: history.length === 0 ? "opening_balance" : "cash_count",
      sourceNumber: `COUNT-${businessDateKey(entryDate)}-${Date.now().toString(36).toUpperCase()}`,
      exchangeRate,
      description: input.notes?.trim() || (history.length === 0 ? "Opening cash balance" : "Cash count adjustment"),
      createdBy: actor,
      lines,
    }, tx);
    return { journalId, adjustments };
  });

  return { ok: true, skipped: result.journalId === null, journalId: result.journalId, adjustments: result.adjustments, balance: await getCurrentBalance() };
}

/** Paginated Cash lines, newest first, with the drawer's running balance per currency. */
export async function listLedger(input: { page: number; limit: number; dateFrom?: Date; dateTo?: Date; direction?: string }) {
  const lines = await getLedgerLines({ accountNames: [ACCOUNTS.CASH] });
  const withBalance = withRunningBalance(lines.map(lineToMovement), { usd: 0, cdf: 0 });
  const filtered = withBalance
    .filter((movement) => !input.direction || movement.direction === input.direction)
    .filter((movement) => !input.dateFrom || movement.date >= input.dateFrom)
    .filter((movement) => !input.dateTo || movement.date <= input.dateTo)
    .reverse();
  const offset = (input.page - 1) * input.limit;
  const items = filtered.slice(offset, offset + input.limit).map((movement) => ({
    id: movement.entryId,
    journalId: movement.journalId,
    entryDate: movement.date.toISOString(),
    sourceType: movement.sourceType,
    sourceNumber: movement.sourceNumber,
    sourceId: movement.sourceId,
    direction: movement.direction,
    amount: movement.amount,
    currency: movement.currency,
    exchangeRate: movement.exchangeRate,
    amountUsd: movement.amountUsd,
    amountCdf: movement.amountCdf,
    balanceUsd: movement.balanceUsd,
    balanceCdf: movement.balanceCdf,
    description: movement.description,
    createdBy: movement.createdBy,
    createdAt: movement.date.toISOString(),
  }));
  return { items, total: filtered.length, page: input.page, limit: input.limit };
}
