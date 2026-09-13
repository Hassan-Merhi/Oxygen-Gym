import { db } from "@workspace/db";
import { accountingEntriesTable, cashLedgerTable } from "@workspace/db/schema";
import { desc, eq, sql } from "drizzle-orm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = any;

export interface LedgerEntryInput {
  entryDate?: Date;
  sourceType: string;
  sourceNumber?: string;
  sourceId?: number;
  direction: "in" | "out";
  amount: number;
  currency: string;
  exchangeRate: number;
  description?: string;
  createdBy?: string;
}

export async function appendLedgerEntry(
  input: LedgerEntryInput,
  executor: Executor = db,
): Promise<void> {
  const amountUsd =
    input.currency === "USD" ? input.amount : input.amount / input.exchangeRate;
  const amountCdf =
    input.currency === "CDF" ? input.amount : input.amount * input.exchangeRate;

  const [lastEntry] = await executor
    .select({ balanceUsd: cashLedgerTable.balanceUsd, balanceCdf: cashLedgerTable.balanceCdf })
    .from(cashLedgerTable)
    .orderBy(desc(cashLedgerTable.id))
    .limit(1);

  const prevUsd = lastEntry?.balanceUsd ?? 0;
  const prevCdf = lastEntry?.balanceCdf ?? 0;

  const balanceUsd =
    input.direction === "in" ? prevUsd + amountUsd : prevUsd - amountUsd;
  const balanceCdf =
    input.direction === "in" ? prevCdf + amountCdf : prevCdf - amountCdf;

  await executor.insert(cashLedgerTable).values({
    entryDate:    input.entryDate ?? new Date(),
    sourceType:   input.sourceType,
    sourceNumber: input.sourceNumber,
    sourceId:     input.sourceId,
    direction:    input.direction,
    amount:       input.amount,
    currency:     input.currency,
    exchangeRate: input.exchangeRate,
    amountUsd,
    amountCdf,
    balanceUsd,
    balanceCdf,
    description:  input.description,
    createdBy:    input.createdBy,
  });
}

/**
 * Canonical cash balance.
 *
 * The append-only `cash_ledger` is kept as an operational/audit trail, but it
 * can contain historical corrections and legacy adjustments that do not have a
 * matching accounting posting. Displayed financial balances must come from the
 * canonical double-entry accounting layer instead. For the Cash asset account,
 * the normal balance is debit minus credit.
 */
export async function getCurrentBalance(): Promise<{ balanceUsd: number; balanceCdf: number }> {
  const [row] = await db
    .select({
      balanceUsd: sql<number>`COALESCE(SUM(${accountingEntriesTable.debitUsd} - ${accountingEntriesTable.creditUsd}), 0)`,
      balanceCdf: sql<number>`COALESCE(SUM(${accountingEntriesTable.debitCdf} - ${accountingEntriesTable.creditCdf}), 0)`,
    })
    .from(accountingEntriesTable)
    .where(eq(accountingEntriesTable.accountNameSnapshot, "Cash"));

  return {
    balanceUsd: Number(row?.balanceUsd ?? 0),
    balanceCdf: Number(row?.balanceCdf ?? 0),
  };
}
