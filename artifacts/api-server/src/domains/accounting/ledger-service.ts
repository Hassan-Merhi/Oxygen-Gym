import { db } from "@workspace/db";
import { cashLedgerTable } from "@workspace/db/schema";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { appendLedgerEntry, getCashMovements } from "../../lib/ledger";
import { postDoubleEntry } from "../../lib/accounting";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { addMoney, subtractMoney } from "../../shared/accounting/decimal";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest } from "../../shared/http/errors";

function balanceAtRate(
  movements: Awaited<ReturnType<typeof getCashMovements>>,
  exchangeRate: number,
) {
  return movements.reduce(
    (balance, movement) => {
      const converted = toUsdCdf(movement.amount, movement.currency, exchangeRate);
      return {
        balanceUsd: movement.direction === "in"
          ? addMoney(balance.balanceUsd, converted.amountUsd)
          : subtractMoney(balance.balanceUsd, converted.amountUsd),
        balanceCdf: movement.direction === "in"
          ? addMoney(balance.balanceCdf, converted.amountCdf)
          : subtractMoney(balance.balanceCdf, converted.amountCdf),
      };
    },
    { balanceUsd: 0, balanceCdf: 0 },
  );
}

export async function getLedgerBalance() {
  const [movements, exchangeRate] = await Promise.all([
    getCashMovements(),
    getExchangeRate(),
  ]);
  return balanceAtRate(movements, exchangeRate);
}

export async function setOpeningBalance(input: { targetAmountUsd: number; date?: Date; notes?: string }, actor: string) {
  if (!Number.isFinite(input.targetAmountUsd) || input.targetAmountUsd < 0) throw badRequest("targetAmountUsd must be a non-negative number");
  const exchangeRate = await getExchangeRate();

  const result = await withTransaction(async (tx) => {
    // Calculate the delta only after the financial transaction lock is held and
    // value every movement with the same live rate from Settings.
    const currentBalance = balanceAtRate(await getCashMovements(tx), exchangeRate);
    const delta = input.targetAmountUsd - currentBalance.balanceUsd;
    if (Math.abs(delta) < 0.001) return { skipped: true };

    const entryDate = input.date ?? new Date();
    const amount = Math.abs(delta);
    const description = input.notes ?? "Opening balance adjustment";
    const sourceNumber = `OPENING-${Date.now()}`;

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
    return { skipped: false };
  });

  return { ok: true, ...result, balance: await getLedgerBalance() };
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
