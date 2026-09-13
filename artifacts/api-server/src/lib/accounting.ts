/**
 * Double-entry accounting helpers.
 *
 * Every financial event posts two rows to `accounting_entries`:
 *   - a DEBIT row  (debitUsd > 0,  creditUsd = 0)
 *   - a CREDIT row (debitUsd = 0,  creditUsd > 0)
 *
 * Cash-in events:  Debit Cash account  / Credit Revenue account
 * Cash-out events: Debit Expense acct  / Credit Cash account
 */

import { db, type DbExecutor } from "@workspace/db";
import { chartOfAccountsTable, accountingEntriesTable } from "@workspace/db/schema";
import { eq, and, ilike, or } from "drizzle-orm";
import type { AccountingEntry } from "@workspace/db/schema";

export function normalizeName(raw: string): string {
  return (raw || "cash")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const DEFAULT_TYPES: Record<string, "asset" | "liability" | "income" | "expense" | "equity"> = {
  "Cash":               "asset",
  "Bank":               "asset",
  "Mobile Money":       "asset",
  "Petty Cash":         "asset",
  "Inventory":          "asset",
  "Accounts Payable":   "liability",
  "Membership Revenue": "income",
  "Sales Revenue":      "income",
  "Other Income":       "income",
  "General Expense":    "expense",
  "Payroll Expense":    "expense",
  "Other Expense":      "expense",
};

export async function resolveAccountId(
  rawName: string,
  fallbackType: "asset" | "liability" | "income" | "expense" | "equity" = "asset",
  executor: DbExecutor = db,
): Promise<{ id: number; name: string } | null> {
  const name = normalizeName(rawName);

  const rows = await executor
    .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name })
    .from(chartOfAccountsTable)
    .where(ilike(chartOfAccountsTable.name, name))
    .limit(1);
  if (rows.length > 0) return rows[0] as { id: number; name: string };

  const type = DEFAULT_TYPES[name] ?? fallbackType;
  // onConflictDoNothing handles the expected concurrent-create race. Any other
  // database error is a real accounting failure and must abort the caller's
  // transaction rather than being swallowed as non-fatal.
  const created = await executor
    .insert(chartOfAccountsTable)
    .values({ name, type })
    .onConflictDoNothing()
    .returning({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name });
  if (created.length > 0) return created[0] as { id: number; name: string };

  const refetched = await executor
    .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name })
    .from(chartOfAccountsTable)
    .where(ilike(chartOfAccountsTable.name, name))
    .limit(1);
  return (refetched[0] as { id: number; name: string }) ?? null;
}

const REVENUE_ACCOUNTS: Record<string, string> = {
  membership:    "Membership Revenue",
  product_sale:  "Sales Revenue",
  other:         "Other Income",
};
const EXPENSE_ACCOUNTS: Record<string, string> = {
  expense:        "General Expense",
  payroll:        "Payroll Expense",
  stock_purchase: "Inventory",
  other:          "Other Expense",
};

export function categoryAccountNames(
  category: string,
  direction: "in" | "out",
  cashAccount: string,
  subCategory?: string | null,
): {
  debitName: string;
  debitType: "asset" | "income" | "expense";
  creditName: string;
  creditType: "asset" | "income" | "expense";
} {
  const cashName = normalizeName(cashAccount || "cash");
  if (direction === "in") {
    const revName = subCategory
      ? normalizeName(subCategory)
      : (REVENUE_ACCOUNTS[category] ?? "Other Income");
    return { debitName: cashName, debitType: "asset", creditName: revName, creditType: "income" };
  }

  const expName = subCategory
    ? normalizeName(subCategory)
    : (EXPENSE_ACCOUNTS[category] ?? "Other Expense");
  return { debitName: expName, debitType: "expense", creditName: cashName, creditType: "asset" };
}

export interface PostEntryInput {
  entryDate?: Date;
  sourceType: string;
  sourceId?: number;
  sourceNumber?: string;
  debitName: string;
  debitType?: "asset" | "liability" | "income" | "expense" | "equity";
  creditName: string;
  creditType?: "asset" | "liability" | "income" | "expense" | "equity";
  amount: number;
  amountUsd: number;
  amountCdf: number;
  currency: string;
  exchangeRate: number;
  description?: string;
  createdBy?: string;
}

