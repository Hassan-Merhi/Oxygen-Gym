import { db } from "@workspace/db";
import {
  accountingEntriesTable,
  chartOfAccountsTable,
  paymentsTable,
  vouchersTable,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, not, or, sum } from "drizzle-orm";
import { getCurrentBalance } from "../../lib/ledger";
import { lubumbashiTodayEnd, lubumbashiTodayStart } from "../../lib/timezone";
import { conflict, notFound } from "../../shared/http/errors";

export type ReportPeriod = "today" | "month" | "last_month" | "year";

function startOf(period: ReportPeriod): Date {
  const now = new Date();
  if (period === "today") return lubumbashiTodayStart(now);
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "last_month") return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return new Date(now.getFullYear(), 0, 1);
}

function endOf(period: ReportPeriod): Date {
  const now = new Date();
  if (period === "today") return lubumbashiTodayEnd(now);
  if (period === "month") return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  if (period === "last_month") return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
}

async function sumPayments(direction: "in" | "out", categories: string[], from: Date, to: Date) {
  const rows = await db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.direction, direction),
      eq(paymentsTable.status, "completed"),
      inArray(paymentsTable.category, categories),
      gte(paymentsTable.paymentDate, from),
      lte(paymentsTable.paymentDate, to),
    ));
  return { usd: Number(rows[0]?.usd ?? 0), cdf: Number(rows[0]?.cdf ?? 0) };
}

async function sumVouchers(direction: "in" | "out", from: Date, to: Date) {
  const rows = await db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
    .from(vouchersTable)
    .where(and(
      eq(vouchersTable.direction, direction),
      eq(vouchersTable.status, "recorded"),
      gte(vouchersTable.voucherDate, from),
      lte(vouchersTable.voucherDate, to),
    ));
  return { usd: Number(rows[0]?.usd ?? 0), cdf: Number(rows[0]?.cdf ?? 0) };
}

export async function getAccountsSummary() {
  const todayStart = startOf("today");
  const todayEnd = endOf("today");
  const monthStart = startOf("month");
  const monthEnd = endOf("month");
  const [balance, revToday, revMonth, expPayToday, expPayMonth, expVchToday, expVchMonth] = await Promise.all([
    getCurrentBalance(),
    sumPayments("in", ["membership", "product_sale", "other"], todayStart, todayEnd),
    sumPayments("in", ["membership", "product_sale", "other"], monthStart, monthEnd),
    sumPayments("out", ["expense", "payroll", "stock_purchase", "other"], todayStart, todayEnd),
    sumPayments("out", ["expense", "payroll", "stock_purchase", "other"], monthStart, monthEnd),
    sumVouchers("out", todayStart, todayEnd),
    sumVouchers("out", monthStart, monthEnd),
  ]);

  const expTodayUsd = expPayToday.usd + expVchToday.usd;
  const expTodayCdf = expPayToday.cdf + expVchToday.cdf;
  const expMonthUsd = expPayMonth.usd + expVchMonth.usd;
  const expMonthCdf = expPayMonth.cdf + expVchMonth.cdf;
  return {
    cash: {
      balanceUsd: balance.balanceUsd,
      balanceCdf: balance.balanceCdf,
      todayInUsd: revToday.usd,
      todayOutUsd: expTodayUsd,
      monthInUsd: revMonth.usd,
      monthOutUsd: expMonthUsd,
    },
    sales: { todayUsd: revToday.usd, todayCdf: revToday.cdf, monthUsd: revMonth.usd, monthCdf: revMonth.cdf },
    expenses: { todayUsd: expTodayUsd, todayCdf: expTodayCdf, monthUsd: expMonthUsd, monthCdf: expMonthCdf },
    profit: {
      todayUsd: revToday.usd - expTodayUsd,
      todayCdf: revToday.cdf - expTodayCdf,
      monthUsd: revMonth.usd - expMonthUsd,
      monthCdf: revMonth.cdf - expMonthCdf,
    },
  };
}

export interface AccountMovementListInput {
  page: number;
  limit: number;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  currency?: string;
}

