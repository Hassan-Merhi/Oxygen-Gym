import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getMutationRequestContext } from "../http/idempotency-context";
import { conflict } from "../http/errors";

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

let ensureIdempotencyTablePromise: Promise<void> | undefined;

function ensureIdempotencyTable(): Promise<void> {
  if (!ensureIdempotencyTablePromise) {
    ensureIdempotencyTablePromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS financial_idempotency (
          scope TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          request_hash TEXT,
          status TEXT NOT NULL DEFAULT 'processing',
          response_json JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          PRIMARY KEY (scope, idempotency_key)
        )
      `);
      await db.execute(sql`
        ALTER TABLE financial_idempotency
          ADD COLUMN IF NOT EXISTS request_hash TEXT
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_financial_idempotency_created_at
          ON financial_idempotency(created_at)
      `);
    })().catch((error) => {
      ensureIdempotencyTablePromise = undefined;
      throw error;
    });
  }
  return ensureIdempotencyTablePromise;
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

/**
 * Execute all writes as one unit. Financial HTTP mutations also take one shared
 * transaction-scoped lock. This deliberately favors correctness over parallel
 * financial writes: sales, stock, supplier balances, payroll, payments, and
 * reversals cannot race each other while they read/modify shared money or stock.
 *
 * When the caller supplies Idempotency-Key, the key and serialized result are
 * stored in the SAME transaction as the business event. Concurrent retries wait
 * on the primary key; failed transactions roll back both the event and the claim.
 */
export async function withTransaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  const context = getMutationRequestContext();
  if (context?.idempotencyKey) await ensureIdempotencyTable();

  return db.transaction(async (tx) => {
    if (context?.financial) {
      await lockFinancialEvent(tx, "financial-write");
    }

    if (!context?.idempotencyKey) return work(tx);

    const claimed = await tx.execute(sql`
      INSERT INTO financial_idempotency (scope, idempotency_key, request_hash, status)
      VALUES (${context.scope}, ${context.idempotencyKey}, ${context.requestHash}, 'processing')
      ON CONFLICT (scope, idempotency_key) DO NOTHING
      RETURNING idempotency_key
    `);

    if (claimed.rows.length === 0) {
      const prior = await tx.execute(sql`
        SELECT status, response_json, request_hash
        FROM financial_idempotency
        WHERE scope = ${context.scope}
          AND idempotency_key = ${context.idempotencyKey}
        FOR UPDATE
      `);
      const row = prior.rows[0] as { status?: string; response_json?: unknown; request_hash?: string | null } | undefined;
      if (row?.request_hash && row.request_hash !== context.requestHash) {
        throw conflict("Idempotency-Key was already used with different request data");
      }
      if (row?.status === "completed") return row.response_json as T;
      throw conflict(`Idempotency-Key is already in progress for ${context.scope}`);
    }

    const result = await work(tx);
    const serialized = JSON.stringify(result ?? null);
    await tx.execute(sql`
      UPDATE financial_idempotency
      SET status = 'completed',
          response_json = ${serialized}::jsonb,
          completed_at = NOW()
      WHERE scope = ${context.scope}
        AND idempotency_key = ${context.idempotencyKey}
    `);
    return result;
  });
}

export function withLockedTransaction<T>(
  key: string,
  work: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    await lockFinancialEvent(tx, key);
    return work(tx);
  });
}
