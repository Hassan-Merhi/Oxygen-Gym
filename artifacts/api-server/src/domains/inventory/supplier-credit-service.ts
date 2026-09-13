import { db } from "@workspace/db";
import {
  paymentsTable,
  productsTable,
  salesTable,
  supplierCreditsTable,
  supplierPaymentsTable,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { ACCOUNTS, postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { getNextNumber } from "../../lib/numbering";
import { convertCurrencyAmount, getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { addMoney, fxRate, money, multiplyMoney, subtractMoney } from "../../shared/accounting/decimal";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest, notFound } from "../../shared/http/errors";

export interface CreateSupplierCreditInput {
  supplier: string;
  description?: string;
  productId?: number;
  productName?: string;
  totalAmount: number;
  currency?: string;
  exchangeRate?: number;
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
  exchangeRate?: number;
  purchaseDate?: Date;
  notes?: string | null;
  status?: string;
}

export interface SupplierPaymentInput {
  amount: number;
  currency?: string;
  exchangeRate?: number;
  account?: string;
  paymentDate?: Date;
  notes?: string;
}

function normalizeCurrency(value: string): "USD" | "CDF" {
  const currency = value.toUpperCase();
  if (currency !== "USD" && currency !== "CDF") throw badRequest("currency must be USD or CDF");
  return currency;
}

function supplierCreditDebit(productId?: number | null) {
  return productId
    ? { debitName: ACCOUNTS.INVENTORY, debitType: "asset" as const }
    : { debitName: ACCOUNTS.GENERAL_EXPENSE, debitType: "expense" as const };
}

export async function getSupplierCreditSummary() {
  const [credits, salesRows, products] = await Promise.all([
    db.select().from(supplierCreditsTable).orderBy(desc(supplierCreditsTable.createdAt)),
    db.select({ totalProfitUsd: salesTable.totalProfitUsd })
      .from(salesTable)
      .where(eq(salesTable.status, "completed")),
    db.select().from(productsTable).where(eq(productsTable.status, "active")),
  ]);

  const totalOwed = credits.reduce((total, credit) => {
    const rate = fxRate(Number(credit.exchangeRate || 1));
    return addMoney(total, toUsdCdf(credit.totalAmount, credit.currency, rate).amountUsd);
  }, 0);
  const totalPaid = credits.reduce((total, credit) => {
    const rate = fxRate(Number(credit.exchangeRate || 1));
    return addMoney(total, toUsdCdf(credit.amountPaid, credit.currency, rate).amountUsd);
  }, 0);
  const totalProfitUsd = salesRows.reduce((total, row) => addMoney(total, Number(row.totalProfitUsd ?? 0)), 0);

  return {
    totalOwed,
    totalPaid,
    remaining: subtractMoney(totalOwed, totalPaid),
    totalProfitUsd,
    productCount: products.length,
    lowStock: products.filter((product) => product.quantity <= product.alertQuantity).length,
  };
}

export async function listSupplierCredits() {
  const credits = await db.select().from(supplierCreditsTable).orderBy(desc(supplierCreditsTable.purchaseDate));
  return credits.map((credit) => ({ ...credit, remaining: subtractMoney(credit.totalAmount, credit.amountPaid) }));
}

export async function createSupplierCredit(input: CreateSupplierCreditInput, actor = "system") {
  if (!input.supplier.trim()) throw badRequest("supplier is required");
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) throw badRequest("totalAmount must be positive");
  const currency = normalizeCurrency(input.currency ?? "USD");

  return withTransaction(async (tx) => {
    const rate = fxRate(input.exchangeRate ?? await getExchangeRate(tx));
    const creditNumber = await getNextNumber("SUP", tx);
    const totalAmount = money(input.totalAmount);
    const [credit] = await tx.insert(supplierCreditsTable).values({
      creditNumber,
      supplier: input.supplier.trim(),
      description: input.description,
      productId: input.productId,
      productName: input.productName,
      totalAmount,
      amountPaid: 0,
      currency,
      exchangeRate: rate,
      purchaseDate: input.purchaseDate ?? new Date(),
      notes: input.notes,
      status: "open",
    }).returning();

    const converted = toUsdCdf(totalAmount, currency, rate);
    await postDoubleEntry({
      sourceType: "supplier_credit",
      sourceId: credit.id,
      sourceNumber: creditNumber,
      entryDate: credit.purchaseDate,
      ...supplierCreditDebit(credit.productId),
      creditName: ACCOUNTS.SUPPLIER_PAYABLES,
      creditType: "liability",
      amount: totalAmount,
      ...converted,
      currency,
      exchangeRate: rate,
      description: credit.description || `Supplier credit — ${credit.supplier}`,
      createdBy: actor,
    }, tx);

    return { ...credit, remaining: totalAmount };
  });
}

export async function updateSupplierCredit(id: number, input: UpdateSupplierCreditInput, actor = "system") {
  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, id)).for("update");
    if (!existing) throw notFound("Supplier credit not found");

    const storedRate = Number(existing.exchangeRate ?? 0);
    if (input.exchangeRate !== undefined && storedRate > 0 && fxRate(input.exchangeRate) !== fxRate(storedRate)) {
      throw badRequest("Exchange rate is locked after a supplier credit is posted");
    }
    const rate = fxRate(storedRate > 0 ? storedRate : (input.exchangeRate ?? await getExchangeRate(tx)));
    const oldCurrency = normalizeCurrency(existing.currency);
    const currency = normalizeCurrency(input.currency ?? existing.currency);
    const amountPaid = currency === oldCurrency
      ? money(existing.amountPaid)
      : convertCurrencyAmount(existing.amountPaid, oldCurrency, currency, rate);
    const totalAmount = money(input.totalAmount ?? (currency === oldCurrency
      ? existing.totalAmount
      : convertCurrencyAmount(existing.totalAmount, oldCurrency, currency, rate)));
    if (totalAmount <= 0) throw badRequest("totalAmount must be positive");
    if (totalAmount < amountPaid) throw badRequest("totalAmount cannot be lower than amount already paid");

    const productId = input.productId !== undefined ? input.productId : existing.productId;
    const financialChanged = totalAmount !== money(existing.totalAmount)
      || currency !== oldCurrency
      || productId !== existing.productId
      || (input.purchaseDate !== undefined && input.purchaseDate.getTime() !== existing.purchaseDate.getTime());

    if (financialChanged) {
      await reverseEntries("supplier_credit", id, "supplier_credit_correction", actor, tx);
    }

    const computedStatus = amountPaid >= totalAmount ? "paid" : "open";
    const [credit] = await tx.update(supplierCreditsTable).set({
      ...(input.supplier !== undefined && { supplier: input.supplier.trim() }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.productId !== undefined && { productId: input.productId }),
      ...(input.productName !== undefined && { productName: input.productName }),
      totalAmount,
      amountPaid,
      currency,
      exchangeRate: rate,
      ...(input.purchaseDate !== undefined && { purchaseDate: input.purchaseDate }),
      ...(input.notes !== undefined && { notes: input.notes }),
      status: input.status === "paid" && computedStatus !== "paid" ? computedStatus : (input.status ?? computedStatus),
    }).where(eq(supplierCreditsTable.id, id)).returning();

    if (financialChanged) {
      const converted = toUsdCdf(totalAmount, currency, rate);
      await postDoubleEntry({
        sourceType: "supplier_credit_correction",
        sourceId: id,
        sourceNumber: existing.creditNumber ?? undefined,
        entryDate: input.purchaseDate ?? existing.purchaseDate,
        ...supplierCreditDebit(productId),
        creditName: ACCOUNTS.SUPPLIER_PAYABLES,
        creditType: "liability",
        amount: totalAmount,
        ...converted,
        currency,
        exchangeRate: rate,
        description: input.description ?? existing.description ?? `Supplier credit — ${credit.supplier}`,
        createdBy: actor,
      }, tx);
    }

    return { ...credit, remaining: subtractMoney(credit.totalAmount, credit.amountPaid) };
  });
}

