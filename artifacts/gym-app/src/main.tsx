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
// route them through the configured API base and attach the current bearer token.
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

  if (!relativeApiRequest && !configuredApiRequest) {
    return nativeFetch(input, init);
  }

  const token = localStorage.getItem("gym_token");
  const headers = new Headers(inputIsRequest ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));

  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  if (inputIsRequest) {
    return nativeFetch(input, { ...init, headers });
  }

  const resolvedUrl = relativeApiRequest && apiBase ? `${apiBase}${rawUrl}` : rawUrl;
  return nativeFetch(resolvedUrl, { ...init, headers });
};

createRoot(document.getElementById("root")!).render(<App />);
