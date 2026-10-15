import { db } from "@workspace/db";
import type { DbExecutor } from "@workspace/db";
import {
  activityLogsTable,
  productsTable,
  stockAdjustmentsTable,
  stockPurchasesTable,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, ilike, lte, not, or, sql } from "drizzle-orm";
import { getNextNumber } from "../../lib/numbering";
import { ACCOUNTS, assertPeriodOpen, postDoubleEntry } from "../../lib/accounting";
import { lubumbashiTodayEnd } from "../../lib/timezone";
import { openCreditForStockPurchase } from "./supplier-credit-service";
import { convertCurrencyAmount, getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { addMoney, divideMoney, fxRate, money, multiplyMoney, subtractMoney } from "../../shared/accounting/decimal";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest, conflict, notFound } from "../../shared/http/errors";

export interface InventoryListInput {
  page: number;
  limit: number;
  search?: string;
  category?: string;
  status?: string;
  lowStock?: boolean;
}

export interface CreateProductInput {
  name: string;
  barcode?: string;
  description?: string;
  category?: string;
  supplier?: string;
  notes?: string;
  quantity?: number;
  alertQuantity?: number;
  costPrice?: number;
  sellingPrice?: number;
  currency?: string;
  status?: string;
}

export interface UpdateProductInput {
  name?: string;
  barcode?: string | null;
  description?: string | null;
  category?: string | null;
  supplier?: string | null;
  notes?: string | null;
  quantity?: number;
  alertQuantity?: number;
  costPrice?: number;
  sellingPrice?: number;
  currency?: string;
  status?: string;
  /** Why quantity or cost changed (count difference, damage, ...). */
  adjustmentReason?: string;
}

export interface AddStockPurchaseInput {
  quantityAdded: number;
  costPerUnit: number;
  totalCost?: number;
  currency?: string;
  exchangeRate?: number;
  supplier?: string;
  notes?: string;
  paidFromCash?: boolean;
  purchaseDate?: Date;
}

/** Stock value of one product in USD at `rate` (deleted products hold no stock value). */
function productValueUsd(product: { quantity: number; costPrice: number; currency: string; status: string }, rate: number): number {
  if (product.status === "deleted") return 0;
  return multiplyMoney(convertCurrencyAmount(product.costPrice, product.currency, "USD", rate), product.quantity);
}

/**
 * Record a manual change in a product's stock value. The difference posts
 * Inventory against `counterAccount` (Inventory Adjustments for corrections,
 * Opening Balance Equity for stock that existed before the system), so the
 * Inventory account always equals the stock on hand.
 */
async function recordStockAdjustment(executor: DbExecutor, input: {
  before: { quantity: number; costPrice: number; currency: string; status: string };
  after: { id: number; name: string; quantity: number; costPrice: number; currency: string; status: string };
  rate: number;
  reason: string;
  actor: string;
  counterAccount: string;
  counterType: "expense" | "equity";
}) {
  const valueChange = subtractMoney(productValueUsd(input.after, input.rate), productValueUsd(input.before, input.rate));
  const quantityChanged = input.before.quantity !== input.after.quantity;
  const costChanged = money(input.before.costPrice) !== money(input.after.costPrice) || input.before.currency !== input.after.currency;
  if (!quantityChanged && !costChanged && valueChange === 0) return null;

  const entryDate = new Date();
  await assertPeriodOpen(executor, entryDate, "This stock adjustment");
  const adjustmentNumber = await getNextNumber("ADJ", executor);
  const [adjustment] = await executor.insert(stockAdjustmentsTable).values({
    adjustmentNumber,
    productId: input.after.id,
    productName: input.after.name,
    quantityBefore: input.before.quantity,
    quantityAfter: input.after.quantity,
    costBefore: money(input.before.costPrice),
    costAfter: money(input.after.costPrice),
    currency: input.after.currency,
    exchangeRate: input.rate,
    valueChangeUsd: valueChange,
    reason: input.reason,
    createdBy: input.actor,
  }).returning();

  if (valueChange !== 0) {
    const increase = valueChange > 0;
    const amount = Math.abs(valueChange);
    await postDoubleEntry({
      entryDate,
      sourceType: "stock_adjustment",
      sourceId: adjustment!.id,
      sourceNumber: adjustmentNumber,
      debitName: increase ? ACCOUNTS.INVENTORY : input.counterAccount,
      debitType: increase ? "asset" : input.counterType,
      creditName: increase ? input.counterAccount : ACCOUNTS.INVENTORY,
      creditType: increase ? input.counterType : "asset",
      amount,
      ...toUsdCdf(amount, "USD", input.rate),
      currency: "USD",
      exchangeRate: input.rate,
      description: `${input.reason}: ${input.after.name} (${input.before.quantity} → ${input.after.quantity})`,
      createdBy: input.actor,
    }, executor);
  }
  return adjustment;
}

