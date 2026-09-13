import { db } from "@workspace/db";
import { paymentsTable, productsTable, salesTable } from "@workspace/db/schema";
import type { SaleItem, DbExecutor } from "@workspace/db";
import { and, count, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { ACCOUNTS, postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { getNextNumber } from "../../lib/numbering";
import { convertCurrencyAmount, getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { addMoney, fxRate, money, multiplyMoney, subtractMoney } from "../../shared/accounting/decimal";
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
  if (money(item.discount) > money(item.unitPrice)) throw badRequest("Discount cannot exceed unit price");
}

async function postSaleAccounting(input: {
  executor: DbExecutor;
  sourceType: string;
  sourceId: number;
  sourceNumber?: string | null;
  entryDate?: Date;
  cashAccount?: string;
  revenue: number;
  cogs: number;
  currency: string;
  exchangeRate: number;
  description: string;
  actor: string;
}): Promise<void> {
  const revenueConverted = toUsdCdf(input.revenue, input.currency, input.exchangeRate);
  await postDoubleEntry({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceNumber: input.sourceNumber ?? undefined,
    entryDate: input.entryDate,
    debitName: input.cashAccount ?? ACCOUNTS.CASH,
    debitType: "asset",
    creditName: ACCOUNTS.SALES_REVENUE,
    creditType: "income",
    amount: input.revenue,
    ...revenueConverted,
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    description: input.description,
    createdBy: input.actor,
  }, input.executor);

  if (money(input.cogs) > 0) {
    const costConverted = toUsdCdf(input.cogs, input.currency, input.exchangeRate);
    await postDoubleEntry({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber ?? undefined,
      entryDate: input.entryDate,
      debitName: ACCOUNTS.COGS,
      debitType: "expense",
      creditName: ACCOUNTS.INVENTORY,
      creditType: "asset",
      amount: input.cogs,
      ...costConverted,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      description: `${input.description} — COGS`,
      createdBy: input.actor,
    }, input.executor);
  }
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
  const currency = input.currency.toUpperCase();
  if (currency !== "USD" && currency !== "CDF") throw badRequest("currency must be USD or CDF");

  return withTransaction(async (tx) => {
    const rate = fxRate(await getExchangeRate(tx));
    const saleNumber = await getNextNumber("sale", tx);
    const paymentNumber = await getNextNumber("PAY", tx);
    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const products = await tx.select().from(productsTable).where(
      or(...productIds.map((productId) => eq(productsTable.id, productId))) as ReturnType<typeof eq>,
    ).for("update");
    const productMap = new Map(products.map((product) => [product.id, product]));

    let totalAmount = 0;
    let totalDiscount = 0;
    let totalCost = 0;

    const saleItems: SaleItem[] = input.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw badRequest(`Product ${item.productId} not found`);
      if (product.status !== "active") throw badRequest(`Product "${product.name}" is not active`);
      if (product.quantity < item.quantity) throw badRequest(`Insufficient stock for "${product.name}" (available: ${product.quantity})`);

      const unitPrice = money(item.unitPrice);
      const discount = money(item.discount);
      const costInSaleCurrency = convertCurrencyAmount(product.costPrice, product.currency, currency, rate);
      const lineTotal = multiplyMoney(subtractMoney(unitPrice, discount), item.quantity);
      const lineCost = multiplyMoney(costInSaleCurrency, item.quantity);
      const lineProfit = subtractMoney(lineTotal, lineCost);
      totalAmount = addMoney(totalAmount, lineTotal);
      totalDiscount = addMoney(totalDiscount, multiplyMoney(discount, item.quantity));
      totalCost = addMoney(totalCost, lineCost);

      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        discount,
        lineTotal,
        costPrice: costInSaleCurrency,
        profit: lineProfit,
        currency,
      };
    });

    const totalProfit = subtractMoney(totalAmount, totalCost);
    const totalAmountUsd = toUsdCdf(totalAmount, currency, rate).amountUsd;
    const totalCostUsd = toUsdCdf(totalCost, currency, rate).amountUsd;
    const totalProfitUsd = subtractMoney(totalAmountUsd, totalCostUsd);
    const paymentAmount = money(input.paymentAmount);
    const changeDue = money(Math.max(0, subtractMoney(paymentAmount, totalAmount)));

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
      currency,
      exchangeRate: rate,
      paymentAmount,
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

    const { amountUsd, amountCdf } = toUsdCdf(totalAmount, currency, rate);
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
      currency,
      exchangeRate: rate,
      amountUsd,
      amountCdf,
      account: "cash",
      notes: itemSummary || input.notes || null,
      paymentDate: sale.saleDate,
      status: "completed",
      createdBy: actor,
    });

    await appendLedgerEntry({
      entryDate: sale.saleDate,
      sourceType: "sale",
      sourceNumber: saleNumber,
      sourceId: sale.id,
      direction: "in",
      amount: totalAmount,
      currency,
      exchangeRate: rate,
      description: `Sale ${saleNumber}`,
      createdBy: actor,
    }, tx);

    await postSaleAccounting({
      executor: tx,
      sourceType: "sale",
      sourceId: sale.id,
      sourceNumber: saleNumber,
      entryDate: sale.saleDate,
      revenue: totalAmount,
      cogs: totalCost,
      currency,
      exchangeRate: rate,
      description: `Sale ${saleNumber}`,
      actor,
    });

    return sale;
  });
}

