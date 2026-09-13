import { db } from "@workspace/db";
import { cashLedgerTable } from "@workspace/db/schema";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { appendLedgerEntry, getCurrentBalance } from "../../lib/ledger";
import { postDoubleEntry } from "../../lib/accounting";
import { getExchangeRate } from "../../shared/accounting/currency";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest } from "../../shared/http/errors";

export async function getLedgerBalance() {
  return getCurrentBalance();
}

export async function setOpeningBalance(input: { targetAmountUsd: number; date?: Date; notes?: string }, actor: string) {
  if (!Number.isFinite(input.targetAmountUsd) || input.targetAmountUsd < 0) throw badRequest("targetAmountUsd must be a non-negative number");
  const currentBalance = await getCurrentBalance();
  const exchangeRate = await getExchangeRate();
  const delta = input.targetAmountUsd - currentBalance.balanceUsd;
  if (Math.abs(delta) < 0.001) return { ok: true, skipped: true, balance: currentBalance };

  const entryDate = input.date ?? new Date();
  const amount = Math.abs(delta);
  const description = input.notes ?? "Opening balance adjustment";
  const sourceNumber = `OPENING-${Date.now()}`;

  await withTransaction(async (tx) => {
    await appendLedgerEntry({
      entryDate,
      sourceType: "opening_balance",
      sourceNumber,
      direction: delta > 0 ? "in" : "out",
      amount,
      currency: "USD",
      exchangeRate,
      description,
      createdBy: actor,
    }, tx);
    await postDoubleEntry({
      entryDate,
      sourceType: "opening_balance",
      sourceNumber,
      debitName: delta > 0 ? "Cash" : "Opening Balance Equity",
      debitType: delta > 0 ? "asset" : "equity",
      creditName: delta > 0 ? "Opening Balance Equity" : "Cash",
      creditType: delta > 0 ? "equity" : "asset",
      amount,
      amountUsd: amount,
      amountCdf: amount * exchangeRate,
      currency: "USD",
      exchangeRate,
      description,
      createdBy: actor,
    }, tx);
  });

  return { ok: true, skipped: false, balance: await getCurrentBalance() };
}

export async function listLedger(input: {
  page: number;
  limit: number;
  dateFrom?: Date;
  dateTo?: Date;
  direction?: string;
}) {
  const conditions: ReturnType<typeof eq>[] = [];
  if (input.direction) conditions.push(eq(cashLedgerTable.direction, input.direction));
  if (input.dateFrom) conditions.push(gte(cashLedgerTable.entryDate, input.dateFrom));
  if (input.dateTo) conditions.push(lte(cashLedgerTable.entryDate, input.dateTo));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (input.page - 1) * input.limit;
  const [items, [totalRow]] = await Promise.all([
    db.select().from(cashLedgerTable).where(where).orderBy(desc(cashLedgerTable.id)).limit(input.limit).offset(offset),
    db.select({ total: count() }).from(cashLedgerTable).where(where),
  ]);
  return { items, total: Number(totalRow.total), page: input.page, limit: input.limit };
}
