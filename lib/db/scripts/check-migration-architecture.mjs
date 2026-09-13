import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const dbRoot = path.join(repoRoot, "lib", "db");
const apiSourceRoot = path.join(repoRoot, "artifacts", "api-server", "src");

function fail(message) {
  console.error(`DB architecture check failed: ${message}`);
  process.exitCode = 1;
}

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

const startup = await text("artifacts/api-server/src/index.ts");
const forbiddenStartupPatterns = [
  [/runStartupMigrations\s*\(/, "runStartupMigrations()"],
  [/\bALTER\s+TABLE\b/i, "ALTER TABLE"],
  [/\bCREATE\s+TABLE\b/i, "CREATE TABLE"],
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bTRUNCATE\b/i, "TRUNCATE"],
  [/\bcash_wipe_v1\b/i, "cash_wipe_v1"],
];
for (const [pattern, label] of forbiddenStartupPatterns) {
  if (pattern.test(startup)) fail(`normal server startup contains ${label}`);
}

for (const file of await walk(apiSourceRoot)) {
  if (!/\.(?:ts|tsx|js|mjs)$/.test(file)) continue;
  const source = await readFile(file, "utf8");
  if (/\bcash_wipe_v1\b/i.test(source)) {
    fail(`runtime source references cash_wipe_v1: ${path.relative(repoRoot, file)}`);
  }
}

const journalPath = path.join(dbRoot, "drizzle", "meta", "_journal.json");
const journal = JSON.parse(await readFile(journalPath, "utf8"));
if (journal.dialect !== "postgresql") fail("Drizzle journal is not PostgreSQL");
if (!Array.isArray(journal.entries) || journal.entries.length === 0) fail("Drizzle migration journal has no entries");

for (const entry of journal.entries ?? []) {
  if (!entry || typeof entry.tag !== "string" || !/^\d{4}_[a-z0-9_]+$/i.test(entry.tag)) {
    fail(`invalid migration journal tag: ${String(entry?.tag)}`);
    continue;
  }
  try {
    await access(path.join(dbRoot, "drizzle", `${entry.tag}.sql`), constants.R_OK);
  } catch {
    fail(`journal entry ${entry.tag} has no matching SQL file`);
  }
}

const migrations = (await readdir(path.join(dbRoot, "drizzle")))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
for (const migration of migrations) {
  const sql = await readFile(path.join(dbRoot, "drizzle", migration), "utf8");
  const destructivePatterns = [
    [/\bDELETE\s+FROM\b/i, "DELETE FROM"],
    [/\bTRUNCATE\b/i, "TRUNCATE"],
    [/\bcash_wipe_v1\b/i, "cash_wipe_v1"],
    [/\bmigration_flags\b/i, "migration_flags"],
  ];
  for (const [pattern, label] of destructivePatterns) {
    if (pattern.test(sql)) fail(`${migration} contains destructive/repair-only token ${label}`);
  }
}

const destructiveScript = await text("lib/db/scripts/cash-wipe-v1.mjs");
for (const required of [
  "ALLOW_DESTRUCTIVE_DB_ADMIN",
  "CASH_WIPE_CONFIRM",
  "CASH_WIPE_PHRASE",
  "DELETE_FINANCIAL_HISTORY",
]) {
  if (!destructiveScript.includes(required)) fail(`cash-wipe-v1.mjs is missing guard ${required}`);
}

const guardedRepairs = [
  ["lib/db/scripts/repair-legacy-financials.mjs", "repair_legacy_financials_v1"],
  ["lib/db/scripts/repair-inventory-quantities.mjs", "repair_inventory_quantities_v1"],
];
for (const [relativePath, confirmation] of guardedRepairs) {
  const script = await text(relativePath);
  if (!script.includes("DB_REPAIR_CONFIRM") || !script.includes(confirmation)) {
    fail(`${relativePath} is missing its explicit repair confirmation guard`);
  }
}

if (!process.exitCode) {
  console.log(`Database migration architecture check passed (${migrations.length} versioned migration${migrations.length === 1 ? "" : "s"}).`);
}
