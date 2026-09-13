import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";
import { AUTH_TOKEN_KEY, clientEnv } from "@/config/env";

const apiBase = clientEnv.apiBaseUrl;
if (apiBase) setBaseUrl(apiBase);

// Keep legacy direct /api fetches on the same authenticated transport contract
// as the generated client while they are migrated incrementally.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
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

  const resolvedUrl = relativeApiRequest && apiBase ? `${apiBase}${rawUrl}` : rawUrl;
  if (inputIsRequest) {
    const request = new Request(resolvedUrl, input);
    return nativeFetch(request, { ...init, headers });
  }
  return nativeFetch(resolvedUrl, { ...init, headers });
};

createRoot(document.getElementById("root")!).render(<App />);
