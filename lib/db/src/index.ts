import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export type DbClient = typeof db;
export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type DbExecutor = DbClient | DbTransaction;

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
