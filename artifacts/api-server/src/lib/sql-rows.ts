export function sqlRows<T extends object>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];

  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
