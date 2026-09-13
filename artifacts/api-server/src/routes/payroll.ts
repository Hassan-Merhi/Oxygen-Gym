import { contractBodyAs, contractQueryAs } from "../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import {
  payrollTable,
  staffEmployeesTable,
  settingsTable,
  paymentsTable,
  commissionsTable,
} from "@workspace/db/schema";
import { eq, and, ilike, desc, count, gte, lte, or } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry } from "../lib/ledger";
import { postDoubleEntry, reverseEntries } from "../lib/accounting";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return req.__gymproUserName ?? "System";
}

async function getExchangeRate(): Promise<number> {
  const [s] = await db.select({ rate: settingsTable.usdToCdfRate }).from(settingsTable);
  return s?.rate ?? 2800;
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const { page = "1", limit = "20", search, status, staffEmployeeId, dateFrom, dateTo } =
    contractQueryAs<Record<string, string>>(req, ApiContracts.ListPayrollQueryParams);

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
  if (dateFrom) conditions.push(gte(payrollTable.periodStart, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(payrollTable.periodStart, new Date(dateTo + "T23:59:59")));

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
  const { staffEmployeeId, periodStart, periodEnd, baseSalary, bonus, deduction, currency, exchangeRate, notes } = contractBodyAs<{
    staffEmployeeId: number;
    periodStart: string;
    periodEnd: string;
    baseSalary: number;
    bonus?: number;
    deduction?: number;
    currency?: string;
    exchangeRate?: number;
    notes?: string;
  }>(req, ApiContracts.CreatePayrollBody);

  if (!staffEmployeeId) { res.status(400).json({ error: "Staff employee is required" }); return; }

  const [employee] = await db.select().from(staffEmployeesTable).where(eq(staffEmployeesTable.id, staffEmployeeId));
  if (!employee) { res.status(404).json({ error: "Staff employee not found" }); return; }

  const rate = exchangeRate ?? (await getExchangeRate());
  const bonusAmt = bonus ?? 0;
  const deductionAmt = deduction ?? 0;
  const salCurrency = currency ?? employee.salaryCurrency ?? "USD";

  const pendingCommissions = await db
    .select()
    .from(commissionsTable)
    .where(and(eq(commissionsTable.staffEmployeeId, staffEmployeeId), eq(commissionsTable.status, "pending")));
  const commissionBonus = pendingCommissions.reduce((total, c) => {
    const amt = c.amount ?? 0;
    const commCur = c.currency ?? salCurrency;
    if (commCur === salCurrency) return total + amt;
    if (salCurrency === "USD" && commCur === "CDF") return total + amt / rate;
    if (salCurrency === "CDF" && commCur === "USD") return total + amt * rate;
    return total + amt;
  }, 0);

  const netPay = baseSalary + bonusAmt + commissionBonus - deductionAmt;
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
    commissionBonus,
    deduction: deductionAmt,
    netPay,
    currency: salCurrency,
    exchangeRate: rate,
    netPayUsd,
    notes: notes ?? null,
    status: "draft",
    createdBy: creator,
  }).returning();

  if (pendingCommissions.length > 0) {
    await db
      .update(commissionsTable)
      .set({ payrollId: record.id, status: "draft" })
      .where(and(eq(commissionsTable.staffEmployeeId, staffEmployeeId), eq(commissionsTable.status, "pending")));
  }

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
  const netPayCdf = record.currency === "CDF" ? record.netPay : record.netPay * rate;

  // 1. Create payment record — use original currency/amount (not USD-converted)
  const paymentNumber = await getNextNumber("PAY");
  const [payment] = await db.insert(paymentsTable).values({
    paymentNumber,
    direction: "out",
    category: "payroll",
    type: "payroll",
    amount: record.netPay,
    currency: record.currency,
    exchangeRate: rate,
    amountUsd: netPayUsd,
    amountCdf: netPayCdf,
    account: "cash",
    notes: `Payroll ${record.payrollNumber} — ${record.staffName}`,
    createdBy: creator,
    status: "completed",
  }).returning();

  // 2. Cash ledger OUT — use original currency/amount
  await appendLedgerEntry({
    sourceType: "payroll",
    sourceNumber: record.payrollNumber ?? undefined,
    sourceId: record.id,
    direction: "out",
    amount: record.netPay,
    currency: record.currency,
    exchangeRate: rate,
    description: `Payroll ${record.payrollNumber} — ${record.staffName}`,
    createdBy: creator,
  });

  // 3. Double-entry accounting: Payroll Expense debit / Cash credit
  try {
    await postDoubleEntry({
      sourceType: "payroll",
      sourceId: record.id,
      sourceNumber: record.payrollNumber ?? undefined,
      debitName: "Payroll Expense",
      debitType: "expense",
      creditName: "Cash",
      creditType: "asset",
      amount: record.netPay,
      amountUsd: netPayUsd,
      amountCdf: netPayCdf,
      currency: record.currency,
      exchangeRate: rate,
      description: `Payroll ${record.payrollNumber} — ${record.staffName}`,
      createdBy: creator,
    });
  } catch { /* non-fatal */ }

  // 4. Mark linked commissions as paid
  await db
    .update(commissionsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(commissionsTable.payrollId, id), eq(commissionsTable.status, "pending")));

  // 5. Update payroll record
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
  const { reason } = contractBodyAs<{ reason: string }>(req, ApiContracts.CancelPayrollBody);
  const id = parseInt(req.params.id as string);

  const [record] = await db.select().from(payrollTable).where(eq(payrollTable.id, id));
  if (!record) { res.status(404).json({ error: "Payroll record not found" }); return; }
  if (record.status === "cancelled") { res.status(400).json({ error: "Already cancelled" }); return; }

  const rate = await getExchangeRate();
  const creator = callerName(req);

  if (record.status === "paid") {
    const netPayAmt = record.netPay;
    const netPayCur = record.currency;
    const netPayUsd = record.netPayUsd ?? (netPayCur === "USD" ? netPayAmt : netPayAmt / rate);
    const netPayCdf = netPayCur === "CDF" ? netPayAmt : netPayAmt * rate;

    // Reverse ledger entry
    await appendLedgerEntry({
      sourceType: "payroll_reversal",
      sourceNumber: record.payrollNumber ?? undefined,
      sourceId: record.id,
      direction: "in",
      amount: netPayAmt,
      currency: netPayCur,
      exchangeRate: record.exchangeRate ?? rate,
      description: `Reversal of payroll ${record.payrollNumber} — ${reason}`,
      createdBy: creator,
    });

    // Reverse accounting entries
    try {
      await reverseEntries("payroll", record.id, "payroll_reversal", creator);
    } catch { /* non-fatal */ }

    // Cancel the payment record
    if (record.paymentId) {
      await db.update(paymentsTable).set({ status: "cancelled" }).where(eq(paymentsTable.id, record.paymentId));
    }

    void netPayUsd;
    void netPayCdf;
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