export async function deleteSupplierCredit(id: number, actor = "system") {
  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, id)).for("update");
    if (!existing) throw notFound("Supplier credit not found");
    const payments = await tx.select({ id: supplierPaymentsTable.id }).from(supplierPaymentsTable)
      .where(eq(supplierPaymentsTable.creditId, id));
    if (payments.length > 0) throw badRequest("Delete supplier payments before deleting this supplier credit");

    await reverseEntries("supplier_credit", id, "supplier_credit_reversal", actor, tx);
    await tx.delete(supplierCreditsTable).where(eq(supplierCreditsTable.id, id));
    return { ok: true };
  });
}

export async function listSupplierPayments(creditId: number) {
  return db.select().from(supplierPaymentsTable)
    .where(eq(supplierPaymentsTable.creditId, creditId))
    .orderBy(desc(supplierPaymentsTable.paymentDate));
}

export async function addSupplierPayment(creditId: number, input: SupplierPaymentInput, actor = "system") {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw badRequest("amount must be positive");

  return withTransaction(async (tx) => {
    const [credit] = await tx.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, creditId)).for("update");
    if (!credit) throw notFound("Supplier credit not found");
    const currency = normalizeCurrency(input.currency ?? credit.currency);
    if (currency !== normalizeCurrency(credit.currency)) {
      throw badRequest("Supplier payments must use the credit currency so the liability settles at its locked FX rate");
    }

    const storedRate = Number(credit.exchangeRate ?? 0);
    const rate = fxRate(storedRate > 0 ? storedRate : await getExchangeRate(tx));
    if (input.exchangeRate !== undefined && fxRate(input.exchangeRate) !== rate) {
      throw badRequest("Supplier payment must use the supplier credit's locked exchange rate");
    }

    const amount = money(input.amount);
    const remaining = subtractMoney(credit.totalAmount, credit.amountPaid);
    if (amount > remaining) throw badRequest(`Payment exceeds remaining balance (${remaining.toFixed(2)})`);
    const account = input.account ?? "cash";
    const paymentNumber = await getNextNumber("PAY", tx);
    const paymentDate = input.paymentDate ?? new Date();
    const converted = toUsdCdf(amount, currency, rate);

    const [supplierPayment] = await tx.insert(supplierPaymentsTable).values({
      creditId,
      amount,
      currency,
      exchangeRate: rate,
      ...converted,
      account,
      paymentDate,
      notes: input.notes,
    }).returning();

    const description = `Supplier payment — ${credit.supplier}${credit.creditNumber ? ` (${credit.creditNumber})` : ""}`;
    const [cashPayment] = await tx.insert(paymentsTable).values({
      paymentNumber,
      direction: "out",
      category: "supplier_payment",
      type: "supplier_payment",
      linkedEntity: "supplier_payment",
      linkedEntityId: supplierPayment.id,
      linkedEntityName: credit.supplier,
      amount,
      currency,
      exchangeRate: rate,
      ...converted,
      account,
      notes: input.notes || description,
      paymentDate,
      status: "completed",
      createdBy: actor,
    }).returning();
    await tx.update(supplierPaymentsTable).set({ paymentId: cashPayment.id }).where(eq(supplierPaymentsTable.id, supplierPayment.id));

    await appendLedgerEntry({
      entryDate: paymentDate,
      sourceType: "supplier_payment",
      sourceNumber: paymentNumber,
      sourceId: supplierPayment.id,
      direction: "out",
      amount,
      currency,
      exchangeRate: rate,
      description,
      createdBy: actor,
    }, tx);

    await postDoubleEntry({
      entryDate: paymentDate,
      sourceType: "supplier_payment",
      sourceId: supplierPayment.id,
      sourceNumber: paymentNumber,
      debitName: ACCOUNTS.SUPPLIER_PAYABLES,
      debitType: "liability",
      creditName: account,
      creditType: "asset",
      amount,
      ...converted,
      currency,
      exchangeRate: rate,
      description,
      createdBy: actor,
    }, tx);

    const newPaid = addMoney(credit.amountPaid, amount);
    const [updated] = await tx.update(supplierCreditsTable).set({
      amountPaid: newPaid,
      status: newPaid >= money(credit.totalAmount) ? "paid" : "open",
    }).where(eq(supplierCreditsTable.id, creditId)).returning();

    const [finalPayment] = await tx.select().from(supplierPaymentsTable).where(eq(supplierPaymentsTable.id, supplierPayment.id));
    return {
      payment: finalPayment,
      credit: { ...updated, remaining: subtractMoney(updated.totalAmount, updated.amountPaid) },
    };
  });
}

