import { db } from "@workspace/db";
import {
  commissionsTable,
  paymentsTable,
  payrollTable,
  staffEmployeesTable,
} from "@workspace/db/schema";
import { and, count, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { getNextNumber } from "../../lib/numbering";
import { postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest, notFound } from "../../shared/http/errors";

export interface PayrollListInput {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  staffEmployeeId?: number;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface CreatePayrollInput {
  staffEmployeeId: number;
  periodStart?: Date;
  periodEnd?: Date;
  baseSalary: number;
  bonus?: number;
  deduction?: number;
  currency?: string;
  exchangeRate?: number;
  notes?: string;
}

export async function listPayroll(input: PayrollListInput) {
  const conditions: ReturnType<typeof eq>[] = [];
  if (input.search) {
    conditions.push(or(
      ilike(payrollTable.staffName, `%${input.search}%`),
      ilike(payrollTable.payrollNumber, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
  }
  if (input.status) conditions.push(eq(payrollTable.status, input.status));
  if (input.staffEmployeeId) conditions.push(eq(payrollTable.staffEmployeeId, input.staffEmployeeId));
  if (input.dateFrom) conditions.push(gte(payrollTable.periodStart, input.dateFrom));
  if (input.dateTo) conditions.push(lte(payrollTable.periodStart, input.dateTo));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (input.page - 1) * input.limit;
  const [items, [totalRow]] = await Promise.all([
    db.select().from(payrollTable).where(where).orderBy(desc(payrollTable.createdAt)).limit(input.limit).offset(offset),
    db.select({ total: count() }).from(payrollTable).where(where),
  ]);

  return { items, total: Number(totalRow.total), page: input.page, limit: input.limit };
}

export async function getPayroll(id: number) {
  const [record] = await db.select().from(payrollTable).where(eq(payrollTable.id, id));
  if (!record) throw notFound("Payroll record not found");
  return record;
}

export async function createPayroll(input: CreatePayrollInput, actor: string) {
  if (!input.staffEmployeeId) throw badRequest("Staff employee is required");
  if (!Number.isFinite(input.baseSalary) || input.baseSalary < 0) throw badRequest("Base salary cannot be negative");
  if ((input.bonus ?? 0) < 0) throw badRequest("Bonus cannot be negative");
  if ((input.deduction ?? 0) < 0) throw badRequest("Deduction cannot be negative");
  if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) throw badRequest("Period end must be after period start");

  const rate = input.exchangeRate ?? await getExchangeRate();
  const payrollNumber = await getNextNumber("payroll");

  return withTransaction(async (tx) => {
    const [employee] = await tx.select().from(staffEmployeesTable).where(eq(staffEmployeesTable.id, input.staffEmployeeId));
    if (!employee) throw notFound("Staff employee not found");

    const salCurrency = input.currency ?? employee.salaryCurrency ?? "USD";
    const pendingCommissions = await tx.select().from(commissionsTable).where(and(
      eq(commissionsTable.staffEmployeeId, input.staffEmployeeId),
      eq(commissionsTable.status, "pending"),
    ));

    const commissionBonus = pendingCommissions.reduce((total, commission) => {
      const amount = commission.amount ?? 0;
      const commissionCurrency = commission.currency ?? salCurrency;
      if (commissionCurrency === salCurrency) return total + amount;
      if (salCurrency === "USD" && commissionCurrency === "CDF") return total + amount / rate;
      if (salCurrency === "CDF" && commissionCurrency === "USD") return total + amount * rate;
      return total + amount;
    }, 0);

    const bonus = input.bonus ?? 0;
    const deduction = input.deduction ?? 0;
    const netPay = input.baseSalary + bonus + commissionBonus - deduction;
    if (netPay < 0) throw badRequest("Net pay cannot be negative");

    const netPayUsd = salCurrency === "USD" ? netPay : netPay / rate;
    const [record] = await tx.insert(payrollTable).values({
      payrollNumber,
      staffEmployeeId: employee.id,
      staffName: employee.name,
      staffNumber: employee.staffNumber ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      baseSalary: input.baseSalary,
      bonus,
      commissionBonus,
      deduction,
      netPay,
      currency: salCurrency,
      exchangeRate: rate,
      netPayUsd,
      notes: input.notes ?? null,
      status: "draft",
      createdBy: actor,
    }).returning();

    if (pendingCommissions.length > 0) {
      await tx.update(commissionsTable)
        .set({ payrollId: record.id, status: "draft" })
        .where(and(eq(commissionsTable.staffEmployeeId, input.staffEmployeeId), eq(commissionsTable.status, "pending")));
    }

    return record;
  });
}

export async function payPayroll(id: number, actor: string) {
  const rate = await getExchangeRate();
  const paymentNumber = await getNextNumber("PAY");

  return withTransaction(async (tx) => {
    const [record] = await tx.select().from(payrollTable).where(eq(payrollTable.id, id));
    if (!record) throw notFound("Payroll record not found");
    if (record.status === "paid") throw badRequest("Already paid");
    if (record.status === "cancelled") throw badRequest("Cannot pay a cancelled payroll");

    const { amountUsd: netPayUsd, amountCdf: netPayCdf } = toUsdCdf(record.netPay, record.currency, rate);
    const description = `Payroll ${record.payrollNumber} — ${record.staffName}`;

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
      notes: description,
      createdBy: actor,
      status: "completed",
    }).returning();

    await appendLedgerEntry({
      sourceType: "payroll",
      sourceNumber: record.payrollNumber ?? undefined,
      sourceId: record.id,
      direction: "out",
      amount: record.netPay,
      currency: record.currency,
      exchangeRate: rate,
      description,
      createdBy: actor,
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
      description,
      createdBy: actor,
    }, tx);

    await tx.update(commissionsTable)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(
        eq(commissionsTable.payrollId, id),
        or(eq(commissionsTable.status, "draft"), eq(commissionsTable.status, "pending")),
      ));

    const [updated] = await tx.update(payrollTable).set({
      status: "paid",
      paidAt: new Date(),
      paidBy: actor,
      paymentId: payment.id,
      netPayUsd,
      exchangeRate: rate,
    }).where(eq(payrollTable.id, id)).returning();

    return updated;
  });
}

export async function cancelPayroll(id: number, reason: string, actor: string) {
  if (!reason.trim()) throw badRequest("Cancellation reason is required");
  const rate = await getExchangeRate();

  return withTransaction(async (tx) => {
    const [record] = await tx.select().from(payrollTable).where(eq(payrollTable.id, id));
    if (!record) throw notFound("Payroll record not found");
    if (record.status === "cancelled") throw badRequest("Already cancelled");

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
        createdBy: actor,
      }, tx);

      await reverseEntries("payroll", record.id, "payroll_reversal", actor, tx);

      if (record.paymentId) {
        await tx.update(paymentsTable).set({ status: "cancelled" }).where(eq(paymentsTable.id, record.paymentId));
      }
    }

    await tx.update(commissionsTable)
      .set({ status: "pending", payrollId: null, paidAt: null })
      .where(eq(commissionsTable.payrollId, id));

    const [updated] = await tx.update(payrollTable).set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: actor,
      cancelReason: reason,
    }).where(eq(payrollTable.id, id)).returning();

    return updated;
  });
}
