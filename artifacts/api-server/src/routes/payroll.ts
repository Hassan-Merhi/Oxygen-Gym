import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db, withTransaction } from "@workspace/db";
import {
  payrollTable,
  staffEmployeesTable,
  paymentsTable,
  commissionsTable,
} from "@workspace/db/schema";
import { eq, and, ilike, desc, count, gte, lte, or } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry } from "../lib/ledger";
import { postDoubleEntry, reverseEntries } from "../lib/accounting";
import { getExchangeRate } from "../repositories/settings";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return (req as unknown as { __gymproUserName?: string }).__gymproUserName ?? "System";
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
  const salCurrency = currency ?? employee.salaryCurrency ?? "USD";
  const creator = callerName(req);

  const record = await withTransaction(async (tx) => {
    const pendingCommissions = await tx
      .select()
      .from(commissionsTable)
      .where(and(eq(commissionsTable.staffEmployeeId, staffEmployeeId), eq(commissionsTable.status, "pending")))
      .for("update");

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
    const payrollNumber = await getNextNumber("payroll", tx);

    const [created] = await tx.insert(payrollTable).values({
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
    if (!created) throw new Error("Unable to create payroll");

    if (pendingCommissions.length > 0) {
      await tx
        .update(commissionsTable)
        .set({ payrollId: created.id, status: "draft" })
        .where(and(eq(commissionsTable.staffEmployeeId, staffEmployeeId), eq(commissionsTable.status, "pending")));
    }

    return created;
  });

  await logActivity(req, "payroll_generated", "payroll", record.id, {
    payrollNumber: record.payrollNumber,
    staffName: employee.name,
    netPay: record.netPay,
    currency: record.currency,
  });

  res.status(201).json(record);
});

// ── Mark as paid ──────────────────────────────────────────────────────────────
router.patch("/:id/pay", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const creator = callerName(req);

  const result = await withTransaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(payrollTable)
      .where(eq(payrollTable.id, id))
      .for("update");
    if (!record) return { kind: "not_found" as const };
    if (record.status === "paid") return { kind: "already_paid" as const };
    if (record.status === "cancelled") return { kind: "cancelled" as const };

    const rate = await getExchangeRate(tx);
    const netPayUsd = record.currency === "USD" ? record.netPay : record.netPay / rate;
    const netPayCdf = record.currency === "CDF" ? record.netPay : record.netPay * rate;
    const paymentNumber = await getNextNumber("PAY", tx);

    const [payment] = await tx.insert(paymentsTable).values({
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
    if (!payment) throw new Error("Unable to create payroll payment");

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
    }, tx);

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
    }, tx);

    await tx
      .update(commissionsTable)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(eq(commissionsTable.payrollId, id), eq(commissionsTable.status, "draft")));

    const [updated] = await tx.update(payrollTable).set({
      status: "paid",
      paidAt: new Date(),
      paidBy: creator,
      paymentId: payment.id,
      netPayUsd,
      exchangeRate: rate,
    }).where(eq(payrollTable.id, id)).returning();
    if (!updated) throw new Error("Unable to mark payroll paid");

    return { kind: "ok" as const, record, updated };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Payroll record not found" }); return; }
  if (result.kind === "already_paid") { res.status(400).json({ error: "Already paid" }); return; }
  if (result.kind === "cancelled") { res.status(400).json({ error: "Cannot pay a cancelled payroll" }); return; }

  await logActivity(req, "payroll_paid", "payroll", id, {
    payrollNumber: result.record.payrollNumber,
    staffName: result.record.staffName,
    netPay: result.record.netPay,
    currency: result.record.currency,
  });

  res.json(result.updated);
});

// ── Cancel payroll ────────────────────────────────────────────────────────────
router.patch("/:id/cancel", async (req: Request, res: Response) => {
  const { reason } = req.body as { reason: string };
  const id = parseInt(req.params.id as string);
  const creator = callerName(req);

  const result = await withTransaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(payrollTable)
      .where(eq(payrollTable.id, id))
      .for("update");
    if (!record) return { kind: "not_found" as const };
    if (record.status === "cancelled") return { kind: "already_cancelled" as const };

    const rate = await getExchangeRate(tx);
    if (record.status === "paid") {
      await appendLedgerEntry({
        sourceType: "payroll_reversal",
        sourceNumber: record.payrollNumber ?? undefined,
        sourceId: record.id,
        direction: "in",
        amount: record.netPay,
        currency: record.currency,
        exchangeRate: record.exchangeRate ?? rate,
        description: `Reversal of payroll ${record.payrollNumber} — ${reason}`,
        createdBy: creator,
      }, tx);

      await reverseEntries("payroll", record.id, "payroll_reversal", creator, tx);

      if (record.paymentId) {
        await tx.update(paymentsTable).set({ status: "cancelled" }).where(eq(paymentsTable.id, record.paymentId));
      }

      await tx
        .update(commissionsTable)
        .set({ status: "pending", paidAt: null, payrollId: null })
        .where(and(eq(commissionsTable.payrollId, id), eq(commissionsTable.status, "paid")));
    } else {
      await tx
        .update(commissionsTable)
        .set({ status: "pending", payrollId: null })
        .where(and(eq(commissionsTable.payrollId, id), eq(commissionsTable.status, "draft")));
    }

    const [updated] = await tx.update(payrollTable).set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: creator,
      cancelReason: reason,
    }).where(eq(payrollTable.id, id)).returning();
    if (!updated) throw new Error("Unable to cancel payroll");

    return { kind: "ok" as const, record, updated };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Payroll record not found" }); return; }
  if (result.kind === "already_cancelled") { res.status(400).json({ error: "Already cancelled" }); return; }

  await logActivity(req, "payroll_cancelled", "payroll", id, {
    payrollNumber: result.record.payrollNumber,
    staffName: result.record.staffName,
    reason,
    wasPaid: result.record.status === "paid",
  });

  res.json(result.updated);
});

export default router;