export async function postDoubleEntry(
  input: PostEntryInput,
  executor: DbExecutor = db,
): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error("Accounting amount must be a non-negative finite number");
  }
  if (!Number.isFinite(input.amountUsd) || input.amountUsd < 0 || !Number.isFinite(input.amountCdf) || input.amountCdf < 0) {
    throw new Error("Accounting converted amounts must be non-negative finite numbers");
  }
  if (!Number.isFinite(input.exchangeRate) || input.exchangeRate <= 0) {
    throw new Error("Accounting exchange rate must be greater than zero");
  }

  const [debit, credit] = await Promise.all([
    resolveAccountId(input.debitName, input.debitType ?? "asset", executor),
    resolveAccountId(input.creditName, input.creditType ?? "asset", executor),
  ]);

  const base = {
    entryDate:    input.entryDate ?? new Date(),
    sourceType:   input.sourceType,
    sourceId:     input.sourceId,
    sourceNumber: input.sourceNumber,
    currency:     input.currency,
    amount:       input.amount,
    exchangeRate: input.exchangeRate,
    description:  input.description,
    createdBy:    input.createdBy,
  };

  await executor.insert(accountingEntriesTable).values([
    {
      ...base,
      accountId:           debit?.id ?? null,
      accountNameSnapshot: debit?.name ?? normalizeName(input.debitName),
      debitUsd:  input.amountUsd,
      creditUsd: 0,
      debitCdf:  input.amountCdf,
      creditCdf: 0,
    },
    {
      ...base,
      accountId:           credit?.id ?? null,
      accountNameSnapshot: credit?.name ?? normalizeName(input.creditName),
      debitUsd:  0,
      creditUsd: input.amountUsd,
      debitCdf:  0,
      creditCdf: input.amountCdf,
    },
  ]);
}

/**
 * Reverse the CURRENT effective entries for a source.
 *
 * Voucher/payment edits are append-only: original rows stay in the ledger and
 * correction/reversal rows are added. Reversing only the original rows on every
 * edit causes repeated edits to drift the ledger. Instead, calculate the current
 * net position per account across the whole source family, then post only the
 * opposite of that effective position.
 */
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
  ];

  const existing: AccountingEntry[] = await executor
    .select()
    .from(accountingEntriesTable)
    .where(
      and(
        eq(accountingEntriesTable.sourceId, originalSourceId),
        or(...sourceFamily.map((type) => eq(accountingEntriesTable.sourceType, type))),
      ),
    );

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

    current.debitUsd += Number(entry.debitUsd ?? 0);
    current.creditUsd += Number(entry.creditUsd ?? 0);
    current.debitCdf += Number(entry.debitCdf ?? 0);
    current.creditCdf += Number(entry.creditCdf ?? 0);
    if ((entry.id ?? 0) >= (current.latest.id ?? 0)) current.latest = entry;
    grouped.set(key, current);
  }

  const EPSILON = 0.000001;
  const reversals = [...grouped.values()].flatMap((group) => {
    const netUsd = group.debitUsd - group.creditUsd;
    const netCdf = group.debitCdf - group.creditCdf;
    if (Math.abs(netUsd) < EPSILON && Math.abs(netCdf) < EPSILON) return [];

    const latest = group.latest;
    const netIsDebit = Math.abs(netUsd) >= EPSILON ? netUsd > 0 : netCdf > 0;
    const amountUsd = Math.abs(netUsd);
    const amountCdf = Math.abs(netCdf);
    const currency = latest.currency ?? "USD";
    const amount = currency === "CDF" ? amountCdf : amountUsd;

    return [{
      entryDate:           new Date(),
      sourceType:          reversalSourceType,
      sourceId:            originalSourceId,
      sourceNumber:        latest.sourceNumber,
      accountId:           latest.accountId,
      accountNameSnapshot: latest.accountNameSnapshot,
      debitUsd:            netIsDebit ? 0 : amountUsd,
      creditUsd:           netIsDebit ? amountUsd : 0,
      debitCdf:            netIsDebit ? 0 : amountCdf,
      creditCdf:           netIsDebit ? amountCdf : 0,
      currency,
      amount,
      exchangeRate:        latest.exchangeRate,
      description:         `Reversal: current effective ${originalSourceType} ${latest.sourceNumber ?? originalSourceId}`,
      createdBy,
    }];
  });

  if (reversals.length > 0) {
    await executor.insert(accountingEntriesTable).values(reversals);
  }
}
