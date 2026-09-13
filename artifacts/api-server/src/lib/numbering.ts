import { db, systemCountersTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const PREFIXES: Record<string, string> = {
  member: "MEM",
  staff: "STF",
  plan: "PLN",
  payment: "PAY",
  voucher: "VCH",
  sale: "SAL",
  payroll: "PRL",
  product: "PRD",
};

/**
 * Atomically increment a document counter in one PostgreSQL statement.
 *
 * The previous select-then-update implementation allowed two concurrent
 * requests to read the same counter and issue the same financial document
 * number. The upsert below is serialized by PostgreSQL's row-level conflict
 * handling and returns the committed next value.
 */
export async function getNextNumber(entity: string): Promise<string> {
  const prefix = PREFIXES[entity] ?? entity.toUpperCase().slice(0, 3);

  const [counter] = await db
    .insert(systemCountersTable)
    .values({ entity, currentCount: 1 })
    .onConflictDoUpdate({
      target: systemCountersTable.entity,
      set: {
        currentCount: sql`${systemCountersTable.currentCount} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ currentCount: systemCountersTable.currentCount });

  if (!counter) throw new Error(`Failed to allocate document number for ${entity}`);
  return `${prefix}-${String(counter.currentCount).padStart(6, "0")}`;
}
