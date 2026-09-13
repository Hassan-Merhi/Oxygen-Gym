import { contractBodyAs, contractQueryAs } from "../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { staffEmployeesTable } from "@workspace/db/schema";
import { eq, and, ilike, or, desc, count, ne } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return req.__gymproUserName ?? "System";
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const { page = "1", limit = "20", search, status } = contractQueryAs<Record<string, string>>(req, ApiContracts.ListStaffEmployeesQueryParams);
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [ne(staffEmployeesTable.status, "archived") as ReturnType<typeof eq>];

  if (search) {
    conditions.push(
      or(
        ilike(staffEmployeesTable.name, `%${search}%`),
        ilike(staffEmployeesTable.staffNumber, `%${search}%`),
        ilike(staffEmployeesTable.phone, `%${search}%`),
        ilike(staffEmployeesTable.email, `%${search}%`)
      ) as ReturnType<typeof eq>
    );
  }
  if (status) conditions.push(eq(staffEmployeesTable.status, status));

  const where = and(...conditions);
  const [items, [totRow]] = await Promise.all([
    db.select().from(staffEmployeesTable).where(where).orderBy(desc(staffEmployeesTable.createdAt)).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(staffEmployeesTable).where(where),
  ]);

  res.json({ items, total: Number(totRow.total), page: pageNum, limit: limitNum });
});

// ── Get single ────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const [emp] = await db.select().from(staffEmployeesTable).where(eq(staffEmployeesTable.id, id));
  if (!emp) { res.status(404).json({ error: "Staff employee not found" }); return; }
  res.json(emp);
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const { name, phone, email, jobTitle, hireDate, salary, salaryCurrency, paymentFrequency, linkedUserId, notes } = contractBodyAs<{
    name: string; phone?: string; email?: string; jobTitle?: string; hireDate?: string;
    salary?: number; salaryCurrency?: string; paymentFrequency?: string;
    linkedUserId?: number; notes?: string;
  }>(req, ApiContracts.CreateStaffEmployeeBody);

  if (!name) { res.status(400).json({ error: "Name is required" }); return; }

  const staffNumber = await getNextNumber("staff");
  const [emp] = await db.insert(staffEmployeesTable).values({
    staffNumber,
    name,
    phone: phone ?? null,
    email: email ?? null,
    jobTitle: jobTitle ?? null,
    hireDate: hireDate ? new Date(hireDate) : null,
    salary: salary ?? 0,
    salaryCurrency: salaryCurrency ?? "USD",
    paymentFrequency: paymentFrequency ?? "monthly",
    linkedUserId: linkedUserId ?? null,
    notes: notes ?? null,
    status: "active",
    createdBy: callerName(req),
  }).returning();

  await logActivity(req, "staff_employee_created", "staff_employee", emp.id, { name, staffNumber });
  res.status(201).json(emp);
});

// ── Update ────────────────────────────────────────────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { name, phone, email, jobTitle, hireDate, salary, salaryCurrency, paymentFrequency, linkedUserId, notes, status } = contractBodyAs<{
    name?: string; phone?: string; email?: string; jobTitle?: string; hireDate?: string;
    salary?: number; salaryCurrency?: string; paymentFrequency?: string;
    linkedUserId?: number; notes?: string; status?: string;
  }>(req, ApiContracts.UpdateStaffEmployeeBody);

  const [existing] = await db.select().from(staffEmployeesTable).where(eq(staffEmployeesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Staff employee not found" }); return; }

  const [updated] = await db.update(staffEmployeesTable).set({
    ...(name !== undefined && { name }),
    ...(phone !== undefined && { phone }),
    ...(email !== undefined && { email }),
    ...(jobTitle !== undefined && { jobTitle }),
    ...(hireDate !== undefined && { hireDate: hireDate ? new Date(hireDate) : null }),
    ...(salary !== undefined && { salary }),
    ...(salaryCurrency !== undefined && { salaryCurrency }),
    ...(paymentFrequency !== undefined && { paymentFrequency }),
    ...(linkedUserId !== undefined && { linkedUserId }),
    ...(notes !== undefined && { notes }),
    ...(status !== undefined && { status }),
  }).where(eq(staffEmployeesTable.id, id)).returning();

  await logActivity(req, "staff_employee_edited", "staff_employee", id, { name: updated.name });
  res.json(updated);
});

// ── Archive ───────────────────────────────────────────────────────────────────
router.patch("/:id/archive", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(staffEmployeesTable).where(eq(staffEmployeesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Staff employee not found" }); return; }

  const [updated] = await db.update(staffEmployeesTable).set({ status: "archived" }).where(eq(staffEmployeesTable.id, id)).returning();
  await logActivity(req, "staff_employee_archived", "staff_employee", id, { name: existing.name });
  res.json(updated);
});

export default router;
