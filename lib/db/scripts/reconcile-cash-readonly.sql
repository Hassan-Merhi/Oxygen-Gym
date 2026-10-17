-- Oxygen Gym: Cash reconciliation / diagnostic ONLY
-- Safe for TablePlus: SELECT statements, no UPDATE/INSERT/DELETE.
-- Run on the actual Oxygen Gym production database (NOT ERP/Factory).
-- Cash is tracked in *native* USD and CDF independently.
-- The booked USD/CDF equivalents are valuations, NOT additional notes in the drawer.
-- IMPORTANT: A negative balance is evidence to investigate, NOT grounds to invent an opening balance.

-- 1. All-time native cash, book values, and inflow/outflow totals by currency.
WITH cash_lines AS (
  SELECT e.*,
         CASE WHEN e.debit_usd > 0 OR e.debit_cdf > 0 THEN 1 ELSE -1 END AS sign
  FROM accounting_entries e
  LEFT JOIN chart_of_accounts a ON a.id = e.account_id
  WHERE lower(coalesce(a.name, e.account_name_snapshot, '')) = 'cash'
)
SELECT upper(currency) AS currency,
       count(*) FILTER (WHERE amount <> 0) AS native_movements,
       round(sum(CASE WHEN sign = 1 THEN amount ELSE 0 END)::numeric, 6) AS cash_received,
       round(sum(CASE WHEN sign = -1 THEN amount ELSE 0 END)::numeric, 6) AS cash_paid,
       round(sum(sign * amount)::numeric, 6) AS physical_currency_balance,
       round(sum(debit_usd - credit_usd)::numeric, 6) AS book_value_usd,
       round(sum(debit_cdf - credit_cdf)::numeric, 6) AS book_value_cdf
FROM cash_lines
GROUP BY upper(currency) ORDER BY currency;

-- 2. Break down the cash balance by source and currency. Pay special
-- attention to cutover, opening_balance, cash_count, correction and reversal.
WITH cash_lines AS (
  SELECT e.*,
         CASE WHEN e.debit_usd > 0 OR e.debit_cdf > 0 THEN 1 ELSE -1 END AS sign
  FROM accounting_entries e
  LEFT JOIN chart_of_accounts a ON a.id = e.account_id
  WHERE lower(coalesce(a.name, e.account_name_snapshot, '')) = 'cash'
)
SELECT upper(currency) AS currency, source_type, count(*) AS lines,
       round(sum(CASE WHEN sign = 1 THEN amount ELSE 0 END)::numeric, 6) AS in_native,
       round(sum(CASE WHEN sign = -1 THEN amount ELSE 0 END)::numeric, 6) AS out_native,
       round(sum(sign * amount)::numeric, 6) AS net_native,
       min(entry_date) AS earliest_entry, max(entry_date) AS latest_entry
FROM cash_lines
GROUP BY upper(currency), source_type
ORDER BY upper(currency), abs(sum(sign * amount)) DESC, source_type;

-- 3. Every point where the physical USD/CDF balance first crossed below zero.
-- Look at the source number and entry date of the FIRST crossing, not just
-- the current total. Corrections/backdated entries can move this threshold.
WITH cash_lines AS (
  SELECT e.id, e.journal_id, e.entry_date, e.source_type, e.source_id,
         e.source_number, e.description, e.currency, e.amount,
         CASE WHEN e.debit_usd > 0 OR e.debit_cdf > 0 THEN e.amount ELSE -e.amount END AS signed_native
  FROM accounting_entries e
  LEFT JOIN chart_of_accounts a ON a.id = e.account_id
  WHERE lower(coalesce(a.name, e.account_name_snapshot, '')) = 'cash'
    AND upper(e.currency) IN ('USD', 'CDF') AND e.amount <> 0
), running AS (
  SELECT *,
         sum(signed_native) OVER (PARTITION BY upper(currency) ORDER BY entry_date, id
                                 ROWS UNBOUNDED PRECEDING) AS running_native
  FROM cash_lines
), crossings AS (
  SELECT *, lag(running_native, 1, 0::numeric)
                  OVER (PARTITION BY upper(currency) ORDER BY entry_date, id) AS previous_native
  FROM running
)
SELECT upper(currency) AS currency, entry_date, id AS entry_id,
       journal_id, source_type, source_id, source_number, description,
       signed_native, previous_native, running_native
FROM crossings
WHERE running_native < 0 AND previous_native >= 0
ORDER BY entry_date, entry_id LIMIT 100;

-- 4. Largest USD cash OUT entries (use source_number to verify supporting
-- payment, voucher, payroll, or stock records against the physical drawer).
SELECT e.id AS entry_id, e.entry_date, e.source_type, e.source_id,
       e.source_number, e.description, e.journal_id, e.currency,
       e.amount AS usd_paid
FROM accounting_entries e
LEFT JOIN chart_of_accounts a ON a.id = e.account_id
WHERE lower(coalesce(a.name, e.account_name_snapshot, '')) = 'cash'
  AND upper(e.currency) = 'USD'
  AND (e.credit_usd > 0 OR e.credit_cdf > 0)
  AND e.amount > 0
