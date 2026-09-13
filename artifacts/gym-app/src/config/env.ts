function normalizeBaseUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

export const AUTH_TOKEN_KEY = "gym_token" as const;

export const clientEnv = Object.freeze({
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
});

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) throw new Error(`API path must start with '/': ${path}`);
  return `${clientEnv.apiBaseUrl}${path}`;
}
