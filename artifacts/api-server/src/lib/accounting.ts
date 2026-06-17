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

import { db } from "@workspace/db";
import { chartOfAccountsTable, accountingEntriesTable } from "@workspace/db/schema";
import { eq, and, ilike } from "drizzle-orm";
import type { AccountingEntry } from "@workspace/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = any;

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
  executor: Executor = db,
): Promise<{ id: number; name: string } | null> {
  const name = normalizeName(rawName);

  const rows = await executor
    .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name })
    .from(chartOfAccountsTable)
    .where(ilike(chartOfAccountsTable.name, name))
    .limit(1);
  if (rows.length > 0) return rows[0] as { id: number; name: string };

  const type = DEFAULT_TYPES[name] ?? fallbackType;
  try {
    const created = await executor
      .insert(chartOfAccountsTable)
      .values({ name, type })
      .onConflictDoNothing()
      .returning({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name });
    if (created.length > 0) return created[0] as { id: number; name: string };
  } catch { /* concurrent insert race — fall through */ }

  const refetched = await executor
    .select({ id: chartOfAccountsTable.id, name: chartOfAccountsTable.name })
    .from(chartOfAccountsTable)
    .where(ilike(chartOfAccountsTable.name, name))
    .limit(1);
  return (refetched[0] as { id: number; name: string }) ?? null;
}

// ── Account name lookup by category ─────────────────────────────────────────

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
  } else {
    const expName = subCategory
      ? normalizeName(subCategory)
      : (EXPENSE_ACCOUNTS[category] ?? "Other Expense");
    return { debitName: expName, debitType: "expense", creditName: cashName, creditType: "asset" };
  }
}

// ── Post a balanced double-entry pair ────────────────────────────────────────

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

export async function postDoubleEntry(input: PostEntryInput, executor: Executor = db): Promise<void> {
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

// ── Reverse all accounting entries for a given source ────────────────────────

export async function reverseEntries(
  originalSourceType: string,
  originalSourceId: number,
  reversalSourceType: string,
  createdBy: string,
  executor: Executor = db,
): Promise<void> {
  const existing: AccountingEntry[] = await executor
    .select()
    .from(accountingEntriesTable)
    .where(
      and(
        eq(accountingEntriesTable.sourceType, originalSourceType),
        eq(accountingEntriesTable.sourceId, originalSourceId),
      ),
    );

  if (existing.length === 0) return;

  await executor.insert(accountingEntriesTable).values(
    existing.map((e) => ({
      entryDate:           new Date(),
      sourceType:          reversalSourceType,
      sourceId:            originalSourceId,
      sourceNumber:        e.sourceNumber,
      accountId:           e.accountId,
      accountNameSnapshot: e.accountNameSnapshot,
      debitUsd:   e.creditUsd,
      creditUsd:  e.debitUsd,
      debitCdf:   e.creditCdf,
      creditCdf:  e.debitCdf,
      currency:    e.currency,
      amount:      e.amount,
      exchangeRate: e.exchangeRate,
      description: `Reversal: ${e.description ?? ""}`.trim(),
      createdBy,
    })),
  );
}

// ── Seed default chart of accounts (idempotent) ──────────────────────────────

export async function seedDefaultAccounts(): Promise<void> {
  const defaults: Array<{ name: string; type: "asset" | "liability" | "income" | "expense" | "equity" }> = [
    { name: "Cash",               type: "asset" },
    { name: "Bank",               type: "asset" },
    { name: "Mobile Money",       type: "asset" },
    { name: "Inventory",          type: "asset" },
    { name: "Membership Revenue", type: "income" },
    { name: "Sales Revenue",      type: "income" },
    { name: "Other Income",       type: "income" },
    { name: "General Expense",    type: "expense" },
    { name: "Payroll Expense",    type: "expense" },
    { name: "Other Expense",      type: "expense" },
  ];
  for (const acc of defaults) {
    await db.insert(chartOfAccountsTable).values(acc).onConflictDoNothing();
  }
}
