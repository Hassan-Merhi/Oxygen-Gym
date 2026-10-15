-- One-time cutover that makes accounting_entries the single source of truth.
--
-- 1. Posts journals for completed source documents that never reached the
--    ledger (older app versions wrote only the source table).
-- 2. Cancels legacy duplicate member cash receipts (a voucher written next to
--    the membership payment for the same money) and reverses their postings.
-- 3. Reconciles Cash (per currency), Inventory and Supplier Payables to the
--    balances the app showed before the cutover, through Opening Balance
--    Equity, so no screen jumps when reports move onto the ledger.
--
-- Every journal written here uses a 'cutover:' journal id and is balanced.

CREATE OR REPLACE FUNCTION "ledger_cutover_account"(raw_name text, fallback_type text) RETURNS integer AS $$
DECLARE
  clean text := initcap(replace(trim(COALESCE(NULLIF(raw_name, ''), 'cash')), '_', ' '));
  account_id integer;
BEGIN
  IF lower(clean) IN ('physical cash', 'cash account') THEN clean := 'Cash'; END IF;
  SELECT "id" INTO account_id FROM "chart_of_accounts" WHERE lower("name") = lower(clean) ORDER BY "id" LIMIT 1;
  IF account_id IS NULL THEN
    INSERT INTO "chart_of_accounts" ("name", "type", "is_active") VALUES (clean, fallback_type, true)
    ON CONFLICT ("name") DO NOTHING
    RETURNING "id" INTO account_id;
    IF account_id IS NULL THEN
      SELECT "id" INTO account_id FROM "chart_of_accounts" WHERE lower("name") = lower(clean) ORDER BY "id" LIMIT 1;
    END IF;
  END IF;
  RETURN account_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "ledger_cutover_post"(
  journal text, posted_at timestamptz, src_type text, src_id integer, src_number text,
  debit_name text, debit_type text, credit_name text, credit_type text,
  native_amount numeric, native_currency text, locked_rate numeric, memo text
) RETURNS void AS $$
DECLARE
  cur text := CASE WHEN upper(COALESCE(native_currency, 'USD')) = 'CDF' THEN 'CDF' ELSE 'USD' END;
  amt numeric := round(COALESCE(native_amount, 0), 6);
  rate numeric := round(locked_rate, 8);
  usd numeric;
  cdf numeric;
  debit_id integer;
  credit_id integer;
BEGIN
  IF amt <= 0 THEN RETURN; END IF;
  usd := CASE WHEN cur = 'USD' THEN amt ELSE round(amt / rate, 6) END;
  cdf := CASE WHEN cur = 'CDF' THEN amt ELSE round(amt * rate, 6) END;
  debit_id := "ledger_cutover_account"(debit_name, debit_type);
  credit_id := "ledger_cutover_account"(credit_name, credit_type);
  INSERT INTO "accounting_entries" (
    "journal_id", "entry_date", "source_type", "source_id", "source_number", "account_id", "account_name_snapshot",
    "debit_usd", "credit_usd", "debit_cdf", "credit_cdf", "currency", "amount", "exchange_rate", "description", "created_by"
  )
  SELECT journal, posted_at, src_type, src_id, src_number, debit_id, (SELECT "name" FROM "chart_of_accounts" WHERE "id" = debit_id),
         usd, 0, cdf, 0, cur, amt, rate, memo, 'ledger-cutover'
  UNION ALL
  SELECT journal, posted_at, src_type, src_id, src_number, credit_id, (SELECT "name" FROM "chart_of_accounts" WHERE "id" = credit_id),
         0, usd, 0, cdf, cur, amt, rate, memo, 'ledger-cutover';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "ledger_cutover_has_family"(base text, src_id integer) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "accounting_entries"
    WHERE "source_id" = src_id
      AND "source_type" IN (base, base || '_correction', base || '_reversal', base || '_void', 'void_' || base)
  );
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

DO $$
DECLARE
  current_rate numeric;
  r record;
  rate numeric;
  legacy_usd numeric;
  legacy_cdf numeric;
  ledger_usd numeric;
  ledger_cdf numeric;
  diff numeric;
  stock_value numeric;
  ledger_value numeric;
  payable_value numeric;
