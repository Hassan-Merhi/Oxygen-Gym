import { db, withTransaction, type DbExecutor } from "@workspace/db";
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

async function appendLedgerEntryWithExecutor(
  input: LedgerEntryInput,
  executor: DbExecutor,
): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error("Ledger amount must be a non-negative finite number");
  }
  if (!Number.isFinite(input.exchangeRate) || input.exchangeRate <= 0) {
    throw new Error("Ledger exchangeRate must be greater than zero");
  }

  // Serialize running-balance writes inside the surrounding transaction. This
  // prevents two concurrent cash movements from reading the same previous row
  // and persisting conflicting running balances.
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext('oxygen_gym_cash_ledger'))`);

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
 * Append a cash-ledger row.
 *
 * When a transaction executor is supplied, this joins that transaction. When
 * called standalone it opens a transaction automatically, so the advisory lock,
 * previous-balance read, and insert always share one atomic unit of work.
 */
export async function appendLedgerEntry(
  input: LedgerEntryInput,
  executor?: DbExecutor,
): Promise<void> {
  if (executor) {
    await appendLedgerEntryWithExecutor(input, executor);
    return;
  }

  await withTransaction(async (tx) => {
    await appendLedgerEntryWithExecutor(input, tx);
  });
}

export interface CashMovement {
  sourceType: string;
  sourceId: number | null;
  sourceNumber: string | null;
  date: Date;
  direction: "in" | "out";
  amount: number;
  currency: string;
  exchangeRate: number;
  amountUsd: number;
  amountCdf: number;
  description: string;
  party: string;
}

/**
 * Canonical effective physical-cash movements.
 *
 * The Accounts/Cash statement and the balance must be derived from this
 * exact source stream. Historical double-entry rows can contain legacy
 * polarity mistakes (for example expenses posted on the Cash debit side),
 * so they are not authoritative for whether cash moved IN or OUT.
 */
export async function getCashMovements(
  executor: DbExecutor = db,
): Promise<CashMovement[]> {
  const result = await executor.execute(sql`
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
        'payment'::text AS source_type,
        p.id AS source_id,
        p.payment_number AS source_number,
        p.payment_date AS entry_date,
        p.direction,
        p.amount,
        p.currency,
        p.exchange_rate,
        p.effective_usd AS amount_usd,
        p.effective_cdf AS amount_cdf,
        COALESCE(
          NULLIF(TRIM(p.notes), ''),
          NULLIF(TRIM(p.linked_entity_name), ''),
          NULLIF(TRIM(p.member_name), ''),
          NULLIF(TRIM(p.category), ''),
          'Payment'
        ) AS description,
        COALESCE(
          NULLIF(TRIM(p.linked_entity_name), ''),
          NULLIF(TRIM(p.member_name), ''),
          ''
        ) AS party
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
        'voucher'::text AS source_type,
        v.id AS source_id,
        v.voucher_number AS source_number,
        v.voucher_date AS entry_date,
        v.direction,
        v.amount,
        v.currency,
        v.exchange_rate,
        v.effective_usd AS amount_usd,
        v.effective_cdf AS amount_cdf,
        COALESCE(NULLIF(TRIM(v.description), ''), NULLIF(TRIM(v.category), ''), v.voucher_type, 'Voucher') AS description,
        COALESCE(NULLIF(TRIM(v.paid_to), ''), NULLIF(TRIM(v.received_from), ''), NULLIF(TRIM(v.linked_entity_name), ''), '') AS party
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
        'stock_purchase'::text AS source_type,
        sp.id AS source_id,
        sp.purchase_number AS source_number,
        sp.purchase_date AS entry_date,
        'out'::text AS direction,
        sp.total_cost AS amount,
        sp.currency,
        sp.exchange_rate,
        COALESCE(
          sp.total_cost_usd,
          CASE
            WHEN sp.currency = 'USD' THEN sp.total_cost
            WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN sp.total_cost / sp.exchange_rate
            ELSE 0
          END
        ) AS amount_usd,
        COALESCE(
          sp.total_cost_cdf,
          CASE
            WHEN sp.currency = 'CDF' THEN sp.total_cost
            WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN sp.total_cost * sp.exchange_rate
            ELSE 0
          END
        ) AS amount_cdf,
        COALESCE(NULLIF(TRIM(sp.notes), ''), 'Stock purchase: ' || COALESCE(sp.product_name, sp.purchase_number, sp.id::text)) AS description,
        COALESCE(NULLIF(TRIM(sp.supplier), ''), '') AS party
      FROM stock_purchases sp
      WHERE sp.paid_from_cash = 1
        AND (
          sp.payment_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM payments p3
            WHERE p3.id = sp.payment_id
              AND p3.status = 'completed'
          )
        )
    ),
    supplier_cash AS (
      SELECT
        'supplier_payment'::text AS source_type,
        sp.id AS source_id,
        sc.credit_number AS source_number,
        sp.payment_date AS entry_date,
        'out'::text AS direction,
        sp.amount,
        sp.currency,
        COALESCE(NULLIF(sp.exchange_rate, 0), 1) AS exchange_rate,
        COALESCE(
          sp.amount_usd,
          CASE
            WHEN sp.currency = 'USD' THEN sp.amount
            WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN sp.amount / sp.exchange_rate
            ELSE 0
          END
        ) AS amount_usd,
        COALESCE(
          sp.amount_cdf,
          CASE
            WHEN sp.currency = 'CDF' THEN sp.amount
            WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN sp.amount * sp.exchange_rate
            ELSE 0
          END
        ) AS amount_cdf,
        COALESCE(NULLIF(TRIM(sp.notes), ''), 'Supplier payment: ' || COALESCE(sc.supplier, sc.credit_number, sp.id::text)) AS description,
        COALESCE(NULLIF(TRIM(sc.supplier), ''), '') AS party
      FROM supplier_payments sp
      LEFT JOIN supplier_credits sc ON sc.id = sp.credit_id
    ),
    opening_cash AS (
      SELECT
        'opening_balance'::text AS source_type,
        cl.id AS source_id,
        cl.source_number,
        cl.entry_date,
        cl.direction,
        cl.amount,
        cl.currency,
        cl.exchange_rate,
        COALESCE(
          cl.amount_usd,
          CASE
            WHEN cl.currency = 'USD' THEN cl.amount
            WHEN COALESCE(cl.exchange_rate, 0) > 0 THEN cl.amount / cl.exchange_rate
            ELSE 0
          END
        ) AS amount_usd,
        COALESCE(
          cl.amount_cdf,
          CASE
            WHEN cl.currency = 'CDF' THEN cl.amount
            WHEN COALESCE(cl.exchange_rate, 0) > 0 THEN cl.amount * cl.exchange_rate
            ELSE 0
          END
        ) AS amount_cdf,
        COALESCE(NULLIF(TRIM(cl.description), ''), 'Opening cash balance') AS description,
        'Opening balance'::text AS party
      FROM cash_ledger cl
      WHERE cl.source_type = 'opening_balance'
    )
    SELECT * FROM payment_cash
    UNION ALL SELECT * FROM voucher_cash
    UNION ALL SELECT * FROM stock_cash
    UNION ALL SELECT * FROM supplier_cash
    UNION ALL SELECT * FROM opening_cash
    ORDER BY entry_date ASC, source_type ASC, source_id ASC
  `);

  type RawMovement = {
    source_type?: string;
    source_id?: number | string | null;
    source_number?: string | null;
    entry_date?: Date | string;
    direction?: string;
    amount?: number | string;
    currency?: string;
    exchange_rate?: number | string;
    amount_usd?: number | string;
    amount_cdf?: number | string;
    description?: string | null;
    party?: string | null;
  };

  return (result.rows as RawMovement[]).map((row) => ({
    sourceType: row.source_type ?? 'cash',
    sourceId: row.source_id == null ? null : Number(row.source_id),
    sourceNumber: row.source_number ?? null,
    date: row.entry_date instanceof Date ? row.entry_date : new Date(row.entry_date ?? 0),
    direction: row.direction === 'out' ? 'out' : 'in',
    amount: Number(row.amount ?? 0),
    currency: row.currency ?? 'USD',
    exchangeRate: Number(row.exchange_rate ?? 1),
    amountUsd: Number(row.amount_usd ?? 0),
    amountCdf: Number(row.amount_cdf ?? 0),
    description: row.description ?? '',
    party: row.party ?? '',
  }));
}

/**
 * Current physical Cash balance from the same canonical movements used by
 * the Cash account statement. This guarantees Balance = Total In - Total Out
 * for the same all-time movement set and removes legacy debit/credit drift.
 */
export async function getCurrentBalance(
  executor: DbExecutor = db,
): Promise<{ balanceUsd: number; balanceCdf: number }> {
  const movements = await getCashMovements(executor);
  return movements.reduce(
    (balance, movement) => {
      const sign = movement.direction === 'in' ? 1 : -1;
      balance.balanceUsd += sign * movement.amountUsd;
      balance.balanceCdf += sign * movement.amountCdf;
      return balance;
    },
    { balanceUsd: 0, balanceCdf: 0 },
  );
}
