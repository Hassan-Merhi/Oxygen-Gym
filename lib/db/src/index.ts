import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { dbEnv } from "./config/env";

const { Pool } = pg;

export const pool = new Pool({ connectionString: dbEnv.databaseUrl });
export const db = drizzle(pool, { schema });

export * from "./schema";
