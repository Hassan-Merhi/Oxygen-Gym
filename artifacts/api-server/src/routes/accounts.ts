import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { paymentsTable, vouchersTable, cashLedgerTable, chartOfAccountsTable, accountingEntriesTable } from "@workspace/db/schema";
import {
  and, gte, lte, eq, inArray, sum, not,
  desc, count, or, ilike, asc,
} from "drizzle-orm";
import { getCurrentBalance } from "../lib/ledger";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth());

// ── helpers ──────────────────────────────────────────────────────────────────

function startOf(period: "today" | "month" | "last_month" | "year"): Date {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "last_month") return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return new Date(now.getFullYear(), 0, 1);
}
function endOf(period: "today" | "month" | "last_month" | "year"): Date {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now);
    d.setHours(23, 59, 59, 999);
    return d;
  }
  if (period === "month") return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  if (period === "last_month") return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
}

async function sumPayments(
  direction: "in" | "out",
  categories: string[],
  from: Date,
  to: Date,
): Promise<{ usd: number; cdf: number }> {
  const rows = await db
    .select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.direction, direction),
        eq(paymentsTable.status, "completed"),
        inArray(paymentsTable.category, categories),
        gte(paymentsTable.paymentDate, from),
        lte(paymentsTable.paymentDate, to),
      ),
    );
  return { usd: Number(rows[0]?.usd ?? 0), cdf: Number(rows[0]?.cdf ?? 0) };
}

async function sumVouchers(
  direction: "in" | "out",
  from: Date,
  to: Date,
): Promise<{ usd: number; cdf: number }> {
  const rows = await db
    .select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) })
    .from(vouchersTable)
    .where(
      and(
        eq(vouchersTable.direction, direction),
        eq(vouchersTable.status, "recorded"),
        gte(vouchersTable.voucherDate, from),
        lte(vouchersTable.voucherDate, to),
      ),
    );
  return { usd: Number(rows[0]?.usd ?? 0), cdf: Number(rows[0]?.cdf ?? 0) };
}

// ── GET /accounts/summary ────────────────────────────────────────────────────
router.get("/summary", async (_req: Request, res: Response) => {
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

  res.json({
    cash: {
      balanceUsd: balance.balanceUsd,
      balanceCdf: balance.balanceCdf,
      todayInUsd: revToday.usd,
      todayOutUsd: expTodayUsd,
      monthInUsd: revMonth.usd,
      monthOutUsd: expMonthUsd,
    },
    sales: {
      todayUsd: revToday.usd,
      todayCdf: revToday.cdf,
      monthUsd: revMonth.usd,
      monthCdf: revMonth.cdf,
    },
    expenses: {
      todayUsd: expTodayUsd,
      todayCdf: expTodayCdf,
      monthUsd: expMonthUsd,
      monthCdf: expMonthCdf,
    },
    profit: {
      todayUsd: revToday.usd - expTodayUsd,
      todayCdf: revToday.cdf - expTodayCdf,
      monthUsd: revMonth.usd - expMonthUsd,
      monthCdf: revMonth.cdf - expMonthCdf,
    },
  });
});

