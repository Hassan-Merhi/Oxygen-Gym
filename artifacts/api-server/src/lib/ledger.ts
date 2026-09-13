import { db } from "@workspace/db";
import { cashLedgerTable } from "@workspace/db/schema";
import { desc, sql } from "drizzle-orm";

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
 * Current physical Cash balance.
 *
 * `accounting_entries` was introduced after the gym already had historical
 * payments and sales, so using only the double-entry Cash account can produce a
 * false negative balance until every legacy transaction is backfilled.
 *
 * The balance below is therefore reconstructed from the authoritative business
 * records that actually move physical cash:
 *   - completed cash payments (membership, POS sales, payroll/expenses, etc.)
 *   - recorded cash vouchers
 *   - stock purchases explicitly marked paid from cash
 *   - explicit opening-balance adjustments posted to accounting
 *
 * Auto-generated member Cash Receipt vouchers are excluded when a completed
 * membership payment already exists for that member; otherwise the same receipt
 * would be counted twice.
 */
export async function getCurrentBalance(): Promise<{ balanceUsd: number; balanceCdf: number }> {
  const result = await db.execute(sql`
    WITH payment_cash AS (
      SELECT
        COALESCE(SUM(CASE WHEN p.direction = 'in' THEN COALESCE(p.amount_usd, 0) ELSE -COALESCE(p.amount_usd, 0) END), 0) AS usd,
        COALESCE(SUM(CASE WHEN p.direction = 'in' THEN COALESCE(p.amount_cdf, 0) ELSE -COALESCE(p.amount_cdf, 0) END), 0) AS cdf
      FROM payments p
      WHERE p.status = 'completed'
        AND LOWER(REPLACE(TRIM(COALESCE(p.account, 'cash')), '_', ' ')) = 'cash'
    ),
    voucher_cash AS (
      SELECT
        COALESCE(SUM(CASE WHEN v.direction = 'in' THEN COALESCE(v.amount_usd, 0) ELSE -COALESCE(v.amount_usd, 0) END), 0) AS usd,
        COALESCE(SUM(CASE WHEN v.direction = 'in' THEN COALESCE(v.amount_cdf, 0) ELSE -COALESCE(v.amount_cdf, 0) END), 0) AS cdf
      FROM vouchers v
      WHERE v.status = 'recorded'
        AND v.deleted_at IS NULL
        AND LOWER(REPLACE(TRIM(COALESCE(v.account, 'cash')), '_', ' ')) = 'cash'
        AND NOT (
          v.linked_entity = 'member'
          AND v.voucher_type = 'cash_receipt'
          AND EXISTS (
            SELECT 1
            FROM payments p2
            WHERE p2.member_id = v.linked_entity_id
              AND p2.category = 'membership'
              AND p2.status = 'completed'
          )
        )
    ),
    stock_cash AS (
      SELECT
        -COALESCE(SUM(COALESCE(sp.total_cost_usd, 0)), 0) AS usd,
        -COALESCE(SUM(COALESCE(sp.total_cost_cdf, 0)), 0) AS cdf
      FROM stock_purchases sp
      WHERE sp.paid_from_cash = 1
        AND (
          sp.payment_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM payments p3
            WHERE p3.id = sp.payment_id
              AND p3.status = 'completed'
          )
        )
    ),
    opening_adjustments AS (
      SELECT
        COALESCE(SUM(ae.debit_usd - ae.credit_usd), 0) AS usd,
        COALESCE(SUM(ae.debit_cdf - ae.credit_cdf), 0) AS cdf
      FROM accounting_entries ae
      WHERE ae.account_name_snapshot = 'Cash'
        AND ae.source_type = 'opening_balance'
    )
    SELECT
      payment_cash.usd + voucher_cash.usd + stock_cash.usd + opening_adjustments.usd AS balance_usd,
      payment_cash.cdf + voucher_cash.cdf + stock_cash.cdf + opening_adjustments.cdf AS balance_cdf
    FROM payment_cash, voucher_cash, stock_cash, opening_adjustments
  `);

  const row = result.rows[0] as { balance_usd?: number | string; balance_cdf?: number | string } | undefined;
  return {
    balanceUsd: Number(row?.balance_usd ?? 0),
    balanceCdf: Number(row?.balance_cdf ?? 0),
  };
}
