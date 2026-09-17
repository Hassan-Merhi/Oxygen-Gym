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
 * - expense/outgoing transactions and the legacy expenses table
 * - completed membership/subscription receipts dated on or after the selected period start
 * - plans, staff/users, settings, suppliers/credits, numbering, and activity logs
 *
 * Cleared intentionally:
 * - pre-period revenue/member receipts, sales, payroll runs, commissions, attendance check-ins,
 *   their accounting entries, and the current cash-ledger event stream
 *
 * The period-reset marker is used by the canonical cash movement reader so
 * preserved pre-reset expense/stock/supplier history remains auditable but no
 * longer changes the new period's opening cash balance. Membership receipts on
 * or after resetDate remain available so a backdated period start (for example,
 * September 1) keeps subscription revenue already collected in that period.
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
  if (resetDate.getTime() > Date.now()) throw badRequest("Period start date cannot be in the future");

  const exchangeRate = await getExchangeRate();
  const resetNumber = `PERIOD-${Date.now()}`;
  const description = input.notes?.trim() || "New operating period opening balance";

  const result = await withTransaction(async (tx) => {
    // Serialize this operation against every financial mutation and against another reset.
    await lockFinancialEvent(tx, "financial-write");
    await lockFinancialEvent(tx, "period-reset");

    const before = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM payments
          WHERE NOT (
            (direction = 'out' AND category <> 'payroll' AND status <> 'cancelled')
            OR (
              direction = 'in'
              AND category = 'membership'
              AND status = 'completed'
              AND payment_date >= ${resetDate}
            )
          )) AS payments,
        (SELECT COUNT(*) FROM vouchers
          WHERE NOT (direction = 'out' AND status = 'recorded' AND deleted_at IS NULL)) AS vouchers,
        (SELECT COUNT(*) FROM sales) AS sales,
        (SELECT COUNT(*) FROM payroll) AS payroll,
        (SELECT COUNT(*) FROM commissions) AS commissions,
        (SELECT COUNT(*) FROM check_ins) AS check_ins,
        (SELECT COUNT(*) FROM accounting_entries ae
          WHERE NOT (
            (ae.source_type LIKE 'payment%' AND EXISTS (
              SELECT 1 FROM payments p
              WHERE p.id = ae.source_id
                AND (
                  (p.direction = 'out' AND p.category <> 'payroll' AND p.status <> 'cancelled')
                  OR (
                    p.direction = 'in'
                    AND p.category = 'membership'
                    AND p.status = 'completed'
                    AND p.payment_date >= ${resetDate}
                  )
                )
            ))
            OR (ae.source_type LIKE 'voucher%' AND EXISTS (SELECT 1 FROM vouchers v WHERE v.id = ae.source_id AND v.direction = 'out' AND v.status = 'recorded' AND v.deleted_at IS NULL))
            OR ae.source_type IN ('stock_purchase', 'supplier_credit', 'supplier_payment', 'expense')
          )) AS accounting_entries,
        (SELECT COUNT(*) FROM cash_ledger) AS cash_ledger
    `);
    const counts = (before.rows[0] ?? {}) as CountRow;

    // Remove resettable activity while retaining expenses, inventory history,
    // and membership revenue that belongs to the selected new period.
    await tx.execute(sql`DELETE FROM commissions`);
    await tx.execute(sql`DELETE FROM payroll`);
    await tx.execute(sql`DELETE FROM sales`);
    await tx.execute(sql`
      DELETE FROM vouchers
      WHERE NOT (direction = 'out' AND status = 'recorded' AND deleted_at IS NULL)
    `);
    await tx.execute(sql`
      DELETE FROM payments
      WHERE NOT (
        (direction = 'out' AND category <> 'payroll' AND status <> 'cancelled')
        OR (
          direction = 'in'
          AND category = 'membership'
          AND status = 'completed'
          AND payment_date >= ${resetDate}
        )
      )
    `);
    await tx.execute(sql`DELETE FROM check_ins`);
    await tx.execute(sql`
      DELETE FROM accounting_entries ae
      WHERE NOT (
        (ae.source_type LIKE 'payment%' AND EXISTS (SELECT 1 FROM payments p WHERE p.id = ae.source_id))
        OR (ae.source_type LIKE 'voucher%' AND EXISTS (SELECT 1 FROM vouchers v WHERE v.id = ae.source_id))
        OR ae.source_type IN ('stock_purchase', 'supplier_credit', 'supplier_payment', 'expense')
      )
    `);
    await tx.execute(sql`DELETE FROM cash_ledger`);

    // A zero-value marker is kept even when opening cash is $0. The cash reader
    // uses this timestamp as the cutover for preserved expense/stock/supplier history
    // and for the membership receipts preserved from the selected period start.
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
          'exchangeRate', ${exchangeRate},
          'preserved', jsonb_build_array(
            'stock',
            'stock_purchase_history',
            'members',
            'expenses',
            'membership_revenue_from_period_start',
            'master_data'
          ),
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
        membershipRevenueFromPeriodStart: true,
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
