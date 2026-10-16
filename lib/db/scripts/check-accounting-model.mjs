import pg from "pg";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for accounting model validation.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

const canonicalAccounts = new Map([
  ["Cash", "asset"],
  ["Bank", "asset"],
  ["Mobile Money", "asset"],
  ["Petty Cash", "asset"],
  ["Inventory", "asset"],
  ["Supplier Payables", "liability"],
  ["Membership Revenue", "income"],
  ["Sales Revenue", "income"],
  ["Other Income", "income"],
  ["Cost of Goods Sold", "expense"],
  ["Payroll Expense", "expense"],
  ["General Expense", "expense"],
  ["Other Expense", "expense"],
  ["Retained Earnings", "equity"],
  ["Opening Balance Equity", "equity"],
  ["FX Gain/Loss", "income"],
  ["Cash Over/Short", "expense"],
  ["Inventory Adjustments", "expense"],
]);

const moneyColumns = [
  ["accounting_entries", "debit_usd"], ["accounting_entries", "credit_usd"],
  ["accounting_entries", "debit_cdf"], ["accounting_entries", "credit_cdf"], ["accounting_entries", "amount"],
  ["cash_ledger", "amount"], ["cash_ledger", "amount_usd"], ["cash_ledger", "amount_cdf"],
  ["cash_ledger", "balance_usd"], ["cash_ledger", "balance_cdf"],
  ["payments", "amount"], ["payments", "discount"], ["payments", "amount_usd"], ["payments", "amount_cdf"],
  ["vouchers", "amount"], ["vouchers", "amount_usd"], ["vouchers", "amount_cdf"],
  ["sales", "total_amount"], ["sales", "total_discount"], ["sales", "cost_total"], ["sales", "total_profit"],
  ["sales", "total_amount_usd"], ["sales", "cost_total_usd"], ["sales", "total_profit_usd"],
  ["sales", "payment_amount"], ["sales", "change_due"],
  ["products", "cost_price"], ["products", "selling_price"],
  ["stock_purchases", "cost_per_unit"], ["stock_purchases", "total_cost"],
  ["stock_purchases", "total_cost_usd"], ["stock_purchases", "total_cost_cdf"],
  ["supplier_credits", "total_amount"], ["supplier_credits", "amount_paid"],
  ["supplier_payments", "amount"], ["supplier_payments", "amount_usd"], ["supplier_payments", "amount_cdf"],
  ["payroll", "amount"], ["payroll", "bonus"], ["payroll", "deduction"], ["payroll", "net_pay"],
  ["payroll", "amount_usd"], ["payroll", "commission_bonus"],
  ["staff_employees", "salary"], ["plans", "price"], ["plans", "coach_fee"],
  ["members", "plan_price"], ["members", "amount_paid"], ["members", "discount"], ["members", "balance"],
  ["members", "commission_amount"], ["commissions", "amount"],
  ["expenses", "amount"], ["expenses", "amount_usd"],
];

const fxColumns = [
  ["accounting_entries", "exchange_rate"], ["cash_ledger", "exchange_rate"],
  ["payments", "exchange_rate"], ["vouchers", "exchange_rate"], ["sales", "exchange_rate"],
  ["stock_purchases", "exchange_rate"], ["supplier_credits", "exchange_rate"],
  ["supplier_payments", "exchange_rate"], ["payroll", "exchange_rate"],
  ["settings", "usd_to_cdf_rate"], ["expenses", "exchange_rate"],
];

async function assertNumericColumns(columns, expectedScale) {
  for (const [table, column] of columns) {
    const result = await client.query(
      `SELECT data_type, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [table, column],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Missing accounting column ${table}.${column}`);
    if (row.data_type !== "numeric" || Number(row.numeric_scale) !== expectedScale) {
      throw new Error(`${table}.${column} must be numeric scale ${expectedScale}; found ${row.data_type}(${row.numeric_precision},${row.numeric_scale})`);
    }
  }
}

