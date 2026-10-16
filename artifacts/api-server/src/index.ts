import { ensureFinancialIdempotencyInfrastructure, pool } from "@workspace/db";
import type { Server } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import app from "./app";
import { env } from "./config/env";
import { scheduleBackgroundJobs, stopBackgroundJobs } from "./jobs/scheduler";
import { logger } from "./lib/logger";
import { markRuntimeDraining, markRuntimeReady } from "./shared/runtime/readiness";

const FORCE_SHUTDOWN_MS = 25_000;
let shutdownPromise: Promise<void> | undefined;

/**
 * Render can use a dashboard-defined build command instead of render.yaml.
 * The October ledger cutover added journal_id and accounting_periods, so the
 * API must never accept requests against a database where those migrations
 * have not run. Run the existing versioned migrator before listening, even
 * when Render skipped the build-time migration step.
 *
 * The migrator serializes concurrent deploys with a PostgreSQL advisory lock
 * and only applies unapplied migrations. A failure stops startup; it must not
 * silently downgrade to legacy accounting or create synthetic balances.
 */
async function ensureProductionLedgerSchema(): Promise<void> {
  if (!env.isProduction) return;

  const migrationScript = path.resolve(process.cwd(), "lib/db/scripts/migrate.mjs");
  logger.info("Checking and applying production database migrations before opening the API");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [migrationScript], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Database migration failed (exit ${code ?? "none"}, signal ${signal ?? "none"}); refusing to start the API`));
    });
  });

  // A migration journal can exist on a legacy database even if the matching
  // SQL changes were never installed. Check the actual schema as well.
  const result = await pool.query<{
    periods: boolean;
    journal_id: boolean;
    balanced: boolean;
    append_only: boolean;
    period_lock: boolean;
  }>(`
    SELECT
      to_regclass('accounting_periods') IS NOT NULL AS periods,
      EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('accounting_entries')
          AND attname = 'journal_id' AND NOT attisdropped
      ) AS journal_id,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = to_regclass('accounting_entries')
          AND tgname = 'accounting_entries_balanced' AND NOT tgisinternal
      ) AS balanced,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = to_regclass('accounting_entries')
          AND tgname = 'accounting_entries_immutable' AND NOT tgisinternal
      ) AS append_only,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = to_regclass('accounting_entries')
          AND tgname = 'accounting_entries_period_lock' AND NOT tgisinternal
      ) AS period_lock
  `);

  const schema = result.rows[0];
  if (!schema || !Object.values(schema).every((ready) => ready === true)) {
    logger.error({ ledgerSchema: schema }, "Production ledger schema is incomplete after migration");
    throw new Error("Production ledger schema is incomplete; refusing to serve financial and POS requests");
  }
  logger.info("Production accounting schema and journal protections verified");
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    // Do not let idle keep-alive sockets consume the shutdown window. Active
    // requests remain open and are allowed to finish normally.
    server.closeIdleConnections?.();
  });
}

function shutdown(server: Server, signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    markRuntimeDraining();
    logger.info({ signal }, "Shutdown signal received; draining HTTP requests");

    const forceTimer = setTimeout(() => {
      logger.error({ signal }, "Graceful shutdown timed out; closing remaining connections");
      server.closeAllConnections?.();
      process.exit(1);
    }, FORCE_SHUTDOWN_MS);
    forceTimer.unref();

    try {
      // Prevent new cron executions first. Existing HTTP requests still have the
      // database pool available while server.close() waits for them to finish.
      await stopBackgroundJobs();
      await closeHttpServer(server);
      await pool.end();
      clearTimeout(forceTimer);
      logger.info({ signal }, "Graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      clearTimeout(forceTimer);
      logger.error({ err, signal }, "Graceful shutdown failed");
      process.exit(1);
    }
  })();

  return shutdownPromise;
}

async function startServer(): Promise<void> {
  // pg emits an `error` event when an idle pooled client loses its connection.
  // Without a listener, Node treats that event as uncaught and terminates the
  // process. Log it and let the pool discard/recreate the affected client.
  pool.on("error", (err) => {
    logger.error({ err }, "Unexpected idle PostgreSQL client error");
  });

  // Complete the ledger cutover and validate its constraints before any API request.
  await ensureProductionLedgerSchema();

  // Financial mutation routes use the idempotency table before their domain
  // writes run. Repair legacy production databases before accepting traffic.
  await ensureFinancialIdempotencyInfrastructure();

  const server = app.listen(env.port);
  // Render recommends longer keep-alive/header windows for Node services behind
  // its proxy to avoid intermittent connection resets on otherwise healthy apps.
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;

  server.once("listening", () => {
    scheduleBackgroundJobs();
    markRuntimeReady();
    logger.info({ port: env.port, nodeEnv: env.nodeEnv }, "Server listening and ready");
  });

  server.once("error", (err) => {
    markRuntimeDraining();
    logger.fatal({ err }, "HTTP server error");
    process.exit(1);
  });

  process.once("SIGTERM", () => {
    void shutdown(server, "SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown(server, "SIGINT");
  });
}

startServer().catch((err) => {
  markRuntimeDraining();
  logger.fatal({ err }, "Server startup failed");
  void pool.end().finally(() => process.exit(1));
});