export async function listAccountSales(input: AccountMovementListInput) {
  const conditions: ReturnType<typeof eq>[] = [
    eq(paymentsTable.direction, "in"),
    eq(paymentsTable.status, "completed"),
    inArray(paymentsTable.category, ["membership", "product_sale", "other"]) as ReturnType<typeof eq>,
  ];
  if (input.dateFrom) conditions.push(gte(paymentsTable.paymentDate, input.dateFrom));
  if (input.dateTo) conditions.push(lte(paymentsTable.paymentDate, input.dateTo));
  if (input.currency) conditions.push(eq(paymentsTable.currency, input.currency));
  if (input.search) conditions.push(or(
    ilike(paymentsTable.paymentNumber, `%${input.search}%`),
    ilike(paymentsTable.memberName, `%${input.search}%`),
    ilike(paymentsTable.linkedEntityName, `%${input.search}%`),
    ilike(paymentsTable.notes, `%${input.search}%`),
  ) as ReturnType<typeof eq>);

  const where = and(...conditions);
  const offset = (input.page - 1) * input.limit;
  const [items, [totalRow]] = await Promise.all([
    db.select().from(paymentsTable).where(where).orderBy(desc(paymentsTable.paymentDate)).limit(input.limit).offset(offset),
    db.select({ total: count() }).from(paymentsTable).where(where),
  ]);
  return { items, total: Number(totalRow.total), page: input.page, limit: input.limit };
}

