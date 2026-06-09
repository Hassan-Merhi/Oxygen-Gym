import { Router, type Request, type Response } from "express";
import { requireAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  payrollTable,
  staffEmployeesTable,
  settingsTable,
  paymentsTable,
} from "@workspace/db/schema";
import { eq, and, ilike, desc, count, gte, lte, or } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry } from "../lib/ledger";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return (req as unknown as { __gymproUserName?: string }).__gymproUserName ?? "System";
}

async function getExchangeRate(): Promise<number> {
  const [s] = await db.select({ rate: settingsTable.usdToCdfRate }).from(settingsTable);
  return s?.rate ?? 2800;
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const { page = "1", limit = "20", search, status, staffEmployeeId, dateFrom, dateTo } =
    req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [];
  if (search) {
    conditions.push(
      or(
        ilike(payrollTable.staffName, `%${search}%`),
        ilike(payrollTable.payrollNumber, `%${search}%`)
      ) as ReturnType<typeof eq>
    );
  }
  if (status) conditions.push(eq(payrollTable.status, status));
  if (staffEmployeeId) conditions.push(eq(payrollTable.staffEmployeeId, parseInt(staffEmployeeId)));
  if (dateFrom) conditions.push(gte(payrollTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(payrollTable.createdAt, new Date(dateTo + "T23:59:59")));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [items, [totRow]] = await Promise.all([
    db.select().from(payrollTable).where(where).orderBy(desc(payrollTable.createdAt)).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(payrollTable).where(where),
  ]);

  res.json({ items, total: Number(totRow.total), page: pageNum, limit: limitNum });
});

// ── Get single ────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const [record] = await db.select().from(payrollTable).where(eq(payrollTable.id, id));
  if (!record) { res.status(404).json({ error: "Payroll record not found" }); return; }
  res.json(record);
});

// ── Create draft payroll ───────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const { staffEmployeeId, periodStart, periodEnd, baseSalary, bonus, deduction, currency, exchangeRate, notes } = req.body as {
    staffEmployeeId: number;
    periodStart: string;
    periodEnd: string;
    baseSalary: number;
    bonus?: number;
    deduction?: number;
    currency?: string;
    exchangeRate?: number;
    notes?: string;
  };

  if (!staffEmployeeId) { res.status(400).json({ error: "Staff employee is required" }); return; }

  const [employee] = await db.select().from(staffEmployeesTable).where(eq(staffEmployeesTable.id, staffEmployeeId));
  if (!employee) { res.status(404).json({ error: "Staff employee not found" }); return; }

  const rate = exchangeRate ?? (await getExchangeRate());
  const bonusAmt = bonus ?? 0;
  const deductionAmt = deduction ?? 0;
  const netPay = baseSalary + bonusAmt - deductionAmt;
  const salCurrency = currency ?? employee.salaryCurrency ?? "USD";
  const netPayUsd = salCurrency === "USD" ? netPay : netPay / rate;

  const payrollNumber = await getNextNumber("payroll");
  const creator = callerName(req);

  const [record] = await db.insert(payrollTable).values({
    payrollNumber,
    staffEmployeeId: employee.id,
    staffName: employee.name,
    staffNumber: employee.staffNumber ?? null,
    periodStart: periodStart ? new Date(periodStart) : null,
    periodEnd: periodEnd ? new Date(periodEnd) : null,
    baseSalary,
    bonus: bonusAmt,
    deduction: deductionAmt,
    netPay,
    currency: salCurrency,
    exchangeRate: rate,
    netPayUsd,
    notes: notes ?? null,
    status: "draft",
    createdBy: creator,
  }).returning();

  await logActivity(req, "payroll_generated", "payroll", record.id, {
    payrollNumber,
    staffName: employee.name,
    netPay,
    currency: salCurrency,
  });

  res.status(201).json(record);
});

// ── Mark as paid ──────────────────────────────────────────────────────────────
router.patch("/:id/pay", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const [record] = await db.select().from(payrollTable).where(eq(payrollTable.id, id));
  if (!record) { res.status(404).json({ error: "Payroll record not found" }); return; }
  if (record.status === "paid") { res.status(400).json({ error: "Already paid" }); return; }
  if (record.status === "cancelled") { res.status(400).json({ error: "Cannot pay a cancelled payroll" }); return; }

  const rate = await getExchangeRate();
  const creator = callerName(req);
  const netPayUsd = record.currency === "USD" ? record.netPay : record.netPay / rate;

  // 1. Create payment record
  const paymentNumber = await getNextNumber("payment");
  const [payment] = await db.insert(paymentsTable).values({
    paymentNumber,
    direction: "out",
    category: "payroll",
    type: "payroll",
    amount: netPayUsd,
    currency: "USD",
    exchangeRate: rate,
    amountUsd: netPayUsd,
    amountCdf: record.currency === "CDF" ? record.netPay : netPayUsd * rate,
    account: "cash",
    notes: `Payroll ${record.payrollNumber} — ${record.staffName}`,
    createdBy: creator,
    status: "completed",
  }).returning();

  // 2. Cash ledger OUT
  await appendLedgerEntry({
    sourceType: "payroll",
    sourceNumber: record.payrollNumber ?? undefined,
    sourceId: record.id,
    direction: "out",
    amount: netPayUsd,
    currency: "USD",
    exchangeRate: rate,
    description: `Payroll ${record.payrollNumber} — ${record.staffName}`,
    createdBy: creator,
  });

  // 3. Update payroll record
  const [updated] = await db.update(payrollTable).set({
    status: "paid",
    paidAt: new Date(),
    paidBy: creator,
    paymentId: payment.id,
    netPayUsd,
    exchangeRate: rate,
  }).where(eq(payrollTable.id, id)).returning();

  await logActivity(req, "payroll_paid", "payroll", id, {
    payrollNumber: record.payrollNumber,
    staffName: record.staffName,
    netPay: record.netPay,
    currency: record.currency,
  });

  res.json(updated);
});

// ── Cancel payroll ────────────────────────────────────────────────────────────
router.patch("/:id/cancel", async (req: Request, res: Response) => {
  const { reason } = req.body as { reason: string };
  const id = parseInt(req.params.id as string);

  const [record] = await db.select().from(payrollTable).where(eq(payrollTable.id, id));
  if (!record) { res.status(404).json({ error: "Payroll record not found" }); return; }
  if (record.status === "cancelled") { res.status(400).json({ error: "Already cancelled" }); return; }

  const rate = await getExchangeRate();
  const creator = callerName(req);

  // If already paid, reverse the ledger
  if (record.status === "paid") {
    const netPayUsd = record.netPayUsd ?? (record.currency === "USD" ? record.netPay : record.netPay / rate);
    await appendLedgerEntry({
      sourceType: "payroll_reversal",
      sourceNumber: record.payrollNumber ?? undefined,
      sourceId: record.id,
      direction: "in",
      amount: netPayUsd,
      currency: "USD",
      exchangeRate: rate,
      description: `Reversal of payroll ${record.payrollNumber} — ${reason}`,
      createdBy: creator,
    });
  }

  const [updated] = await db.update(payrollTable).set({
    status: "cancelled",
    cancelledAt: new Date(),
    cancelledBy: creator,
    cancelReason: reason,
  }).where(eq(payrollTable.id, id)).returning();

  await logActivity(req, "payroll_cancelled", "payroll", id, {
    payrollNumber: record.payrollNumber,
    staffName: record.staffName,
    reason,
    wasPaid: record.status === "paid",
  });

  res.json(updated);
});

export default router;
