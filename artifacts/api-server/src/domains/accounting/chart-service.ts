import { db } from "@workspace/db";
import { chartOfAccountsTable } from "@workspace/db/schema";
import { asc, eq, ilike } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { ACCOUNTS, canonicalTypeFor, normalizeName, type AccountType } from "../../lib/accounting";
import { badRequest, conflict, notFound } from "../../shared/http/errors";

const VALID_TYPES = new Set<AccountType>(["asset", "liability", "income", "expense", "equity"]);
/** System accounts the ledger posts to. They are always listed, never renamed or retyped. */
const CANONICAL_TYPES = new Map<string, AccountType>(
  Object.values(ACCOUNTS).map((name) => [name, canonicalTypeFor(name)!] as const),
);

function accountType(value: string): AccountType {
  const normalized = value.toLowerCase() as AccountType;
  if (!VALID_TYPES.has(normalized)) throw badRequest("Account type must be asset, liability, income, expense, or equity");
  return normalized;
}

export function canonicalAccountType(name: string): AccountType | undefined {
  return CANONICAL_TYPES.get(normalizeName(name));
}

/**
 * Production databases can contain canonical accounts created before the type
 * guard existed (for example Cash persisted as income). Repair those rows on
 * read so every downstream accounting consumer agrees. Every account is listed
 * with its book balance in its normal direction, so Inventory, Supplier
 * Payables and the equity accounts are visible instead of hidden.
 */
export async function listChartAccounts() {
  const rows = await db.select().from(chartOfAccountsTable).orderBy(asc(chartOfAccountsTable.type), asc(chartOfAccountsTable.name));

  const repairs = rows.flatMap((row) => {
    const requiredType = canonicalAccountType(row.name);
    if (!requiredType || (row.type === requiredType && row.isActive)) return [];
    return [
      db.update(chartOfAccountsTable)
        .set({ type: requiredType, isActive: true })
        .where(eq(chartOfAccountsTable.id, row.id)),
    ];
  });
  if (repairs.length > 0) await Promise.all(repairs);

  const balances = await db.execute(sql`
    SELECT account_id, SUM(debit_usd - credit_usd) AS net_usd, SUM(debit_cdf - credit_cdf) AS net_cdf, COUNT(*) AS lines
    FROM accounting_entries GROUP BY account_id
  `);
  const byAccount = new Map((balances.rows as Array<Record<string, unknown>>).map((row) => [Number(row.account_id), row]));

  return rows.map((row) => {
    const requiredType = canonicalAccountType(row.name);
    const type = requiredType ?? (row.type as AccountType);
    const totals = byAccount.get(row.id);
    const sign = type === "asset" || type === "expense" ? 1 : -1;
    return {
      ...row,
      type,
      isActive: requiredType ? true : row.isActive,
      isSystem: !!requiredType,
      balanceUsd: Math.round(sign * Number(totals?.net_usd ?? 0) * 1e6) / 1e6,
      balanceCdf: Math.round(sign * Number(totals?.net_cdf ?? 0) * 1e6) / 1e6,
      entryCount: Number(totals?.lines ?? 0),
    };
  });
}

export async function createChartAccount(name: string, type: string, description?: string) {
  const normalizedName = normalizeName(name);
  const requestedType = accountType(type);
  const requiredType = canonicalAccountType(normalizedName);
  if (requiredType && requestedType !== requiredType) {
    throw badRequest(`${normalizedName} is a canonical ${requiredType} account and its type cannot be changed`);
  }

  const [existing] = await db.select({ id: chartOfAccountsTable.id }).from(chartOfAccountsTable)
    .where(ilike(chartOfAccountsTable.name, normalizedName)).limit(1);
  if (existing) throw conflict("Account name already exists");

  const [row] = await db.insert(chartOfAccountsTable).values({
    name: normalizedName,
    type: requiredType ?? requestedType,
    description: description ?? null,
    isActive: true,
  }).returning();
  if (!row) throw conflict("Unable to create account");
  return row;
}

export async function updateChartAccount(id: number, input: { name?: string; type?: string; description?: string; isActive?: boolean }) {
  const [existing] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, id)).limit(1);
  if (!existing) throw notFound("Account not found");

  const existingCanonicalType = canonicalAccountType(existing.name);
  const nextName = input.name !== undefined ? normalizeName(input.name) : existing.name;
  const nextCanonicalType = canonicalAccountType(nextName);
  if (existingCanonicalType && nextName !== existing.name) {
    throw badRequest(`Canonical account ${existing.name} cannot be renamed`);
  }
  if (!existingCanonicalType && nextCanonicalType) {
    throw conflict(`${nextName} is reserved for the canonical chart of accounts`);
  }

  const requestedType = input.type !== undefined ? accountType(input.type) : (existing.type as AccountType);
  if (existingCanonicalType && requestedType !== existingCanonicalType) {
    throw badRequest(`${existing.name} must remain a ${existingCanonicalType} account`);
  }
  if (existingCanonicalType && input.isActive === false) {
    throw badRequest(`Canonical account ${existing.name} cannot be deactivated`);
  }

  const [row] = await db.update(chartOfAccountsTable).set({
    ...(input.name !== undefined && { name: nextName }),
    ...(input.type !== undefined && { type: requestedType }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  }).where(eq(chartOfAccountsTable.id, id)).returning();
  if (!row) throw notFound("Account not found");
  return row;
}

export async function deactivateChartAccount(id: number) {
  const [existing] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, id)).limit(1);
  if (!existing) throw notFound("Account not found");
  if (canonicalAccountType(existing.name)) throw badRequest(`Canonical account ${existing.name} cannot be deactivated`);
  const [usage] = (await db.execute(sql`
    SELECT COALESCE(SUM(debit_usd - credit_usd), 0) AS net FROM accounting_entries WHERE account_id = ${id}
  `)).rows as Array<{ net: string | number }>;
  if (Math.abs(Number(usage?.net ?? 0)) > 0.000001) {
    throw badRequest(`${existing.name} still has a balance. Close it to another account before deactivating it.`);
  }
  await db.update(chartOfAccountsTable).set({ isActive: false }).where(eq(chartOfAccountsTable.id, id));
  return { ok: true, deactivated: true };
}
