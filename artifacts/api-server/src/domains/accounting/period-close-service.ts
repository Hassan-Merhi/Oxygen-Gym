import { db } from "@workspace/db";
import { accountingPeriodsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import {
  ACCOUNTS,
  MONEY_ACCOUNTS,
  getBooksLockedThrough,
  newJournalId,
  postJournal,
  type JournalLine,
} from "../../lib/accounting";
import { getLedgerLines, getMoneyBalance, valueAtRate } from "../../lib/ledger";
import { businessDateKey, businessDayEnd } from "../../lib/timezone";
import { getExchangeRate } from "../../shared/accounting/currency";
import { addMoney, money, subtractMoney } from "../../shared/accounting/decimal";
import { lockFinancialEvent, withTransaction } from "../../shared/db/transaction";
import { badRequest } from "../../shared/http/errors";
import { getAccountTotals, getProfitAndLoss } from "./ledger-reports";
import { getStockValuation } from "./ledger-health";
import { postCashCount } from "./ledger-service";

export const PERIOD_CLOSE_CONFIRMATION = "CLOSE BOOKS";

/** One journal line that moves `netDebit` (USD, CDF) off an account, each currency on its own side. */
function offsetLine(account: string, type: JournalLine["type"], netDebitUsd: number, netDebitCdf: number): JournalLine {
  return {
    account,
    type,
    debitUsd: netDebitUsd < 0 ? -netDebitUsd : 0,
    creditUsd: netDebitUsd > 0 ? netDebitUsd : 0,
    debitCdf: netDebitCdf < 0 ? -netDebitCdf : 0,
    creditCdf: netDebitCdf > 0 ? netDebitCdf : 0,
    amount: 0,
    currency: "USD",
  };
}

export async function listClosedPeriods() {
  const [periods, lockedThrough] = await Promise.all([
    db.select().from(accountingPeriodsTable).orderBy(desc(accountingPeriodsTable.closedThrough)),
    getBooksLockedThrough(),
  ]);
  return {
    lockedThrough: lockedThrough?.toISOString() ?? null,
    lockedThroughDate: lockedThrough ? businessDateKey(lockedThrough) : null,
    items: periods.map((period) => ({
      ...period,
      closedThrough: period.closedThrough.toISOString(),
      closedThroughDate: businessDateKey(period.closedThrough),
      closedAt: period.closedAt.toISOString(),
      netIncomeUsd: Number(period.netIncomeUsd ?? 0),
      netIncomeCdf: Number(period.netIncomeCdf ?? 0),
    })),
  };
}

/**
 * Close the books through the end of a business date.
 *
 * 1. Optionally record the physical cash count (differences go to Cash Over/Short).
 * 2. Revalue money accounts' CDF holdings at today's rate (FX Gain/Loss), so the
 *    USD book value matches the notes in the drawer.
 *    CDF-costed inventory is restated the same way (Inventory Adjustments).
 * 3. Move every income and expense balance into Retained Earnings.
 * 4. Lock the period: no entry can be posted or reversed on or before that date.
 *
 * Nothing is deleted; corrections after a close are new entries in the open period.
 */
export async function closePeriod(
  input: { closedThroughDate: string; confirmation: string; countedUsd?: number; countedCdf?: number; notes?: string },
  actor: string,
) {
  if (input.confirmation !== PERIOD_CLOSE_CONFIRMATION) throw badRequest(`Type ${PERIOD_CLOSE_CONFIRMATION} to confirm`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.closedThroughDate)) throw badRequest("closedThroughDate must be YYYY-MM-DD");
  const closedThrough = businessDayEnd(input.closedThroughDate);
  if (closedThrough.getTime() > Date.now()) {
    throw badRequest("That business day has not finished yet. Close through a day that has already ended.");
  }
  const rate = await getExchangeRate();
  const closeNumber = `CLOSE-${input.closedThroughDate}`;

  // One transaction under the financial-write lock: the cutoff is checked and the
  // count, revaluation, closing journal and period row are written together.
  return withTransaction(async (tx) => {
    await lockFinancialEvent(tx, "period-close");
    const previous = await getBooksLockedThrough(tx);
    if (previous && closedThrough.getTime() <= previous.getTime()) {
      throw badRequest(`The books are already closed through ${businessDateKey(previous)}.`);
    }

    if (input.countedUsd !== undefined || input.countedCdf !== undefined) {
      await postCashCount({
        countedUsd: input.countedUsd,
        countedCdf: input.countedCdf,
        date: closedThrough,
        notes: input.notes?.trim() ? `Closing count: ${input.notes.trim()}` : "Closing cash count",
      }, actor, rate, tx);
    }

    // FX revaluation of money accounts.
    const revaluation: JournalLine[] = [];
    let fxNetUsd = 0;
    let fxNetCdf = 0;
    for (const account of MONEY_ACCOUNTS) {
      const balance = await getMoneyBalance({ accountNames: [account], asOf: closedThrough }, tx);
      if (balance.usd === 0 && balance.cdf === 0 && balance.bookUsd === 0 && balance.bookCdf === 0) continue;
      const target = valueAtRate(balance, rate);
      const diffUsd = subtractMoney(target.balanceUsd, balance.bookUsd);
      const diffCdf = subtractMoney(target.balanceCdf, balance.bookCdf);
      if (diffUsd === 0 && diffCdf === 0) continue;
      // offsetLine removes a net debit, so pass the negative difference to add it.
      revaluation.push(offsetLine(account, "asset", -diffUsd, -diffCdf));
      fxNetUsd = addMoney(fxNetUsd, diffUsd);
      fxNetCdf = addMoney(fxNetCdf, diffCdf);
    }
    let revaluationJournal: string | null = null;
    if (revaluation.length > 0) {
      revaluation.push(offsetLine(ACCOUNTS.FX_GAIN_LOSS, "income", fxNetUsd, fxNetCdf));
      revaluationJournal = await postJournal({
        entryDate: closedThrough,
        sourceType: "fx_revaluation",
        sourceNumber: `FX-${input.closedThroughDate}`,
        exchangeRate: rate,
        description: `FX revaluation at ${rate} CDF per USD`,
        createdBy: actor,
        lines: revaluation,
      }, tx);
    }

    // Inventory revaluation: CDF-costed stock is restated at today's rate so the
    // Inventory account equals quantity x cost of the stock on hand.
    // Quantities on hand are only known for today, so compare them with the
    // whole Inventory balance (not the balance at the close date).
    const inventoryLines = await getLedgerLines({ accountNames: [ACCOUNTS.INVENTORY] }, tx);
    const inventoryBook = addMoney(...inventoryLines.map((line) => subtractMoney(line.debitUsd, line.creditUsd)));
    const inventoryDiff = subtractMoney(await getStockValuation(rate, tx), inventoryBook);
    if (Math.abs(inventoryDiff) >= 0.01) {
      const diffCdf = money(inventoryDiff * rate);
      await postJournal({
        entryDate: closedThrough,
        sourceType: "inventory_revaluation",
        sourceNumber: `INV-${input.closedThroughDate}`,
        exchangeRate: rate,
        description: "Inventory restated to stock on hand",
        createdBy: actor,
        lines: [
          offsetLine(ACCOUNTS.INVENTORY, "asset", -inventoryDiff, -diffCdf),
          offsetLine(ACCOUNTS.INVENTORY_ADJUSTMENTS, "expense", inventoryDiff, diffCdf),
        ],
      }, tx);
    }

    // Period result for the record (P&L since the previous close).
    const periodPnl = await getProfitAndLoss({ from: previous ? new Date(previous.getTime() + 1) : undefined, to: closedThrough }, tx);

    // Closing entries: zero every income and expense account into Retained Earnings.
    const totals = await getAccountTotals({ to: closedThrough }, tx);
    const closing: JournalLine[] = [];
    let retainedUsd = 0;
    let retainedCdf = 0;
    for (const row of totals.filter((total) => total.type === "income" || total.type === "expense")) {
      const netDebitUsd = subtractMoney(row.debitUsd, row.creditUsd);
      const netDebitCdf = subtractMoney(row.debitCdf, row.creditCdf);
      if (netDebitUsd === 0 && netDebitCdf === 0) continue;
      closing.push(offsetLine(row.name, row.type as JournalLine["type"], netDebitUsd, netDebitCdf));
      retainedUsd = addMoney(retainedUsd, netDebitUsd);
      retainedCdf = addMoney(retainedCdf, netDebitCdf);
    }
    const journalId = newJournalId();
    if (closing.length > 0) {
      // Retained Earnings takes the net debit (a loss) or credit (a profit).
      closing.push({
        ...offsetLine(ACCOUNTS.RETAINED_EARNINGS, "equity", -retainedUsd, -retainedCdf),
      });
      await postJournal({
        journalId,
        entryDate: closedThrough,
        sourceType: "period_close",
        sourceNumber: closeNumber,
        exchangeRate: rate,
        description: `Close books through ${input.closedThroughDate}`,
        createdBy: actor,
        lines: closing,
      }, tx);
    }

    const [period] = await tx.insert(accountingPeriodsTable).values({
      closedThrough,
      journalId,
      netIncomeUsd: money(periodPnl.net.usd),
      netIncomeCdf: money(periodPnl.net.cdf),
      notes: input.notes?.trim() || null,
      closedBy: actor,
    }).returning();

    return {
      ok: true,
      closedThrough: closedThrough.toISOString(),
      closedThroughDate: input.closedThroughDate,
      journalId,
      revaluationJournalId: revaluationJournal,
      exchangeRate: rate,
      netIncome: periodPnl.net,
      revenue: periodPnl.revenue,
      expenses: periodPnl.expenses,
      fxAdjustment: { usd: fxNetUsd, cdf: fxNetCdf },
      periodId: period!.id,
    };
  });
}
