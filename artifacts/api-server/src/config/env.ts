type NodeEnv = "development" | "test" | "production";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`${name} environment variable is required.`);
  return value;
}

function positiveInteger(name: string): number {
  const raw = required(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${JSON.stringify(raw)}.`);
  }
  return value;
}

function nodeEnv(): NodeEnv {
  const value = optional("NODE_ENV") ?? "development";
  if (value === "development" || value === "test" || value === "production") return value;
  throw new Error(`NODE_ENV must be development, test, or production; received ${JSON.stringify(value)}.`);
}

const runtime = nodeEnv();
const configuredSecret = optional("SESSION_SECRET");
if (runtime === "production" && !configuredSecret) {
  throw new Error("SESSION_SECRET is required in production.");
}

const staticDir = optional("STATIC_DIR") ?? optional("ELECTRON_STATIC_DIR");

export const env = Object.freeze({
  nodeEnv: runtime,
  isProduction: runtime === "production",
  port: positiveInteger("PORT"),
  sessionSecret: configuredSecret ?? "gympro-dev-secret-change-in-prod",
  logLevel: optional("LOG_LEVEL") ?? "info",
  staticDir,
});

export type ServerEnv = typeof env;