export async function deleteSupplierPayment(creditId: number, paymentId: number, actor = "system") {
  return withTransaction(async (tx) => {
    const [payment] = await tx.select().from(supplierPaymentsTable).where(and(
      eq(supplierPaymentsTable.id, paymentId),
      eq(supplierPaymentsTable.creditId, creditId),
    )).for("update");
    if (!payment) throw notFound("Supplier payment not found");

    const [credit] = await tx.select().from(supplierCreditsTable).where(eq(supplierCreditsTable.id, creditId)).for("update");
    if (!credit) throw notFound("Supplier credit not found");
    const rate = fxRate(Number(payment.exchangeRate || credit.exchangeRate || 1));

    await appendLedgerEntry({
      entryDate: new Date(),
      sourceType: "supplier_payment_reversal",
      sourceId: payment.id,
      direction: "in",
      amount: payment.amount,
      currency: payment.currency,
      exchangeRate: rate,
      description: `Reversal of supplier payment — ${credit.supplier}`,
      createdBy: actor,
    }, tx);
    await reverseEntries("supplier_payment", payment.id, "supplier_payment_reversal", actor, tx);
    if (payment.paymentId) {
      await tx.update(paymentsTable).set({ status: "cancelled" }).where(eq(paymentsTable.id, payment.paymentId));
    }

    await tx.delete(supplierPaymentsTable).where(eq(supplierPaymentsTable.id, paymentId));
    const newPaid = money(Math.max(0, subtractMoney(credit.amountPaid, payment.amount)));
    const [updated] = await tx.update(supplierCreditsTable).set({
      amountPaid: newPaid,
      status: newPaid < money(credit.totalAmount) ? "open" : "paid",
    }).where(eq(supplierCreditsTable.id, creditId)).returning();

    return { ok: true, credit: { ...updated, remaining: subtractMoney(updated.totalAmount, updated.amountPaid) } };
  });
}

