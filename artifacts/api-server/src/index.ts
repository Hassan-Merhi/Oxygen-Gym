import { ensureFinancialIdempotencyInfrastructure } from "@workspace/db";
import app from "./app";
import { env } from "./config/env";
import { scheduleBackgroundJobs } from "./jobs/scheduler";
import { logger } from "./lib/logger";

async function startServer(): Promise<void> {
  // Financial mutation routes use the idempotency table before their domain
  // writes run. Repair legacy production databases before accepting traffic.
  await ensureFinancialIdempotencyInfrastructure();

  scheduleBackgroundJobs();

  app.listen(env.port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port: env.port, nodeEnv: env.nodeEnv }, "Server listening");
  });
}

startServer().catch((err) => {
  logger.fatal({ err }, "Server startup failed");
  process.exit(1);
});
