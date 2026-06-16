import { db } from "@workspace/db";
import { cashLedgerTable } from "@workspace/db/schema";
import { desc, sql } from "drizzle-orm";

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

export async function appendLedgerEntry(input: LedgerEntryInput): Promise<void> {
  const amountUsd =
    input.currency === "USD"
      ? input.amount
      : input.amount / input.exchangeRate;
  const amountCdf =
    input.currency === "CDF"
      ? input.amount
      : input.amount * input.exchangeRate;

  const [lastEntry] = await db
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

  await db.insert(cashLedgerTable).values({
    entryDate: input.entryDate ?? new Date(),
    sourceType: input.sourceType,
    sourceNumber: input.sourceNumber,
    sourceId: input.sourceId,
    direction: input.direction,
    amount: input.amount,
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    amountUsd,
    amountCdf,
    balanceUsd,
    balanceCdf,
    description: input.description,
    createdBy: input.createdBy,
  });
}

export async function getCurrentBalance(): Promise<{ balanceUsd: number; balanceCdf: number }> {
  const [row] = await db
    .select({
      balanceUsd: sql<number>`COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_usd ELSE -amount_usd END), 0)`,
      balanceCdf: sql<number>`COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_cdf ELSE -amount_cdf END), 0)`,
    })
    .from(cashLedgerTable);
  return { balanceUsd: Number(row?.balanceUsd ?? 0), balanceCdf: Number(row?.balanceCdf ?? 0) };
}
