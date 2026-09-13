import { db } from "@workspace/db";
import { chartOfAccountsTable } from "@workspace/db/schema";
import { asc, eq, ilike } from "drizzle-orm";
import { ACCOUNTS, normalizeName, type AccountType } from "../../lib/accounting";
import { badRequest, conflict, notFound } from "../../shared/http/errors";

const VALID_TYPES = new Set<AccountType>(["asset", "liability", "income", "expense", "equity"]);
const CANONICAL_TYPES = new Map<string, AccountType>([
  [ACCOUNTS.CASH, "asset"],
  [ACCOUNTS.BANK, "asset"],
  [ACCOUNTS.MOBILE_MONEY, "asset"],
  [ACCOUNTS.PETTY_CASH, "asset"],
  [ACCOUNTS.INVENTORY, "asset"],
  [ACCOUNTS.SUPPLIER_PAYABLES, "liability"],
  [ACCOUNTS.MEMBERSHIP_REVENUE, "income"],
  [ACCOUNTS.SALES_REVENUE, "income"],
  [ACCOUNTS.OTHER_INCOME, "income"],
  [ACCOUNTS.COGS, "expense"],
  [ACCOUNTS.PAYROLL_EXPENSE, "expense"],
  [ACCOUNTS.GENERAL_EXPENSE, "expense"],
  [ACCOUNTS.OTHER_EXPENSE, "expense"],
]);

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
 * read so the UI never computes debit-normal cash with credit-normal polarity,
 * and persist the correction so every downstream accounting consumer agrees.
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

  return rows.map((row) => {
    const requiredType = canonicalAccountType(row.name);
    return requiredType ? { ...row, type: requiredType, isActive: true } : row;
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
  await db.update(chartOfAccountsTable).set({ isActive: false }).where(eq(chartOfAccountsTable.id, id));
  return { ok: true, deactivated: true };
}