function validateNonNegative(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw badRequest(`${field} cannot be negative`);
}

function enrichProduct(product: typeof productsTable.$inferSelect, rate: number) {
  const safeRate = fxRate(Number.isFinite(rate) && rate > 0 ? rate : 2800);
  const sellingUsd = convertCurrencyAmount(product.sellingPrice, product.currency, "USD", safeRate);
  const costUsd = convertCurrencyAmount(product.costPrice, product.currency, "USD", safeRate);
  const stockValueUsd = multiplyMoney(costUsd, product.quantity);
  const stockValueCdf = convertCurrencyAmount(stockValueUsd, "USD", "CDF", safeRate);
  const retailValueUsd = multiplyMoney(sellingUsd, product.quantity);
  const retailValueCdf = convertCurrencyAmount(retailValueUsd, "USD", "CDF", safeRate);

  return {
    ...product,
    stockValueUsd,
    stockValueCdf,
    costValueUsd: stockValueUsd,
    costValueCdf: stockValueCdf,
    retailValueUsd,
    retailValueCdf,
    profitPerUnit: subtractMoney(sellingUsd, costUsd),
    isLowStock: product.quantity <= product.alertQuantity,
  };
}

export async function getInventorySummary() {
  const rate = await getExchangeRate();

  // Keep summary work in Postgres. The previous implementation selected every
  // product and reduced it in Node on every Stock-page visit.
  const [row] = await db.select({
    totalProducts: sql<number>`COUNT(*) FILTER (WHERE ${productsTable.status} <> 'deleted')`,
    activeProducts: sql<number>`COUNT(*) FILTER (WHERE ${productsTable.status} = 'active')`,
    lowStockCount: sql<number>`COUNT(*) FILTER (WHERE ${productsTable.status} = 'active' AND ${productsTable.quantity} <= ${productsTable.alertQuantity})`,
    totalQuantity: sql<number>`COALESCE(SUM(${productsTable.quantity}) FILTER (WHERE ${productsTable.status} = 'active'), 0)`,
    totalValueUsd: sql<number>`COALESCE(SUM(
      CASE WHEN ${productsTable.status} = 'active' THEN
        CASE WHEN ${productsTable.currency} = 'USD'
          THEN ${productsTable.costPrice} * ${productsTable.quantity}
          ELSE (${productsTable.costPrice} * ${productsTable.quantity}) / CAST(${rate} AS DOUBLE PRECISION)
        END
      ELSE 0 END
    ), 0)`,
  }).from(productsTable);

  const totalValueUsd = money(Number(row?.totalValueUsd ?? 0));
  return {
    totalProducts: Number(row?.totalProducts ?? 0),
    activeProducts: Number(row?.activeProducts ?? 0),
    lowStockCount: Number(row?.lowStockCount ?? 0),
    totalQuantity: Number(row?.totalQuantity ?? 0),
    totalValueUsd,
    totalValueCdf: convertCurrencyAmount(totalValueUsd, "USD", "CDF", rate),
  };
}

