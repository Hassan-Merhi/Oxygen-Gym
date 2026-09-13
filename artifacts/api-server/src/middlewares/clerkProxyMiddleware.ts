/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain. Kept for legacy
 * deployments that still use Clerk; runtime configuration is owned by env.ts.
 */
import { createProxyMiddleware } from "http-proxy-middleware";
import type { RequestHandler } from "express";
import type { IncomingHttpHeaders } from "http";
import { env } from "../config/env";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

export function getClerkProxyHost(req: { headers: IncomingHttpHeaders }): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = raw?.split(",")[0]?.trim();
  return firstHop || req.headers.host?.trim() || undefined;
}

export function clerkProxyMiddleware(): RequestHandler {
  if (!env.isProduction || !env.clerkSecretKey) {
    return (_req, _res, next) => next();
  }

  const secretKey = env.clerkSecretKey;
  return createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    pathRewrite: (path: string) => path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = getClerkProxyHost(req) || "";
        const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}`;
        proxyReq.setHeader("Clerk-Proxy-Url", proxyUrl);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);

        const xff = req.headers["x-forwarded-for"];
        const clientIp =
          (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          "";
        if (clientIp) proxyReq.setHeader("X-Forwarded-For", clientIp);
      },
    },
  }) as RequestHandler;
}
