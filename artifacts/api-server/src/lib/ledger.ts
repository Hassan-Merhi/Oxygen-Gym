import { db, withTransaction, type DbExecutor } from "@workspace/db";
import { cashLedgerTable } from "@workspace/db/schema";
import { desc, sql } from "drizzle-orm";
import { addMoney, fxRate, money, subtractMoney } from "../shared/accounting/decimal";
import { getExchangeRate, toUsdCdf } from "../shared/accounting/currency";

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

async function appendLedgerEntryWithExecutor(input: LedgerEntryInput, executor: DbExecutor): Promise<void> {
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
  const balanceUsd = input.direction === "in" ? addMoney(prevUsd, amountUsd) : subtractMoney(prevUsd, amountUsd);
  const balanceCdf = input.direction === "in" ? addMoney(prevCdf, amountCdf) : subtractMoney(prevCdf, amountCdf);

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

export async function appendLedgerEntry(input: LedgerEntryInput, executor?: DbExecutor): Promise<void> {
  if (executor) {
    await appendLedgerEntryWithExecutor(input, executor);
    return;
  }
  await withTransaction(async (tx) => appendLedgerEntryWithExecutor(input, tx));
}

export interface CashMovement {
  sourceType: string;
  sourceId: number | null;
  sourceNumber: string | null;
  date: Date;
  direction: "in" | "out";
  category: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  amountUsd: number;
  amountCdf: number;
  description: string;
  party: string;
}

export interface CashMovementRange {
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * Canonical effective physical-cash movements used by Cash Book, the Cash account
 * statement, and the current balance. Optional statement bounds are pushed into
 * every source query so date-filtered statements do not reconstruct all history.
 */
export async function getCashMovements(
  executor: DbExecutor = db,
  range: CashMovementRange = {},
): Promise<CashMovement[]> {
  const dateFrom = range.dateFrom ?? null;
  const dateTo = range.dateTo ?? null;

  const result = await executor.execute(sql`
    WITH bounds AS (
      SELECT ${dateFrom}::timestamptz AS date_from, ${dateTo}::timestamptz AS date_to
    ),
    reset_cutoff AS (
      SELECT MAX(entry_date) AS cutoff
      FROM cash_ledger
      WHERE source_type = 'period_reset'
    ),
    payment_values AS NOT MATERIALIZED (
      SELECT
        p.id,
        p.payment_number,
        p.payment_date,
        p.direction,
        p.category,
        p.amount,
        p.currency,
        p.exchange_rate,
        p.amount_usd,
        p.amount_cdf,
        p.notes,
        p.linked_entity_name,
        p.member_name,
        p.member_id,
        p.status,
        CASE
          WHEN UPPER(COALESCE(p.currency, 'USD')) = 'USD' THEN COALESCE(p.amount, 0)
          WHEN COALESCE(p.exchange_rate, 0) > 0 THEN COALESCE(p.amount, 0) / p.exchange_rate
          ELSE COALESCE(p.amount_usd, 0)
        END AS effective_usd,
        CASE
          WHEN UPPER(COALESCE(p.currency, 'USD')) = 'CDF' THEN COALESCE(p.amount, 0)
          WHEN COALESCE(p.exchange_rate, 0) > 0 THEN COALESCE(p.amount, 0) * p.exchange_rate
          ELSE COALESCE(p.amount_cdf, 0)
        END AS effective_cdf,
        LOWER(REPLACE(TRIM(COALESCE(NULLIF(p.account, ''), 'cash')), '_', ' ')) IN ('cash', 'physical cash', 'cash account') AS is_cash
      FROM payments p
    ),
    payment_cash AS (
      SELECT
        'payment'::text AS source_type,
        p.id AS source_id,
        p.payment_number AS source_number,
        p.payment_date AS entry_date,
        p.direction,
        COALESCE(NULLIF(TRIM(p.category), ''), 'other') AS category,
        p.amount,
        p.currency,
        p.exchange_rate,
        p.effective_usd AS amount_usd,
        p.effective_cdf AS amount_cdf,
        COALESCE(NULLIF(TRIM(p.notes), ''), NULLIF(TRIM(p.linked_entity_name), ''), NULLIF(TRIM(p.member_name), ''), NULLIF(TRIM(p.category), ''), 'Payment') AS description,
        COALESCE(NULLIF(TRIM(p.linked_entity_name), ''), NULLIF(TRIM(p.member_name), ''), '') AS party
      FROM payment_values p
      WHERE p.status = 'completed'
        AND p.is_cash
        AND ((SELECT cutoff FROM reset_cutoff) IS NULL OR p.payment_date >= (SELECT cutoff FROM reset_cutoff))
        AND ((SELECT date_from FROM bounds) IS NULL OR p.payment_date >= (SELECT date_from FROM bounds))
        AND ((SELECT date_to FROM bounds) IS NULL OR p.payment_date <= (SELECT date_to FROM bounds))
    ),
    voucher_values AS NOT MATERIALIZED (
      SELECT
        v.id,
        v.voucher_number,
        v.voucher_date,
        v.direction,
        v.amount,
        v.currency,
        v.exchange_rate,
        v.amount_usd,
        v.amount_cdf,
        v.description,
        v.category,
        v.voucher_type,
        v.paid_to,
        v.received_from,
        v.linked_entity_name,
        v.linked_entity,
        v.linked_entity_id,
        v.status,
        v.deleted_at,
        CASE
          WHEN UPPER(COALESCE(v.currency, 'USD')) = 'USD' THEN COALESCE(v.amount, 0)
          WHEN COALESCE(v.exchange_rate, 0) > 0 THEN COALESCE(v.amount, 0) / v.exchange_rate
          ELSE COALESCE(v.amount_usd, 0)
        END AS effective_usd,
        CASE
          WHEN UPPER(COALESCE(v.currency, 'USD')) = 'CDF' THEN COALESCE(v.amount, 0)
          WHEN COALESCE(v.exchange_rate, 0) > 0 THEN COALESCE(v.amount, 0) * v.exchange_rate
          ELSE COALESCE(v.amount_cdf, 0)
        END AS effective_cdf,
        LOWER(REPLACE(TRIM(COALESCE(NULLIF(v.account, ''), 'cash')), '_', ' ')) IN ('cash', 'physical cash', 'cash account') AS is_cash
      FROM vouchers v
    ),
    voucher_cash AS (
      SELECT
        'voucher'::text AS source_type,
        v.id AS source_id,
        v.voucher_number AS source_number,
        v.voucher_date AS entry_date,
        v.direction,
        'voucher'::text AS category,
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
        AND v.is_cash
        AND ((SELECT cutoff FROM reset_cutoff) IS NULL OR v.voucher_date >= (SELECT cutoff FROM reset_cutoff))
        AND ((SELECT date_from FROM bounds) IS NULL OR v.voucher_date >= (SELECT date_from FROM bounds))
        AND ((SELECT date_to FROM bounds) IS NULL OR v.voucher_date <= (SELECT date_to FROM bounds))
        AND NOT (
          v.linked_entity = 'member'
          AND v.voucher_type = 'cash_receipt'
          AND EXISTS (
            SELECT 1
            FROM payment_values p2
            WHERE p2.member_id = v.linked_entity_id
              AND p2.category = 'membership'
              AND p2.status = 'completed'
              AND p2.is_cash
              AND UPPER(COALESCE(p2.currency, 'USD')) = UPPER(COALESCE(v.currency, 'USD'))
              AND ABS(COALESCE(p2.amount, 0) - COALESCE(v.amount, 0)) < 0.000001
              AND p2.payment_date >= v.voucher_date::date
              AND p2.payment_date < v.voucher_date::date + INTERVAL '1 day'
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
        'stock_purchase'::text AS category,
        sp.total_cost AS amount,
        sp.currency,
        sp.exchange_rate,
        CASE
          WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'USD' THEN COALESCE(sp.total_cost, 0)
          WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN COALESCE(sp.total_cost, 0) / sp.exchange_rate
          ELSE COALESCE(sp.total_cost_usd, 0)
        END AS amount_usd,
        CASE
          WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'CDF' THEN COALESCE(sp.total_cost, 0)
          WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN COALESCE(sp.total_cost, 0) * sp.exchange_rate
          ELSE COALESCE(sp.total_cost_cdf, 0)
        END AS amount_cdf,
        COALESCE(NULLIF(TRIM(sp.notes), ''), 'Stock purchase: ' || COALESCE(sp.product_name, sp.purchase_number, sp.id::text)) AS description,
        COALESCE(NULLIF(TRIM(sp.supplier), ''), '') AS party
      FROM stock_purchases sp
      WHERE sp.paid_from_cash = 1
        AND ((SELECT cutoff FROM reset_cutoff) IS NULL OR sp.purchase_date >= (SELECT cutoff FROM reset_cutoff))
        AND ((SELECT date_from FROM bounds) IS NULL OR sp.purchase_date >= (SELECT date_from FROM bounds))
        AND ((SELECT date_to FROM bounds) IS NULL OR sp.purchase_date <= (SELECT date_to FROM bounds))
        AND (
          sp.payment_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM payment_values p3
            WHERE p3.id = sp.payment_id
              AND p3.status = 'completed'
              AND p3.is_cash
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
        'supplier_payment'::text AS category,
        sp.amount,
        sp.currency,
        COALESCE(NULLIF(sp.exchange_rate, 0), 1) AS exchange_rate,
        CASE
          WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'USD' THEN COALESCE(sp.amount, 0)
          WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN COALESCE(sp.amount, 0) / sp.exchange_rate
          ELSE COALESCE(sp.amount_usd, 0)
        END AS amount_usd,
        CASE
          WHEN UPPER(COALESCE(sp.currency, 'USD')) = 'CDF' THEN COALESCE(sp.amount, 0)
          WHEN COALESCE(sp.exchange_rate, 0) > 0 THEN COALESCE(sp.amount, 0) * sp.exchange_rate
          ELSE COALESCE(sp.amount_cdf, 0)
        END AS amount_cdf,
        COALESCE(NULLIF(TRIM(sp.notes), ''), 'Supplier payment: ' || COALESCE(sc.supplier, sc.credit_number, sp.id::text)) AS description,
        COALESCE(NULLIF(TRIM(sc.supplier), ''), '') AS party
      FROM supplier_payments sp
      LEFT JOIN supplier_credits sc ON sc.id = sp.credit_id
      WHERE ((SELECT cutoff FROM reset_cutoff) IS NULL OR sp.payment_date >= (SELECT cutoff FROM reset_cutoff))
        AND ((SELECT date_from FROM bounds) IS NULL OR sp.payment_date >= (SELECT date_from FROM bounds))
        AND ((SELECT date_to FROM bounds) IS NULL OR sp.payment_date <= (SELECT date_to FROM bounds))
        AND (sp.payment_id IS NULL OR NOT EXISTS (
          SELECT 1
          FROM payment_values p4
          WHERE p4.id = sp.payment_id
            AND p4.status = 'completed'
            AND p4.is_cash
        ))
    ),
    opening_cash AS (
      SELECT
        'opening_balance'::text AS source_type,
        cl.id AS source_id,
        cl.source_number,
        cl.entry_date,
        cl.direction,
        'opening_balance'::text AS category,
        cl.amount,
        cl.currency,
        cl.exchange_rate,
        CASE
          WHEN UPPER(COALESCE(cl.currency, 'USD')) = 'USD' THEN COALESCE(cl.amount, 0)
          WHEN COALESCE(cl.exchange_rate, 0) > 0 THEN COALESCE(cl.amount, 0) / cl.exchange_rate
          ELSE COALESCE(cl.amount_usd, 0)
        END AS amount_usd,
        CASE
          WHEN UPPER(COALESCE(cl.currency, 'USD')) = 'CDF' THEN COALESCE(cl.amount, 0)
          WHEN COALESCE(cl.exchange_rate, 0) > 0 THEN COALESCE(cl.amount, 0) * cl.exchange_rate
          ELSE COALESCE(cl.amount_cdf, 0)
        END AS amount_cdf,
        COALESCE(NULLIF(TRIM(cl.description), ''), 'Opening cash balance') AS description,
        'Opening balance'::text AS party
      FROM cash_ledger cl
      WHERE cl.source_type = 'opening_balance'
        AND ((SELECT cutoff FROM reset_cutoff) IS NULL OR cl.entry_date >= (SELECT cutoff FROM reset_cutoff))
        AND ((SELECT date_from FROM bounds) IS NULL OR cl.entry_date >= (SELECT date_from FROM bounds))
        AND ((SELECT date_to FROM bounds) IS NULL OR cl.entry_date <= (SELECT date_to FROM bounds))
    )
    SELECT * FROM payment_cash
    UNION ALL SELECT * FROM voucher_cash
    UNION ALL SELECT * FROM stock_cash
    UNION ALL SELECT * FROM supplier_cash
    UNION ALL SELECT * FROM opening_cash
    ORDER BY entry_date ASC, source_type ASC, source_id ASC
  `);

  const configuredRate = await getExchangeRate(executor);
  const fallbackRate = configuredRate >= 10 ? configuredRate : 2800;

  type RawMovement = {
    source_type?: string;
    source_id?: number | string | null;
    source_number?: string | null;
    entry_date?: Date | string;
    direction?: string;
    category?: string | null;
    amount?: number | string;
    currency?: string;
    exchange_rate?: number | string;
    amount_usd?: number | string;
    amount_cdf?: number | string;
    description?: string | null;
    party?: string | null;
  };

  return (result.rows as RawMovement[]).map((row) => {
    const amount = money(Number(row.amount ?? 0));
    const nativeCurrency = (row.currency ?? "USD").toUpperCase();
    const currency = nativeCurrency === "USD" ? "USD" : "CDF";
    const storedRate = Number(row.exchange_rate ?? 0);
    const rate = storedRate >= 10 ? fxRate(storedRate) : fallbackRate;
    const converted = toUsdCdf(amount, currency, rate);

    return {
      sourceType: row.source_type ?? "cash",
      sourceId: row.source_id == null ? null : Number(row.source_id),
      sourceNumber: row.source_number ?? null,
      date: row.entry_date instanceof Date ? row.entry_date : new Date(row.entry_date ?? 0),
      direction: row.direction === "out" ? "out" : "in",
      category: row.category ?? "other",
      amount,
      currency,
      exchangeRate: rate,
      amountUsd: converted.amountUsd,
      amountCdf: converted.amountCdf,
      description: row.description ?? "",
      party: row.party ?? "",
    };
  });
}

/**
 * Revalue the canonical native cash stream using the one live USD/CDF rate from
 * Settings. Stored transaction rates stay intact for audit/accounting history;
 * these values are the current display equivalents used by Cash Book/Accounts.
 */
export async function getCurrentCashMovements(
  executor: DbExecutor = db,
  range: CashMovementRange = {},
): Promise<{
  exchangeRate: number;
  movements: CashMovement[];
}> {
  const movements = await getCashMovements(executor, range);
  const exchangeRate = await getExchangeRate(executor);
  return {
    exchangeRate,
    movements: movements.map((movement) => ({
      ...movement,
      exchangeRate,
      ...toUsdCdf(movement.amount, movement.currency, exchangeRate),
    })),
  };
}

export async function getCurrentBalance(executor: DbExecutor = db): Promise<{ balanceUsd: number; balanceCdf: number }> {
  const { movements } = await getCurrentCashMovements(executor);
  return movements.reduce(
    (balance, movement) => ({
      balanceUsd: movement.direction === "in" ? addMoney(balance.balanceUsd, movement.amountUsd) : subtractMoney(balance.balanceUsd, movement.amountUsd),
      balanceCdf: movement.direction === "in" ? addMoney(balance.balanceCdf, movement.amountCdf) : subtractMoney(balance.balanceCdf, movement.amountCdf),
    }),
    { balanceUsd: 0, balanceCdf: 0 },
  );
}