export async function listProducts(input: InventoryListInput) {
  const conditions: ReturnType<typeof eq>[] = [];
  conditions.push(input.status
    ? eq(productsTable.status, input.status) as ReturnType<typeof eq>
    : not(eq(productsTable.status, "deleted")) as ReturnType<typeof eq>);

  if (input.search) {
    conditions.push(or(
      ilike(productsTable.name, `%${input.search}%`),
      ilike(productsTable.productNumber, `%${input.search}%`),
      ilike(productsTable.barcode, `%${input.search}%`),
      ilike(productsTable.category, `%${input.search}%`),
      ilike(productsTable.supplier, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
  }
  if (input.category) conditions.push(ilike(productsTable.category, input.category) as ReturnType<typeof eq>);
  if (input.lowStock) {
    conditions.push(lte(productsTable.quantity, productsTable.alertQuantity) as ReturnType<typeof eq>);
  }

  const where = and(...conditions);
  const offset = (input.page - 1) * input.limit;

  // Pagination and low-stock filtering belong in SQL. This keeps response work
  // proportional to the requested page instead of the total inventory size.
  const [rate, rows, [totalRow]] = await Promise.all([
    getExchangeRate(),
    db.select().from(productsTable)
      .where(where)
      .orderBy(asc(productsTable.name))
      .limit(input.limit)
      .offset(offset),
    db.select({ total: count() }).from(productsTable).where(where),
  ]);

  return {
    items: rows.map((product) => enrichProduct(product, rate)),
    total: Number(totalRow?.total ?? 0),
    page: input.page,
    limit: input.limit,
  };
}

export async function createProduct(input: CreateProductInput, actor = "system") {
  validateNonNegative(input.quantity, "quantity");
  validateNonNegative(input.alertQuantity, "alertQuantity");
  validateNonNegative(input.costPrice, "costPrice");
  validateNonNegative(input.sellingPrice, "sellingPrice");
  if (input.quantity !== undefined && !Number.isInteger(input.quantity)) throw badRequest("quantity must be a whole number");

  if (input.barcode) {
    const duplicate = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.barcode, input.barcode));
    if (duplicate.length > 0) throw conflict("Barcode already exists");
  }

  return withTransaction(async (tx) => {
    const rate = await getExchangeRate(tx);
    const productNumber = await getNextNumber("product", tx);
    const [created] = await tx.insert(productsTable).values({
      productNumber,
      name: input.name,
      barcode: input.barcode || null,
      description: input.description || null,
      category: input.category || null,
      supplier: input.supplier || null,
      notes: input.notes || null,
      quantity: input.quantity ?? 0,
      alertQuantity: input.alertQuantity ?? 5,
      costPrice: money(input.costPrice ?? 0),
      sellingPrice: money(input.sellingPrice ?? 0),
      currency: (input.currency ?? "USD").toUpperCase(),
      status: input.status ?? "active",
    }).returning();

    // Stock that is already on the shelf when the product is created is opening stock.
    await recordStockAdjustment(tx, {
      before: { quantity: 0, costPrice: created!.costPrice, currency: created!.currency, status: created!.status },
      after: created!,
      rate,
      reason: "Opening stock",
      actor,
      counterAccount: ACCOUNTS.OPENING_BALANCE_EQUITY,
      counterType: "equity",
    });
    return { product: enrichProduct(created!, rate), productNumber };
  });
}

export async function getProduct(id: number) {
  const rate = await getExchangeRate();
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!product) throw notFound("Product not found");
  return enrichProduct(product, rate);
}

export async function updateProduct(id: number, input: UpdateProductInput, actor = "system") {
  validateNonNegative(input.quantity, "quantity");
  validateNonNegative(input.alertQuantity, "alertQuantity");
  validateNonNegative(input.costPrice, "costPrice");
  validateNonNegative(input.sellingPrice, "sellingPrice");
  if (input.quantity !== undefined && !Number.isInteger(input.quantity)) throw badRequest("quantity must be a whole number");
  if (input.currency !== undefined && !["USD", "CDF"].includes(input.currency.toUpperCase())) throw badRequest("currency must be USD or CDF");

  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(productsTable).where(eq(productsTable.id, id)).for("update");
    if (!existing) throw notFound("Product not found");

    if (input.barcode && input.barcode !== existing.barcode) {
      const duplicate = await tx.select({ id: productsTable.id }).from(productsTable).where(and(
        eq(productsTable.barcode, input.barcode),
        not(eq(productsTable.id, id)),
      ));
      if (duplicate.length > 0) throw conflict("Barcode already exists");
    }

    const patch: Partial<typeof productsTable.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.barcode !== undefined) patch.barcode = input.barcode || null;
    if (input.description !== undefined) patch.description = input.description || null;
    if (input.category !== undefined) patch.category = input.category || null;
    if (input.supplier !== undefined) patch.supplier = input.supplier || null;
    if (input.notes !== undefined) patch.notes = input.notes || null;
    if (input.quantity !== undefined) patch.quantity = input.quantity;
    if (input.alertQuantity !== undefined) patch.alertQuantity = input.alertQuantity;
    if (input.costPrice !== undefined) patch.costPrice = money(input.costPrice);
    if (input.sellingPrice !== undefined) patch.sellingPrice = money(input.sellingPrice);
    if (input.currency !== undefined) patch.currency = input.currency.toUpperCase();
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.deletedAt = input.status === "deleted" ? new Date() : null;
    }

    const [updated] = await tx.update(productsTable).set(patch).where(eq(productsTable.id, id)).returning();
    const rate = await getExchangeRate(tx);
    const reason = input.adjustmentReason?.trim()
      || (input.status === "deleted" && existing.status !== "deleted" ? "Product deleted: stock written off"
        : existing.status === "deleted" && updated!.status !== "deleted" ? "Product restored: stock brought back"
          : "Stock correction");
    await recordStockAdjustment(tx, {
      before: existing,
      after: updated!,
      rate,
      reason,
      actor,
      counterAccount: ACCOUNTS.INVENTORY_ADJUSTMENTS,
      counterType: "expense",
    });

    const action = input.status === "deleted" ? "product_deleted"
      : input.status === "archived" ? "product_archived"
        : input.status === "active" && existing.status !== "active" ? "product_restored"
          : input.barcode !== undefined && input.barcode !== existing.barcode ? "product_barcode_changed"
            : "product_edited";
    return { product: enrichProduct(updated!, rate), action };
  });
}

