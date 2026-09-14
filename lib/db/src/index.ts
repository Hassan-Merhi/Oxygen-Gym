import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { dbEnv } from "./config/env";

const { Pool } = pg;

export const pool = new Pool({ connectionString: dbEnv.databaseUrl });
export const db = drizzle(pool, { schema });

export type DbClient = typeof db;
export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type DbExecutor = DbClient | DbTransaction;

let financialIdempotencyInfrastructurePromise: Promise<void> | undefined;

/**
 * Keep the request-idempotency infrastructure available before the API accepts
 * financial mutations. The canonical schema is still owned by the Drizzle
 * migration, but this guard safely self-heals older production databases that
 * were deployed without that migration having been applied.
 */
export function ensureFinancialIdempotencyInfrastructure(): Promise<void> {
  if (!financialIdempotencyInfrastructurePromise) {
    financialIdempotencyInfrastructurePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "financial_idempotency" (
          "scope" text NOT NULL,
          "idempotency_key" text NOT NULL,
          "request_hash" text NOT NULL,
          "status" text DEFAULT 'processing' NOT NULL,
          "response_json" jsonb,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "completed_at" timestamp with time zone,
          CONSTRAINT "financial_idempotency_scope_key_pk"
            PRIMARY KEY ("scope", "idempotency_key")
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS "financial_idempotency_created_at_idx"
          ON "financial_idempotency" ("created_at")
      `);
    })().catch((error) => {
      // Permit a later startup/retry to attempt the repair again after a
      // transient database failure instead of caching a rejected promise.
      financialIdempotencyInfrastructurePromise = undefined;
      throw error;
    });
  }

  return financialIdempotencyInfrastructurePromise;
}

/**
 * Standard entry point for multi-step database writes.
 *
 * Domain code should use this helper rather than mixing independent writes on
 * the shared pool. Repository/helper functions accept DbExecutor so they can
 * participate in the caller's transaction instead of opening nested ones.
 */
export async function withTransaction<T>(
  work: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(work);
}

export * from "./schema";
