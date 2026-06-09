import { db, systemCountersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

export async function getNextNumber(entity: string): Promise<string> {
  const prefix = PREFIXES[entity] ?? entity.toUpperCase().slice(0, 3);

  const count = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(systemCountersTable)
      .where(eq(systemCountersTable.entity, entity));

    if (existing) {
      const next = existing.currentCount + 1;
      await tx
        .update(systemCountersTable)
        .set({ currentCount: next })
        .where(eq(systemCountersTable.entity, entity));
      return next;
    } else {
      await tx.insert(systemCountersTable).values({ entity, currentCount: 1 });
      return 1;
    }
  });

  return `${prefix}-${String(count).padStart(6, "0")}`;
}
