type NodeEnv = "development" | "test" | "production";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = optional(name);
  if (!raw && fallback !== undefined) return fallback;
  if (!raw) throw new Error(`${name} environment variable is required.`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${name} must be a positive integer; received ${JSON.stringify(raw)}.`,
    );
  }
  return value;
}

function userIdList(name: string): readonly number[] {
  const raw = optional(name);
  if (!raw) return [];

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const ids = values.map((value) => Number(value));
  if (ids.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(
      `${name} must contain only comma-separated positive user IDs; received ${JSON.stringify(raw)}.`,
    );
  }
  return [...new Set(ids)];
}

function nodeEnv(): NodeEnv {
  const value = optional("NODE_ENV") ?? "development";
  if (value === "development" || value === "test" || value === "production")
    return value;
  throw new Error(
    `NODE_ENV must be development, test, or production; received ${JSON.stringify(value)}.`,
  );
}

const runtime = nodeEnv();
const configuredSecret = optional("SESSION_SECRET");
if (runtime === "production" && !configuredSecret) {
  throw new Error("SESSION_SECRET is required in production.");
}

export const env = Object.freeze({
  nodeEnv: runtime,
  isProduction: runtime === "production",
  port: positiveInteger("PORT", 3000),
  sessionSecret: configuredSecret ?? "gympro-dev-secret-change-in-prod",
  logLevel: optional("LOG_LEVEL") ?? "info",
  staticDir: optional("STATIC_DIR") ?? optional("ELECTRON_STATIC_DIR"),
  clerkSecretKey: optional("CLERK_SECRET_KEY"),
  rolloutInternalUserIds: userIdList("ROLLOUT_INTERNAL_USER_IDS"),
  rolloutCanaryUserIds: userIdList("ROLLOUT_CANARY_USER_IDS"),
});

export type ServerEnv = typeof env;
