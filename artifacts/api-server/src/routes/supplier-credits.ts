import { Router, type Request, type Response } from "express";
import { db, withTransaction } from "@workspace/db";
import {
  supplierCreditsTable,
  supplierPaymentsTable,
  productsTable,
  salesTable,
} from "@workspace/db/schema";
import { eq, and, desc, sum, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { getExchangeRate } from "../repositories/settings";

const router = Router();
router.use(requireAuth());

// ── Summary KPIs ──────────────────────────────────────────────────────────────
router.get("/summary", async (_req: Request, res: Response) => {
  const rate = await getExchangeRate();

  const [credits, salesRows, products] = await Promise.all([
    db.select().from(supplierCreditsTable).orderBy(desc(supplierCreditsTable.createdAt)),
    db.select({ totalProfit: sum(salesTable.totalProfit), currency: salesTable.currency })
      .from(salesTable)
      .where(eq(salesTable.status, "completed"))
      .groupBy(salesTable.currency),
    db.select().from(productsTable).where(eq(productsTable.status, "active")),
  ]);

  const toUsd = (amount: number, cur: string) =>
    cur === "CDF" ? amount / rate : amount;

  const totalOwed = credits.reduce((s, c) => s + toUsd(c.totalAmount, c.currency), 0);
  const totalPaid = credits.reduce((s, c) => s + toUsd(c.amountPaid, c.currency), 0);
  const remaining = totalOwed - totalPaid;

  let totalProfitUsd = 0;
  for (const row of salesRows) {
    const cur = (row.currency as string) ?? "USD";
    totalProfitUsd += toUsd(Number(row.totalProfit ?? 0), cur);
  }

  const productCount = products.length;
  const lowStock = products.filter((p) => p.quantity <= p.alertQuantity).length;

  res.json({ totalOwed, totalPaid, remaining, totalProfitUsd, productCount, lowStock });
});

// ── List credits ──────────────────────────────────────────────────────────────
router.get("/", async (_req: Request, res: Response) => {
  const credits = await db
    .select()
    .from(supplierCreditsTable)
    .orderBy(desc(supplierCreditsTable.purchaseDate));

  res.json(credits.map((c) => ({
    ...c,
    remaining: c.totalAmount - c.amountPaid,
  })));
});

// ── Create credit ─────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as {
    supplier: string;
    description?: string;
    productId?: number;
    productName?: string;
    totalAmount: number;
    currency?: string;
    purchaseDate?: string;
    notes?: string;
  };

  if (!body.supplier) { res.status(400).json({ error: "supplier is required" }); return; }
  if (!body.totalAmount || body.totalAmount <= 0) { res.status(400).json({ error: "totalAmount must be positive" }); return; }

  const credit = await withTransaction(async (tx) => {
    const creditNumber = await getNextNumber("SUP", tx);
    const [created] = await tx.insert(supplierCreditsTable).values({
      creditNumber,
      supplier: body.supplier,
      description: body.description,
      productId: body.productId,
      productName: body.productName,
      totalAmount: body.totalAmount,
      amountPaid: 0,
      currency: body.currency ?? "USD",
      purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : new Date(),
      notes: body.notes,
      status: "open",
    }).returning();
    if (!created) throw new Error("Unable to create supplier credit");
    return created;
  });

  await logActivity(req, "create_supplier_credit", "supplier_credit", credit.id, {
    supplier: credit.supplier,
    creditNumber: credit.creditNumber,
  });
  res.status(201).json({ ...credit, remaining: credit.totalAmount - credit.amountPaid });
});

// ── Update credit ─────────────────────────────────────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const allowed = ["supplier", "description", "productId", "productName", "totalAmount", "currency", "purchaseDate", "notes", "status"];
  const update: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) {
      update[k] = k === "purchaseDate" && body[k] ? new Date(body[k] as string) : body[k];
    }
  }

  const [existing] = await db.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [credit] = await db.update(supplierCreditsTable).set(update).where(eq(supplierCreditsTable.id, id)).returning();
  res.json({ ...credit, remaining: credit.totalAmount - credit.amountPaid });
});

// ── Delete credit ─────────────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const deleted = await withTransaction(async (tx) => {
    const [existing] = await tx
      .select({ id: supplierCreditsTable.id })
      .from(supplierCreditsTable)
      .where(eq(supplierCreditsTable.id, id))
      .for("update");
    if (!existing) return false;

    await tx.delete(supplierPaymentsTable).where(eq(supplierPaymentsTable.creditId, id));
    await tx.delete(supplierCreditsTable).where(eq(supplierCreditsTable.id, id));
    return true;
  });

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

// ── List payments for a credit ────────────────────────────────────────────────
router.get("/:id/payments", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const payments = await db
    .select()
    .from(supplierPaymentsTable)
    .where(eq(supplierPaymentsTable.creditId, id))
    .orderBy(desc(supplierPaymentsTable.paymentDate));
  res.json(payments);
});

