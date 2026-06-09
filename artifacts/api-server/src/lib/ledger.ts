import { db } from "@workspace/db";
import { cashLedgerTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

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
  const [last] = await db
    .select({ balanceUsd: cashLedgerTable.balanceUsd, balanceCdf: cashLedgerTable.balanceCdf })
    .from(cashLedgerTable)
    .orderBy(desc(cashLedgerTable.id))
    .limit(1);
  return { balanceUsd: last?.balanceUsd ?? 0, balanceCdf: last?.balanceCdf ?? 0 };
}
