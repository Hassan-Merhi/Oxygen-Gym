/**
 * Canonical double-entry accounting helpers.
 *
 * All postings are append-only. Each event writes balanced debit/credit rows,
 * using the transaction's locked FX rate and six-decimal monetary precision.
 */

import { randomUUID } from "node:crypto";
import { db, type DbExecutor } from "@workspace/db";
import { chartOfAccountsTable, accountingEntriesTable, accountingPeriodsTable } from "@workspace/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import type { AccountingEntry } from "@workspace/db/schema";
import { addMoney, fxRate, money, subtractMoney } from "../shared/accounting/decimal";
import { toUsdCdf } from "../shared/accounting/currency";
import { badRequest } from "../shared/http/errors";

export type AccountType = "asset" | "liability" | "income" | "expense" | "equity";

export const ACCOUNTS = {
  CASH: "Cash",
  BANK: "Bank",
  MOBILE_MONEY: "Mobile Money",
  PETTY_CASH: "Petty Cash",
  INVENTORY: "Inventory",
  SUPPLIER_PAYABLES: "Supplier Payables",
  MEMBERSHIP_REVENUE: "Membership Revenue",
  SALES_REVENUE: "Sales Revenue",
  OTHER_INCOME: "Other Income",
  COGS: "Cost of Goods Sold",
  PAYROLL_EXPENSE: "Payroll Expense",
  GENERAL_EXPENSE: "General Expense",
  OTHER_EXPENSE: "Other Expense",
  RETAINED_EARNINGS: "Retained Earnings",
  OPENING_BALANCE_EQUITY: "Opening Balance Equity",
  FX_GAIN_LOSS: "FX Gain/Loss",
  CASH_OVER_SHORT: "Cash Over/Short",
  INVENTORY_ADJUSTMENTS: "Inventory Adjustments",
} as const;

/** Accounts that hold money (drawer, bank, mobile wallets). */
export const MONEY_ACCOUNTS: readonly string[] = [ACCOUNTS.CASH, ACCOUNTS.BANK, ACCOUNTS.MOBILE_MONEY, ACCOUNTS.PETTY_CASH];

const NAME_ALIASES: Record<string, string> = {
  "physical cash": ACCOUNTS.CASH,
  "cash account": ACCOUNTS.CASH,
};

export function normalizeName(raw: string): string {
  const name = (raw || "cash")
    .replace(/_/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return NAME_ALIASES[name.toLowerCase()] ?? name;
}

/** Latest instant the books are locked through, or null when no period is closed. */
export async function getBooksLockedThrough(executor: DbExecutor = db): Promise<Date | null> {
  const [row] = await executor
    .select({ closedThrough: sql<Date | string | null>`MAX(${accountingPeriodsTable.closedThrough})` })
    .from(accountingPeriodsTable);
  const value = row?.closedThrough;
  return value ? new Date(value) : null;
}

/** Reject any change dated inside a closed period with a clear message. */
export async function assertPeriodOpen(executor: DbExecutor, date: Date | undefined | null, what = "This entry"): Promise<void> {
  if (!date) return;
  const lockedThrough = await getBooksLockedThrough(executor);
  if (lockedThrough && date.getTime() <= lockedThrough.getTime()) {
    throw badRequest(`${what} is dated in a closed period (books are closed through ${lockedThrough.toISOString()}). Record a new entry after the close instead.`, {
      code: "PERIOD_CLOSED",
      lockedThrough: lockedThrough.toISOString(),
    });
  }
}

export function newJournalId(): string {
  return randomUUID();
}

const DEFAULT_TYPES: Record<string, AccountType> = {
  [ACCOUNTS.CASH]: "asset",
  [ACCOUNTS.BANK]: "asset",
  [ACCOUNTS.MOBILE_MONEY]: "asset",
  [ACCOUNTS.PETTY_CASH]: "asset",
  [ACCOUNTS.INVENTORY]: "asset",
  [ACCOUNTS.SUPPLIER_PAYABLES]: "liability",
  [ACCOUNTS.MEMBERSHIP_REVENUE]: "income",
  [ACCOUNTS.SALES_REVENUE]: "income",
  [ACCOUNTS.OTHER_INCOME]: "income",
  [ACCOUNTS.COGS]: "expense",
  [ACCOUNTS.PAYROLL_EXPENSE]: "expense",
  [ACCOUNTS.GENERAL_EXPENSE]: "expense",
  [ACCOUNTS.OTHER_EXPENSE]: "expense",
  [ACCOUNTS.RETAINED_EARNINGS]: "equity",
  [ACCOUNTS.OPENING_BALANCE_EQUITY]: "equity",
  [ACCOUNTS.FX_GAIN_LOSS]: "income",
  [ACCOUNTS.CASH_OVER_SHORT]: "expense",
  [ACCOUNTS.INVENTORY_ADJUSTMENTS]: "expense",
};

export function canonicalTypeFor(name: string): AccountType | undefined {
  return DEFAULT_TYPES[normalizeName(name)];
}

export async function resolveAccountId(
  rawName: string,
  fallbackType: AccountType = "asset",
  executor: DbExecutor = db,
): Promise<{ id: number; name: string; type: AccountType } | null> {
  const name = normalizeName(rawName);
  const canonicalType = DEFAULT_TYPES[name];

  const rows = await executor
    .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name, type: chartOfAccountsTable.type })
    .from(chartOfAccountsTable)
    .where(sql`lower(${chartOfAccountsTable.name}) = lower(${name})`)
    .orderBy(chartOfAccountsTable.id)
    .limit(1);

  if (rows.length > 0) {
    const row = rows[0]!;
    const type = canonicalType ?? (row.type as AccountType) ?? fallbackType;
    if (canonicalType && row.type !== canonicalType) {
      await executor.update(chartOfAccountsTable)
        .set({ type: canonicalType, isActive: true })
        .where(eq(chartOfAccountsTable.id, row.id));
    }
    return { id: row.id, name: row.name, type };
  }

  const type = canonicalType ?? fallbackType;
  const created = await executor
    .insert(chartOfAccountsTable)
    .values({ name, type, isActive: true })
    .onConflictDoNothing()
    .returning({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name, type: chartOfAccountsTable.type });
  if (created.length > 0) {
    const row = created[0]!;
    return { id: row.id, name: row.name, type: row.type as AccountType };
  }

  const refetched = await executor
    .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name, type: chartOfAccountsTable.type })
    .from(chartOfAccountsTable)
    .where(sql`lower(${chartOfAccountsTable.name}) = lower(${name})`)
    .orderBy(chartOfAccountsTable.id)
    .limit(1);
  const row = refetched[0];
  return row ? { id: row.id, name: row.name, type: row.type as AccountType } : null;
}

