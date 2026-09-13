import { db } from "@workspace/db";
import { paymentsTable, productsTable, salesTable } from "@workspace/db/schema";
import type { SaleItem } from "@workspace/db/schema";
import { and, count, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { getNextNumber } from "../../lib/numbering";
import { postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest, notFound } from "../../shared/http/errors";

export interface SalesListInput {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  currency?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface SaleLineInput {
  productId: number;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface CreateSaleInput {
  items: SaleLineInput[];
  currency: string;
  paymentAmount: number;
  notes?: string;
}

export interface PatchSaleItemInput {
  productId: number;
  unitPrice: number;
  discount: number;
}

export interface PatchSaleInput {
  currency?: string;
  notes?: string | null;
  saleDate?: Date;
  paymentAmount?: number;
  items?: PatchSaleItemInput[];
}

function validateSaleLine(item: SaleLineInput): void {
  if (!Number.isInteger(item.productId) || item.productId <= 0) throw badRequest("Each sale item requires a valid productId");
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw badRequest("Sale item quantity must be greater than zero");
  if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw badRequest("Unit price cannot be negative");
  if (!Number.isFinite(item.discount) || item.discount < 0) throw badRequest("Discount cannot be negative");
  if (item.discount > item.unitPrice) throw badRequest("Discount cannot exceed unit price");
}

export async function lookupProductByBarcode(barcode: string) {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.barcode, barcode));
  return product ?? null;
}

export async function listSales(input: SalesListInput) {
  const conditions: ReturnType<typeof eq>[] = [];
  if (input.search) {
    conditions.push(or(
      ilike(salesTable.saleNumber, `%${input.search}%`),
      ilike(salesTable.createdBy, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
  }
  if (input.status) conditions.push(eq(salesTable.status, input.status));
  if (input.currency) conditions.push(eq(salesTable.currency, input.currency));
  if (input.dateFrom) conditions.push(gte(salesTable.saleDate, input.dateFrom));
  if (input.dateTo) conditions.push(lte(salesTable.saleDate, input.dateTo));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (input.page - 1) * input.limit;
  const [items, [totalRow]] = await Promise.all([
    db.select().from(salesTable).where(where).orderBy(desc(salesTable.saleDate)).limit(input.limit).offset(offset),
    db.select({ total: count() }).from(salesTable).where(where),
  ]);
  return { items, total: Number(totalRow.total), page: input.page, limit: input.limit };
}

export async function getSale(id: number) {
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!sale) throw notFound("Sale not found");
  return sale;
}

export async function createSale(input: CreateSaleInput, actor: string) {
  if (!input.items.length) throw badRequest("Cart is empty");
  input.items.forEach(validateSaleLine);
  if (!Number.isFinite(input.paymentAmount) || input.paymentAmount < 0) throw badRequest("Payment amount cannot be negative");

  const rate = await getExchangeRate();
  const saleNumber = await getNextNumber("sale");
  const paymentNumber = await getNextNumber("PAY");

  return withTransaction(async (tx) => {
    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const products = await tx.select().from(productsTable).where(
      or(...productIds.map((productId) => eq(productsTable.id, productId))) as ReturnType<typeof eq>,
    );
    const productMap = new Map(products.map((product) => [product.id, product]));

    let totalAmount = 0;
    let totalDiscount = 0;
    let totalCost = 0;
    let totalProfit = 0;

    const saleItems: SaleItem[] = input.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw badRequest(`Product ${item.productId} not found`);
      if (product.status !== "active") throw badRequest(`Product "${product.name}" is not active`);
      if (product.quantity < item.quantity) throw badRequest(`Insufficient stock for "${product.name}" (available: ${product.quantity})`);

      let costInSaleCurrency = product.costPrice;
      if (product.currency !== input.currency) {
        if (input.currency === "USD" && product.currency === "CDF") costInSaleCurrency = product.costPrice / rate;
        if (input.currency === "CDF" && product.currency === "USD") costInSaleCurrency = product.costPrice * rate;
      }

      const lineTotal = (item.unitPrice - item.discount) * item.quantity;
      const lineCost = costInSaleCurrency * item.quantity;
      const lineProfit = lineTotal - lineCost;
      totalAmount += lineTotal;
      totalDiscount += item.discount * item.quantity;
      totalCost += lineCost;
      totalProfit += lineProfit;

      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        lineTotal,
        costPrice: costInSaleCurrency,
        profit: lineProfit,
        currency: input.currency,
      };
    });

    const totalAmountUsd = input.currency === "USD" ? totalAmount : totalAmount / rate;
    const totalCostUsd = input.currency === "USD" ? totalCost : totalCost / rate;
    const totalProfitUsd = input.currency === "USD" ? totalProfit : totalProfit / rate;
    const changeDue = Math.max(0, input.paymentAmount - totalAmount);

    const [sale] = await tx.insert(salesTable).values({
      saleNumber,
      items: saleItems,
      totalAmount,
      totalDiscount,
      totalCost,
      totalProfit,
      totalAmountUsd,
      totalCostUsd,
      totalProfitUsd,
      currency: input.currency,
      exchangeRate: rate,
      paymentAmount: input.paymentAmount,
      changeDue,
      notes: input.notes ?? null,
      createdBy: actor,
      status: "completed",
    }).returning();

    for (const item of input.items) {
      const product = productMap.get(item.productId)!;
      const updated = await tx.update(productsTable)
        .set({ quantity: sql`${productsTable.quantity} - ${item.quantity}` })
        .where(and(eq(productsTable.id, item.productId), gte(productsTable.quantity, item.quantity)))
        .returning({ id: productsTable.id });
      if (updated.length === 0) throw badRequest(`Insufficient stock for "${product.name}"`);
    }

    const { amountUsd, amountCdf } = toUsdCdf(totalAmount, input.currency, rate);
    const itemSummary = saleItems.map((item) => `${item.quantity > 1 ? `${item.quantity}× ` : ""}${item.productName}`).join(", ");
    await tx.insert(paymentsTable).values({
      paymentNumber,
      direction: "in",
      category: "product_sale",
      type: "product_sale",
      linkedEntity: "sale",
      linkedEntityId: sale.id,
      linkedEntityName: saleNumber,
      amount: totalAmount,
      currency: input.currency,
      exchangeRate: rate,
      amountUsd,
      amountCdf,
      account: "cash",
      notes: itemSummary || input.notes || null,
      paymentDate: new Date(),
      status: "completed",
      createdBy: actor,
    });

    await appendLedgerEntry({
      sourceType: "sale",
      sourceNumber: saleNumber,
      sourceId: sale.id,
      direction: "in",
      amount: totalAmount,
      currency: input.currency,
      exchangeRate: rate,
      description: `Sale ${saleNumber}`,
      createdBy: actor,
    }, tx);

    await postDoubleEntry({
      sourceType: "sale",
      sourceId: sale.id,
      sourceNumber: saleNumber,
      debitName: "Cash",
      debitType: "asset",
      creditName: "Sales Revenue",
      creditType: "income",
      amount: totalAmount,
      amountUsd,
      amountCdf,
      currency: input.currency,
      exchangeRate: rate,
      description: `Sale ${saleNumber}`,
      createdBy: actor,
    }, tx);

    return sale;
  });
}

