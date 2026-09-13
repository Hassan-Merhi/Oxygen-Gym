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

  const unbalanced = await client.query(`
    SELECT source_type, source_id,
           ROUND(SUM(debit_usd - credit_usd), 6) AS usd_diff,
           ROUND(SUM(debit_cdf - credit_cdf), 6) AS cdf_diff
    FROM accounting_entries
    GROUP BY source_type, source_id
    HAVING ABS(ROUND(SUM(debit_usd - credit_usd), 6)) > 0.000001
        OR ABS(ROUND(SUM(debit_cdf - credit_cdf), 6)) > 0.000001
    LIMIT 1
  `);
  if (unbalanced.rowCount > 0) {
    const row = unbalanced.rows[0];
    throw new Error(`Unbalanced accounting source ${row.source_type}/${row.source_id}: USD ${row.usd_diff}, CDF ${row.cdf_diff}`);
  }

  const invalidFx = await client.query(`
    SELECT source FROM (
      SELECT 'payments' AS source FROM payments WHERE exchange_rate <= 0 LIMIT 1
      UNION ALL SELECT 'vouchers' FROM vouchers WHERE exchange_rate <= 0 LIMIT 1
      UNION ALL SELECT 'sales' FROM sales WHERE exchange_rate <= 0 LIMIT 1
      UNION ALL SELECT 'stock_purchases' FROM stock_purchases WHERE exchange_rate <= 0 LIMIT 1
      UNION ALL SELECT 'supplier_credits' FROM supplier_credits WHERE exchange_rate <= 0 LIMIT 1
      UNION ALL SELECT 'supplier_payments' FROM supplier_payments WHERE exchange_rate <= 0 LIMIT 1
      UNION ALL SELECT 'payroll' FROM payroll WHERE exchange_rate <= 0 LIMIT 1
    ) bad
    LIMIT 1
  `);
  if (invalidFx.rowCount > 0) throw new Error(`Non-positive locked FX rate found in ${invalidFx.rows[0].source}`);

  console.log(`Accounting model check passed (${moneyColumns.length} money columns, ${fxColumns.length} FX columns, ${canonicalAccounts.size} canonical accounts, balanced journal invariants).`);
} finally {
  client.release();
  await pool.end();
}
