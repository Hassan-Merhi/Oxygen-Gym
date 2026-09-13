import { badRequest } from "./errors";

export function parseId(value: string | string[] | number | undefined, field = "id"): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw badRequest(`${field} must be a positive integer`);
  return parsed;
}

export function parsePage(value: unknown, fallback = 1): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw badRequest("page must be a positive integer");
  return parsed;
}

export function parseLimit(value: unknown, fallback = 20, max = 100): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw badRequest("limit must be a positive integer");
  return Math.min(parsed, max);
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw badRequest(`${field} is required`);
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw badRequest("Expected a string value");
  return value.trim();
}

export function nonNegativeNumber(value: unknown, field: string, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw badRequest(`${field} cannot be negative`);
  return parsed;
}

export function optionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw badRequest(`${field} must be a positive integer`);
  return parsed;
}

export function optionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw badRequest(`${field} must be a valid date`);
  return date;
}

export function assertDateOrder(start: Date | undefined, end: Date | undefined, message = "End date must be after start date"): void {
  if (start && end && end <= start) throw badRequest(message);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("Request body must be an object");
  return value as Record<string, unknown>;
}