export async function patchSale(id: number, patch: PatchSaleInput, actor: string) {
  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(salesTable).where(eq(salesTable.id, id)).for("update");
    if (!existing) throw notFound("Sale not found");
    if (existing.status === "voided") throw badRequest("Cannot edit a voided sale");

    const lockedRate = fxRate(Number(existing.exchangeRate ?? await getExchangeRate(tx)));
    const oldCurrency = existing.currency.toUpperCase();
    const targetCurrency = (patch.currency ?? existing.currency).toUpperCase();
    if (targetCurrency !== "USD" && targetCurrency !== "CDF") throw badRequest("currency must be USD or CDF");

    const existingItems = (existing.items ?? []) as SaleItem[];
    const convertedBaseItems = existingItems.map((item) => {
      const sourceCurrency = (item.currency || oldCurrency).toUpperCase();
      const unitPrice = convertCurrencyAmount(item.unitPrice ?? 0, sourceCurrency, targetCurrency, lockedRate);
      const discount = convertCurrencyAmount(item.discount ?? 0, sourceCurrency, targetCurrency, lockedRate);
      const costPrice = convertCurrencyAmount(item.costPrice ?? 0, sourceCurrency, targetCurrency, lockedRate);
      const lineTotal = multiplyMoney(subtractMoney(unitPrice, discount), item.quantity);
      const lineCost = multiplyMoney(costPrice, item.quantity);
      return {
        ...item,
        unitPrice,
        discount,
        costPrice,
        lineTotal,
        profit: subtractMoney(lineTotal, lineCost),
        currency: targetCurrency,
      };
    });

    if (patch.items) {
      for (const item of patch.items) {
        if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw badRequest("Unit price cannot be negative");
        if (!Number.isFinite(item.discount) || item.discount < 0) throw badRequest("Discount cannot be negative");
        if (money(item.discount) > money(item.unitPrice)) throw badRequest("Discount cannot exceed unit price");
      }
    }

    const newItems = convertedBaseItems.map((item) => {
      const itemPatch = patch.items?.find((candidate) => candidate.productId === item.productId);
      if (!itemPatch) return item;
      const unitPrice = money(itemPatch.unitPrice);
      const discount = money(itemPatch.discount);
      const lineTotal = multiplyMoney(subtractMoney(unitPrice, discount), item.quantity);
      const lineCost = multiplyMoney(item.costPrice, item.quantity);
      return { ...item, unitPrice, discount, lineTotal, profit: subtractMoney(lineTotal, lineCost) };
    });

    const totalAmount = newItems.reduce((sum, item) => addMoney(sum, item.lineTotal ?? 0), 0);
    const totalDiscount = newItems.reduce((sum, item) => addMoney(sum, multiplyMoney(item.discount ?? 0, item.quantity)), 0);
    const totalCost = newItems.reduce((sum, item) => addMoney(sum, multiplyMoney(item.costPrice ?? 0, item.quantity)), 0);
    const totalProfit = subtractMoney(totalAmount, totalCost);
    const totalAmountUsd = toUsdCdf(totalAmount, targetCurrency, lockedRate).amountUsd;
    const totalCostUsd = toUsdCdf(totalCost, targetCurrency, lockedRate).amountUsd;
    const totalProfitUsd = subtractMoney(totalAmountUsd, totalCostUsd);
    const paymentAmount = patch.paymentAmount !== undefined
      ? money(patch.paymentAmount)
      : convertCurrencyAmount(existing.paymentAmount ?? 0, oldCurrency, targetCurrency, lockedRate);
    if (paymentAmount < 0) throw badRequest("Payment amount cannot be negative");
    const changeDue = money(Math.max(0, subtractMoney(paymentAmount, totalAmount)));

    const [updated] = await tx.update(salesTable).set({
      items: newItems,
      totalAmount,
      totalDiscount,
      totalCost,
      totalProfit,
      totalAmountUsd,
      totalCostUsd,
      totalProfitUsd,
      exchangeRate: lockedRate,
      paymentAmount,
      changeDue,
      ...(patch.currency !== undefined && { currency: targetCurrency }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      ...(patch.saleDate !== undefined && { saleDate: patch.saleDate }),
    }).where(eq(salesTable.id, id)).returning();

    const { amountUsd, amountCdf } = toUsdCdf(totalAmount, targetCurrency, lockedRate);
    await tx.update(paymentsTable).set({
      amount: totalAmount,
      currency: targetCurrency,
      exchangeRate: lockedRate,
      amountUsd,
      amountCdf,
      ...(patch.saleDate !== undefined && { paymentDate: patch.saleDate }),
    }).where(and(eq(paymentsTable.linkedEntity, "sale"), eq(paymentsTable.linkedEntityId, id)));

    const financialChanged = patch.currency !== undefined || patch.items !== undefined || patch.saleDate !== undefined;
    if (financialChanged) {
      if (money(existing.totalAmount ?? 0) > 0) {
        await appendLedgerEntry({
          sourceType: "sale_correction",
          sourceNumber: existing.saleNumber ?? undefined,
          sourceId: existing.id,
          direction: "out",
          amount: existing.totalAmount ?? 0,
          currency: existing.currency,
          exchangeRate: lockedRate,
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
          exchangeRate: lockedRate,
          entryDate: patch.saleDate ?? existing.saleDate,
          description: `Correction: update sale ${existing.saleNumber}`,
          createdBy: actor,
        }, tx);
      }

      await reverseEntries("sale", existing.id, "sale_correction", actor, tx);
      await postSaleAccounting({
        executor: tx,
        sourceType: "sale_correction",
        sourceId: existing.id,
        sourceNumber: existing.saleNumber,
        entryDate: patch.saleDate ?? existing.saleDate,
        revenue: totalAmount,
        cogs: totalCost,
        currency: targetCurrency,
        exchangeRate: lockedRate,
        description: `Sale ${existing.saleNumber} correction`,
        actor,
      });
    }

    return updated;
  });
}

export async function voidSale(id: number, reason: string, actor: string) {
  if (!reason.trim()) throw badRequest("Void reason is required");

  return withTransaction(async (tx) => {
    const [sale] = await tx.select().from(salesTable).where(eq(salesTable.id, id)).for("update");
    if (!sale) throw notFound("Sale not found");
    if (sale.status === "voided") throw badRequest("Sale is already voided");
    const lockedRate = fxRate(Number(sale.exchangeRate ?? await getExchangeRate(tx)));

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

    if (money(sale.totalAmount ?? 0) > 0) {
      await appendLedgerEntry({
        sourceType: "sale_void",
        sourceNumber: sale.saleNumber ?? undefined,
        sourceId: sale.id,
        direction: "out",
        amount: sale.totalAmount ?? 0,
        currency: sale.currency ?? "USD",
        exchangeRate: lockedRate,
        description: `Void Sale ${sale.saleNumber}`,
        createdBy: actor,
      }, tx);
    }

    return voided;
  });
}
