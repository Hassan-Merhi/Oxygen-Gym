import { ensureFinancialIdempotencyInfrastructure, pool } from "@workspace/db";
import type { Server } from "node:http";
import app from "./app";
import { env } from "./config/env";
import { scheduleBackgroundJobs, stopBackgroundJobs } from "./jobs/scheduler";
import { logger } from "./lib/logger";
import { markRuntimeDraining, markRuntimeReady } from "./shared/runtime/readiness";

const FORCE_SHUTDOWN_MS = 25_000;
let shutdownPromise: Promise<void> | undefined;

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