const REVENUE_ACCOUNTS: Record<string, string> = {
  membership: ACCOUNTS.MEMBERSHIP_REVENUE,
  product_sale: ACCOUNTS.SALES_REVENUE,
  other: ACCOUNTS.OTHER_INCOME,
};

const OUTGOING_ACCOUNTS: Record<string, { name: string; type: AccountType }> = {
  expense: { name: ACCOUNTS.GENERAL_EXPENSE, type: "expense" },
  payroll: { name: ACCOUNTS.PAYROLL_EXPENSE, type: "expense" },
  stock_purchase: { name: ACCOUNTS.INVENTORY, type: "asset" },
  supplier_payment: { name: ACCOUNTS.SUPPLIER_PAYABLES, type: "liability" },
  other: { name: ACCOUNTS.OTHER_EXPENSE, type: "expense" },
};

export function categoryAccountNames(
  category: string,
  direction: "in" | "out",
  cashAccount: string,
  subCategory?: string | null,
): {
  debitName: string;
  debitType: AccountType;
  creditName: string;
  creditType: AccountType;
} {
  const cashName = normalizeName(cashAccount || "cash");
  if (direction === "in") {
    const revName = subCategory
      ? normalizeName(subCategory)
      : (REVENUE_ACCOUNTS[category] ?? ACCOUNTS.OTHER_INCOME);
    return { debitName: cashName, debitType: "asset", creditName: revName, creditType: "income" };
  }

  const mapped = OUTGOING_ACCOUNTS[category] ?? OUTGOING_ACCOUNTS.other!;
  const debitName = subCategory ? normalizeName(subCategory) : mapped.name;
  const debitType = subCategory ? "expense" : mapped.type;
  return { debitName, debitType, creditName: cashName, creditType: "asset" };
}

export interface PostEntryInput {
  /** Group several postings into one journal (e.g. sale revenue + COGS). */
  journalId?: string;
  entryDate?: Date;
  sourceType: string;
  sourceId?: number;
  sourceNumber?: string;
  debitName: string;
  debitType?: AccountType;
  creditName: string;
  creditType?: AccountType;
  amount: number;
  amountUsd?: number;
  amountCdf?: number;
  currency: string;
  exchangeRate: number;
  description?: string;
  createdBy?: string;
}

