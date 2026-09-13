/**
 * Canonical double-entry accounting helpers.
 *
 * All postings are append-only. Each event writes balanced debit/credit rows,
 * using the transaction's locked FX rate and six-decimal monetary precision.
 */

import { db, type DbExecutor } from "@workspace/db";
import { chartOfAccountsTable, accountingEntriesTable } from "@workspace/db/schema";
import { eq, and, ilike, or } from "drizzle-orm";
import type { AccountingEntry } from "@workspace/db/schema";
import { fxRate, money, subtractMoney } from "../shared/accounting/decimal";
import { toUsdCdf } from "../shared/accounting/currency";

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
} as const;

export function normalizeName(raw: string): string {
  return (raw || "cash")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
};

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
    .where(ilike(chartOfAccountsTable.name, name))
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
  try {
    const created = await executor
      .insert(chartOfAccountsTable)
      .values({ name, type, isActive: true })
      .onConflictDoNothing()
      .returning({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name, type: chartOfAccountsTable.type });
    if (created.length > 0) {
      const row = created[0]!;
      return { id: row.id, name: row.name, type: row.type as AccountType };
    }
  } catch {
    // Concurrent insert race; refetch below.
  }

  const refetched = await executor
    .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name, type: chartOfAccountsTable.type })
    .from(chartOfAccountsTable)
    .where(ilike(chartOfAccountsTable.name, name))
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
    entryDate: input.entryDate ?? new Date(),
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
): Promise<void> {
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
  if (existing.length === 0) return;

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

  const reversals = [...grouped.values()].flatMap((group) => {
    const netUsd = subtractMoney(group.debitUsd, group.creditUsd);
    const netCdf = subtractMoney(group.debitCdf, group.creditCdf);
    if (netUsd === 0 && netCdf === 0) return [];

    const latest = group.latest;
    const netIsDebit = netUsd !== 0 ? netUsd > 0 : netCdf > 0;
    const amountUsd = money(Math.abs(netUsd));
    const amountCdf = money(Math.abs(netCdf));
    const currency = (latest.currency ?? "USD").toUpperCase();
    const amount = currency === "CDF" ? amountCdf : amountUsd;

    return [{
      entryDate: new Date(),
      sourceType: reversalSourceType,
      sourceId: originalSourceId,
      sourceNumber: latest.sourceNumber,
      accountId: latest.accountId,
      accountNameSnapshot: latest.accountNameSnapshot,
      debitUsd: netIsDebit ? 0 : amountUsd,
      creditUsd: netIsDebit ? amountUsd : 0,
      debitCdf: netIsDebit ? 0 : amountCdf,
      creditCdf: netIsDebit ? amountCdf : 0,
      currency,
      amount,
      exchangeRate: fxRate(Number(latest.exchangeRate ?? 1)),
      description: `Reversal: current effective ${originalSourceType} ${latest.sourceNumber ?? originalSourceId}`,
      createdBy,
    }];
  });

  if (reversals.length > 0) await executor.insert(accountingEntriesTable).values(reversals);
}
