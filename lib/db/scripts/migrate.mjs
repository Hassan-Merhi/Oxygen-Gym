import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running migrations.");
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});

try {
  const database = drizzle(pool);
  await migrate(database, { migrationsFolder });
  console.log("Database migrations applied successfully.");
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
