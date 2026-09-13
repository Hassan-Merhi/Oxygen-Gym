import pg from "pg";

const { Pool } = pg;

const required = {
  ALLOW_DESTRUCTIVE_DB_ADMIN: "YES",
  CASH_WIPE_CONFIRM: "cash_wipe_v1",
  CASH_WIPE_PHRASE: "DELETE_FINANCIAL_HISTORY",
};

for (const [key, value] of Object.entries(required)) {
  if (process.env[key] !== value) {
    throw new Error(`Refusing destructive cash wipe. Set ${key}=${value} explicitly.`);
  }
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running a destructive admin script.");
}

const target = new URL(process.env.DATABASE_URL);
console.warn(`DESTRUCTIVE OPERATION targeting database ${target.pathname.replace(/^\//, "")} on ${target.hostname}.`);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('oxygen_gym_cash_wipe_v1'))");

  const counts = {};
  for (const table of [
    "accounting_entries",
    "commissions",
    "expenses",
    "vouchers",
    "payments",
    "sales",
    "cash_ledger",
  ]) {
    const result = await client.query(`DELETE FROM ${table}`);
    counts[table] = result.rowCount ?? 0;
  }

  await client.query("COMMIT");
  console.warn("cash_wipe_v1 completed.", counts);
} catch (error) {
  await client.query("ROLLBACK");
  console.error("cash_wipe_v1 failed; transaction rolled back.", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
