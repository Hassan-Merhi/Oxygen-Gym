import { db, systemCountersTable, type DbExecutor } from "@workspace/db";
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
 * Allocate a sequential business number with a single atomic UPSERT.
 * Passing a transaction executor keeps number allocation in the same unit of
 * work as the record being created and avoids nested transactions.
 */
export async function getNextNumber(
  entity: string,
  executor: DbExecutor = db,
): Promise<string> {
  const prefix = PREFIXES[entity] ?? entity.toUpperCase().slice(0, 3);

  const [counter] = await executor
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

  if (!counter) {
    throw new Error(`Unable to allocate sequence number for ${entity}`);
  }

  return `${prefix}-${String(counter.currentCount).padStart(6, "0")}`;
}