// ── GET /accounts/sales ──────────────────────────────────────────────────────
router.get("/sales", async (req: Request, res: Response) => {
  const {
    page = "1", limit = "50",
    search, dateFrom, dateTo, currency,
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [
    eq(paymentsTable.direction, "in"),
    eq(paymentsTable.status, "completed"),
    inArray(paymentsTable.category, ["membership", "product_sale", "other"]),
  ];
  if (dateFrom) conditions.push(gte(paymentsTable.paymentDate, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(paymentsTable.paymentDate, new Date(dateTo + "T23:59:59")));
  if (currency) conditions.push(eq(paymentsTable.currency, currency));
  if (search) {
    conditions.push(
      or(
        ilike(paymentsTable.paymentNumber, `%${search}%`),
        ilike(paymentsTable.memberName, `%${search}%`),
        ilike(paymentsTable.linkedEntityName, `%${search}%`),
        ilike(paymentsTable.notes, `%${search}%`),
      ) as ReturnType<typeof eq>,
    );
  }

  const where = and(...conditions);

  const [items, [totRow]] = await Promise.all([
    db.select().from(paymentsTable).where(where).orderBy(desc(paymentsTable.paymentDate)).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(paymentsTable).where(where),
  ]);

  res.json({ items, total: Number(totRow.total), page: pageNum, limit: limitNum });
});

// ── GET /accounts/expenses ───────────────────────────────────────────────────
router.get("/expenses", async (req: Request, res: Response) => {
  const {
    page = "1", limit = "50",
    search, dateFrom, dateTo, currency,
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const payConditions = [
    eq(paymentsTable.direction, "out"),
    eq(paymentsTable.status, "completed"),
    not(inArray(paymentsTable.category, ["membership", "product_sale"])),
  ];
  const vchConditions = [
    eq(vouchersTable.direction, "out"),
    eq(vouchersTable.status, "recorded"),
  ];

  if (dateFrom) {
    payConditions.push(gte(paymentsTable.paymentDate, new Date(dateFrom)));
    vchConditions.push(gte(vouchersTable.voucherDate, new Date(dateFrom)));
  }
  if (dateTo) {
    payConditions.push(lte(paymentsTable.paymentDate, new Date(dateTo + "T23:59:59")));
    vchConditions.push(lte(vouchersTable.voucherDate, new Date(dateTo + "T23:59:59")));
  }
  if (currency) {
    payConditions.push(eq(paymentsTable.currency, currency));
    vchConditions.push(eq(vouchersTable.currency, currency));
  }
  if (search) {
    payConditions.push(
      or(
        ilike(paymentsTable.paymentNumber, `%${search}%`),
        ilike(paymentsTable.linkedEntityName, `%${search}%`),
        ilike(paymentsTable.notes, `%${search}%`),
      ) as ReturnType<typeof eq>,
    );
    vchConditions.push(
      or(
        ilike(vouchersTable.voucherNumber, `%${search}%`),
        ilike(vouchersTable.paidTo, `%${search}%`),
        ilike(vouchersTable.description, `%${search}%`),
      ) as ReturnType<typeof eq>,
    );
  }

  const fetchLimit = limitNum + offset;
  const [payments, vouchers, [payCountRow], [vchCountRow]] = await Promise.all([
    db.select().from(paymentsTable).where(and(...payConditions)).orderBy(desc(paymentsTable.paymentDate)).limit(fetchLimit),
    db.select().from(vouchersTable).where(and(...vchConditions)).orderBy(desc(vouchersTable.voucherDate)).limit(fetchLimit),
    db.select({ total: count() }).from(paymentsTable).where(and(...payConditions)),
    db.select({ total: count() }).from(vouchersTable).where(and(...vchConditions)),
  ]);

  const total = Number(payCountRow.total) + Number(vchCountRow.total);

  const unified = [
    ...payments.map((p) => ({
      id: `pay-${p.id}`,
      sourceType: "payment",
      sourceNumber: p.paymentNumber,
      date: p.paymentDate,
      description: p.notes ?? p.category,
      party: p.linkedEntityName ?? "",
      category: p.category,
      amount: p.amount,
      currency: p.currency,
      amountUsd: p.amountUsd ?? 0,
      amountCdf: p.amountCdf ?? 0,
      createdBy: p.createdBy,
    })),
    ...vouchers.map((v) => ({
      id: `vch-${v.id}`,
      sourceType: "voucher",
      sourceNumber: v.voucherNumber,
      date: v.voucherDate,
      description: v.description,
      party: v.paidTo ?? v.linkedEntityName ?? "",
      category: v.category ?? v.voucherType,
      amount: v.amount,
      currency: v.currency,
      amountUsd: v.amountUsd ?? 0,
      amountCdf: v.amountCdf ?? 0,
      createdBy: v.createdBy,
    })),
  ];

  unified.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const paged = unified.slice(offset, offset + limitNum);

  res.json({ items: paged, total, page: pageNum, limit: limitNum });
});

// ── GET /accounts/profit-loss ────────────────────────────────────────────────
router.get("/profit-loss", async (req: Request, res: Response) => {
  const { period = "month", dateFrom, dateTo } = req.query as Record<string, string>;

  let from: Date;
  let to: Date;
  if (period === "custom" && dateFrom && dateTo) {
    from = new Date(dateFrom);
    to = new Date(dateTo + "T23:59:59");
  } else if (period === "today") {
    from = startOf("today"); to = endOf("today");
  } else if (period === "last_month") {
    from = startOf("last_month"); to = endOf("last_month");
  } else if (period === "year") {
    from = startOf("year"); to = endOf("year");
  } else {
    from = startOf("month"); to = endOf("month");
  }

  const [revenue, expPay, expVch] = await Promise.all([
    sumPayments("in", ["membership", "product_sale", "other"], from, to),
    sumPayments("out", ["expense", "payroll", "stock_purchase", "other"], from, to),
    sumVouchers("out", from, to),
  ]);

  const catRows = await db
    .select({ category: paymentsTable.category, usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.status, "completed"), gte(paymentsTable.paymentDate, from), lte(paymentsTable.paymentDate, to)))
    .groupBy(paymentsTable.category);

  const byCategory = Object.fromEntries(
    catRows.map((r) => [r.category, { usd: Number(r.usd ?? 0), cdf: Number(r.cdf ?? 0) }]),
  );

  const totalExpUsd = expPay.usd + expVch.usd;
  const totalExpCdf = expPay.cdf + expVch.cdf;

  await logActivity(req as Parameters<typeof logActivity>[0], "view", "accounts", undefined, { period });

  res.json({
    period,
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    revenue: { usd: revenue.usd, cdf: revenue.cdf },
    expenses: { usd: totalExpUsd, cdf: totalExpCdf },
    net: { usd: revenue.usd - totalExpUsd, cdf: revenue.cdf - totalExpCdf },
    breakdown: byCategory,
  });
});

// ── Chart of Accounts ────────────────────────────────────────────────────────

// GET /accounts/chart
router.get("/chart", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(chartOfAccountsTable)
    .orderBy(asc(chartOfAccountsTable.type), asc(chartOfAccountsTable.name));
  res.json(rows);
});

// POST /accounts/chart
router.post("/chart", async (req: Request, res: Response) => {
  const { name, type, description } = req.body as {
    name: string;
    type: string;
    description?: string;
  };
  if (!name || !type) {
    res.status(400).json({ error: "name and type are required" });
    return;
  }
  const [row] = await db
    .insert(chartOfAccountsTable)
    .values({ name: name.trim(), type, description: description ?? null })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    res.status(409).json({ error: "Account name already exists" });
    return;
  }
  res.status(201).json(row);
});

