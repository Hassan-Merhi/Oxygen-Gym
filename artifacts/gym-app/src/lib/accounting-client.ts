/**
 * Shared helpers for the accounting screens: authenticated fetches that surface
 * the server's own error message, money formatting per currency, and business
 * dates on the gym's 21:00 Lubumbashi day boundary (the same one the API uses).
 */
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

const GYM_TIME_ZONE = "Africa/Lubumbashi";
/** A business day starts at 21:00 local time; this shift maps an instant to its business date. */
const BUSINESS_SHIFT_HOURS = 3;

export type Money = { usd: number; cdf: number };

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function apiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("gym_token");
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.method && init.method !== "GET" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as { error?: string; details?: { code?: string } };
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, body.details?.code);
  return body as T;
}

export function useApi<T>(path: string | null, options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => apiRequest<T>(path!),
    enabled: !!path,
    staleTime: 5_000,
    ...options,
  });
}

/** Query string from defined values only. */
export function qs(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function localeFor(language: string) {
  return language === "fr" ? "fr-FR" : language === "ar" ? "ar-u-nu-latn" : "en-US";
}

export function formatAmount(value: number | null | undefined, currency: "USD" | "CDF" | string, language = "fr") {
  const amount = Number(value ?? 0);
  const formatted = new Intl.NumberFormat(localeFor(language), {
    minimumFractionDigits: currency === "CDF" ? 0 : 2,
    maximumFractionDigits: currency === "CDF" ? 0 : 2,
  }).format(Math.abs(amount));
  const sign = amount < 0 ? "−" : "";
  return currency === "CDF" ? `${sign}${formatted} FC` : `${sign}$${formatted}`;
}

export function formatRate(rate: number | null | undefined, language = "fr") {
  return new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 2 }).format(Number(rate ?? 0));
}

/** Business date (YYYY-MM-DD) of an instant. */
export function businessDateKey(value: Date | string = new Date()) {
  const date = new Date(new Date(value).getTime() + BUSINESS_SHIFT_HOURS * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: GYM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftDateKey(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type DatePreset = "today" | "yesterday" | "month" | "last_month" | "year" | "all" | "custom";

export function rangeForPreset(preset: DatePreset, customFrom = "", customTo = ""): { from: string; to: string } {
  const today = businessDateKey();
  const [year, month] = today.split("-").map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": { const day = shiftDateKey(today, -1); return { from: day, to: day }; }
    case "month": return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay(year, month))}` };
    case "last_month": {
      const y = month === 1 ? year - 1 : year;
      const m = month === 1 ? 12 : month - 1;
      return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
    }
    case "year": return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "custom": return { from: customFrom, to: customTo };
    default: return { from: "", to: "" };
  }
}

/** Error text for a toast: the server's message, with the closed-period case made explicit. */
export function errorMessage(error: unknown, t: (key: string) => string) {
  if (error instanceof ApiError && error.code === "PERIOD_CLOSED") return t("acc.error.periodClosed");
  if (error instanceof ApiError && error.code === "LINKED_PAYMENT") return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Display name of a ledger account: system accounts are translated, custom ones are shown as named. */
export function accountLabel(name: string | null | undefined, t: (key: string) => string) {
  if (!name) return "";
  const key = `account.${name}`;
  const translated = t(key);
  return translated === key ? name : translated;
}
