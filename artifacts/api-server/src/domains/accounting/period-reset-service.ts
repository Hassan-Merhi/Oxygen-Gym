import { sql } from "drizzle-orm";
import { appendLedgerEntry, getCurrentBalance } from "../../lib/ledger";
import { postDoubleEntry } from "../../lib/accounting";
import { getExchangeRate } from "../../shared/accounting/currency";
import { money, multiplyMoney } from "../../shared/accounting/decimal";
import { lockFinancialEvent, withTransaction } from "../../shared/db/transaction";
import { badRequest } from "../../shared/http/errors";

export const PERIOD_RESET_CONFIRMATION = "RESET OXYGEN GYM";

export interface ResetOperationalPeriodInput {
  openingCashUsd: number;
  resetDate?: Date;
  notes?: string;
  confirmation: string;
}

type CountRow = {
  payments?: string | number;
  vouchers?: string | number;
  sales?: string | number;
  payroll?: string | number;
  commissions?: string | number;
  check_ins?: string | number;
  accounting_entries?: string | number;
  cash_ledger?: string | number;
};

/**
 * Starts a clean operating period without destroying the business master data.
 *
 * Preserved intentionally:
 * - products, quantities, costs, and stock purchase history
 * - members (active members stay live; inactive/expired members remain available for retention history)
 * - expenses
 * - plans, staff/users, settings, suppliers/credits, numbering, and activity logs
 *
 * Cleared intentionally:
 * - payments/cashbook activity, vouchers, sales, payroll runs, commissions,
 *   attendance check-ins, accounting entries, and the cash-ledger event stream
 *
 * The period-reset marker is used by the canonical cash movement reader so
 * pre-reset stock/supplier cash history cannot reduce the new opening balance.
 */
export async function resetOperationalPeriod(input: ResetOperationalPeriodInput, actor: string) {
  if (input.confirmation !== PERIOD_RESET_CONFIRMATION) {
    throw badRequest(`Type ${PERIOD_RESET_CONFIRMATION} to confirm the reset`);
  }
  if (!Number.isFinite(input.openingCashUsd) || input.openingCashUsd < 0) {
    throw badRequest("openingCashUsd must be a non-negative number");
  }

  const openingCashUsd = money(input.openingCashUsd);
  const resetDate = input.resetDate ?? new Date();
  if (Number.isNaN(resetDate.getTime())) throw badRequest("Invalid reset date");

  const exchangeRate = await getExchangeRate();
  const resetNumber = `PERIOD-${Date.now()}`;
  const description = input.notes?.trim() || "New operating period opening balance";

  const result = await withTransaction(async (tx) => {
    // Serialize this operation against every financial mutation and against another reset.
    await lockFinancialEvent(tx, "financial-write");
    await lockFinancialEvent(tx, "period-reset");

    const before = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM payments) AS payments,
        (SELECT COUNT(*) FROM vouchers) AS vouchers,
        (SELECT COUNT(*) FROM sales) AS sales,
        (SELECT COUNT(*) FROM payroll) AS payroll,
        (SELECT COUNT(*) FROM commissions) AS commissions,
        (SELECT COUNT(*) FROM check_ins) AS check_ins,
        (SELECT COUNT(*) FROM accounting_entries) AS accounting_entries,
        (SELECT COUNT(*) FROM cash_ledger) AS cash_ledger
    `);
    const counts = (before.rows[0] ?? {}) as CountRow;

    // Current-period transactional activity is cleared. Master/reference data and
    // the explicitly preserved datasets above are deliberately not touched.
    await tx.execute(sql`DELETE FROM commissions`);
    await tx.execute(sql`DELETE FROM payroll`);
    await tx.execute(sql`DELETE FROM sales`);
    await tx.execute(sql`DELETE FROM vouchers`);
    await tx.execute(sql`DELETE FROM payments`);
    await tx.execute(sql`DELETE FROM check_ins`);
    await tx.execute(sql`DELETE FROM accounting_entries`);
    await tx.execute(sql`DELETE FROM cash_ledger`);
    await tx.execute(sql`DELETE FROM financial_idempotency`);

    // A zero-value marker is kept even when opening cash is $0. The cash reader
    // uses this timestamp as the cutover for preserved stock/supplier history.
    await tx.execute(sql`
      INSERT INTO cash_ledger (
        entry_date, source_type, source_number, direction, amount, currency,
        exchange_rate, amount_usd, amount_cdf, balance_usd, balance_cdf,
        description, created_by
      ) VALUES (
        ${resetDate}, 'period_reset', ${resetNumber}, 'in', 0, 'USD',
        ${exchangeRate}, 0, 0, 0, 0,
        ${`Operating period reset by ${actor}`}, ${actor}
      )
    `);

    if (openingCashUsd > 0) {
      const openingNumber = `${resetNumber}-OPENING`;
      await appendLedgerEntry({
        entryDate: resetDate,
        sourceType: "opening_balance",
        sourceNumber: openingNumber,
        direction: "in",
        amount: openingCashUsd,
        currency: "USD",
        exchangeRate,
        description,
        createdBy: actor,
      }, tx);

      await postDoubleEntry({
        entryDate: resetDate,
        sourceType: "opening_balance",
        sourceNumber: openingNumber,
        debitName: "Cash",
        debitType: "asset",
        creditName: "Opening Balance Equity",
        creditType: "equity",
        amount: openingCashUsd,
        amountUsd: openingCashUsd,
        amountCdf: multiplyMoney(openingCashUsd, exchangeRate),
        currency: "USD",
        exchangeRate,
        description,
        createdBy: actor,
      }, tx);
    }

    await tx.execute(sql`
      INSERT INTO activity_logs (user_name, action, entity, details)
      VALUES (
        ${actor},
        'operating_period_reset',
        'system',
        jsonb_build_object(
          'resetNumber', ${resetNumber},
          'resetDate', ${resetDate.toISOString()},
          'openingCashUsd', ${openingCashUsd},
          'preserved', jsonb_build_array('stock', 'stock_purchase_history', 'members', 'expenses', 'master_data'),
          'cleared', jsonb_build_object(
            'payments', ${Number(counts.payments ?? 0)},
            'vouchers', ${Number(counts.vouchers ?? 0)},
            'sales', ${Number(counts.sales ?? 0)},
            'payroll', ${Number(counts.payroll ?? 0)},
            'commissions', ${Number(counts.commissions ?? 0)},
            'checkIns', ${Number(counts.check_ins ?? 0)},
            'accountingEntries', ${Number(counts.accounting_entries ?? 0)},
            'cashLedger', ${Number(counts.cash_ledger ?? 0)}
          )
        )
      )
    `);

    return {
      resetNumber,
      resetDate: resetDate.toISOString(),
      openingCashUsd,
      exchangeRate,
      cleared: {
        payments: Number(counts.payments ?? 0),
        vouchers: Number(counts.vouchers ?? 0),
        sales: Number(counts.sales ?? 0),
        payroll: Number(counts.payroll ?? 0),
        commissions: Number(counts.commissions ?? 0),
        checkIns: Number(counts.check_ins ?? 0),
        accountingEntries: Number(counts.accounting_entries ?? 0),
        cashLedger: Number(counts.cash_ledger ?? 0),
      },
      preserved: {
        stock: true,
        stockPurchaseHistory: true,
        members: true,
        expenses: true,
        masterData: true,
      },
    };
  });

  return {
    ok: true,
    ...result,
    balance: await getCurrentBalance(),
  };
}
