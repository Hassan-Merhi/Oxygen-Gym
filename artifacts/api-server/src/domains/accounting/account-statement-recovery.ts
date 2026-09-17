import { db } from "@workspace/db";
import { chartOfAccountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentCashMovements } from "../../lib/ledger";
import { getAccountStatement } from "./accounts-service";
import { canonicalAccountType } from "./chart-service";

function isCashName(name: string) {
  return name.trim().toLowerCase() === "cash";
}

async function getAccount(id: number) {
  const [account] = await db.select().from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.id, id))
    .limit(1);
  return account;
}

/**
 * Cash is special: the account statement must be the exact same canonical
 * physical-cash stream as Cash Book/current balance. An empty canonical stream
 * is a valid $0 balance (especially after a period reset), so never replace it
 * with old append-only cash_ledger history.
 */
async function getCanonicalCashStatement(
  account: NonNullable<Awaited<ReturnType<typeof getAccount>>>,
  dateFrom?: Date,
  dateTo?: Date,
) {
  const { movements } = await getCurrentCashMovements();
  const filtered = movements.filter((movement) => {
    if (dateFrom && movement.date < dateFrom) return false;
    if (dateTo && movement.date > dateTo) return false;
    return true;
  });

  let runningBalance = 0;
  const rows = filtered.map((movement, index) => {
    const amountUsd = movement.amountUsd;
    const amountCdf = movement.amountCdf;
    runningBalance += movement.direction === "in" ? amountUsd : -amountUsd;

    return {
      // Use a statement-local unique id. Source ids can collide across payments,
      // vouchers, stock purchases, and supplier payments.
      id: index + 1,
      date: movement.date,
      description: movement.description,
      party: movement.party || movement.sourceNumber || "",
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      amount: movement.amount,
      currency: movement.currency,
      debitUsd: movement.direction === "in" ? amountUsd : 0,
      creditUsd: movement.direction === "out" ? amountUsd : 0,
      debitCdf: movement.direction === "in" ? amountCdf : 0,
      creditCdf: movement.direction === "out" ? amountCdf : 0,
      exchangeRate: movement.exchangeRate,
      runningBalance,
    };
  });

  const requiredType = canonicalAccountType(account.name);
  return {
    account: requiredType ? { ...account, type: requiredType, isActive: true } : account,
    rows,
  };
}

export async function getAccountStatementWithRecovery(id: number, dateFrom?: Date, dateTo?: Date) {
  const account = await getAccount(id);
  if (!account) return getAccountStatement(id, dateFrom, dateTo);
  if (isCashName(account.name)) {
    return getCanonicalCashStatement(account, dateFrom, dateTo);
  }
  return getAccountStatement(id, dateFrom, dateTo);
}
