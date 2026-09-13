import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// When deployed as a standalone static site (e.g. Render), point the API
// client at the separate API server. In Replit the proxy handles routing so
// no base URL is needed.
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
if (apiBase) {
  setBaseUrl(apiBase);
}

// Some pages still use the browser fetch API directly instead of the generated
// API client. Keep those /api requests consistent with the authenticated client:
// route them through the configured API base, attach auth, and protect mutation
// retries with an Idempotency-Key understood by the backend transaction layer.
const nativeFetch = window.fetch.bind(window);
const mutationKeys = new Map<string, { key: string; expiresAt: number }>();
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const inputIsRequest = typeof Request !== "undefined" && input instanceof Request;
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const relativeApiRequest = rawUrl.startsWith("/api/");
  const configuredApiRequest = Boolean(apiBase && rawUrl.startsWith(`${apiBase}/api/`));

  if (!relativeApiRequest && !configuredApiRequest) {
    return nativeFetch(input, init);
  }

  const token = localStorage.getItem("gym_token");
  const headers = new Headers(inputIsRequest ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));

  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const method = (init?.method ?? (inputIsRequest ? input.method : "GET")).toUpperCase();
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

  const resolvedUrl = relativeApiRequest && apiBase ? `${apiBase}${rawUrl}` : rawUrl;

  try {
    const response = inputIsRequest
      ? await nativeFetch(input, { ...init, method, headers })
      : await nativeFetch(resolvedUrl, { ...init, method, headers });

    if (fingerprint && idempotencyKey) {
      if (response.ok) {
        // Keep a short grace window so a double-click that lands just after the
        // first success still reuses the committed event instead of posting twice.
        releaseMutationKey(fingerprint, idempotencyKey, 5_000);
      } else {
        // A non-2xx response can still be ambiguous if the financial transaction
        // committed and a later route-side action failed. Retain the key so a
        // retry recovers the already-committed result rather than posting again.
        releaseMutationKey(fingerprint, idempotencyKey, 5 * 60_000);
      }
    }
    return response;
  } catch (error) {
    if (fingerprint && idempotencyKey) {
      // A network failure is ambiguous: the server may already have committed.
      // Retain the key so a retry can safely recover the committed result.
      releaseMutationKey(fingerprint, idempotencyKey, 5 * 60_000);
    }
    throw error;
  }
};

createRoot(document.getElementById("root")!).render(<App />);
