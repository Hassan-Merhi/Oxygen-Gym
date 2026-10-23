/**
 * The historical cash recovery script and the 0008 correction, against real
 * PostgreSQL databases created for this test from LEDGER_TEST_DATABASE_URL.
 *
 * Scenario: opening stock worth $100, a $40-cost sale made before the 0007
 * cutover (the cutover already took its cost out of Inventory), and a $10-cost
 * sale made after it. Stock on hand is worth $50, and the books must say so.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverUrl = process.env.LEDGER_TEST_DATABASE_URL;
const skip = !serverUrl && "LEDGER_TEST_DATABASE_URL is not set";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = createRequire(path.join(root, "lib/db/package.json"))("pg") as typeof import("pg");

const SEED = `
DO $$
DECLARE inv int; obe int; s1 int; s2 int;
BEGIN
  SELECT id INTO inv FROM chart_of_accounts WHERE lower(name) = 'inventory';
  SELECT id INTO obe FROM chart_of_accounts WHERE lower(name) = 'opening balance equity';
  INSERT INTO accounting_entries (journal_id, entry_date, source_type, account_id, account_name_snapshot,
    debit_usd, credit_usd, debit_cdf, credit_cdf, currency, amount, exchange_rate, created_at) VALUES
   ('opening:stock', '2026-10-01', 'opening_balance', inv, 'Inventory', 100, 0, 280000, 0, 'USD', 100, 2800, '2026-10-01'),
   ('opening:stock', '2026-10-01', 'opening_balance', obe, 'Opening Balance Equity', 0, 100, 0, 280000, 'USD', 100, 2800, '2026-10-01'),
   ('cutover:inventory', '2026-10-16 12:00+00', 'cutover_reconciliation', obe, 'Opening Balance Equity', 40, 0, 112000, 0, 'USD', 40, 2800, '2026-10-16 12:00+00'),
   ('cutover:inventory', '2026-10-16 12:00+00', 'cutover_reconciliation', inv, 'Inventory', 0, 40, 0, 112000, 'USD', 40, 2800, '2026-10-16 12:00+00');
  INSERT INTO sales (sale_number, total_amount, cost_total, currency, exchange_rate, sale_date, status, created_at, items)
    VALUES ('SAL-PRE', 100, 40, 'USD', 2800, '2026-10-15 10:00+00', 'completed', '2026-10-15 10:00+00', '[]') RETURNING id INTO s1;
  INSERT INTO sales (sale_number, total_amount, cost_total, currency, exchange_rate, sale_date, status, created_at, items)
    VALUES ('SAL-POST', 30, 10, 'USD', 2800, '2026-10-17 06:00+00', 'completed', '2026-10-17 06:00+00', '[]') RETURNING id INTO s2;
  INSERT INTO cash_ledger (entry_date, source_type, source_id, direction, amount, currency, exchange_rate, amount_usd, amount_cdf) VALUES
    ('2026-10-15 10:00+00', 'sale', s1, 'in', 100, 'USD', 2800, 100, 280000),
    ('2026-10-17 06:00+00', 'sale', s2, 'in', 30, 'USD', 2800, 30, 84000);
END $$;`;

function databaseUrl(name: string): string {
  const url = new URL(serverUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function withFreshDatabase(name: string, run: (url: string, client: import("pg").Client) => Promise<void>) {
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  const url = databaseUrl(name);
  const client = new pg.Client({ connectionString: url });
  try {
    execFileSync(process.execPath, [path.join(root, "lib/db/scripts/migrate.mjs")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    await client.connect();
    await client.query(SEED);
    await run(url, client);
  } finally {
    await client.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}

function runRecovery(url: string): string {
  return execFileSync(process.execPath, [path.join(root, "lib/db/scripts/restore-verifiable-legacy-cash.mjs")], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
}

async function balances(client: import("pg").Client): Promise<Record<string, number>> {
  const { rows } = await client.query(`
    SELECT a.name, ROUND(SUM(e.debit_usd - e.credit_usd), 2)::float AS usd
    FROM accounting_entries e JOIN chart_of_accounts a ON a.id = e.account_id GROUP BY a.name`);
  return Object.fromEntries(rows.map((row) => [row.name, row.usd]));
}

async function unbalancedJournals(client: import("pg").Client): Promise<number> {
  const { rows } = await client.query(`
    SELECT journal_id FROM accounting_entries GROUP BY journal_id
    HAVING ABS(SUM(debit_usd - credit_usd)) > 0.000001 OR ABS(SUM(debit_cdf - credit_cdf)) > 0.000001`);
  return rows.length;
}

test("recovery posts missing sales without taking pre-cutover stock out of Inventory twice", { skip }, async () => {
  await withFreshDatabase(`restore_new_${process.pid}`, async (url, client) => {
    assert.match(runRecovery(url), /CASH_RECOVERY_COMPLETED/);
    runRecovery(url); // a second boot changes nothing
    const books = await balances(client);
    assert.equal(books["Inventory"], 50, "Inventory equals stock on hand");
    assert.equal(books["Cost of Goods Sold"], 50);
    assert.equal(books["Cash"], 130);
    assert.equal(books["Sales Revenue"], -130);
    assert.equal(await unbalancedJournals(client), 0);
  });
});

test("migration 0008 puts back stock that an earlier recovery removed twice", { skip }, async () => {
  await withFreshDatabase(`restore_fix_${process.pid}`, async (_url, client) => {
    // What the earlier script wrote for the pre-cutover sale: COGS against Inventory.
    await client.query(`
      INSERT INTO accounting_entries (journal_id, entry_date, source_type, source_id, source_number,
        account_id, account_name_snapshot, debit_usd, credit_usd, debit_cdf, credit_cdf, currency, amount, exchange_rate)
      SELECT 'legacy-restore:sale:' || s.id, s.sale_date, 'sale', s.id, s.sale_number, a.id, a.name,
             CASE WHEN a.name = 'Cost of Goods Sold' THEN 40 ELSE 0 END, CASE WHEN a.name = 'Inventory' THEN 40 ELSE 0 END,
             CASE WHEN a.name = 'Cost of Goods Sold' THEN 112000 ELSE 0 END, CASE WHEN a.name = 'Inventory' THEN 112000 ELSE 0 END,
             'USD', 40, 2800
      FROM sales s CROSS JOIN chart_of_accounts a
      WHERE s.sale_number = 'SAL-PRE' AND a.name IN ('Cost of Goods Sold', 'Inventory')`);
    assert.equal((await balances(client))["Inventory"], 20);

    const fix = readFileSync(path.join(root, "lib/db/drizzle/0008_legacy_restore_inventory_fix.sql"), "utf8");
    await client.query(fix);
    await client.query(fix); // idempotent
    const books = await balances(client);
    assert.equal(books["Inventory"], 60, "pre-cutover cost no longer double counted");
    assert.equal(books["Cost of Goods Sold"], 40, "the cost stays expensed");
    assert.equal(await unbalancedJournals(client), 0);
  });
});