BEGIN
  SELECT COALESCE(NULLIF((SELECT "usd_to_cdf_rate" FROM "settings" ORDER BY "id" LIMIT 1), 0), 2800) INTO current_rate;
  IF current_rate < 10 THEN current_rate := 2800; END IF;

  -- 1a. Payments that are not owned by a sale, payroll or supplier settlement.
  FOR r IN
    SELECT p.* FROM "payments" p
    WHERE p."status" = 'completed' AND COALESCE(p."amount", 0) > 0
      AND COALESCE(p."linked_entity", '') NOT IN ('sale', 'payroll', 'supplier_payment')
      AND NOT "ledger_cutover_has_family"('payment', p."id")
  LOOP
    rate := CASE WHEN r."exchange_rate" >= 10 THEN r."exchange_rate" ELSE current_rate END;
    IF r."direction" = 'in' THEN
      PERFORM "ledger_cutover_post"('cutover:payment:' || r."id", r."payment_date", 'payment', r."id", r."payment_number",
        COALESCE(NULLIF(r."account", ''), 'cash'), 'asset',
        CASE r."category" WHEN 'membership' THEN 'Membership Revenue' WHEN 'product_sale' THEN 'Sales Revenue' ELSE 'Other Income' END, 'income',
        r."amount", r."currency", rate, 'Ledger cutover: ' || COALESCE(r."category", 'payment'));
    ELSE
      PERFORM "ledger_cutover_post"('cutover:payment:' || r."id", r."payment_date", 'payment', r."id", r."payment_number",
        CASE r."category" WHEN 'expense' THEN 'General Expense' WHEN 'payroll' THEN 'Payroll Expense'
          WHEN 'stock_purchase' THEN 'Inventory' WHEN 'supplier_payment' THEN 'Supplier Payables' ELSE 'Other Expense' END,
        CASE r."category" WHEN 'stock_purchase' THEN 'asset' WHEN 'supplier_payment' THEN 'liability' ELSE 'expense' END,
        COALESCE(NULLIF(r."account", ''), 'cash'), 'asset',
        r."amount", r."currency", rate, 'Ledger cutover: ' || COALESCE(r."category", 'payment'));
    END IF;
  END LOOP;

  -- 2. Legacy duplicate member receipts: same member, currency and amount as a
  --    completed cash membership payment on the same day.
  FOR r IN
    SELECT v.* FROM "vouchers" v
    WHERE v."status" = 'recorded' AND v."deleted_at" IS NULL
      AND v."linked_entity" = 'member' AND v."voucher_type" = 'cash_receipt'
      AND EXISTS (
        SELECT 1 FROM "payments" p2
        WHERE p2."member_id" = v."linked_entity_id"
          AND p2."category" = 'membership' AND p2."status" = 'completed'
          AND LOWER(REPLACE(TRIM(COALESCE(NULLIF(p2."account", ''), 'cash')), '_', ' ')) IN ('cash', 'physical cash', 'cash account')
          AND UPPER(COALESCE(p2."currency", 'USD')) = UPPER(COALESCE(v."currency", 'USD'))
          AND ABS(COALESCE(p2."amount", 0) - COALESCE(v."amount", 0)) < 0.000001
          AND p2."payment_date" >= v."voucher_date"::date
          AND p2."payment_date" < v."voucher_date"::date + INTERVAL '1 day'
      )
  LOOP
    INSERT INTO "accounting_entries" (
      "journal_id", "entry_date", "source_type", "source_id", "source_number", "account_id", "account_name_snapshot",
      "debit_usd", "credit_usd", "debit_cdf", "credit_cdf", "currency", "amount", "exchange_rate", "description", "created_by"
    )
    SELECT 'cutover:duplicate-voucher:' || r."id", now(), 'voucher_reversal', r."id", r."voucher_number",
           n."account_id", n."account_name_snapshot",
           CASE WHEN n.net_usd < 0 THEN -n.net_usd ELSE 0 END,
           CASE WHEN n.net_usd > 0 THEN n.net_usd ELSE 0 END,
           CASE WHEN n.net_cdf < 0 THEN -n.net_cdf ELSE 0 END,
           CASE WHEN n.net_cdf > 0 THEN n.net_cdf ELSE 0 END,
           n.currency,
           CASE WHEN n.currency = 'CDF' THEN ABS(n.net_cdf) ELSE ABS(n.net_usd) END,
           n.rate,
           'Ledger cutover: duplicate member receipt reversed', 'ledger-cutover'
    FROM (
      SELECT ae."account_id", ae."account_name_snapshot",
             SUM(ae."debit_usd" - ae."credit_usd") AS net_usd,
             SUM(ae."debit_cdf" - ae."credit_cdf") AS net_cdf,
             MAX(ae."currency") AS currency,
             MAX(ae."exchange_rate") AS rate
      FROM "accounting_entries" ae
      WHERE ae."source_id" = r."id"
        AND ae."source_type" IN ('voucher', 'voucher_correction', 'voucher_reversal')
      GROUP BY ae."account_id", ae."account_name_snapshot"
    ) n
    WHERE ABS(n.net_usd) > 0.000001 OR ABS(n.net_cdf) > 0.000001;

    UPDATE "vouchers" SET "status" = 'cancelled', "deleted_at" = now(), "updated_at" = now() WHERE "id" = r."id";
  END LOOP;

  -- 1b. Remaining recorded vouchers.
  FOR r IN
    SELECT v.* FROM "vouchers" v
    WHERE v."status" = 'recorded' AND v."deleted_at" IS NULL AND COALESCE(v."amount", 0) > 0
      AND NOT "ledger_cutover_has_family"('voucher', v."id")
  LOOP
    rate := CASE WHEN r."exchange_rate" >= 10 THEN r."exchange_rate" ELSE current_rate END;
    IF r."direction" = 'in' THEN
      PERFORM "ledger_cutover_post"('cutover:voucher:' || r."id", r."voucher_date", 'voucher', r."id", r."voucher_number",
        COALESCE(NULLIF(r."account", ''), 'cash'), 'asset', COALESCE(NULLIF(r."category", ''), 'Other Income'), 'income',
        r."amount", r."currency", rate, COALESCE(NULLIF(r."description", ''), 'Ledger cutover: voucher'));
    ELSE
      PERFORM "ledger_cutover_post"('cutover:voucher:' || r."id", r."voucher_date", 'voucher', r."id", r."voucher_number",
        COALESCE(NULLIF(r."category", ''), 'General Expense'), 'expense', COALESCE(NULLIF(r."account", ''), 'cash'), 'asset',
        r."amount", r."currency", rate, COALESCE(NULLIF(r."description", ''), 'Ledger cutover: voucher'));
    END IF;
  END LOOP;

  -- 1c. Completed POS sales.
  FOR r IN
    SELECT s.* FROM "sales" s
    WHERE s."status" = 'completed' AND NOT "ledger_cutover_has_family"('sale', s."id")
  LOOP
    rate := CASE WHEN r."exchange_rate" >= 10 THEN r."exchange_rate" ELSE current_rate END;
    PERFORM "ledger_cutover_post"('cutover:sale:' || r."id", r."sale_date", 'sale', r."id", r."sale_number",
      'Cash', 'asset', 'Sales Revenue', 'income', r."total_amount", r."currency", rate, 'Ledger cutover: sale');
    PERFORM "ledger_cutover_post"('cutover:sale:' || r."id", r."sale_date", 'sale', r."id", r."sale_number",
      'Cost of Goods Sold', 'expense', 'Inventory', 'asset', r."cost_total", r."currency", rate, 'Ledger cutover: sale COGS');
  END LOOP;

  -- 1d. Paid payroll.
  FOR r IN
    SELECT pr.* FROM "payroll" pr
    WHERE pr."status" = 'paid' AND NOT "ledger_cutover_has_family"('payroll', pr."id")
  LOOP
    rate := CASE WHEN r."exchange_rate" >= 10 THEN r."exchange_rate" ELSE current_rate END;
    PERFORM "ledger_cutover_post"('cutover:payroll:' || r."id", COALESCE(r."paid_at", r."created_at"), 'payroll', r."id", r."payroll_number",
      'Payroll Expense', 'expense', 'Cash', 'asset', r."net_pay", r."currency", rate, 'Ledger cutover: payroll');
  END LOOP;

  -- 1e. Stock purchases not already represented by a completed payment.
  FOR r IN
    SELECT sp.* FROM "stock_purchases" sp
    WHERE COALESCE(sp."total_cost", 0) > 0
      AND NOT "ledger_cutover_has_family"('stock_purchase', sp."id")
      AND (sp."payment_id" IS NULL OR NOT EXISTS (
        SELECT 1 FROM "payments" p3 WHERE p3."id" = sp."payment_id" AND p3."status" = 'completed'
      ))
  LOOP
    rate := CASE WHEN r."exchange_rate" >= 10 THEN r."exchange_rate" ELSE current_rate END;
    PERFORM "ledger_cutover_post"('cutover:stock_purchase:' || r."id", r."purchase_date", 'stock_purchase', r."id", r."purchase_number",
      'Inventory', 'asset', CASE WHEN r."paid_from_cash" = 1 THEN 'Cash' ELSE 'Supplier Payables' END,
      CASE WHEN r."paid_from_cash" = 1 THEN 'asset' ELSE 'liability' END,
      r."total_cost", r."currency", rate, 'Ledger cutover: stock purchase');
  END LOOP;

  -- 1f. Supplier credits and settlements.
  FOR r IN
    SELECT sc.* FROM "supplier_credits" sc
    WHERE sc."deleted_at" IS NULL AND COALESCE(sc."total_amount", 0) > 0
      AND NOT "ledger_cutover_has_family"('supplier_credit', sc."id")
  LOOP
    rate := CASE WHEN r."exchange_rate" >= 10 THEN r."exchange_rate" ELSE current_rate END;
    PERFORM "ledger_cutover_post"('cutover:supplier_credit:' || r."id", r."purchase_date", 'supplier_credit', r."id", r."credit_number",
      CASE WHEN r."product_id" IS NULL THEN 'General Expense' ELSE 'Inventory' END,
      CASE WHEN r."product_id" IS NULL THEN 'expense' ELSE 'asset' END,
      'Supplier Payables', 'liability', r."total_amount", r."currency", rate, 'Ledger cutover: supplier credit');
  END LOOP;

  FOR r IN
    SELECT sp.* FROM "supplier_payments" sp
    WHERE sp."deleted_at" IS NULL AND COALESCE(sp."amount", 0) > 0
      AND NOT "ledger_cutover_has_family"('supplier_payment', sp."id")
  LOOP
    rate := CASE WHEN r."exchange_rate" >= 10 THEN r."exchange_rate" ELSE current_rate END;
    PERFORM "ledger_cutover_post"('cutover:supplier_payment:' || r."id", r."payment_date", 'supplier_payment', r."id", NULL,
      'Supplier Payables', 'liability', COALESCE(NULLIF(r."account", ''), 'cash'), 'asset',
      r."amount", r."currency", rate, 'Ledger cutover: supplier payment');
  END LOOP;

  -- 3a. Cash per currency: match the balance the Cash Book showed before the cutover.
  WITH reset_cutoff AS (
    SELECT MAX("entry_date") AS cutoff FROM "cash_ledger" WHERE "source_type" = 'period_reset'
  ),
  movements AS (
    SELECT p."direction", UPPER(COALESCE(p."currency", 'USD')) AS currency, COALESCE(p."amount", 0) AS amount
    FROM "payments" p
    WHERE p."status" = 'completed'
      AND LOWER(REPLACE(TRIM(COALESCE(NULLIF(p."account", ''), 'cash')), '_', ' ')) IN ('cash', 'physical cash', 'cash account')
      AND ((SELECT cutoff FROM reset_cutoff) IS NULL OR p."payment_date" >= (SELECT cutoff FROM reset_cutoff))
    UNION ALL
    SELECT v."direction", UPPER(COALESCE(v."currency", 'USD')), COALESCE(v."amount", 0)
    FROM "vouchers" v
    WHERE v."status" = 'recorded' AND v."deleted_at" IS NULL
      AND LOWER(REPLACE(TRIM(COALESCE(NULLIF(v."account", ''), 'cash')), '_', ' ')) IN ('cash', 'physical cash', 'cash account')
      AND ((SELECT cutoff FROM reset_cutoff) IS NULL OR v."voucher_date" >= (SELECT cutoff FROM reset_cutoff))
    UNION ALL
    SELECT 'out', UPPER(COALESCE(sp."currency", 'USD')), COALESCE(sp."total_cost", 0)
    FROM "stock_purchases" sp
    WHERE sp."paid_from_cash" = 1
      AND ((SELECT cutoff FROM reset_cutoff) IS NULL OR sp."purchase_date" >= (SELECT cutoff FROM reset_cutoff))
      AND (sp."payment_id" IS NULL OR NOT EXISTS (
        SELECT 1 FROM "payments" p3 WHERE p3."id" = sp."payment_id" AND p3."status" = 'completed'
          AND LOWER(REPLACE(TRIM(COALESCE(NULLIF(p3."account", ''), 'cash')), '_', ' ')) IN ('cash', 'physical cash', 'cash account')
      ))
    UNION ALL
    SELECT 'out', UPPER(COALESCE(sp."currency", 'USD')), COALESCE(sp."amount", 0)
    FROM "supplier_payments" sp
    WHERE ((SELECT cutoff FROM reset_cutoff) IS NULL OR sp."payment_date" >= (SELECT cutoff FROM reset_cutoff))
      AND (sp."payment_id" IS NULL OR NOT EXISTS (
        SELECT 1 FROM "payments" p4 WHERE p4."id" = sp."payment_id" AND p4."status" = 'completed'
          AND LOWER(REPLACE(TRIM(COALESCE(NULLIF(p4."account", ''), 'cash')), '_', ' ')) IN ('cash', 'physical cash', 'cash account')
      ))
    UNION ALL
    SELECT cl."direction", UPPER(COALESCE(cl."currency", 'USD')), COALESCE(cl."amount", 0)
    FROM "cash_ledger" cl
    WHERE cl."source_type" = 'opening_balance'
      AND ((SELECT cutoff FROM reset_cutoff) IS NULL OR cl."entry_date" >= (SELECT cutoff FROM reset_cutoff))
  )
  SELECT
    COALESCE(SUM(CASE WHEN currency <> 'CDF' THEN (CASE WHEN "direction" = 'out' THEN -amount ELSE amount END) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN currency = 'CDF' THEN (CASE WHEN "direction" = 'out' THEN -amount ELSE amount END) ELSE 0 END), 0)
  INTO legacy_usd, legacy_cdf
  FROM movements;

  SELECT
    COALESCE(SUM(CASE WHEN ae."currency" <> 'CDF' THEN (CASE WHEN ae."debit_usd" > 0 OR ae."debit_cdf" > 0 THEN ae."amount" ELSE -ae."amount" END) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ae."currency" = 'CDF' THEN (CASE WHEN ae."debit_usd" > 0 OR ae."debit_cdf" > 0 THEN ae."amount" ELSE -ae."amount" END) ELSE 0 END), 0)
  INTO ledger_usd, ledger_cdf
  FROM "accounting_entries" ae
  JOIN "chart_of_accounts" ca ON ca."id" = ae."account_id"
  WHERE lower(ca."name") = 'cash';

  diff := round(legacy_usd - ledger_usd, 6);
  IF diff > 0.004 THEN
    PERFORM "ledger_cutover_post"('cutover:cash-usd', now(), 'cutover_reconciliation', NULL, 'CUTOVER-CASH-USD',
      'Cash', 'asset', 'Opening Balance Equity', 'equity', diff, 'USD', current_rate, 'Ledger cutover: USD cash brought to Cash Book balance');
  ELSIF diff < -0.004 THEN
    PERFORM "ledger_cutover_post"('cutover:cash-usd', now(), 'cutover_reconciliation', NULL, 'CUTOVER-CASH-USD',
      'Opening Balance Equity', 'equity', 'Cash', 'asset', -diff, 'USD', current_rate, 'Ledger cutover: USD cash brought to Cash Book balance');
  END IF;

  diff := round(legacy_cdf - ledger_cdf, 6);
  IF diff > 0.5 THEN
    PERFORM "ledger_cutover_post"('cutover:cash-cdf', now(), 'cutover_reconciliation', NULL, 'CUTOVER-CASH-CDF',
      'Cash', 'asset', 'Opening Balance Equity', 'equity', diff, 'CDF', current_rate, 'Ledger cutover: CDF cash brought to Cash Book balance');
  ELSIF diff < -0.5 THEN
    PERFORM "ledger_cutover_post"('cutover:cash-cdf', now(), 'cutover_reconciliation', NULL, 'CUTOVER-CASH-CDF',
      'Opening Balance Equity', 'equity', 'Cash', 'asset', -diff, 'CDF', current_rate, 'Ledger cutover: CDF cash brought to Cash Book balance');
  END IF;

  -- 3b. Inventory: ledger value equals quantity x average cost of live products.
  SELECT COALESCE(SUM(
    CASE WHEN UPPER(COALESCE("currency", 'USD')) = 'CDF' THEN ("cost_price" * "quantity") / current_rate ELSE "cost_price" * "quantity" END
  ), 0) INTO stock_value
  FROM "products" WHERE "status" <> 'deleted' AND "quantity" > 0;

  SELECT COALESCE(SUM(ae."debit_usd" - ae."credit_usd"), 0) INTO ledger_value
  FROM "accounting_entries" ae JOIN "chart_of_accounts" ca ON ca."id" = ae."account_id"
  WHERE lower(ca."name") = 'inventory';

  diff := round(stock_value - ledger_value, 6);
  IF diff > 0.004 THEN
    PERFORM "ledger_cutover_post"('cutover:inventory', now(), 'cutover_reconciliation', NULL, 'CUTOVER-INVENTORY',
      'Inventory', 'asset', 'Opening Balance Equity', 'equity', diff, 'USD', current_rate, 'Ledger cutover: inventory brought to stock valuation');
  ELSIF diff < -0.004 THEN
    PERFORM "ledger_cutover_post"('cutover:inventory', now(), 'cutover_reconciliation', NULL, 'CUTOVER-INVENTORY',
      'Opening Balance Equity', 'equity', 'Inventory', 'asset', -diff, 'USD', current_rate, 'Ledger cutover: inventory brought to stock valuation');
  END IF;

  -- 3c. Supplier Payables: ledger liability equals the open supplier balances.
  SELECT COALESCE(SUM(
    CASE WHEN UPPER(COALESCE("currency", 'USD')) = 'CDF'
      THEN ("total_amount" - "amount_paid") / CASE WHEN "exchange_rate" >= 10 THEN "exchange_rate" ELSE current_rate END
      ELSE "total_amount" - "amount_paid" END
  ), 0) INTO payable_value
  FROM "supplier_credits" WHERE "deleted_at" IS NULL;

  SELECT COALESCE(SUM(ae."credit_usd" - ae."debit_usd"), 0) INTO ledger_value
  FROM "accounting_entries" ae JOIN "chart_of_accounts" ca ON ca."id" = ae."account_id"
  WHERE lower(ca."name") = 'supplier payables';

  diff := round(payable_value - ledger_value, 6);
  IF diff > 0.004 THEN
    PERFORM "ledger_cutover_post"('cutover:payables', now(), 'cutover_reconciliation', NULL, 'CUTOVER-PAYABLES',
      'Opening Balance Equity', 'equity', 'Supplier Payables', 'liability', diff, 'USD', current_rate, 'Ledger cutover: payables brought to open supplier balances');
  ELSIF diff < -0.004 THEN
    PERFORM "ledger_cutover_post"('cutover:payables', now(), 'cutover_reconciliation', NULL, 'CUTOVER-PAYABLES',
      'Supplier Payables', 'liability', 'Opening Balance Equity', 'equity', -diff, 'USD', current_rate, 'Ledger cutover: payables brought to open supplier balances');
  END IF;
END $$;
--> statement-breakpoint

DROP FUNCTION IF EXISTS "ledger_cutover_has_family"(text, integer);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "ledger_cutover_post"(text, timestamptz, text, integer, text, text, text, text, text, numeric, text, numeric, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS "ledger_cutover_account"(text, text);
