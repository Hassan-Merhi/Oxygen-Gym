import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { badRequest } from "./errors";

export interface MutationRequestContext {
  scope: string;
  idempotencyKey?: string;
  financial: boolean;
}

const storage = new AsyncLocalStorage<MutationRequestContext>();
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const FINANCIAL_PREFIXES = [
  "/api/members",
  "/api/payments",
  "/api/vouchers",
  "/api/ledger",
  "/api/accounts",
  "/api/financials",
  "/api/stock",
  "/api/supplier-credits",
  "/api/sales",
  "/api/payroll",
  "/api/commissions",
];

export function getMutationRequestContext(): MutationRequestContext | undefined {
  return storage.getStore();
}

export function mutationRequestContext(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const path = req.originalUrl.split("?", 1)[0] || req.path;
  const rawKey = req.get("Idempotency-Key")?.trim();
  if (rawKey && (rawKey.length < 8 || rawKey.length > 200)) {
    throw badRequest("Idempotency-Key must be between 8 and 200 characters");
  }

  storage.run({
    scope: `${req.method.toUpperCase()}:${path}`,
    idempotencyKey: rawKey || undefined,
    financial: FINANCIAL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
  }, next);
}
