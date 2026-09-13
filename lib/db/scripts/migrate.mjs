import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running migrations.");
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

try {
  // A session advisory lock prevents two overlapping deploys from attempting
  // to advance the migration journal at the same time.
  await client.query("SELECT pg_advisory_lock(hashtext('oxygen_gym_drizzle_migrations'))");
  const database = drizzle(client);
  await migrate(database, { migrationsFolder });
  console.log("Database migrations applied successfully.");
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  try {
    await client.query("SELECT pg_advisory_unlock(hashtext('oxygen_gym_drizzle_migrations'))");
  } finally {
    client.release();
    await pool.end();
  }
}
