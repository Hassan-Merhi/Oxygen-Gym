import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { commissionsTable, staffEmployeesTable } from "@workspace/db/schema";
import { eq, and, sum, count, inArray } from "drizzle-orm";

const router = Router();
router.use(requireAuth());

// ── Pending commission summary per employee ───────────────────────────────────
router.get("/summary", async (_req: Request, res: Response) => {
  const pending = await db
    .select({
      staffEmployeeId: commissionsTable.staffEmployeeId,
      pendingAmount: sum(commissionsTable.amount),
      pendingCount: count(commissionsTable.id),
      currency: commissionsTable.currency,
    })
    .from(commissionsTable)
    .where(eq(commissionsTable.status, "pending"))
    .groupBy(commissionsTable.staffEmployeeId, commissionsTable.currency);

  if (pending.length === 0) {
    res.json([]);
    return;
  }

  const empIds = pending.map((r) => r.staffEmployeeId);
  const employees = await db
    .select({ id: staffEmployeesTable.id, name: staffEmployeesTable.name })
    .from(staffEmployeesTable)
    .where(inArray(staffEmployeesTable.id, empIds));

  const empMap = new Map(employees.map((e) => [e.id, e.name]));

  res.json(
    pending.map((r) => ({
      staffEmployeeId: r.staffEmployeeId,
      staffName: empMap.get(r.staffEmployeeId) ?? "Unknown",
      pendingAmount: Number(r.pendingAmount ?? 0),
      currency: r.currency,
      pendingCount: Number(r.pendingCount ?? 0),
    }))
  );
});

export default router;
