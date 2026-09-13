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

  if (!relativeApiRequest && !configuredApiRequest) return nativeFetch(input, init);

  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const headers = new Headers(inputIsRequest ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);

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
