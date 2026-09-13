import app from "./app";
import { env } from "./config/env";
import { scheduleBackgroundJobs } from "./jobs/scheduler";
import { logger } from "./lib/logger";
import { runStartupMigrations } from "./migrations/startup";

async function start(): Promise<void> {
  await runStartupMigrations();
  scheduleBackgroundJobs();

  app.listen(env.port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port: env.port, nodeEnv: env.nodeEnv }, "Server listening");
  });
}

start().catch((err) => {
  logger.fatal({ err }, "Server startup failed");
  process.exit(1);
});