// ── Record an installment payment ─────────────────────────────────────────────
router.post("/:id/payments", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as { amount: number; currency?: string; paymentDate?: string; notes?: string };

  if (!body.amount || body.amount <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }

  const result = await withTransaction(async (tx) => {
    const [credit] = await tx
      .select()
      .from(supplierCreditsTable)
      .where(eq(supplierCreditsTable.id, id))
      .for("update");
    if (!credit) return { kind: "not_found" as const };

    const remaining = credit.totalAmount - credit.amountPaid;
    if (body.amount > remaining + 0.001) {
      return { kind: "overpayment" as const, remaining };
    }

    const [payment] = await tx.insert(supplierPaymentsTable).values({
      creditId: id,
      amount: body.amount,
      currency: body.currency ?? credit.currency,
      paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
      notes: body.notes,
    }).returning();

    const newPaid = credit.amountPaid + body.amount;
    const newStatus = newPaid >= credit.totalAmount - 0.001 ? "paid" : "open";
    const [updated] = await tx.update(supplierCreditsTable)
      .set({ amountPaid: newPaid, status: newStatus })
      .where(eq(supplierCreditsTable.id, id))
      .returning();

    if (!payment || !updated) throw new Error("Unable to record supplier payment");
    return { kind: "ok" as const, payment, credit: updated, supplier: credit.supplier };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (result.kind === "overpayment") {
    res.status(400).json({ error: `Payment exceeds remaining balance (${result.remaining.toFixed(2)})` });
    return;
  }

  await logActivity(req, "supplier_payment", "supplier_credit", id, {
    amount: body.amount,
    supplier: result.supplier,
  });
  res.status(201).json({
    payment: result.payment,
    credit: { ...result.credit, remaining: result.credit.totalAmount - result.credit.amountPaid },
  });
});

// ── Delete a payment (undo) ───────────────────────────────────────────────────
router.delete("/:id/payments/:paymentId", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const paymentId = Number(req.params.paymentId);

  const result = await withTransaction(async (tx) => {
    const [credit] = await tx
      .select()
      .from(supplierCreditsTable)
      .where(eq(supplierCreditsTable.id, id))
      .for("update");
    if (!credit) return { kind: "credit_not_found" as const };

    const [payment] = await tx.select().from(supplierPaymentsTable)
      .where(and(eq(supplierPaymentsTable.id, paymentId), eq(supplierPaymentsTable.creditId, id)))
      .for("update");
    if (!payment) return { kind: "payment_not_found" as const };

    await tx.delete(supplierPaymentsTable).where(eq(supplierPaymentsTable.id, paymentId));

    const newPaid = Math.max(0, credit.amountPaid - payment.amount);
    const [updated] = await tx.update(supplierCreditsTable)
      .set({ amountPaid: newPaid, status: newPaid < credit.totalAmount ? "open" : "paid" })
      .where(eq(supplierCreditsTable.id, id))
      .returning();
    if (!updated) throw new Error("Unable to update supplier credit after payment deletion");

    return { kind: "ok" as const, credit: updated };
  });

  if (result.kind === "credit_not_found") { res.status(404).json({ error: "Credit not found" }); return; }
  if (result.kind === "payment_not_found") { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true, credit: { ...result.credit, remaining: result.credit.totalAmount - result.credit.amountPaid } });
});

// ── Product profit summary (for Supplements page product cards) ───────────────
router.get("/products", async (_req: Request, res: Response) => {
  const rate = await getExchangeRate();

  const [products, salesRows] = await Promise.all([
    db.select().from(productsTable)
      .where(eq(productsTable.status, "active"))
      .orderBy(desc(productsTable.createdAt)),
    db.select({
      productId: sql<number>`(jsonb_array_elements(items)->>'productId')::int`,
      qty: sql<number>`sum((jsonb_array_elements(items)->>'quantity')::numeric)`,
      revenue: sql<number>`sum((jsonb_array_elements(items)->>'lineTotal')::numeric)`,
      cost: sql<number>`sum((jsonb_array_elements(items)->>'costPrice')::numeric * (jsonb_array_elements(items)->>'quantity')::numeric)`,
      profit: sql<number>`sum((jsonb_array_elements(items)->>'profit')::numeric)`,
      currency: salesTable.currency,
    })
      .from(salesTable)
      .where(eq(salesTable.status, "completed"))
      .groupBy(sql`(jsonb_array_elements(items)->>'productId')::int`, salesTable.currency),
  ]);

  const salesMap = new Map<number, { qtySold: number; profit: number; revenue: number }>();
  for (const row of salesRows) {
    const pid = Number(row.productId);
    const cur = (row.currency as string) ?? "USD";
    const toUsd = (n: number) => cur === "CDF" ? n / rate : n;
    const existing = salesMap.get(pid) ?? { qtySold: 0, profit: 0, revenue: 0 };
    salesMap.set(pid, {
      qtySold: existing.qtySold + Number(row.qty ?? 0),
      profit: existing.profit + toUsd(Number(row.profit ?? 0)),
      revenue: existing.revenue + toUsd(Number(row.revenue ?? 0)),
    });
  }

  const enriched = products.map((p) => {
    const toUsd = (n: number) => p.currency === "CDF" ? n / rate : n;
    const stats = salesMap.get(p.id) ?? { qtySold: 0, profit: 0, revenue: 0 };
    return {
      ...p,
      profitPerUnit: toUsd(p.sellingPrice) - toUsd(p.costPrice),
      stockValue: toUsd(p.sellingPrice) * p.quantity,
      costValue: toUsd(p.costPrice) * p.quantity,
      qtySold: stats.qtySold,
      totalProfit: stats.profit,
      totalRevenue: stats.revenue,
      isLowStock: p.quantity <= p.alertQuantity,
    };
  });

  res.json(enriched);
});

export default router;
