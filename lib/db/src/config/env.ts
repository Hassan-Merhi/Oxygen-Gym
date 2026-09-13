function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} environment variable is required.`);
  return value;
}

export const dbEnv = Object.freeze({
  databaseUrl: required("DATABASE_URL"),
});

export type DatabaseEnv = typeof dbEnv;
