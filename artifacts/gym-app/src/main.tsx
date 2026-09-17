import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";
import { AUTH_TOKEN_KEY, clientEnv } from "@/config/env";

const apiBase = clientEnv.apiBaseUrl;
if (apiBase) setBaseUrl(apiBase);

const nativeFetch = window.fetch.bind(window);
const mutationKeys = new Map<string, { key: string; expiresAt: number }>();
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// These reads were the dominant source of idle Render traffic. Their React Query
// callers may still ask frequently, but repeated reads are satisfied from memory
// until a user interaction, mutation, or tab-return makes a fresh read useful.
const QUIET_READ_PATHS = new Set([
  "/api/payments",
  "/api/vouchers",
  "/api/ledger/balance",
  "/api/notifications/count",
]);
const QUIET_READ_TTL_MS = 10 * 60_000;
const USER_REFRESH_WINDOW_MS = 2_500;

type CachedRead = {
  response: Response;
  expiresAt: number;
};

const readCache = new Map<string, CachedRead>();
const inFlightReads = new Map<string, Promise<Response>>();
const resourceQueues = new Map<string, Promise<void>>();
let forceFreshReadsUntil = 0;

function markUserRefreshWindow(): void {
  forceFreshReadsUntil = Date.now() + USER_REFRESH_WINDOW_MS;
}

document.addEventListener("pointerdown", markUserRefreshWindow, true);
document.addEventListener("keydown", markUserRefreshWindow, true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // Returning to the app should show changes made by another browser/user.
    readCache.clear();
  }
});

function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function releaseMutationKey(fingerprint: string, key: string, delayMs: number): void {
  window.setTimeout(() => {
    const current = mutationKeys.get(fingerprint);
    if (current?.key === key) mutationKeys.delete(fingerprint);
  }, delayMs);
}

function apiPath(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url.split("?", 1)[0] ?? url;
  }
}

function quietReadKey(url: string, token: string | null): string {
  return `${token ?? "anonymous"}\n${url}`;
}

function clearReadCache(): void {
  readCache.clear();
}

async function runSerializedRead(
  resource: string,
  key: string,
  request: () => Promise<Response>,
): Promise<Response> {
  const existing = inFlightReads.get(key);
  if (existing) return (await existing).clone();

  const previous = resourceQueues.get(resource) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(request);

  // Keep one network request at a time per logical resource. This turns the old
  // Promise.all pagination fan-out into a short serialized sequence while still
  // allowing unrelated API resources to load concurrently.
  resourceQueues.set(
    resource,
    task.then(() => undefined, () => undefined),
  );
  inFlightReads.set(key, task);

  try {
    return (await task).clone();
  } finally {
    if (inFlightReads.get(key) === task) inFlightReads.delete(key);
  }
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const inputIsRequest = typeof Request !== "undefined" && input instanceof Request;
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const relativeApiRequest = rawUrl.startsWith("/api/");
  const configuredApiRequest = Boolean(apiBase && rawUrl.startsWith(`${apiBase}/api/`));

  if (!relativeApiRequest && !configuredApiRequest) return nativeFetch(input, init);

  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const headers = new Headers(inputIsRequest ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);

  const method = (init?.method ?? (inputIsRequest ? input.method : "GET")).toUpperCase();
  const resolvedUrl = relativeApiRequest && apiBase ? `${apiBase}${rawUrl}` : rawUrl;
  const path = apiPath(resolvedUrl);
  const cacheableRead = method === "GET" && QUIET_READ_PATHS.has(path);
  const bypassReadCache = Date.now() < forceFreshReadsUntil;

  if (cacheableRead && !bypassReadCache) {
    const cacheKey = quietReadKey(resolvedUrl, token);
    const cached = readCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.response.clone();
    if (cached) readCache.delete(cacheKey);

    const request = async () => {
      const signal = init?.signal ?? (inputIsRequest ? input.signal : undefined);
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

      const response = inputIsRequest
        ? await nativeFetch(input, { ...init, method, headers })
        : await nativeFetch(resolvedUrl, { ...init, method, headers });

      if (response.ok) {
        readCache.set(cacheKey, {
          response: response.clone(),
          expiresAt: Date.now() + QUIET_READ_TTL_MS,
        });
      }
      return response;
    };

    return runSerializedRead(path, cacheKey, request);
  }

  let fingerprint: string | undefined;
  let idempotencyKey: string | undefined;

  if (MUTATING_METHODS.has(method) && !headers.has("idempotency-key")) {
    let body = typeof init?.body === "string" ? init.body : "";
    if (!body && inputIsRequest) {
      try {
        body = await input.clone().text();
      } catch {
        body = "";
      }
    }

    fingerprint = `${method}\n${rawUrl}\n${body}`;
    const now = Date.now();
    const existing = mutationKeys.get(fingerprint);
    if (existing && existing.expiresAt > now) {
      idempotencyKey = existing.key;
    } else {
      idempotencyKey = newIdempotencyKey();
      mutationKeys.set(fingerprint, { key: idempotencyKey, expiresAt: now + 5 * 60_000 });
    }
    headers.set("Idempotency-Key", idempotencyKey);
  }

  try {
    const response = inputIsRequest
      ? await nativeFetch(input, { ...init, method, headers })
      : await nativeFetch(resolvedUrl, { ...init, method, headers });

    if (MUTATING_METHODS.has(method) && response.ok) {
      // A successful write can affect cash-book totals and notifications. Drop all
      // cached reads so the mutation's normal query invalidation receives fresh data.
      clearReadCache();
      forceFreshReadsUntil = Date.now() + USER_REFRESH_WINDOW_MS;
    }

    if (fingerprint && idempotencyKey) {
      releaseMutationKey(
        fingerprint,
        idempotencyKey,
        response.ok ? 5_000 : 5 * 60_000,
      );
    }
    return response;
  } catch (error) {
    if (fingerprint && idempotencyKey) {
      releaseMutationKey(fingerprint, idempotencyKey, 5 * 60_000);
    }
    throw error;
  }
};

createRoot(document.getElementById("root")!).render(<App />);