export async function listStockAdjustments(productId: number) {
  return db.select().from(stockAdjustmentsTable)
    .where(eq(stockAdjustmentsTable.productId, productId))
    .orderBy(desc(stockAdjustmentsTable.createdAt));
}

export async function listStockPurchases(productId: number) {
  return db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.productId, productId))
    .orderBy(desc(stockPurchasesTable.purchaseDate));
}

export async function addStockPurchase(productId: number, input: AddStockPurchaseInput, actor: string) {
  if (!Number.isFinite(input.quantityAdded) || input.quantityAdded < 1 || !Number.isInteger(input.quantityAdded)) {
    throw badRequest("quantityAdded must be a whole number >= 1");
  }
  validateNonNegative(input.costPerUnit, "costPerUnit");
  validateNonNegative(input.totalCost, "totalCost");
  if (input.purchaseDate && input.purchaseDate.getTime() > lubumbashiTodayEnd().getTime()) throw badRequest("A purchase cannot be dated in the future");
  if (!input.paidFromCash && !input.supplier?.trim()) throw badRequest("Name the supplier for a purchase on credit");

  return withTransaction(async (tx) => {
    await assertPeriodOpen(tx, input.purchaseDate ?? new Date(), "This purchase");
    const rate = fxRate(input.exchangeRate ?? await getExchangeRate(tx));
    const purchaseNumber = await getNextNumber("purchase", tx);
    const [product] = await tx.select().from(productsTable).where(eq(productsTable.id, productId)).for("update");
    if (!product) throw notFound("Product not found");

    const currency = (input.currency ?? product.currency ?? "USD").toUpperCase();
    if (currency !== "USD" && currency !== "CDF") throw badRequest("currency must be USD or CDF");

    const costPerUnit = money(input.costPerUnit);
    const totalCost = money(input.totalCost ?? multiplyMoney(costPerUnit, input.quantityAdded));
    const { amountUsd: totalCostUsd, amountCdf: totalCostCdf } = toUsdCdf(totalCost, currency, rate);
    const entryDate = input.purchaseDate ?? new Date();
    if (Number.isNaN(entryDate.getTime())) throw badRequest("Invalid purchase date");

    const [purchase] = await tx.insert(stockPurchasesTable).values({
      purchaseNumber,
      productId,
      productName: product.name,
      quantityAdded: input.quantityAdded,
      costPerUnit,
      totalCost,
      currency,
      exchangeRate: rate,
      totalCostUsd,
      totalCostCdf,
      supplier: input.supplier || null,
      notes: input.notes || null,
      paidFromCash: input.paidFromCash ? 1 : 0,
      purchaseDate: entryDate,
      createdBy: actor,
    }).returning();

    const newQuantity = product.quantity + input.quantityAdded;
    const oldUnitCostUsd = convertCurrencyAmount(product.costPrice, product.currency, "USD", rate);
    const oldTotalCostUsd = multiplyMoney(oldUnitCostUsd, product.quantity);
    const newAverageCostUsd = newQuantity > 0
      ? divideMoney(addMoney(oldTotalCostUsd, totalCostUsd), newQuantity)
      : divideMoney(totalCostUsd, input.quantityAdded);
    const newCostPrice = convertCurrencyAmount(newAverageCostUsd, "USD", product.currency, rate);

    await tx.update(productsTable)
      .set({ quantity: newQuantity, costPrice: newCostPrice })
      .where(eq(productsTable.id, productId));

    const description = `Stock purchase: ${product.name} (${input.quantityAdded} units)${input.supplier ? ` — ${input.supplier}` : ""}`;
    await postDoubleEntry({
      entryDate,
      sourceType: "stock_purchase",
      sourceId: purchase.id,
      sourceNumber: purchaseNumber,
      debitName: ACCOUNTS.INVENTORY,
      debitType: "asset",
      creditName: input.paidFromCash ? ACCOUNTS.CASH : ACCOUNTS.SUPPLIER_PAYABLES,
      creditType: input.paidFromCash ? "asset" : "liability",
      amount: totalCost,
      amountUsd: totalCostUsd,
      amountCdf: totalCostCdf,
      currency,
      exchangeRate: rate,
      description,
      createdBy: actor,
    }, tx);

    if (!input.paidFromCash) {
      // The liability was posted above; open the supplier balance so it can be settled.
      await openCreditForStockPurchase(tx, { ...purchase!, productName: purchase!.productName ?? product.name });
    }

    return purchase;
  });
}

export async function getProductHistory(productId: number) {
  return db.select().from(activityLogsTable).where(and(
    eq(activityLogsTable.entity, "product"),
    eq(activityLogsTable.entityId, productId),
  )).orderBy(desc(activityLogsTable.createdAt)).limit(100);
}