export async function postDoubleEntry(
  input: PostEntryInput,
  executor: DbExecutor = db,
): Promise<void> {
  const amount = money(input.amount);
  if (amount < 0) throw new Error("Accounting amount cannot be negative");
  if (amount === 0) return;
  const entryDate = input.entryDate ?? new Date();
  await assertPeriodOpen(executor, entryDate);

  const rate = fxRate(input.exchangeRate);
  const converted = toUsdCdf(amount, input.currency, rate);
  if (input.amountUsd !== undefined && money(input.amountUsd) !== converted.amountUsd) {
    throw new Error("USD accounting amount does not match transaction amount and locked FX rate");
  }
  if (input.amountCdf !== undefined && money(input.amountCdf) !== converted.amountCdf) {
    throw new Error("CDF accounting amount does not match transaction amount and locked FX rate");
  }

  const [debit, credit] = await Promise.all([
    resolveAccountId(input.debitName, input.debitType ?? "asset", executor),
    resolveAccountId(input.creditName, input.creditType ?? "asset", executor),
  ]);
  if (!debit || !credit) throw new Error("Unable to resolve both accounting accounts");

  const base = {
    journalId: input.journalId ?? newJournalId(),
    entryDate,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceNumber: input.sourceNumber,
    currency: input.currency.toUpperCase(),
    amount,
    exchangeRate: rate,
    description: input.description,
    createdBy: input.createdBy,
  };

  await executor.insert(accountingEntriesTable).values([
    {
      ...base,
      accountId: debit.id,
      accountNameSnapshot: debit.name,
      debitUsd: converted.amountUsd,
      creditUsd: 0,
      debitCdf: converted.amountCdf,
      creditCdf: 0,
    },
    {
      ...base,
      accountId: credit.id,
      accountNameSnapshot: credit.name,
      debitUsd: 0,
      creditUsd: converted.amountUsd,
      debitCdf: 0,
      creditCdf: converted.amountCdf,
    },
  ]);
}

/** Reverse the current effective accounting position for a source family. */
export async function reverseEntries(
  originalSourceType: string,
  originalSourceId: number,
  reversalSourceType: string,
  createdBy: string,
  executor: DbExecutor = db,
  options: { journalId?: string; entryDate?: Date; description?: string } = {},
): Promise<number> {
  const sourceFamily = [
    originalSourceType,
    `${originalSourceType}_correction`,
    `${originalSourceType}_reversal`,
    `${originalSourceType}_void`,
    `void_${originalSourceType}`,
  ];

  const existing: AccountingEntry[] = await executor
    .select()
    .from(accountingEntriesTable)
    .where(and(
      eq(accountingEntriesTable.sourceId, originalSourceId),
      or(...sourceFamily.map((type) => eq(accountingEntriesTable.sourceType, type))),
    ));
  if (existing.length === 0) return 0;

  type EffectiveAccount = {
    latest: AccountingEntry;
    debitUsd: number;
    creditUsd: number;
    debitCdf: number;
    creditCdf: number;
  };
  const grouped = new Map<string, EffectiveAccount>();

  for (const entry of existing) {
    const key = `${entry.accountId ?? "none"}:${entry.accountNameSnapshot ?? ""}`;
    const current = grouped.get(key) ?? {
      latest: entry,
      debitUsd: 0,
      creditUsd: 0,
      debitCdf: 0,
      creditCdf: 0,
    };
    current.debitUsd = money(current.debitUsd + Number(entry.debitUsd ?? 0));
    current.creditUsd = money(current.creditUsd + Number(entry.creditUsd ?? 0));
    current.debitCdf = money(current.debitCdf + Number(entry.debitCdf ?? 0));
    current.creditCdf = money(current.creditCdf + Number(entry.creditCdf ?? 0));
    if ((entry.id ?? 0) >= (current.latest.id ?? 0)) current.latest = entry;
    grouped.set(key, current);
  }

  const journalId = options.journalId ?? newJournalId();
  const entryDate = options.entryDate ?? new Date();
  await assertPeriodOpen(executor, entryDate, "The reversal");
  const reversals = [...grouped.values()].flatMap((group) => {
    const netUsd = subtractMoney(group.debitUsd, group.creditUsd);
    const netCdf = subtractMoney(group.debitCdf, group.creditCdf);
    if (netUsd === 0 && netCdf === 0) return [];

    const latest = group.latest;
    // Each currency column is reversed on its own side, so a group whose USD and
    // CDF nets point in different directions (after a revaluation) still balances.
    const amountUsd = money(Math.abs(netUsd));
    const amountCdf = money(Math.abs(netCdf));
    const currency = (latest.currency ?? "USD").toUpperCase();
    // Native amount follows the original native movement so cash per currency reverses exactly.
    const nativeNet = existing
      .filter((entry) => `${entry.accountId ?? "none"}:${entry.accountNameSnapshot ?? ""}` === `${latest.accountId ?? "none"}:${latest.accountNameSnapshot ?? ""}`
        && (entry.currency ?? "USD").toUpperCase() === currency)
      .reduce((sum, entry) => {
        const isDebit = Number(entry.debitUsd ?? 0) > 0 || Number(entry.debitCdf ?? 0) > 0;
        return addMoney(sum, isDebit ? Number(entry.amount ?? 0) : -Number(entry.amount ?? 0));
      }, 0);
    const amount = money(Math.abs(nativeNet));

    return [{
      journalId,
      entryDate,
      sourceType: reversalSourceType,
      sourceId: originalSourceId,
      sourceNumber: latest.sourceNumber,
      accountId: latest.accountId,
      accountNameSnapshot: latest.accountNameSnapshot,
      debitUsd: netUsd < 0 ? amountUsd : 0,
      creditUsd: netUsd > 0 ? amountUsd : 0,
      debitCdf: netCdf < 0 ? amountCdf : 0,
      creditCdf: netCdf > 0 ? amountCdf : 0,
      currency,
      amount,
      exchangeRate: fxRate(Number(latest.exchangeRate ?? 1)),
      description: options.description ?? `Reversal: current effective ${originalSourceType} ${latest.sourceNumber ?? originalSourceId}`,
      createdBy,
    }];
  });

  if (reversals.length > 0) await executor.insert(accountingEntriesTable).values(reversals);
  return reversals.length;
}

