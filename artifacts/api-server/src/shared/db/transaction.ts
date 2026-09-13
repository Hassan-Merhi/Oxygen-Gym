import { withTransaction as dbWithTransaction, type DbTransaction } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getMutationRequestContext } from "../http/idempotency-context";
import { conflict } from "../http/errors";

export type DatabaseTransaction = DbTransaction;

export async function lockFinancialEvent(tx: DbTransaction, key: string): Promise<void> {
  const normalized = key.trim();
  if (!normalized) throw new Error("Financial lock key cannot be empty");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`oxygen-gym:${normalized}`}, 0))`);
}

export async function lockFinancialEvents(tx: DbTransaction, keys: string[]): Promise<void> {
  const uniqueKeys = [...new Set(keys.map((key) => key.trim()).filter(Boolean))].sort();
  for (const key of uniqueKeys) await lockFinancialEvent(tx, key);
}

/**
 * Canonical API transaction boundary for financial writes.
 *
 * Financial mutation requests are serialized across modules before any source
 * row is read or changed. This prevents stock purchases, sales, supplier
 * payments, payroll, vouchers, payments, reversals, and commissions from racing
 * while they update shared money/stock state.
 *
 * When Idempotency-Key is supplied, the claim and response are persisted inside
 * the SAME transaction as the business event. A rollback removes the claim; a
 * committed retry replays the stored result without posting the event twice.
 */
export async function withTransaction<T>(work: (tx: DbTransaction) => Promise<T>): Promise<T> {
  const context = getMutationRequestContext();

  return dbWithTransaction(async (tx) => {
    if (context?.financial) {
      await lockFinancialEvent(tx, "financial-write");
    }

    if (!context?.idempotencyKey) {
      return work(tx);
    }

    const claimed = await tx.execute(sql`
      INSERT INTO financial_idempotency (
        scope,
        idempotency_key,
        request_hash,
        status
      ) VALUES (
        ${context.scope},
        ${context.idempotencyKey},
        ${context.requestHash},
        'processing'
      )
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
      const row = prior.rows[0] as {
        status?: string;
        response_json?: unknown;
        request_hash?: string | null;
      } | undefined;

      if (row?.request_hash && row.request_hash !== context.requestHash) {
        throw conflict("Idempotency-Key was already used with different request data");
      }
      if (row?.status === "completed") {
        return row.response_json as T;
      }
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