// PUT /accounts/chart/:id
router.put("/chart/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, type, description, isActive } = req.body as {
    name?: string;
    type?: string;
    description?: string;
    isActive?: boolean;
  };
  const [row] = await db
    .update(chartOfAccountsTable)
    .set({
      ...(name !== undefined && { name: name.trim() }),
      ...(type !== undefined && { type }),
      ...(description !== undefined && { description }),
      ...(isActive !== undefined && { isActive }),
    })
    .where(eq(chartOfAccountsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE /accounts/chart/:id — soft-deactivate; reject if it has accounting entries
router.delete("/chart/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  // Refuse hard-delete if any accounting entries are linked to this account
  const [hasEntries] = await db
    .select({ cnt: count() })
    .from(accountingEntriesTable)
    .where(eq(accountingEntriesTable.accountId, id));

  if (Number(hasEntries.cnt) > 0) {
    res.status(409).json({
      error: "Account has existing accounting entries and cannot be deleted. Deactivate it instead.",
    });
    return;
  }

  // Soft-deactivate
  const [row] = await db
    .update(chartOfAccountsTable)
    .set({ isActive: false })
    .where(eq(chartOfAccountsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true, deactivated: true });
});

// GET /accounts/chart/:id/statement?dateFrom=&dateTo=
router.get("/chart/:id/statement", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { dateFrom, dateTo } = req.query as Record<string, string>;

  const account = await db.query.chartOfAccountsTable.findFirst({
    where: eq(chartOfAccountsTable.id, id),
  });
  if (!account) { res.status(404).json({ error: "Not found" }); return; }

  const conditions: ReturnType<typeof eq>[] = [
    eq(accountingEntriesTable.accountId, id) as ReturnType<typeof eq>,
  ];
  if (dateFrom) conditions.push(gte(accountingEntriesTable.entryDate, new Date(dateFrom)) as ReturnType<typeof eq>);
  if (dateTo) conditions.push(lte(accountingEntriesTable.entryDate, new Date(dateTo + "T23:59:59")) as ReturnType<typeof eq>);

  const rows = await db
    .select()
    .from(accountingEntriesTable)
    .where(and(...conditions))
    .orderBy(asc(accountingEntriesTable.entryDate), asc(accountingEntriesTable.id));

  // Running balance: asset/expense accounts are debit-normal; income/liability/equity are credit-normal
  const isCredit = ["income", "liability", "equity"].includes(account.type);
  let runningBalance = 0;
  const withBalance = rows.map((r) => {
    const debit = r.debitUsd ?? 0;
    const credit = r.creditUsd ?? 0;
    const delta = isCredit ? credit - debit : debit - credit;
    runningBalance += delta;
    return {
      id: r.id,
      date: r.entryDate,
      description: r.description ?? "",
      party: r.sourceNumber ?? "",
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      amount: r.amount,
      currency: r.currency,
      debitUsd: r.debitUsd,
      creditUsd: r.creditUsd,
      debitCdf: r.debitCdf,
      creditCdf: r.creditCdf,
      exchangeRate: r.exchangeRate,
      runningBalance,
    };
  });

  res.json({ account, rows: withBalance });
});

// Suppress unused import warnings
void cashLedgerTable;

export default router;