export async function patchSale(id: number, patch: PatchSaleInput, actor: string) {
  const rate = await getExchangeRate();

  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(salesTable).where(eq(salesTable.id, id));
    if (!existing) throw notFound("Sale not found");
    if (existing.status === "voided") throw badRequest("Cannot edit a voided sale");

    const existingItems = (existing.items ?? []) as SaleItem[];
    let newItems = existingItems;
    let totalAmount = existing.totalAmount ?? 0;
    let totalDiscount = existing.totalDiscount ?? 0;
    let totalCost = existing.totalCost ?? 0;
    let totalProfit = existing.totalProfit ?? 0;
    const targetCurrency = patch.currency ?? existing.currency;

    if (patch.items && patch.items.length > 0) {
      for (const item of patch.items) {
        if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw badRequest("Unit price cannot be negative");
        if (!Number.isFinite(item.discount) || item.discount < 0) throw badRequest("Discount cannot be negative");
        if (item.discount > item.unitPrice) throw badRequest("Discount cannot exceed unit price");
      }
      newItems = existingItems.map((item) => {
        const itemPatch = patch.items!.find((candidate) => candidate.productId === item.productId);
        if (!itemPatch) return { ...item, currency: targetCurrency };
        const lineTotal = (itemPatch.unitPrice - itemPatch.discount) * item.quantity;
        const lineProfit = lineTotal - (item.costPrice ?? 0) * item.quantity;
        return { ...item, unitPrice: itemPatch.unitPrice, discount: itemPatch.discount, lineTotal, profit: lineProfit, currency: targetCurrency };
      });
      totalAmount = newItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
      totalDiscount = newItems.reduce((sum, item) => sum + (item.discount ?? 0) * item.quantity, 0);
      totalCost = newItems.reduce((sum, item) => sum + (item.costPrice ?? 0) * item.quantity, 0);
      totalProfit = totalAmount - totalCost;
    } else if (patch.currency) {
      newItems = existingItems.map((item) => ({ ...item, currency: targetCurrency }));
    }

    const paymentAmount = patch.paymentAmount ?? existing.paymentAmount ?? 0;
    if (paymentAmount < 0) throw badRequest("Payment amount cannot be negative");
    const changeDue = Math.max(0, paymentAmount - totalAmount);
    const totalAmountUsd = targetCurrency === "CDF" ? totalAmount / rate : totalAmount;
    const totalCostUsd = targetCurrency === "CDF" ? totalCost / rate : totalCost;
    const totalProfitUsd = targetCurrency === "CDF" ? totalProfit / rate : totalProfit;

    const [updated] = await tx.update(salesTable).set({
      items: newItems,
      totalAmount,
      totalDiscount,
      totalCost,
      totalProfit,
      totalAmountUsd,
      totalCostUsd,
      totalProfitUsd,
      exchangeRate: rate,
      paymentAmount,
      changeDue,
      ...(patch.currency !== undefined && { currency: patch.currency }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      ...(patch.saleDate !== undefined && { saleDate: patch.saleDate }),
    }).where(eq(salesTable.id, id)).returning();

    const { amountUsd, amountCdf } = toUsdCdf(totalAmount, targetCurrency, rate);
    await tx.update(paymentsTable).set({
      amount: totalAmount,
      currency: targetCurrency,
      exchangeRate: rate,
      amountUsd,
      amountCdf,
      ...(patch.saleDate !== undefined && { paymentDate: patch.saleDate }),
    }).where(and(eq(paymentsTable.linkedEntity, "sale"), eq(paymentsTable.linkedEntityId, id)));

    const financialChanged = patch.currency !== undefined || patch.items !== undefined || patch.saleDate !== undefined;
    if (financialChanged) {
      const oldRate = existing.exchangeRate ?? rate;
      if ((existing.totalAmount ?? 0) > 0) {
        await appendLedgerEntry({
          sourceType: "sale_correction",
          sourceNumber: existing.saleNumber ?? undefined,
          sourceId: existing.id,
          direction: "out",
          amount: existing.totalAmount ?? 0,
          currency: existing.currency,
          exchangeRate: oldRate,
          description: `Correction: reverse sale ${existing.saleNumber}`,
          createdBy: actor,
        }, tx);
      }
      if (totalAmount > 0) {
        await appendLedgerEntry({
          sourceType: "sale_correction",
          sourceNumber: existing.saleNumber ?? undefined,
          sourceId: existing.id,
          direction: "in",
          amount: totalAmount,
          currency: targetCurrency,
          exchangeRate: rate,
          entryDate: patch.saleDate,
          description: `Correction: update sale ${existing.saleNumber}`,
          createdBy: actor,
        }, tx);
      }

      await reverseEntries("sale", existing.id, "sale_correction", actor, tx);
      await postDoubleEntry({
        sourceType: "sale_correction",
        sourceId: existing.id,
        sourceNumber: existing.saleNumber ?? undefined,
        entryDate: patch.saleDate ?? existing.saleDate ?? new Date(),
        debitName: "Cash",
        debitType: "asset",
        creditName: "Sales Revenue",
        creditType: "income",
        amount: totalAmount,
        amountUsd,
        amountCdf,
        currency: targetCurrency,
        exchangeRate: rate,
        description: `Sale ${existing.saleNumber} correction`,
        createdBy: actor,
      }, tx);
    }

    return updated;
  });
}

