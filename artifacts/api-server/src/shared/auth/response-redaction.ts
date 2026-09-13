import type { Request } from "express";
import { hasPermission } from "./permissions";

export interface FinancialVisibility {
  viewCost: boolean;
  viewProfit: boolean;
}

function shouldRemoveKey(key: string, visibility: FinancialVisibility): boolean {
  const normalized = key.toLowerCase();
  if (!visibility.viewCost && normalized.includes("cost")) return true;
  if (!visibility.viewProfit && (normalized.includes("profit") || normalized.includes("margin"))) return true;
  return false;
}

export function redactFinancialFields<T>(value: T, visibility: FinancialVisibility): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactFinancialFields(item, visibility)) as T;
  }
  if (typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (shouldRemoveKey(key, visibility)) continue;
    output[key] = redactFinancialFields(child, visibility);
  }
  return output as T;
}

export function redactFinancialFieldsForRequest<T>(req: Request, value: T): T {
  return redactFinancialFields(value, {
    viewCost: hasPermission(req, "viewCost"),
    viewProfit: hasPermission(req, "viewProfit"),
  });
}
