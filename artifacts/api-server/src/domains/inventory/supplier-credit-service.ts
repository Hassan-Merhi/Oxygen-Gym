import { db } from "@workspace/db";
import {
  cashLedgerTable,
  productsTable,
  salesTable,
  supplierCreditsTable,
  supplierPaymentsTable,
} from "@workspace/db/schema";
import { and, desc, eq, sql, sum } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { getNextNumber } from "../../lib/numbering";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
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

function convertAmount(amount: number, from: string, to: string, rate: number): number {
  if (from === to) return amount;
  if (from === "CDF" && to === "USD") return amount / rate;
  if (from === "USD" && to === "CDF") return amount * rate;
  throw badRequest("Supplier payment currency must be USD or CDF");
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
  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, id));
    if (!existing) throw notFound("Supplier credit not found");
    if (input.totalAmount !== undefined) {
      if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw badRequest("totalAmount must be positive");
      if (input.totalAmount + 0.001 < existing.amountPaid) throw badRequest("totalAmount cannot be lower than amount already paid");
    }
    if (input.currency !== undefined && input.currency !== existing.currency && existing.amountPaid > 0) {
      throw badRequest("Cannot change supplier credit currency after payments have been posted");
    }

    const [credit] = await tx.update(supplierCreditsTable).set({
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
  });
}

export async function deleteSupplierCredit(id: number) {
  return withTransaction(async (tx) => {
    const [existing] = await tx.select({ id: supplierCreditsTable.id }).from(supplierCreditsTable).where(eq(supplierCreditsTable.id, id));
    if (!existing) throw notFound("Supplier credit not found");
    const payments = await tx.select({ id: supplierPaymentsTable.id })
      .from(supplierPaymentsTable)
      .where(eq(supplierPaymentsTable.creditId, id))
      .limit(1);
    if (payments.length > 0) {
      throw badRequest("Delete or reverse supplier payments before deleting this supplier credit");
    }
    await tx.delete(supplierCreditsTable).where(eq(supplierCreditsTable.id, id));
    return { ok: true };
  });
}

export async function listSupplierPayments(creditId: number) {
  return db.select().from(supplierPaymentsTable)
    .where(eq(supplierPaymentsTable.creditId, creditId))
    .orderBy(desc(supplierPaymentsTable.paymentDate));
}

export async function addSupplierPayment(
  creditId: number,
  input: { amount: number; currency?: string; paymentDate?: Date; notes?: string },
) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw badRequest("amount must be positive");
  const rate = await getExchangeRate();
  if (!Number.isFinite(rate) || rate <= 0) throw badRequest("A valid exchange rate is required");

  return withTransaction(async (tx) => {
    const [credit] = await tx.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, creditId));
    if (!credit) throw notFound("Supplier credit not found");

    const paymentCurrency = input.currency ?? credit.currency;
    if (!["USD", "CDF"].includes(paymentCurrency) || !["USD", "CDF"].includes(credit.currency)) {
      throw badRequest("Supplier payment currency must be USD or CDF");
    }
    const appliedAmount = convertAmount(input.amount, paymentCurrency, credit.currency, rate);
    const remaining = credit.totalAmount - credit.amountPaid;
    if (appliedAmount > remaining + 0.001) throw badRequest(`Payment exceeds remaining balance (${remaining.toFixed(2)} ${credit.currency})`);

    const paymentDate = input.paymentDate ?? new Date();
    const { amountUsd, amountCdf } = toUsdCdf(input.amount, paymentCurrency, rate);
    const [payment] = await tx.insert(supplierPaymentsTable).values({
      creditId,
      amount: input.amount,
      currency: paymentCurrency,
      exchangeRate: rate,
      amountUsd,
      amountCdf,
      paymentDate,
      notes: input.notes,
    }).returning();

    const newPaid = credit.amountPaid + appliedAmount;
    const [updated] = await tx.update(supplierCreditsTable).set({
      amountPaid: newPaid,
      status: newPaid >= credit.totalAmount - 0.001 ? "paid" : "open",
    }).where(eq(supplierCreditsTable.id, creditId)).returning();

    const description = `Supplier payment: ${credit.supplier} — ${credit.creditNumber ?? credit.id}`;
    await appendLedgerEntry({
      entryDate: paymentDate,
      sourceType: "supplier_payment",
      sourceNumber: credit.creditNumber ?? undefined,
      sourceId: payment.id,
      direction: "out",
      amount: input.amount,
      currency: paymentCurrency,
      exchangeRate: rate,
      description,
    }, tx);
    await postDoubleEntry({
      entryDate: paymentDate,
      sourceType: "supplier_payment",
      sourceId: payment.id,
      sourceNumber: credit.creditNumber ?? undefined,
      debitName: "Accounts Payable",
      debitType: "liability",
      creditName: "Cash",
      creditType: "asset",
      amount: input.amount,
      amountUsd,
      amountCdf,
      currency: paymentCurrency,
      exchangeRate: rate,
      description,
    }, tx);

    return {
      payment,
      credit: { ...updated, remaining: updated.totalAmount - updated.amountPaid },
    };
  });
}

export async function deleteSupplierPayment(creditId: number, paymentId: number) {
  const fallbackRate = await getExchangeRate();
  if (!Number.isFinite(fallbackRate) || fallbackRate <= 0) throw badRequest("A valid exchange rate is required");

  return withTransaction(async (tx) => {
    const [payment] = await tx.select().from(supplierPaymentsTable).where(and(
      eq(supplierPaymentsTable.id, paymentId),
      eq(supplierPaymentsTable.creditId, creditId),
    ));
    if (!payment) throw notFound("Supplier payment not found");

    const [credit] = await tx.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, creditId));
    if (!credit) throw notFound("Supplier credit not found");

    const [ledger] = await tx.select().from(cashLedgerTable).where(and(
      eq(cashLedgerTable.sourceType, "supplier_payment"),
      eq(cashLedgerTable.sourceId, paymentId),
    )).orderBy(desc(cashLedgerTable.id)).limit(1);

    const paymentRate = payment.exchangeRate > 0
      ? payment.exchangeRate
      : ledger?.exchangeRate ?? fallbackRate;

    if (ledger) {
      await appendLedgerEntry({
        entryDate: new Date(),
        sourceType: "supplier_payment_reversal",
        sourceNumber: credit.creditNumber ?? undefined,
        sourceId: payment.id,
        direction: "in",
        amount: payment.amount,
        currency: payment.currency,
        exchangeRate: paymentRate,
        description: `Reversal: supplier payment ${credit.creditNumber ?? credit.id}`,
      }, tx);
      await reverseEntries("supplier_payment", payment.id, "supplier_payment_reversal", "system", tx);
    }

    await tx.delete(supplierPaymentsTable).where(eq(supplierPaymentsTable.id, paymentId));
    // Legacy supplier payments pre-date atomic posting. New rows persist the exact
    // exchange rate used for balance, ledger, and accounting in the source row.
    const appliedAmount = convertAmount(payment.amount, payment.currency, credit.currency, paymentRate);
    const newPaid = Math.max(0, credit.amountPaid - appliedAmount);
    const [updated] = await tx.update(supplierCreditsTable).set({
      amountPaid: newPaid,
      status: newPaid < credit.totalAmount - 0.001 ? "open" : "paid",
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
