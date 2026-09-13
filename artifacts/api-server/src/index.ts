import app from "./app";
import { env } from "./config/env";
import { scheduleBackgroundJobs } from "./jobs/scheduler";
import { logger } from "./lib/logger";

scheduleBackgroundJobs();

app.listen(env.port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port: env.port, nodeEnv: env.nodeEnv }, "Server listening");
});
