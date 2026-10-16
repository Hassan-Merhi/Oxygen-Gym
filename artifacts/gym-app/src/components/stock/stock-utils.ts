const compactNumber = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function fmtMoney(value: number, currency: string = "USD"): string {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = compactNumber.format(amount);
  return currency === "CDF" ? `${formatted} FC` : `$${formatted}`;
}

export function fmtCount(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value || 0);
}

export type ProductStatus = "active" | "archived" | "deleted" | "all";
export type ProductStatusChange = "archived" | "active" | "deleted";

export function errorMessage(caught: unknown, fallback: string): string {
  const err = caught as { data?: { error?: string }; response?: { data?: { error?: string } }; message?: string };
  return err?.data?.error ?? err?.response?.data?.error ?? err?.message ?? fallback;
}