export async function listAccountExpenses(input: AccountMovementListInput) {
  const payConditions: ReturnType<typeof eq>[] = [
    eq(paymentsTable.direction, "out"),
    eq(paymentsTable.status, "completed"),
    not(inArray(paymentsTable.category, ["membership", "product_sale"])) as ReturnType<typeof eq>,
  ];
  const voucherConditions: ReturnType<typeof eq>[] = [
    eq(vouchersTable.direction, "out"),
    eq(vouchersTable.status, "recorded"),
  ];
  if (input.dateFrom) {
    payConditions.push(gte(paymentsTable.paymentDate, input.dateFrom));
    voucherConditions.push(gte(vouchersTable.voucherDate, input.dateFrom));
  }
  if (input.dateTo) {
    payConditions.push(lte(paymentsTable.paymentDate, input.dateTo));
    voucherConditions.push(lte(vouchersTable.voucherDate, input.dateTo));
  }
  if (input.currency) {
    payConditions.push(eq(paymentsTable.currency, input.currency));
    voucherConditions.push(eq(vouchersTable.currency, input.currency));
  }
  if (input.search) {
    payConditions.push(or(
      ilike(paymentsTable.paymentNumber, `%${input.search}%`),
      ilike(paymentsTable.linkedEntityName, `%${input.search}%`),
      ilike(paymentsTable.notes, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
    voucherConditions.push(or(
      ilike(vouchersTable.voucherNumber, `%${input.search}%`),
      ilike(vouchersTable.paidTo, `%${input.search}%`),
      ilike(vouchersTable.description, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
  }

  const offset = (input.page - 1) * input.limit;
  const fetchLimit = input.limit + offset;
  const [payments, vouchers, [paymentCount], [voucherCount]] = await Promise.all([
    db.select().from(paymentsTable).where(and(...payConditions)).orderBy(desc(paymentsTable.paymentDate)).limit(fetchLimit),
    db.select().from(vouchersTable).where(and(...voucherConditions)).orderBy(desc(vouchersTable.voucherDate)).limit(fetchLimit),
    db.select({ total: count() }).from(paymentsTable).where(and(...payConditions)),
    db.select({ total: count() }).from(vouchersTable).where(and(...voucherConditions)),
  ]);

  const items = [
    ...payments.map((payment) => ({
      id: `pay-${payment.id}`,
      sourceType: "payment",
      sourceNumber: payment.paymentNumber,
      date: payment.paymentDate,
      description: payment.notes ?? payment.category,
      party: payment.linkedEntityName ?? "",
      category: payment.category,
      amount: payment.amount,
      currency: payment.currency,
      amountUsd: payment.amountUsd ?? 0,
      amountCdf: payment.amountCdf ?? 0,
      createdBy: payment.createdBy,
    })),
    ...vouchers.map((voucher) => ({
      id: `vch-${voucher.id}`,
      sourceType: "voucher",
      sourceNumber: voucher.voucherNumber,
      date: voucher.voucherDate,
      description: voucher.description,
      party: voucher.paidTo ?? voucher.linkedEntityName ?? "",
      category: voucher.category ?? voucher.voucherType,
      amount: voucher.amount,
      currency: voucher.currency,
      amountUsd: voucher.amountUsd ?? 0,
      amountCdf: voucher.amountCdf ?? 0,
      createdBy: voucher.createdBy,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(offset, offset + input.limit);

  return {
    items,
    total: Number(paymentCount.total) + Number(voucherCount.total),
    page: input.page,
    limit: input.limit,
  };
}

export async function getProfitLoss(input: { period: string; dateFrom?: Date; dateTo?: Date }) {
  let from: Date;
  let to: Date;
  if (input.period === "custom" && input.dateFrom && input.dateTo) {
    from = input.dateFrom;
    to = input.dateTo;
  } else if (input.period === "today") {
    from = startOf("today"); to = endOf("today");
  } else if (input.period === "last_month") {
    from = startOf("last_month"); to = endOf("last_month");
  } else if (input.period === "year") {
    from = startOf("year"); to = endOf("year");
  } else {
    from = startOf("month"); to = endOf("month");
  }

  const [revenue, expensePayments, expenseVouchers] = await Promise.all([
    sumPayments("in", ["membership", "product_sale", "other"], from, to),
    sumPayments("out", ["expense", "payroll", "stock_purchase", "other"], from, to),
    sumVouchers("out", from, to),
  ]);
  const categoryRows = await db.select({
    category: paymentsTable.category,
    usd: sum(paymentsTable.amountUsd),
    cdf: sum(paymentsTable.amountCdf),
  }).from(paymentsTable).where(and(
    eq(paymentsTable.status, "completed"),
    gte(paymentsTable.paymentDate, from),
    lte(paymentsTable.paymentDate, to),
  )).groupBy(paymentsTable.category);

  const expensesUsd = expensePayments.usd + expenseVouchers.usd;
  const expensesCdf = expensePayments.cdf + expenseVouchers.cdf;
  return {
    period: input.period,
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    revenue,
    expenses: { usd: expensesUsd, cdf: expensesCdf },
    net: { usd: revenue.usd - expensesUsd, cdf: revenue.cdf - expensesCdf },
    breakdown: Object.fromEntries(categoryRows.map((row) => [row.category, { usd: Number(row.usd ?? 0), cdf: Number(row.cdf ?? 0) }])),
  };
}

export async function listChartAccounts() {
  return db.select().from(chartOfAccountsTable).orderBy(asc(chartOfAccountsTable.type), asc(chartOfAccountsTable.name));
}

export async function createChartAccount(name: string, type: string, description?: string) {
  const [row] = await db.insert(chartOfAccountsTable).values({ name: name.trim(), type, description: description ?? null })
    .onConflictDoNothing().returning();
  if (!row) throw conflict("Account name already exists");
  return row;
}

export async function updateChartAccount(id: number, input: { name?: string; type?: string; description?: string; isActive?: boolean }) {
  const [row] = await db.update(chartOfAccountsTable).set({
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.type !== undefined && { type: input.type }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  }).where(eq(chartOfAccountsTable.id, id)).returning();
  if (!row) throw notFound("Account not found");
  return row;
}

export async function deactivateChartAccount(id: number) {
  const [hasEntries] = await db.select({ cnt: count() }).from(accountingEntriesTable).where(eq(accountingEntriesTable.accountId, id));
  if (Number(hasEntries.cnt) > 0) {
    throw conflict("Account has existing accounting entries and cannot be deleted. Deactivate it instead.");
  }
  const [row] = await db.update(chartOfAccountsTable).set({ isActive: false }).where(eq(chartOfAccountsTable.id, id)).returning();
  if (!row) throw notFound("Account not found");
  return { ok: true, deactivated: true };
}

export async function getAccountStatement(id: number, dateFrom?: Date, dateTo?: Date) {
  const account = await db.query.chartOfAccountsTable.findFirst({ where: eq(chartOfAccountsTable.id, id) });
  if (!account) throw notFound("Account not found");
  const conditions: ReturnType<typeof eq>[] = [eq(accountingEntriesTable.accountId, id)];
  if (dateFrom) conditions.push(gte(accountingEntriesTable.entryDate, dateFrom));
  if (dateTo) conditions.push(lte(accountingEntriesTable.entryDate, dateTo));

  const rows = await db.select().from(accountingEntriesTable).where(and(...conditions))
    .orderBy(asc(accountingEntriesTable.entryDate), asc(accountingEntriesTable.id));
  const paymentIds = [...new Set(rows.filter((row) => (row.sourceType === "payment" || row.sourceType === "payment_correction") && row.sourceId).map((row) => row.sourceId as number))];
  const voucherIds = [...new Set(rows.filter((row) => row.sourceType === "voucher" && row.sourceId).map((row) => row.sourceId as number))];
  const [sourcePayments, sourceVouchers] = await Promise.all([
    paymentIds.length > 0
      ? db.select({ id: paymentsTable.id, notes: paymentsTable.notes, linkedEntityName: paymentsTable.linkedEntityName, memberName: paymentsTable.memberName }).from(paymentsTable).where(inArray(paymentsTable.id, paymentIds))
      : Promise.resolve([]),
    voucherIds.length > 0
      ? db.select({ id: vouchersTable.id, description: vouchersTable.description, paidTo: vouchersTable.paidTo }).from(vouchersTable).where(inArray(vouchersTable.id, voucherIds))
      : Promise.resolve([]),
  ]);
  const paymentMap = new Map(sourcePayments.map((payment) => [payment.id, payment]));
  const voucherMap = new Map(sourceVouchers.map((voucher) => [voucher.id, voucher]));
  const creditNormal = ["income", "liability", "equity"].includes(account.type);
  let runningBalance = 0;

  const statementRows = rows.map((row) => {
    const debit = row.debitUsd ?? 0;
    const credit = row.creditUsd ?? 0;
    runningBalance += creditNormal ? credit - debit : debit - credit;
    let description = row.description ?? "";
    let party = row.sourceNumber ?? "";
    if ((row.sourceType === "payment" || row.sourceType === "payment_correction") && row.sourceId) {
      const payment = paymentMap.get(row.sourceId);
      if (payment?.notes?.trim()) description = payment.notes.trim();
      if (!party && payment) party = payment.linkedEntityName ?? payment.memberName ?? "";
    } else if (row.sourceType === "voucher" && row.sourceId) {
      const voucher = voucherMap.get(row.sourceId);
      if (voucher?.description?.trim()) description = voucher.description.trim();
      if (!party && voucher) party = voucher.paidTo ?? "";
    }
    return {
      id: row.id,
      date: row.entryDate,
      description,
      party,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      amount: row.amount,
      currency: row.currency,
      debitUsd: row.debitUsd,
      creditUsd: row.creditUsd,
      debitCdf: row.debitCdf,
      creditCdf: row.creditCdf,
      exchangeRate: row.exchangeRate,
      runningBalance,
    };
  });

  // Physical cash is reconstructed from the business records in getCurrentBalance().
  // The double-entry ledger was introduced later and can contain legacy gaps or
  // duplicate member-receipt postings, so Cash must carry that historical delta
  // before the first statement row. This makes Accounts and Cash Book share the
  // exact same all-time balance without fabricating a current-period transaction.
  if (account.name.trim().toLowerCase() === "cash" && !dateFrom && !dateTo) {
    const canonical = await getCurrentBalance();
    const accountingUsd = rows.reduce(
      (total, row) => total + Number(row.debitUsd ?? 0) - Number(row.creditUsd ?? 0),
      0,
    );
    const accountingCdf = rows.reduce(
      (total, row) => total + Number(row.debitCdf ?? 0) - Number(row.creditCdf ?? 0),
      0,
    );
    const deltaUsd = canonical.balanceUsd - accountingUsd;
    const deltaCdf = canonical.balanceCdf - accountingCdf;
    const reconciliationDate = new Date(0);
    const epsilon = 0.000001;
    const reconciliationRows: typeof statementRows = [];

    if (Math.abs(deltaUsd) > epsilon) {
      reconciliationRows.push({
        id: -1000001,
        date: reconciliationDate,
        description: "Historical cash balance carry-forward",
        party: "Cash Book",
        sourceType: "cash_balance_reconciliation_usd",
        sourceId: null,
        amount: Math.abs(deltaUsd),
        currency: "USD",
        debitUsd: deltaUsd > 0 ? deltaUsd : 0,
        creditUsd: deltaUsd < 0 ? -deltaUsd : 0,
        debitCdf: 0,
        creditCdf: 0,
        exchangeRate: 1,
        runningBalance: 0,
      });
    }

    if (Math.abs(deltaCdf) > epsilon) {
      reconciliationRows.push({
        id: -1000002,
        date: reconciliationDate,
        description: "Historical cash balance carry-forward",
        party: "Cash Book",
        sourceType: "cash_balance_reconciliation_cdf",
        sourceId: null,
        amount: Math.abs(deltaCdf),
        currency: "CDF",
        debitUsd: 0,
        creditUsd: 0,
        debitCdf: deltaCdf > 0 ? deltaCdf : 0,
        creditCdf: deltaCdf < 0 ? -deltaCdf : 0,
        exchangeRate: 1,
        runningBalance: 0,
      });
    }

    return { account, rows: [...reconciliationRows, ...statementRows] };
  }

  return { account, rows: statementRows };
}