try {
  await assertNumericColumns(moneyColumns, 6);
  await assertNumericColumns(fxColumns, 8);

  const accounts = await client.query(`SELECT name, type, is_active FROM chart_of_accounts`);
  const byName = new Map(accounts.rows.map((row) => [row.name, row]));
  for (const [name, type] of canonicalAccounts) {
    const row = byName.get(name);
    if (!row) throw new Error(`Missing canonical chart account: ${name}`);
    if (row.type !== type) throw new Error(`Canonical account ${name} must be ${type}; found ${row.type}`);
    if (row.is_active !== true) throw new Error(`Canonical account ${name} must remain active`);
  }

  const supplierPaymentColumns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='supplier_payments'
      AND column_name IN ('exchange_rate','amount_usd','amount_cdf','account','payment_id')
  `);
  if (supplierPaymentColumns.rowCount !== 5) throw new Error("Supplier payment accounting linkage is incomplete");

  const malformedEntries = await client.query(`
    SELECT id
    FROM accounting_entries
    WHERE (debit_usd > 0 AND credit_usd > 0)
       OR (debit_cdf > 0 AND credit_cdf > 0)
       OR debit_usd < 0 OR credit_usd < 0 OR debit_cdf < 0 OR credit_cdf < 0
       OR exchange_rate <= 0
    LIMIT 1
  `);
  if (malformedEntries.rowCount > 0) throw new Error("Accounting entries contain invalid debit/credit or FX values");

  const missingJournal = await client.query(`SELECT id FROM accounting_entries WHERE journal_id IS NULL OR journal_id = '' LIMIT 1`);
  if (missingJournal.rowCount > 0) throw new Error("Accounting entries without a journal id");

  const unbalanced = await client.query(`
    SELECT journal_id,
           ROUND(SUM(debit_usd - credit_usd), 6) AS usd_diff,
           ROUND(SUM(debit_cdf - credit_cdf), 6) AS cdf_diff
    FROM accounting_entries
    GROUP BY journal_id
    HAVING ABS(ROUND(SUM(debit_usd - credit_usd), 6)) > 0.00001
        OR ABS(ROUND(SUM(debit_cdf - credit_cdf), 6)) > 0.00001
    LIMIT 1
  `);
  if (unbalanced.rowCount > 0) {
    const row = unbalanced.rows[0];
    throw new Error(`Unbalanced journal ${row.journal_id}: USD ${row.usd_diff}, CDF ${row.cdf_diff}`);
  }

  // The database itself must refuse unbalanced journals, edits of posted lines, and closed-period entries.
  const triggers = await client.query(`
    SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'accounting_entries'::regclass AND NOT tgisinternal
  `);
  const triggerNames = new Set(triggers.rows.map((row) => row.tgname));
  for (const name of ["accounting_entries_balanced", "accounting_entries_immutable", "accounting_entries_period_lock"]) {
    if (!triggerNames.has(name)) throw new Error(`Missing ledger trigger ${name}`);
  }
  const [cashAccount] = (await client.query(`SELECT id FROM chart_of_accounts WHERE name = 'Cash'`)).rows;
  async function expectRejected(label, statements) {
    await client.query("BEGIN");
    try {
      for (const statement of statements) await client.query(statement.text, statement.values ?? []);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      return;
    }
    throw new Error(`The ledger accepted ${label}`);
  }
  await expectRejected("an unbalanced journal", [{
    text: `INSERT INTO accounting_entries (journal_id, entry_date, source_type, account_id, account_name_snapshot, debit_usd, credit_usd, debit_cdf, credit_cdf, currency, amount, exchange_rate)
           VALUES ('ci-unbalanced-probe', now(), 'ci_probe', $1, 'Cash', 1, 0, 2800, 0, 'USD', 1, 2800)`,
    values: [cashAccount.id],
  }]);
  const anyEntry = await client.query(`SELECT id FROM accounting_entries LIMIT 1`);
  if (anyEntry.rowCount > 0) {
    await expectRejected("an edit of a posted entry", [{ text: `UPDATE accounting_entries SET description = 'tampered' WHERE id = $1`, values: [anyEntry.rows[0].id] }]);
    await expectRejected("a deletion of a posted entry", [{ text: `DELETE FROM accounting_entries WHERE id = $1`, values: [anyEntry.rows[0].id] }]);
  }

  const invalidFx = await client.query(`
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM payments WHERE exchange_rate <= 0) THEN 'payments'
      WHEN EXISTS (SELECT 1 FROM vouchers WHERE exchange_rate <= 0) THEN 'vouchers'
      WHEN EXISTS (SELECT 1 FROM sales WHERE exchange_rate <= 0) THEN 'sales'
      WHEN EXISTS (SELECT 1 FROM stock_purchases WHERE exchange_rate <= 0) THEN 'stock_purchases'
      WHEN EXISTS (SELECT 1 FROM supplier_credits WHERE exchange_rate <= 0) THEN 'supplier_credits'
      WHEN EXISTS (SELECT 1 FROM supplier_payments WHERE exchange_rate <= 0) THEN 'supplier_payments'
      WHEN EXISTS (SELECT 1 FROM payroll WHERE exchange_rate <= 0) THEN 'payroll'
      ELSE NULL
    END AS source
  `);
  if (invalidFx.rows[0]?.source) throw new Error(`Non-positive locked FX rate found in ${invalidFx.rows[0].source}`);

  console.log(`Accounting model check passed (${moneyColumns.length} money columns, ${fxColumns.length} FX columns, ${canonicalAccounts.size} canonical accounts, balanced journals enforced by the database, append-only ledger).`);
} finally {
  client.release();
  await pool.end();
}
