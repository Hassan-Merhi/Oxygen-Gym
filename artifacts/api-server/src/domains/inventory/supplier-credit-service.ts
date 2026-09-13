import { db } from "@workspace/db";
import {
  productsTable,
  salesTable,
  supplierCreditsTable,
  supplierPaymentsTable,
} from "@workspace/db/schema";
import { and, desc, eq, sql, sum } from "drizzle-orm";
import { getNextNumber } from "../../lib/numbering";
import { getExchangeRate } from "../../shared/accounting/currency";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest, notFound } from "../../shared/http/errors";

export interface CreateSupplierCreditInput {
  supplier: string;
  description?: string;
  productId?: number;
  productName?: string;
  totalAmount: number;
  currency?: string;
  purchaseDate?: Date;
  notes?: string;
}

export interface UpdateSupplierCreditInput {
  supplier?: string;
  description?: string | null;
  productId?: number | null;
  productName?: string | null;
  totalAmount?: number;
  currency?: string;
  purchaseDate?: Date;
  notes?: string | null;
  status?: string;
}

export async function getSupplierCreditSummary() {
  const rate = await getExchangeRate();
  const [credits, salesRows, products] = await Promise.all([
    db.select().from(supplierCreditsTable).orderBy(desc(supplierCreditsTable.createdAt)),
    db.select({ totalProfit: sum(salesTable.totalProfit), currency: salesTable.currency })
      .from(salesTable)
      .where(eq(salesTable.status, "completed"))
      .groupBy(salesTable.currency),
    db.select().from(productsTable).where(eq(productsTable.status, "active")),
  ]);

  const toUsd = (amount: number, currency: string) => currency === "CDF" ? amount / rate : amount;
  const totalOwed = credits.reduce((total, credit) => total + toUsd(credit.totalAmount, credit.currency), 0);
  const totalPaid = credits.reduce((total, credit) => total + toUsd(credit.amountPaid, credit.currency), 0);
  const totalProfitUsd = salesRows.reduce((total, row) => {
    const currency = (row.currency as string) ?? "USD";
    return total + toUsd(Number(row.totalProfit ?? 0), currency);
  }, 0);

  return {
    totalOwed,
    totalPaid,
    remaining: totalOwed - totalPaid,
    totalProfitUsd,
    productCount: products.length,
    lowStock: products.filter((product) => product.quantity <= product.alertQuantity).length,
  };
}

export async function listSupplierCredits() {
  const credits = await db.select().from(supplierCreditsTable).orderBy(desc(supplierCreditsTable.purchaseDate));
  return credits.map((credit) => ({ ...credit, remaining: credit.totalAmount - credit.amountPaid }));
}

export async function createSupplierCredit(input: CreateSupplierCreditInput) {
  if (!input.supplier.trim()) throw badRequest("supplier is required");
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw badRequest("totalAmount must be positive");
  const creditNumber = await getNextNumber("SUP");
  const [credit] = await db.insert(supplierCreditsTable).values({
    creditNumber,
    supplier: input.supplier.trim(),
    description: input.description,
    productId: input.productId,
    productName: input.productName,
    totalAmount: input.totalAmount,
    amountPaid: 0,
    currency: input.currency ?? "USD",
    purchaseDate: input.purchaseDate ?? new Date(),
    notes: input.notes,
    status: "open",
  }).returning();
  return { ...credit, remaining: credit.totalAmount - credit.amountPaid };
}

export async function updateSupplierCredit(id: number, input: UpdateSupplierCreditInput) {
  const [existing] = await db.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, id));
  if (!existing) throw notFound("Supplier credit not found");
  if (input.totalAmount !== undefined) {
    if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw badRequest("totalAmount must be positive");
    if (input.totalAmount + 0.001 < existing.amountPaid) throw badRequest("totalAmount cannot be lower than amount already paid");
  }

  const [credit] = await db.update(supplierCreditsTable).set({
    ...(input.supplier !== undefined && { supplier: input.supplier.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.productId !== undefined && { productId: input.productId }),
    ...(input.productName !== undefined && { productName: input.productName }),
    ...(input.totalAmount !== undefined && { totalAmount: input.totalAmount }),
    ...(input.currency !== undefined && { currency: input.currency }),
    ...(input.purchaseDate !== undefined && { purchaseDate: input.purchaseDate }),
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.status !== undefined && { status: input.status }),
  }).where(eq(supplierCreditsTable.id, id)).returning();
  return { ...credit, remaining: credit.totalAmount - credit.amountPaid };
}

