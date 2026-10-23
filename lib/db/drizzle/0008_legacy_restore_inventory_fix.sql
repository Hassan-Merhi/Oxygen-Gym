-- Undo a double count left by the historical cash recovery script.
--
-- restore-verifiable-legacy-cash.mjs posted COGS / Inventory for completed POS
-- sales that had no journal. For sales made before the 0007 cutover, the
-- cutover had already brought Inventory to stock on hand (the stock had left
-- the shelf), so that Inventory credit reduced the account a second time.
--
-- For each such sale this posts one balanced, append-only journal that puts
-- the cost back on Inventory and takes it from Opening Balance Equity, which
-- absorbed it at cutover. COGS stays expensed. Sales made after the cutover
-- are left alone. Re-running is a no-op.

DO $$
DECLARE
  cutover_at timestamptz;
  equity_id integer;
  equity_name text;
BEGIN
  SELECT MIN("created_at") INTO cutover_at
  FROM "accounting_entries" WHERE "journal_id" LIKE 'cutover:%';
  IF cutover_at IS NULL THEN RETURN; END IF;

  SELECT "id", "name" INTO equity_id, equity_name
  FROM "chart_of_accounts" WHERE lower("name") = 'opening balance equity' ORDER BY "id" LIMIT 1;
  IF equity_id IS NULL THEN
    INSERT INTO "chart_of_accounts" ("name", "type", "is_active")
    VALUES ('Opening Balance Equity', 'equity', true)
    RETURNING "id", "name" INTO equity_id, equity_name;
  END IF;

  WITH restored AS (
    SELECT e.*
    FROM "accounting_entries" e
    JOIN "chart_of_accounts" a ON a."id" = e."account_id"
    JOIN "sales" s ON s."id" = e."source_id"
    WHERE e."journal_id" LIKE 'legacy-restore:sale:%'
      AND lower(a."name") = 'inventory'
      AND (e."credit_usd" > 0 OR e."credit_cdf" > 0)
      AND s."created_at" <= cutover_at
      AND NOT EXISTS (
        SELECT 1 FROM "accounting_entries" f
        WHERE f."journal_id" = 'legacy-restore-fix:sale:' || e."source_id"
      )
  ),
  lines AS (
    SELECT r.*, l.side, l.post_account_id, l.post_account_name
    FROM restored r
    CROSS JOIN LATERAL (VALUES
      ('debit', r."account_id", r."account_name_snapshot"),
      ('credit', equity_id, equity_name)
    ) AS l(side, post_account_id, post_account_name)
  )
  INSERT INTO "accounting_entries"
    ("journal_id", "entry_date", "source_type", "source_id", "source_number",
     "account_id", "account_name_snapshot", "debit_usd", "credit_usd", "debit_cdf", "credit_cdf",
     "currency", "amount", "exchange_rate", "description", "created_by")
  SELECT
    'legacy-restore-fix:sale:' || "source_id", now(), 'legacy_restore_fix', "source_id", "source_number",
    post_account_id, post_account_name,
    CASE WHEN side = 'debit' THEN "credit_usd" ELSE 0 END,
    CASE WHEN side = 'credit' THEN "credit_usd" ELSE 0 END,
    CASE WHEN side = 'debit' THEN "credit_cdf" ELSE 0 END,
    CASE WHEN side = 'credit' THEN "credit_cdf" ELSE 0 END,
    "currency", "amount", "exchange_rate",
    'Correction: stock of a pre-cutover sale was already out of Inventory at cutover',
    'system:legacy-restore-inventory-fix'
  FROM lines;
END $$;
