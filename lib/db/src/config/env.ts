function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} environment variable is required.`);
  return value;
}

/**
 * pg-connection-string 2.x currently aliases prefer/require/verify-ca to
 * verify-full and emits a security warning because v3 will switch to standard
 * libpq semantics. Make the existing DATABASE_URL intent explicit now.
 *
 * Render internal database URLs normally omit sslmode. Render external URLs use
 * sslmode=require, including for self-signed/internal-style TLS configurations
 * where silently upgrading to verify-full can fail. The compatibility flag keeps
 * the requested libpq mode explicit and removes the upgrade warning without
 * weakening URLs that already request verify-full.
 */
export function normalizeDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    const needsExplicitLibpqSemantics = sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca";
    if (needsExplicitLibpqSemantics && !url.searchParams.has("uselibpqcompat")) {
      url.searchParams.set("uselibpqcompat", "true");
    }
    return url.toString();
  } catch {
    return value;
  }
}

export const dbEnv = Object.freeze({
  databaseUrl: normalizeDatabaseUrl(required("DATABASE_URL")),
});

export type DatabaseEnv = typeof dbEnv;
