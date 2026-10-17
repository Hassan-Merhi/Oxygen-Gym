-- Oxygen Gym | Historical cash restoration: ELIGIBILITY PREVIEW ONLY
-- This file contains SELECTs only and does NOT modify any database records.
-- IMPORTANT: Do not replay the 0007 ledger-cutover migration to fix this issue.
-- Before any backfill, reconcile the historical cash adjustment dated 2026-07-02,
-- validate USD/CDF physical cash counts, and back up the production database.

-- A. Confirm the exact amount/count of missing payment journals, classified
-- against independently existing legacy cash movements. A complete source
-- document alone is not proof that cash was physically received.
WITH missing AS (
  SELECT p.id, p.payment_number, p.payment_date, UPPER(p.currency) currency,
         p.amount, p.exchange_rate, p.account, p.member_id,
         (SELECT SUM(CASE WHEN cl.direction='in' THEN cl.amount ELSE -cl.amount END)
            FROM cash_ledger cl
           WHERE cl.source_type IN ('payment', 'payment_correction', 'payment_reversal')
             AND cl.source_id=p.id AND UPPER(cl.currency)=UPPER(p.currency)
         ) AS legacy_same_currency_amount,
         (SELECT COUNT(*) FROM cash_ledger cl
           WHERE cl.source_type IN ('payment','payment_correction','payment_reversal')
             AND cl.source_id=p.id AND UPPER(cl.currency) <> UPPER(p.currency)
         ) AS legacy_wrong_currency_rows
  FROM payments p
  WHERE p.status='completed' AND p.direction='in'
    AND p.category='membership' AND p.amount>0
    AND LOWER(REPLACE(TRIM(COALESCE(NULLIF(p.account,''),'cash')),'_',' '))
          IN ('cash','cash account','physical cash')
    AND NOT EXISTS (
      SELECT 1 FROM accounting_entries e
      WHERE e.source_id=p.id
        AND e.source_type IN ('payment','payment_correction','payment_reversal',
                              'payment_void','void_payment')
    )
), classified AS (
  SELECT *,
    CASE
      WHEN payment_date>now() THEN 'FUTURE_DATE_REVIEW'
      WHEN exchange_rate IS NULL OR exchange_rate < 10 THEN 'INVALID_HISTORICAL_FX'
      WHEN legacy_wrong_currency_rows>0 THEN 'LEGACY_CURRENCY_CONFLICT'
      WHEN legacy_same_currency_amount IS NULL THEN 'NO_LEGACY_CASH_EVIDENCE'
      WHEN ABS(legacy_same_currency_amount-amount)>0.000001 THEN 'LEGACY_NATIVE_AMOUNT_MISMATCH'
      ELSE 'LEGACY_MATCH_EXACT__REVIEW_FOR_POSTING'
    END AS review_status
  FROM missing
)
SELECT currency, review_status, COUNT(*) AS payments,
       ROUND(SUM(amount)::numeric,6) AS native_amount,
       MIN(payment_date) AS oldest, MAX(payment_date) AS newest
FROM classified
GROUP BY currency, review_status ORDER BY currency, review_status;

-- B. Missing POS journals, checked against legacy sale cash movements. The
-- expense side must also be rebuilt for stock cost and inventory if approved.
WITH missing AS (
  SELECT s.id,s.sale_number,s.sale_date,UPPER(s.currency) currency,
         s.total_amount,s.cost_total,s.exchange_rate,
         (SELECT SUM(CASE WHEN cl.direction='in' THEN cl.amount ELSE -cl.amount END)
            FROM cash_ledger cl
           WHERE cl.source_type IN ('sale','sale_correction','sale_reversal','void_sale')
             AND cl.source_id=s.id AND UPPER(cl.currency)=UPPER(s.currency)
         ) AS legacy_same_currency_amount,
         (SELECT COUNT(*) FROM cash_ledger cl
           WHERE cl.source_type IN ('sale','sale_correction','sale_reversal','void_sale')
             AND cl.source_id=s.id AND UPPER(cl.currency)<>UPPER(s.currency)
         ) AS legacy_wrong_currency_rows
  FROM sales s
  WHERE s.status='completed' AND s.total_amount>0
    AND NOT EXISTS (
      SELECT 1 FROM accounting_entries e WHERE e.source_id=s.id
        AND e.source_type IN ('sale','sale_correction','sale_reversal',
                              'sale_void','void_sale')
    )
), classified AS (
  SELECT *,
    CASE
      WHEN sale_date>now() THEN 'FUTURE_DATE_REVIEW'
      WHEN exchange_rate IS NULL OR exchange_rate<10 THEN 'INVALID_HISTORICAL_FX'
      WHEN cost_total<0 THEN 'INVALID_STOCK_COST'
      WHEN legacy_wrong_currency_rows>0 THEN 'LEGACY_CURRENCY_CONFLICT'
      WHEN legacy_same_currency_amount IS NULL THEN 'NO_LEGACY_CASH_EVIDENCE'
      WHEN ABS(legacy_same_currency_amount-total_amount)>0.000001 THEN 'LEGACY_NATIVE_AMOUNT_MISMATCH'
      ELSE 'LEGACY_MATCH_EXACT__REVIEW_FOR_POSTING'
    END review_status
  FROM missing
)
SELECT currency,review_status,COUNT(*) AS sales,
       ROUND(SUM(total_amount)::numeric,6) AS gross_native,
       ROUND(SUM(cost_total)::numeric,6) AS cogs_native,
       MIN(sale_date) AS oldest, MAX(sale_date) AS newest