export async function voidSale(id: number, reason: string, actor: string) {
  if (!reason.trim()) throw badRequest("Void reason is required");
  const rate = await getExchangeRate();

  return withTransaction(async (tx) => {
    const [sale] = await tx.select().from(salesTable).where(eq(salesTable.id, id));
    if (!sale) throw notFound("Sale not found");
    if (sale.status === "voided") throw badRequest("Sale is already voided");

    const saleItems = (sale.items ?? []) as SaleItem[];
    for (const item of saleItems) {
      await tx.update(productsTable)
        .set({ quantity: sql`${productsTable.quantity} + ${item.quantity}` })
        .where(eq(productsTable.id, item.productId));
    }

    const [voided] = await tx.update(salesTable).set({
      status: "voided",
      voidedAt: new Date(),
      voidedBy: actor,
      voidReason: reason,
    }).where(eq(salesTable.id, id)).returning();

    await reverseEntries("sale", sale.id, "void_sale", actor, tx);
    await tx.update(paymentsTable).set({ status: "cancelled" }).where(and(
      eq(paymentsTable.linkedEntity, "sale"),
      eq(paymentsTable.linkedEntityId, id),
    ));

    if ((sale.totalAmount ?? 0) > 0) {
      await appendLedgerEntry({
        sourceType: "sale_void",
        sourceNumber: sale.saleNumber ?? undefined,
        sourceId: sale.id,
        direction: "out",
        amount: sale.totalAmount ?? 0,
        currency: sale.currency ?? "USD",
        exchangeRate: sale.exchangeRate ?? rate,
        description: `Void Sale ${sale.saleNumber}`,
        createdBy: actor,
      }, tx);
    }

    return voided;
  });
}
