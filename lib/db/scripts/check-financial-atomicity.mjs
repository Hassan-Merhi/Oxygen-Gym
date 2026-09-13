import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function fail(message) {
  throw new Error(`Financial atomicity check failed: ${message}`);
}

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

if (!process.env.DATABASE_URL) fail("DATABASE_URL is required");

const [transactionFacade, accounting, supplierService, app, webMain] = await Promise.all([
  text("artifacts/api-server/src/shared/db/transaction.ts"),
  text("artifacts/api-server/src/lib/accounting.ts"),
  text("artifacts/api-server/src/domains/inventory/supplier-credit-service.ts"),
  text("artifacts/api-server/src/app.ts"),
  text("artifacts/gym-app/src/main.tsx"),
]);

for (const required of ["financial-write", "financial_idempotency", "pg_advisory_xact_lock", "request_hash", "response_json"]) {
  if (!transactionFacade.includes(required)) fail(`transaction facade is missing ${required}`);
}
if (!app.includes("mutationRequestContext")) fail("request idempotency context is not installed in the API app");
if (!webMain.includes("Idempotency-Key")) fail("web API mutations do not attach Idempotency-Key");
if (!accounting.includes('"Accounts Payable"')) fail("Accounts Payable is missing from accounting account typing");
if (/catch\s*\{[\s\S]{0,120}concurrent insert race/i.test(accounting)) {
  fail("accounting helper still swallows account-posting errors");
}
for (const required of ["appendLedgerEntry", "postDoubleEntry", "reverseEntries", "exchangeRate: rate", "amountUsd", "amountCdf"]) {
  if (!supplierService.includes(required)) fail(`supplier payment flow is missing ${required}`);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const first = await pool.connect();
const second = await pool.connect();
const probeScope = `ci-atomicity-${Date.now()}`;
const probeKey = "rollback-probe";

try {
  const tableCheck = await first.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'financial_idempotency'
  `);
  const columns = new Set(tableCheck.rows.map((row) => row.column_name));
  for (const column of ["scope", "idempotency_key", "request_hash", "status", "response_json"]) {
    if (!columns.has(column)) fail(`financial_idempotency is missing column ${column}`);
  }

  const supplierColumnCheck = await first.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'supplier_payments'
  `);
  const supplierColumns = new Set(supplierColumnCheck.rows.map((row) => row.column_name));
  for (const column of ["exchange_rate", "amount_usd", "amount_cdf"]) {
    if (!supplierColumns.has(column)) fail(`supplier_payments is missing column ${column}`);
  }

  await first.query("BEGIN");
  await first.query(
    `INSERT INTO financial_idempotency (scope, idempotency_key, request_hash, status) VALUES ($1, $2, $3, 'processing')`,
    [probeScope, probeKey, "rollback-hash"],
  );
  await first.query("ROLLBACK");

  const rolledBack = await first.query(
    "SELECT 1 FROM financial_idempotency WHERE scope = $1 AND idempotency_key = $2",
    [probeScope, probeKey],
  );
  if (rolledBack.rowCount !== 0) fail("idempotency claim survived a transaction rollback");

  await first.query(
    `INSERT INTO financial_idempotency (scope, idempotency_key, request_hash, status, response_json, completed_at)
     VALUES ($1, $2, $3, 'completed', $4::jsonb, NOW())`,
    [probeScope, "duplicate-probe", "hash-a", JSON.stringify({ ok: true })],
  );
  const duplicate = await first.query(
    `INSERT INTO financial_idempotency (scope, idempotency_key, request_hash, status)
     VALUES ($1, $2, $3, 'processing')
     ON CONFLICT (scope, idempotency_key) DO NOTHING
     RETURNING idempotency_key`,
    [probeScope, "duplicate-probe", "hash-a"],
  );
  if (duplicate.rowCount !== 0) fail("duplicate idempotency key was inserted twice");

  await first.query("BEGIN");
  await first.query("SELECT pg_advisory_xact_lock(hashtextextended('oxygen-gym:financial-write', 0))");
  await second.query("BEGIN");
  const blocked = await second.query("SELECT pg_try_advisory_xact_lock(hashtextextended('oxygen-gym:financial-write', 0)) AS acquired");
  if (blocked.rows[0]?.acquired !== false) fail("second financial transaction acquired an already-held financial lock");
  await first.query("COMMIT");
  const acquiredAfterCommit = await second.query("SELECT pg_try_advisory_xact_lock(hashtextextended('oxygen-gym:financial-write', 0)) AS acquired");
  if (acquiredAfterCommit.rows[0]?.acquired !== true) fail("financial lock was not released after commit");
  await second.query("ROLLBACK");

  await first.query("DELETE FROM financial_idempotency WHERE scope = $1", [probeScope]);
  console.log("Financial atomicity check passed: migrations, rollback, idempotency uniqueness, advisory locking, and posting wiring verified.");
} finally {
  try { await first.query("ROLLBACK"); } catch {}
  try { await second.query("ROLLBACK"); } catch {}
  first.release();
  second.release();
  await pool.end();
}
