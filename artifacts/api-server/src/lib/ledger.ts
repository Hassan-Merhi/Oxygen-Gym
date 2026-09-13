import { db, withTransaction, type DbExecutor } from "@workspace/db";
import { cashLedgerTable } from "@workspace/db/schema";
import { desc, sql } from "drizzle-orm";
import { addMoney, fxRate, money, subtractMoney } from "../shared/accounting/decimal";
import { toUsdCdf } from "../shared/accounting/currency";

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

async function appendLedgerEntryWithExecutor(
  input: LedgerEntryInput,
  executor: DbExecutor,
): Promise<void> {
  const amount = money(input.amount);
  const rate = fxRate(input.exchangeRate);
  if (amount < 0) throw new Error("Ledger amount cannot be negative");
  if (amount === 0) return;

  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext('oxygen_gym_cash_ledger'))`);
  const { amountUsd, amountCdf } = toUsdCdf(amount, input.currency, rate);

  const [lastEntry] = await executor
    .select({ balanceUsd: cashLedgerTable.balanceUsd, balanceCdf: cashLedgerTable.balanceCdf })
    .from(cashLedgerTable)
    .orderBy(desc(cashLedgerTable.id))
    .limit(1);

  const prevUsd = money(Number(lastEntry?.balanceUsd ?? 0));
  const prevCdf = money(Number(lastEntry?.balanceCdf ?? 0));
  const balanceUsd = input.direction === "in"
    ? addMoney(prevUsd, amountUsd)
    : subtractMoney(prevUsd, amountUsd);
  const balanceCdf = input.direction === "in"
    ? addMoney(prevCdf, amountCdf)
    : subtractMoney(prevCdf, amountCdf);

  await executor.insert(cashLedgerTable).values({
    entryDate: input.entryDate ?? new Date(),
    sourceType: input.sourceType,
    sourceNumber: input.sourceNumber,
    sourceId: input.sourceId,
    direction: input.direction,
    amount,
    currency: input.currency.toUpperCase(),
    exchangeRate: rate,
    amountUsd,
    amountCdf,
    balanceUsd,
    balanceCdf,
    description: input.description,
    createdBy: input.createdBy,
  });
}

export async function appendLedgerEntry(
  input: LedgerEntryInput,
  executor?: DbExecutor,
): Promise<void> {
  if (executor) {
    await appendLedgerEntryWithExecutor(input, executor);
    return;
  }
  await withTransaction(async (tx) => appendLedgerEntryWithExecutor(input, tx));
}

/**
 * Reconstruct physical Cash from authoritative business records. The append-only
 * ledger contributes only explicit opening balances so legacy duplicate ledger
 * rows cannot drift current cash.
 */
export async function getCurrentBalance(): Promise<{ balanceUsd: number; balanceCdf: number }> {
  const result = await db.execute(sql`
    WITH payment_values AS (
      SELECT
        p.*,
        COALESCE(
          p.amount_usd,
          CASE
            WHEN p.currency = 'USD' THEN p.amount
            WHEN COALESCE(p.exchange_rate, 0) > 0 THEN p.amount / p.exchange_rate
            ELSE 0
          END
        ) AS effective_usd,
        COALESCE(
          p.amount_cdf,
          CASE
            WHEN p.currency = 'CDF' THEN p.amount
            WHEN COALESCE(p.exchange_rate, 0) > 0 THEN p.amount * p.exchange_rate
            ELSE 0
          END
        ) AS effective_cdf
      FROM payments p
    ),
    payment_cash AS (
      SELECT
        COALESCE(SUM(CASE WHEN p.direction = 'in' THEN p.effective_usd ELSE -p.effective_usd END), 0) AS usd,
        COALESCE(SUM(CASE WHEN p.direction = 'in' THEN p.effective_cdf ELSE -p.effective_cdf END), 0) AS cdf
      FROM payment_values p
      WHERE p.status = 'completed'
        AND LOWER(REPLACE(TRIM(COALESCE(p.account, 'cash')), '_', ' ')) = 'cash'
    ),
    voucher_values AS (
      SELECT
        v.*,
        COALESCE(
          v.amount_usd,
          CASE
            WHEN v.currency = 'USD' THEN v.amount
            WHEN COALESCE(v.exchange_rate, 0) > 0 THEN v.amount / v.exchange_rate
            ELSE 0
          END
        ) AS effective_usd,
        COALESCE(
          v.amount_cdf,
          CASE
            WHEN v.currency = 'CDF' THEN v.amount
            WHEN COALESCE(v.exchange_rate, 0) > 0 THEN v.amount * v.exchange_rate
            ELSE 0
          END
        ) AS effective_cdf
      FROM vouchers v
    ),
    voucher_cash AS (
      SELECT
        COALESCE(SUM(CASE WHEN v.direction = 'in' THEN v.effective_usd ELSE -v.effective_usd END), 0) AS usd,
        COALESCE(SUM(CASE WHEN v.direction = 'in' THEN v.effective_cdf ELSE -v.effective_cdf END), 0) AS cdf
      FROM voucher_values v
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
        -COALESCE(SUM(COALESCE(
          sp.total_cost_usd,
          CASE
            WHEN sp.currency = 'USD' THEN sp.total_cost
            WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN sp.total_cost / sp.exchange_rate
            ELSE 0
          END
        )), 0) AS usd,
        -COALESCE(SUM(COALESCE(
          sp.total_cost_cdf,
          CASE
            WHEN sp.currency = 'CDF' THEN sp.total_cost
            WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN sp.total_cost * sp.exchange_rate
            ELSE 0
          END
        )), 0) AS cdf
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
        COALESCE(SUM(
          CASE WHEN cl.direction = 'in' THEN
            COALESCE(
              cl.amount_usd,
              CASE
                WHEN cl.currency = 'USD' THEN cl.amount
                WHEN COALESCE(cl.exchange_rate, 0) > 0 THEN cl.amount / cl.exchange_rate
                ELSE 0
              END
            )
          ELSE -COALESCE(
              cl.amount_usd,
              CASE
                WHEN cl.currency = 'USD' THEN cl.amount
                WHEN COALESCE(cl.exchange_rate, 0) > 0 THEN cl.amount / cl.exchange_rate
                ELSE 0
              END
            )
          END
        ), 0) AS usd,
        COALESCE(SUM(
          CASE WHEN cl.direction = 'in' THEN
            COALESCE(
              cl.amount_cdf,
              CASE
                WHEN cl.currency = 'CDF' THEN cl.amount
                WHEN COALESCE(cl.exchange_rate, 0) > 0 THEN cl.amount * cl.exchange_rate
                ELSE 0
              END
            )
          ELSE -COALESCE(
              cl.amount_cdf,
              CASE
                WHEN cl.currency = 'CDF' THEN cl.amount
                WHEN COALESCE(cl.exchange_rate, 0) > 0 THEN cl.amount * cl.exchange_rate
                ELSE 0
              END
            )
          END
        ), 0) AS cdf
      FROM cash_ledger cl
      WHERE cl.source_type = 'opening_balance'
    )
    SELECT
      payment_cash.usd + voucher_cash.usd + stock_cash.usd + opening_adjustments.usd AS balance_usd,
      payment_cash.cdf + voucher_cash.cdf + stock_cash.cdf + opening_adjustments.cdf AS balance_cdf
    FROM payment_cash, voucher_cash, stock_cash, opening_adjustments
  `);

  const row = result.rows[0] as { balance_usd?: number | string; balance_cdf?: number | string } | undefined;
  return {
    balanceUsd: money(Number(row?.balance_usd ?? 0)),
    balanceCdf: money(Number(row?.balance_cdf ?? 0)),
  };
}
