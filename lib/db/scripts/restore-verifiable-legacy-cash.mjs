/**
 * Oxygen Gym historical accounting recovery (17 Oct 2026 evidence set).
 *
 * A conservative one-time, append-only backfill of receipts already present in
 * both a completed source document and its historical cash_ledger source entry.
 *
 * This does NOT assert actual notes in the till, set an opening balance, remove
 * legacy postings, overwrite a source document, or apply FX at today's rate.
 *
 * Executed after schema migrations by the production API. All postings are
 * grouped into balanced journals; the transaction is fully rolled back if any
 * statement or journal constraint fails. Repeated starts are idempotent.
 */
import pg from "pg";

const { Pool } = pg;
const REPAIR_BY = "system:cash-source-recovery-20261017";
const CUTOFF = "2026-10-17T08:30:57Z";
const FIRST_DATE = "2026-06-01T00:00:00Z";

if (!process.env.DATABASE_URL) {
  throw new Error("Historical source recovery requires DATABASE_URL");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

const paymentRecovery = `
WITH historic AS (
  SELECT source_id, UPPER(currency) AS currency,
         SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) AS net_native
  FROM cash_ledger
  WHERE source_type IN ('payment','payment_correction','payment_reversal')
    AND source_id IS NOT NULL
  GROUP BY source_id, UPPER(currency)
),
verified AS (
  SELECT p.id, p.payment_number, p.payment_date, p.amount::numeric AS native,
         UPPER(p.currency) AS currency, p.exchange_rate::numeric AS rate
  FROM payments p
  JOIN historic h ON h.source_id = p.id
                AND h.currency = UPPER(p.currency)
                AND ABS(h.net_native - p.amount::numeric) < 0.000001
  WHERE p.category = 'membership' AND p.direction = 'in'
    AND p.status = 'completed' AND p.amount > 0
    AND p.payment_date >= $1::timestamptz
    AND p.payment_date <= NOW()
    AND p.created_at <= $2::timestamptz
    AND UPPER(p.currency) IN ('USD','CDF')
    AND p.exchange_rate >= 10
    AND LOWER(REPLACE(TRIM(COALESCE(NULLIF(p.account, ''), 'cash')), '_', ' '))
        IN ('cash', 'cash account', 'physical cash')
    AND (p.linked_entity IS NULL OR p.linked_entity NOT IN
      ('sale','payroll','supplier_payment','stock_purchase'))
    AND NOT EXISTS (
      SELECT 1 FROM cash_ledger other
      WHERE other.source_id = p.id
        AND other.source_type IN ('payment','payment_correction','payment_reversal')
        AND UPPER(other.currency) <> UPPER(p.currency)
    )
    AND NOT EXISTS (
      SELECT 1 FROM accounting_entries e
      WHERE e.source_id = p.id
        AND e.source_type IN ('payment','payment_correction','payment_reversal',
                              'payment_void','void_payment')
    )
    AND NOT EXISTS (
      SELECT 1 FROM vouchers v
      WHERE v.linked_entity = 'member'
        AND v.linked_entity_id = p.member_id
        AND v.status = 'recorded' AND v.deleted_at IS NULL
        AND UPPER(v.currency) = UPPER(p.currency)
        AND ABS(v.amount::numeric - p.amount::numeric) < 0.000001
        AND (v.voucher_date AT TIME ZONE 'Africa/Lubumbashi')::date =
            (p.payment_date AT TIME ZONE 'Africa/Lubumbashi')::date
    )
    AND NOT EXISTS (
      SELECT 1 FROM accounting_periods a WHERE a.closed_through >= p.payment_date
    )
),
posting AS (
  SELECT p.*, v.account_name, v.side, v.native,
         CASE WHEN p.currency = 'USD' THEN v.native ELSE ROUND(v.native / p.rate, 6) END AS book_usd,
         CASE WHEN p.currency = 'CDF' THEN v.native ELSE ROUND(v.native * p.rate, 6) END AS book_cdf
  FROM verified p
  CROSS JOIN LATERAL (VALUES
    ('Cash','debit',p.native),
    ('Membership Revenue','credit',p.native)
  ) AS v(account_name, side, native)
)
INSERT INTO accounting_entries
  (journal_id,entry_date,source_type,source_id,source_number,
   account_id,account_name_snapshot,debit_usd,credit_usd,
   debit_cdf,credit_cdf,currency,amount,exchange_rate,description,created_by)
SELECT 'legacy-restore:payment:' || p.id, p.payment_date, 'payment', p.id, p.payment_number,
       a.id,a.name,
       CASE WHEN p.side='debit' THEN p.book_usd ELSE 0 END,
       CASE WHEN p.side='credit' THEN p.book_usd ELSE 0 END,
       CASE WHEN p.side='debit' THEN p.book_cdf ELSE 0 END,
       CASE WHEN p.side='credit' THEN p.book_cdf ELSE 0 END,
       p.currency,p.native,p.rate,
       'Verified legacy membership cash receipt; append-only historical journal recovery',
       $3
FROM posting p JOIN chart_of_accounts a ON a.name=p.account_name
RETURNING source_id, currency, amount
`;

const saleRecovery = `
WITH historic AS (
  SELECT source_id, UPPER(currency) AS currency,
         SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) AS net_native
  FROM cash_ledger
  WHERE source_type IN ('sale','sale_correction','sale_reversal','void_sale')
    AND source_id IS NOT NULL
  GROUP BY source_id, UPPER(currency)
),
verified AS (
  SELECT s.id, s.sale_number, s.sale_date, s.total_amount::numeric AS native,
         s.cost_total::numeric AS cogs,
         UPPER(s.currency) AS currency, s.exchange_rate::numeric AS rate
  FROM sales s
  JOIN historic h ON h.source_id = s.id
                AND h.currency = UPPER(s.currency)
                AND ABS(h.net_native - s.total_amount::numeric) < 0.000001
  WHERE s.status = 'completed' AND s.total_amount > 0 AND s.cost_total >= 0
    AND s.sale_date >= $1::timestamptz
    AND s.sale_date <= NOW()
    AND s.created_at <= $2::timestamptz
    AND UPPER(s.currency) IN ('USD','CDF')
    AND s.exchange_rate >= 10
    AND NOT EXISTS (
      SELECT 1 FROM cash_ledger other
      WHERE other.source_id = s.id
        AND other.source_type IN ('sale','sale_correction','sale_reversal','void_sale')
        AND UPPER(other.currency) <> UPPER(s.currency)
    )
    AND NOT EXISTS (
      SELECT 1 FROM accounting_entries e
      WHERE e.source_id = s.id
        AND e.source_type IN ('sale','sale_correction','sale_reversal',
                              'sale_void','void_sale')
    )
    AND NOT EXISTS (
      SELECT 1 FROM accounting_periods a WHERE a.closed_through >= s.sale_date
    )
),
posting AS (
  SELECT s.*, v.account_name, v.side, v.entry_native,
         CASE WHEN s.currency = 'USD' THEN v.entry_native ELSE ROUND(v.entry_native / s.rate, 6) END AS book_usd,
         CASE WHEN s.currency = 'CDF' THEN v.entry_native ELSE ROUND(v.entry_native * s.rate, 6) END AS book_cdf
  FROM verified s
  CROSS JOIN LATERAL (VALUES
    ('Cash','debit',s.native),
    ('Sales Revenue','credit',s.native),
    ('Cost of Goods Sold','debit',s.cogs),
    ('Inventory','credit',s.cogs)
  ) AS v(account_name, side, entry_native)
  WHERE v.entry_native > 0
)
INSERT INTO accounting_entries
  (journal_id,entry_date,source_type,source_id,source_number,
   account_id,account_name_snapshot,debit_usd,credit_usd,
   debit_cdf,credit_cdf,currency,amount,exchange_rate,description,created_by)
SELECT 'legacy-restore:sale:' || p.id, p.sale_date, 'sale', p.id, p.sale_number,
       a.id,a.name,
       CASE WHEN p.side='debit' THEN p.book_usd ELSE 0 END,
       CASE WHEN p.side='credit' THEN p.book_usd ELSE 0 END,
       CASE WHEN p.side='debit' THEN p.book_cdf ELSE 0 END,
       CASE WHEN p.side='credit' THEN p.book_cdf ELSE 0 END,
       p.currency,p.entry_native,p.rate,
       'Verified legacy POS sale; restores cash/revenue and cost/inventory',
       $3
FROM posting p JOIN chart_of_accounts a ON a.name=p.account_name
RETURNING source_id, currency, amount
`;

async function nativeCash(client) {
  const result = await client.query(`
    SELECT UPPER(e.currency) AS currency,
           COALESCE(SUM(CASE WHEN e.debit_usd > 0 OR e.debit_cdf > 0
                             THEN e.amount ELSE -e.amount END),0) AS native_cash
    FROM accounting_entries e
    JOIN chart_of_accounts a ON a.id = e.account_id
    WHERE LOWER(a.name)='cash'
    GROUP BY UPPER(e.currency)
    ORDER BY currency
  `);
  return Object.fromEntries(result.rows.map(row => [row.currency, row.native_cash]));
}

function summarize(rows) {
  const byCurrency = {};
  const ids = new Set();
  for (const row of rows) {
    ids.add(row.source_id);
  }
  for (const currency of ["USD", "CDF"]) {
    const subset = rows.filter(row => row.currency === currency);
    // Every matching receipt/sale emits exactly one Cash debit line.
    // The source_id set is counted separately from ledger rows.
    byCurrency[currency] = {
      journalLines: subset.length,
      documents: new Set(subset.map(row => row.source_id)).size,
    };
  }
  return { totalDocuments: ids.size, byCurrency };
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('oxygen-gym:financial-write',0))");
  // The 0007 cutover can add a cash/equity balancing entry that already
  // incorporates source documents. Do NOT count them again on top of it.
  // Explicit cash-only barrier. The previous version mistakenly treated
  // Inventory/Supplier Payables cutover reconciliations as cash adjustments,
  // skipping every missing membership and POS journal on those databases.
  const offsets = await client.query(`
    SELECT e.source_type, e.source_number,
           UPPER(e.currency) AS currency, COUNT(*)::integer AS n,
           COALESCE(SUM(
             CASE WHEN e.debit_usd > 0 OR e.debit_cdf > 0
               THEN e.amount ELSE -e.amount END
           ),0) AS cash_delta
    FROM accounting_entries e
    JOIN chart_of_accounts a ON a.id = e.account_id
    WHERE LOWER(a.name) = 'cash'
      AND (
        e.source_type IN ('cash_count','opening_balance')
        OR (e.source_type='cutover_reconciliation'
            AND e.source_number IN ('CUTOVER-CASH-USD','CUTOVER-CASH-CDF'))
      )
    GROUP BY e.source_type,e.source_number,UPPER(e.currency)
  `);
  const missing = await client.query(`
    SELECT 'payment' AS source_type, COUNT(*)::integer AS missing_count
      FROM payments p
     WHERE p.category='membership' AND p.status='completed'
       AND p.direction='in' AND p.amount>0
       AND NOT EXISTS (
         SELECT 1 FROM accounting_entries e
          WHERE e.source_id=p.id AND e.source_type IN
          ('payment','payment_correction','payment_reversal',
           'payment_void','void_payment')
       )
    UNION ALL
    SELECT 'sale' AS source_type, COUNT(*)::integer AS missing_count
      FROM sales s
     WHERE s.status='completed' AND s.total_amount>0
       AND NOT EXISTS (
         SELECT 1 FROM accounting_entries e
          WHERE e.source_id=s.id AND e.source_type IN
          ('sale','sale_correction','sale_reversal','sale_void','void_sale')
       )
  `);
  const current = await nativeCash(client);
  console.log("CASH_RECOVERY_PRECHECK", JSON.stringify({
    missingSourceJournals: missing.rows,
    cashAdjustments: offsets.rows,
    nativeCash: current,
  }));
  if (offsets.rows.length) {
    // An existing cash/equity offset may ALREADY include missing historical
    // receipts. Never double count those receipts by appending them again.
    console.log("CASH_RECOVERY_SKIPPED: existing CASH count/opening/cutover journals require matching against source receipts before a backfill.", JSON.stringify({
      offsets: offsets.rows, nativeCash: current, missingSourceJournals: missing.rows,
    }));
    await client.query("ROLLBACK");
  } else {
    const expected = [
      ["Cash","asset"],["Membership Revenue","income"],["Sales Revenue","income"],
      ["Cost of Goods Sold","expense"],["Inventory","asset"],
    ];
    const accounts = await client.query("SELECT name,type FROM chart_of_accounts WHERE name=ANY($1::text[])",[expected.map(x=>x[0])]);
    for (const [name,type] of expected) {
      if (!accounts.rows.some(row => row.name===name && row.type===type)) {
        throw new Error(`CASH_RECOVERY_BLOCKED: missing or incorrectly classified ${name} chart account`);
      }
    }
    const before = await nativeCash(client);
    const paymentResult = await client.query(paymentRecovery,[FIRST_DATE,CUTOFF,REPAIR_BY]);
    const saleResult = await client.query(saleRecovery,[FIRST_DATE,CUTOFF,REPAIR_BY]);
    const after = await nativeCash(client);
    await client.query("COMMIT");
    console.log("CASH_RECOVERY_COMPLETED",JSON.stringify({
      verifiedMemberships: summarize(paymentResult.rows),
      verifiedSales: summarize(saleResult.rows),
      priorNativeCash: before,
      newNativeCash: after,
      note: "Document-based ledger recovery; not an independently counted cash drawer. Unmatched documents and historical opening adjustment remain for manual reconciliation.",
    }));
  }
} catch (error) {
  await client.query("ROLLBACK").catch(()=>{});
  console.error("CASH_RECOVERY_ROLLED_BACK",error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