export async function getSupplierProductProfitSummary() {
  const currentRate = await getExchangeRate();
  const [products, sales] = await Promise.all([
    db.select().from(productsTable)
      .where(eq(productsTable.status, "active"))
      .orderBy(desc(productsTable.createdAt)),
    db.select({
      items: salesTable.items,
      currency: salesTable.currency,
      exchangeRate: salesTable.exchangeRate,
    }).from(salesTable).where(eq(salesTable.status, "completed")),
  ]);

  const salesMap = new Map<number, { qtySold: number; profit: number; revenue: number }>();
  for (const sale of sales) {
    const rate = fxRate(Number(sale.exchangeRate || currentRate));
    for (const item of sale.items ?? []) {
      const existing = salesMap.get(item.productId) ?? { qtySold: 0, profit: 0, revenue: 0 };
      salesMap.set(item.productId, {
        qtySold: existing.qtySold + item.quantity,
        profit: addMoney(existing.profit, toUsdCdf(item.profit ?? 0, sale.currency, rate).amountUsd),
        revenue: addMoney(existing.revenue, toUsdCdf(item.lineTotal ?? 0, sale.currency, rate).amountUsd),
      });
    }
  }

  return products.map((product) => {
    const sellingUsd = convertCurrencyAmount(product.sellingPrice, product.currency, "USD", currentRate);
    const costUsd = convertCurrencyAmount(product.costPrice, product.currency, "USD", currentRate);
    const stats = salesMap.get(product.id) ?? { qtySold: 0, profit: 0, revenue: 0 };
    return {
      ...product,
      profitPerUnit: subtractMoney(sellingUsd, costUsd),
      stockValue: multiplyMoney(sellingUsd, product.quantity),
      costValue: multiplyMoney(costUsd, product.quantity),
      qtySold: stats.qtySold,
      totalProfit: stats.profit,
      totalRevenue: stats.revenue,
      isLowStock: product.quantity <= product.alertQuantity,
    };
  });
}
