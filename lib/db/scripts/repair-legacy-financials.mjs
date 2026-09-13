import pg from "pg";

const { Pool } = pg;
const CONFIRMATION = "repair_legacy_financials_v1";

if (process.env.DB_REPAIR_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Refusing to run legacy financial repair. Set DB_REPAIR_CONFIRM=${CONFIRMATION} explicitly.`,
  );
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running a repair script.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('oxygen_gym_legacy_financial_repair_v1'))");

  const paymentDateBackfill = await client.query(`
    UPDATE payments
    SET payment_date = m.start_date
    FROM members m
    WHERE payments.member_id = m.id
      AND m.start_date IS NOT NULL
      AND payments.category = 'membership'
      AND DATE(payments.payment_date AT TIME ZONE 'UTC')
          <> DATE(m.start_date AT TIME ZONE 'UTC')
  `);

  const paymentFxRepair = await client.query(`
    WITH rate AS (
      SELECT COALESCE((SELECT usd_to_cdf_rate FROM settings LIMIT 1), 2800) AS r
    )
    UPDATE payments
    SET amount_usd = amount / (SELECT r FROM rate),
        amount_cdf = amount,
        exchange_rate = (SELECT r FROM rate)
    WHERE currency = 'CDF'
      AND exchange_rate < 10
  `);

  const saleFxRepair = await client.query(`
    WITH rate AS (
      SELECT COALESCE((SELECT usd_to_cdf_rate FROM settings LIMIT 1), 2800) AS r
    )
    UPDATE sales
    SET total_amount_usd = total_amount / (SELECT r FROM rate),
        cost_total_usd = cost_total / (SELECT r FROM rate),
        total_profit_usd = total_profit / (SELECT r FROM rate),
        exchange_rate = (SELECT r FROM rate)
    WHERE currency = 'CDF'
      AND exchange_rate < 10
  `);

  const duplicateVoucherRepair = await client.query(`
    UPDATE vouchers
    SET status = 'cancelled', updated_at = NOW()
    WHERE linked_entity = 'member'
      AND voucher_type = 'cash_receipt'
      AND status = 'recorded'
      AND deleted_at IS NULL
      AND id NOT IN (
        SELECT DISTINCT ON (linked_entity_id) id
        FROM vouchers
        WHERE linked_entity = 'member'
          AND voucher_type = 'cash_receipt'
          AND status = 'recorded'
          AND deleted_at IS NULL
        ORDER BY linked_entity_id, id DESC
      )
  `);

  const salePaymentBackfill = await client.query(`
    INSERT INTO payments (
      payment_number, direction, category, type,
      linked_entity, linked_entity_id, linked_entity_name,
      amount, currency, exchange_rate, amount_usd, amount_cdf,
      account, notes, payment_date, status, created_by
    )
    SELECT
      'BF-SALE-' || s.id,
      'in',
      'product_sale',
      'product_sale',
      'sale',
      s.id,
      COALESCE(s.sale_number, 'SALE-' || s.id),
      s.total_amount,
      s.currency,
      CASE
        WHEN COALESCE(s.exchange_rate, 0) >= 10 THEN s.exchange_rate
        ELSE COALESCE((SELECT usd_to_cdf_rate FROM settings LIMIT 1), 2800)
      END,
      CASE
        WHEN s.currency = 'USD' THEN s.total_amount
        ELSE s.total_amount / CASE
          WHEN COALESCE(s.exchange_rate, 0) >= 10 THEN s.exchange_rate
          ELSE COALESCE((SELECT usd_to_cdf_rate FROM settings LIMIT 1), 2800)
        END
      END,
      CASE
        WHEN s.currency = 'CDF' THEN s.total_amount
        ELSE s.total_amount * CASE
          WHEN COALESCE(s.exchange_rate, 0) >= 10 THEN s.exchange_rate
          ELSE COALESCE((SELECT usd_to_cdf_rate FROM settings LIMIT 1), 2800)
        END
      END,
      'cash',
      'Historical sale payment backfill',
      s.sale_date,
      'completed',
      s.created_by
    FROM sales s
    WHERE s.status = 'completed'
      AND NOT EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.linked_entity = 'sale'
          AND p.linked_entity_id = s.id
          AND p.status = 'completed'
      )
    ON CONFLICT (payment_number) DO NOTHING
  `);

  await client.query("COMMIT");

  console.log("Legacy financial repair completed.", {
    paymentDatesBackfilled: paymentDateBackfill.rowCount ?? 0,
    cdfPaymentsRepaired: paymentFxRepair.rowCount ?? 0,
    cdfSalesRepaired: saleFxRepair.rowCount ?? 0,
    duplicateVouchersCancelled: duplicateVoucherRepair.rowCount ?? 0,
    salePaymentsBackfilled: salePaymentBackfill.rowCount ?? 0,
  });
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Legacy financial repair failed; transaction rolled back.", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