FROM classified
GROUP BY currency,review_status ORDER BY currency,review_status;

-- C. Historical cash ledger entries with different currency from the
-- referenced current payment. This is often a legacy correction and
-- MUST NOT be blindly treated as a current USD transaction.
SELECT cl.id AS old_cash_entry_id, cl.source_id AS payment_id,
       p.payment_number,p.payment_date,
       UPPER(cl.currency) AS legacy_currency,
       UPPER(p.currency) AS document_currency,
       cl.amount AS legacy_native_amount,p.amount AS document_native_amount,
       cl.direction,cl.source_type
FROM cash_ledger cl
JOIN payments p ON p.id=cl.source_id
WHERE cl.source_type IN ('payment','payment_correction','payment_reversal')
  AND UPPER(cl.currency)<>UPPER(p.currency)
ORDER BY cl.entry_date DESC,cl.id DESC LIMIT 100;

-- D. Confirm original source-document cash accounts and historical journals
-- do not indicate a manually posted receipt via any alternative source family.
SELECT p.id,p.payment_number,p.currency,p.amount,p.account,p.payment_date,
       p.member_id,p.member_name
FROM payments p
WHERE p.status='completed' AND p.direction='in' AND p.category='membership'
  AND p.amount>0
  AND NOT EXISTS (
    SELECT 1 FROM accounting_entries e WHERE e.source_id=p.id
      AND e.source_type IN ('payment','payment_correction','payment_reversal',
                            'payment_void','void_payment')
  )
  AND NOT EXISTS (
    SELECT 1 FROM cash_ledger cl
    WHERE cl.source_id=p.id AND cl.source_type='payment'
  )
ORDER BY p.payment_date,p.id LIMIT 100;

-- E. Verify migration state in either common schema. A missing marker is not
-- proof of a missing migration until deploy logs are also reconciled.
SELECT to_regclass('drizzle.__drizzle_migrations')::text AS drizzle_schema_history,
       to_regclass('public.__drizzle_migrations')::text AS public_schema_history,
       COUNT(*) FILTER (WHERE journal_id LIKE 'cutover:%') AS cutover_ledger_entries,
       COUNT(*) FILTER (WHERE source_type='cutover_reconciliation') AS cutover_cash_adjustments
FROM accounting_entries;

-- F. Inventory and other balances must also reconcile after restoring sales.
-- This prevents a cash-only 'fix' that corrupts inventory valuation or profit.
SELECT lower(a.name) AS account,
       ROUND(SUM(e.debit_usd-e.credit_usd)::numeric,6) AS signed_book_usd,
       ROUND(SUM(e.debit_cdf-e.credit_cdf)::numeric,6) AS signed_book_cdf
FROM accounting_entries e JOIN chart_of_accounts a ON a.id=e.account_id
WHERE lower(a.name) IN ('cash','inventory','sales revenue','membership revenue',
                        'cost of goods sold','opening balance equity','cash over/short')
GROUP BY lower(a.name) ORDER BY account;

-- Stop here until the source-document groups, FX, inventory and actual cash
-- count have been reviewed. Historical receipt restoration must be append-only,
-- in balanced journals, with source-id idempotency and a verified backup.
