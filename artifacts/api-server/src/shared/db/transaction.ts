import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function withTransaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  return db.transaction(work);
}

/**
 * Serialize a financial mutation for the lifetime of the current database
 * transaction. PostgreSQL releases transaction advisory locks automatically on
 * commit/rollback, so a failed financial event can never leave a stale lock.
 */
export async function lockFinancialEvent(tx: DatabaseTransaction, key: string): Promise<void> {
  const normalized = key.trim();
  if (!normalized) throw new Error("Financial lock key cannot be empty");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`oxygen-gym:${normalized}`}, 0))`);
}

/**
 * Acquire multiple locks in deterministic order to prevent lock-order deadlocks
 * when one event touches several products/accounts.
 */
export async function lockFinancialEvents(tx: DatabaseTransaction, keys: string[]): Promise<void> {
  const uniqueKeys = [...new Set(keys.map((key) => key.trim()).filter(Boolean))].sort();
  for (const key of uniqueKeys) await lockFinancialEvent(tx, key);
}

export function withLockedTransaction<T>(
  key: string,
  work: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockFinancialEvent(tx, key);
    return work(tx);
  });
}