export interface JournalLine {
  account: string;
  type?: AccountType;
  debitUsd?: number;
  creditUsd?: number;
  debitCdf?: number;
  creditCdf?: number;
  /** Native amount and currency of this line (zero for pure revaluation lines). */
  amount?: number;
  currency?: "USD" | "CDF";
}

/**
 * Post an arbitrary balanced journal (closing entries, revaluations, cash
 * counts). Each line states its USD and CDF values explicitly; the journal must
 * balance in both columns or nothing is written.
 */
export async function postJournal(input: {
  journalId?: string;
  entryDate: Date;
  sourceType: string;
  sourceId?: number;
  sourceNumber?: string;
  exchangeRate: number;
  description: string;
  createdBy?: string;
  lines: JournalLine[];
  skipPeriodCheck?: boolean;
}, executor: DbExecutor = db): Promise<string | null> {
  const lines = input.lines
    .map((line) => ({
      ...line,
      debitUsd: money(line.debitUsd ?? 0),
      creditUsd: money(line.creditUsd ?? 0),
      debitCdf: money(line.debitCdf ?? 0),
      creditCdf: money(line.creditCdf ?? 0),
    }))
    .filter((line) => line.debitUsd !== 0 || line.creditUsd !== 0 || line.debitCdf !== 0 || line.creditCdf !== 0);
  if (lines.length === 0) return null;
  for (const line of lines) {
    if (line.debitUsd < 0 || line.creditUsd < 0 || line.debitCdf < 0 || line.creditCdf < 0) {
      throw new Error("Journal line values must be non-negative");
    }
  }
  const debitUsd = addMoney(...lines.map((line) => line.debitUsd));
  const creditUsd = addMoney(...lines.map((line) => line.creditUsd));
  const debitCdf = addMoney(...lines.map((line) => line.debitCdf));
  const creditCdf = addMoney(...lines.map((line) => line.creditCdf));
  if (Math.abs(debitUsd - creditUsd) > 0.000001 || Math.abs(debitCdf - creditCdf) > 0.000001) {
    throw new Error(`Journal does not balance (USD ${debitUsd} vs ${creditUsd}, CDF ${debitCdf} vs ${creditCdf})`);
  }
  if (!input.skipPeriodCheck) await assertPeriodOpen(executor, input.entryDate);

  const journalId = input.journalId ?? newJournalId();
  const rate = fxRate(input.exchangeRate);
  const rows = [];
  for (const line of lines) {
    const account = await resolveAccountId(line.account, line.type ?? "asset", executor);
    if (!account) throw new Error(`Unable to resolve account ${line.account}`);
    rows.push({
      journalId,
      entryDate: input.entryDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber,
      accountId: account.id,
      accountNameSnapshot: account.name,
      debitUsd: line.debitUsd,
      creditUsd: line.creditUsd,
      debitCdf: line.debitCdf,
      creditCdf: line.creditCdf,
      currency: line.currency ?? "USD",
      amount: money(line.amount ?? 0),
      exchangeRate: rate,
      description: input.description,
      createdBy: input.createdBy,
    });
  }
  await executor.insert(accountingEntriesTable).values(rows);
  return journalId;
}