export async function deleteSupplierCredit(id: number) {
  return withTransaction(async (tx) => {
    const [existing] = await tx.select({ id: supplierCreditsTable.id }).from(supplierCreditsTable).where(eq(supplierCreditsTable.id, id));
    if (!existing) throw notFound("Supplier credit not found");
    await tx.delete(supplierPaymentsTable).where(eq(supplierPaymentsTable.creditId, id));
    await tx.delete(supplierCreditsTable).where(eq(supplierCreditsTable.id, id));
    return { ok: true };
  });
}

export async function listSupplierPayments(creditId: number) {
  return db.select().from(supplierPaymentsTable)
    .where(eq(supplierPaymentsTable.creditId, creditId))
    .orderBy(desc(supplierPaymentsTable.paymentDate));
}

export async function addSupplierPayment(creditId: number, input: { amount: number; currency?: string; paymentDate?: Date; notes?: string }) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw badRequest("amount must be positive");

  return withTransaction(async (tx) => {
    const [credit] = await tx.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, creditId));
    if (!credit) throw notFound("Supplier credit not found");
    const remaining = credit.totalAmount - credit.amountPaid;
    if (input.amount > remaining + 0.001) throw badRequest(`Payment exceeds remaining balance (${remaining.toFixed(2)})`);

    const [payment] = await tx.insert(supplierPaymentsTable).values({
      creditId,
      amount: input.amount,
      currency: input.currency ?? credit.currency,
      paymentDate: input.paymentDate ?? new Date(),
      notes: input.notes,
    }).returning();

    const newPaid = credit.amountPaid + input.amount;
    const [updated] = await tx.update(supplierCreditsTable).set({
      amountPaid: newPaid,
      status: newPaid >= credit.totalAmount - 0.001 ? "paid" : "open",
    }).where(eq(supplierCreditsTable.id, creditId)).returning();

    return {
      payment,
      credit: { ...updated, remaining: updated.totalAmount - updated.amountPaid },
    };
  });
}

export async function deleteSupplierPayment(creditId: number, paymentId: number) {
  return withTransaction(async (tx) => {
    const [payment] = await tx.select().from(supplierPaymentsTable).where(and(
      eq(supplierPaymentsTable.id, paymentId),
      eq(supplierPaymentsTable.creditId, creditId),
    ));
    if (!payment) throw notFound("Supplier payment not found");

    const [credit] = await tx.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, creditId));
    if (!credit) throw notFound("Supplier credit not found");

    await tx.delete(supplierPaymentsTable).where(eq(supplierPaymentsTable.id, paymentId));
    const newPaid = Math.max(0, credit.amountPaid - payment.amount);
    const [updated] = await tx.update(supplierCreditsTable).set({
      amountPaid: newPaid,
      status: newPaid < credit.totalAmount ? "open" : "paid",
    }).where(eq(supplierCreditsTable.id, creditId)).returning();

    return { ok: true, credit: { ...updated, remaining: updated.totalAmount - updated.amountPaid } };
  });
}

export async function getSupplierProductProfitSummary() {
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
    const productId = Number(row.productId);
    const currency = (row.currency as string) ?? "USD";
    const toUsd = (amount: number) => currency === "CDF" ? amount / rate : amount;
    const existing = salesMap.get(productId) ?? { qtySold: 0, profit: 0, revenue: 0 };
    salesMap.set(productId, {
      qtySold: existing.qtySold + Number(row.qty ?? 0),
      profit: existing.profit + toUsd(Number(row.profit ?? 0)),
      revenue: existing.revenue + toUsd(Number(row.revenue ?? 0)),
    });
  }

  return products.map((product) => {
    const toUsd = (amount: number) => product.currency === "CDF" ? amount / rate : amount;
    const stats = salesMap.get(product.id) ?? { qtySold: 0, profit: 0, revenue: 0 };
    return {
      ...product,
      profitPerUnit: toUsd(product.sellingPrice) - toUsd(product.costPrice),
      stockValue: toUsd(product.sellingPrice) * product.quantity,
      costValue: toUsd(product.costPrice) * product.quantity,
      qtySold: stats.qtySold,
      totalProfit: stats.profit,
      totalRevenue: stats.revenue,
      isLowStock: product.quantity <= product.alertQuantity,
    };
  });
}