ORDER BY e.amount DESC, e.entry_date DESC LIMIT 100;

-- 5. Completed standalone cash payments that are missing ANY journal rows.
-- POS-linked payments are excluded: their CASH journal uses the SALE source ID.
SELECT p.id, p.payment_number, p.payment_date, p.category, p.direction,
       p.currency, p.amount, p.account, p.linked_entity
FROM payments p
WHERE p.status = 'completed' AND coalesce(p.amount, 0) > 0
  AND lower(replace(trim(coalesce(nullif(p.account, ''), 'cash')), '_', ' '))
      IN ('cash', 'cash account', 'physical cash')
  AND coalesce(p.linked_entity, '') NOT IN ('sale', 'payroll', 'supplier_payment', 'stock_purchase')
  AND NOT EXISTS (
    SELECT 1 FROM accounting_entries e
    WHERE e.source_id = p.id
      AND e.source_type IN ('payment', 'payment_correction',
                            'payment_reversal', 'payment_void', 'void_payment')
  )
ORDER BY p.payment_date, p.id;

-- 6. POS sale with two different CASH-posting families (possible double-post).
-- Having a payment DOCUMENT and a sale JOURNAL is normal; this only flags
-- cases where BOTH are actually posted as cash movements.
SELECT s.id AS sale_id, s.sale_number, s.sale_date, s.currency,
       s.total_amount, p.id AS payment_id,
       count(DISTINCT e_sale.id) AS sale_cash_lines,
       count(DISTINCT e_payment.id) AS payment_cash_lines
FROM sales s
JOIN payments p ON p.linked_entity = 'sale' AND p.linked_entity_id = s.id
JOIN accounting_entries e_sale ON e_sale.source_id = s.id
  AND e_sale.source_type IN ('sale', 'sale_correction', 'sale_reversal', 'void_sale')
JOIN chart_of_accounts ac_sale ON ac_sale.id = e_sale.account_id
  AND lower(ac_sale.name) = 'cash'
JOIN accounting_entries e_payment ON e_payment.source_id = p.id
  AND e_payment.source_type IN ('payment', 'payment_correction', 'payment_reversal')
JOIN chart_of_accounts ac_payment ON ac_payment.id = e_payment.account_id
  AND lower(ac_payment.name) = 'cash'
GROUP BY s.id, s.sale_number, s.sale_date, s.currency, s.total_amount, p.id
ORDER BY s.sale_date DESC LIMIT 100;

-- 7. Imbalanced journals (must be empty). This validates the double-entry
-- accounting, but a balanced journal can still be posted to the wrong account.
SELECT journal_id, min(entry_date) AS date, min(source_type) AS source_type,
       sum(debit_usd - credit_usd) AS imbalance_usd,
       sum(debit_cdf - credit_cdf) AS imbalance_cdf
FROM accounting_entries
GROUP BY journal_id
HAVING abs(sum(debit_usd - credit_usd)) > 0.00001
    OR abs(sum(debit_cdf - credit_cdf)) > 0.00001
ORDER BY min(entry_date) LIMIT 100;

-- 8. Opening balances, migration cutover entries and manual cash counts.
-- These are common origins of an incorrect opening cash balance.
SELECT e.id AS entry_id, e.entry_date, e.source_type,
       e.source_number, e.currency, e.amount, e.description,
       e.debit_usd, e.credit_usd, e.debit_cdf, e.credit_cdf, e.created_by
FROM accounting_entries e
LEFT JOIN chart_of_accounts a ON a.id = e.account_id
WHERE lower(coalesce(a.name, e.account_name_snapshot, '')) = 'cash'
  AND (e.source_type IN ('cash_count', 'opening_balance')
       OR e.journal_id LIKE 'cutover:%'
       OR e.source_type LIKE '%revaluation%')
ORDER BY e.entry_date, e.id;

-- 9. Monthly cash flow by physical currency; identifies when the shortfall
-- began (do NOT add USD and CDF amounts together without an FX conversion).
WITH cash_lines AS (
  SELECT date_trunc('month', e.entry_date) AS month, upper(e.currency) AS currency,
         CASE WHEN e.debit_usd > 0 OR e.debit_cdf > 0 THEN e.amount ELSE -e.amount END AS signed_native
  FROM accounting_entries e
  LEFT JOIN chart_of_accounts a ON a.id = e.account_id
  WHERE lower(coalesce(a.name, e.account_name_snapshot, '')) = 'cash'
)
SELECT month, currency,
       round(sum(CASE WHEN signed_native > 0 THEN signed_native ELSE 0 END)::numeric, 6) AS incoming,
       round(sum(CASE WHEN signed_native < 0 THEN -signed_native ELSE 0 END)::numeric, 6) AS outgoing,
       round(sum(signed_native)::numeric, 6) AS monthly_net
FROM cash_lines GROUP BY month, currency ORDER BY month, currency;

-- Compare these results to independently counted notes/coins and to
-- bank/mobile-money balances. Do not post balancing journals until the
-- specific missing, duplicated, misdated, or misclassified source is proven.
