import { db } from "@workspace/db";
import {
  activityLogsTable,
  productsTable,
  stockPurchasesTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, ilike, not, or } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { getNextNumber } from "../../lib/numbering";
import { postDoubleEntry } from "../../lib/accounting";
import { getExchangeRate } from "../../shared/accounting/currency";
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

function validateNonNegative(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw badRequest(`${field} cannot be negative`);
}

function enrichProduct(product: typeof productsTable.$inferSelect, rate: number) {
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 2800;
  const sellingUsd = product.currency === "USD" ? product.sellingPrice : product.sellingPrice / safeRate;
  const costUsd = product.currency === "USD" ? product.costPrice : product.costPrice / safeRate;

  // Inventory is an asset and is valued at weighted-average cost, not retail price.
  const stockValueUsd = costUsd * product.quantity;
  const stockValueCdf = stockValueUsd * safeRate;
  const retailValueUsd = sellingUsd * product.quantity;
  const retailValueCdf = retailValueUsd * safeRate;

  return {
    ...product,
    stockValueUsd,
    stockValueCdf,
    costValueUsd: stockValueUsd,
    costValueCdf: stockValueCdf,
    retailValueUsd,
    retailValueCdf,
    profitPerUnit: sellingUsd - costUsd,
    isLowStock: product.quantity <= product.alertQuantity,
  };
}

export async function getInventorySummary() {
  const rate = await getExchangeRate();
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 2800;
  const all = await db.select().from(productsTable).where(not(eq(productsTable.status, "deleted")));
  const active = all.filter((product) => product.status === "active");
  const totalValueUsd = active.reduce((sum, product) => {
    const costUsd = product.currency === "USD" ? product.costPrice : product.costPrice / safeRate;
    return sum + costUsd * product.quantity;
  }, 0);

  return {
    totalProducts: all.length,
    activeProducts: active.length,
    lowStockCount: active.filter((product) => product.quantity <= product.alertQuantity).length,
    totalQuantity: active.reduce((sum, product) => sum + product.quantity, 0),
    totalValueUsd,
    totalValueCdf: totalValueUsd * safeRate,
  };
}

export async function listProducts(input: InventoryListInput) {
  const rate = await getExchangeRate();
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

  const rows = await db.select().from(productsTable).where(and(...conditions)).orderBy(asc(productsTable.name));
  const enriched = rows.map((product) => enrichProduct(product, rate));
  const filtered = input.lowStock ? enriched.filter((product) => product.isLowStock) : enriched;
  const offset = (input.page - 1) * input.limit;

  return {
    items: filtered.slice(offset, offset + input.limit),
    total: filtered.length,
    page: input.page,
    limit: input.limit,
  };
}

export async function createProduct(input: CreateProductInput) {
  validateNonNegative(input.quantity, "quantity");
  validateNonNegative(input.alertQuantity, "alertQuantity");
  validateNonNegative(input.costPrice, "costPrice");
  validateNonNegative(input.sellingPrice, "sellingPrice");

  if (input.barcode) {
    const duplicate = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.barcode, input.barcode));
    if (duplicate.length > 0) throw conflict("Barcode already exists");
  }

  const productNumber = await getNextNumber("product");
  const [created] = await db.insert(productsTable).values({
    productNumber,
    name: input.name,
    barcode: input.barcode || null,
    description: input.description || null,
    category: input.category || null,
    supplier: input.supplier || null,
    notes: input.notes || null,
    quantity: input.quantity ?? 0,
    alertQuantity: input.alertQuantity ?? 5,
    costPrice: input.costPrice ?? 0,
    sellingPrice: input.sellingPrice ?? 0,
    currency: input.currency ?? "USD",
    status: input.status ?? "active",
  }).returning();

  const rate = await getExchangeRate();
  return { product: enrichProduct(created, rate), productNumber };
}

export async function getProduct(id: number) {
  const rate = await getExchangeRate();
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!product) throw notFound("Product not found");
  return enrichProduct(product, rate);
}

export async function updateProduct(id: number, input: UpdateProductInput) {
  validateNonNegative(input.quantity, "quantity");
  validateNonNegative(input.alertQuantity, "alertQuantity");
  validateNonNegative(input.costPrice, "costPrice");
  validateNonNegative(input.sellingPrice, "sellingPrice");

  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(productsTable).where(eq(productsTable.id, id));
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
    if (input.costPrice !== undefined) patch.costPrice = input.costPrice;
    if (input.sellingPrice !== undefined) patch.sellingPrice = input.sellingPrice;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.deletedAt = input.status === "deleted" ? new Date() : null;
    }

    const [updated] = await tx.update(productsTable).set(patch).where(eq(productsTable.id, id)).returning();
    const action = input.status === "deleted" ? "product_deleted"
      : input.status === "archived" ? "product_archived"
        : input.status === "active" && existing.status !== "active" ? "product_restored"
          : input.barcode !== undefined && input.barcode !== existing.barcode ? "product_barcode_changed"
            : "product_edited";
    const rate = await getExchangeRate();
    return { product: enrichProduct(updated, rate), action };
  });
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

  const defaultRate = await getExchangeRate();
  const rate = input.exchangeRate && Number.isFinite(input.exchangeRate) && input.exchangeRate > 0
    ? input.exchangeRate
    : defaultRate;
  if (!Number.isFinite(rate) || rate <= 0) throw badRequest("A valid exchange rate is required");
  const purchaseNumber = await getNextNumber("purchase");

  return withTransaction(async (tx) => {
    const [product] = await tx.select().from(productsTable).where(eq(productsTable.id, productId));
    if (!product) throw notFound("Product not found");

    const currency = input.currency ?? product.currency ?? "USD";
    if (currency !== "USD" && currency !== "CDF") throw badRequest("currency must be USD or CDF");

    const totalCost = input.totalCost ?? input.costPerUnit * input.quantityAdded;
    const totalCostUsd = currency === "USD" ? totalCost : totalCost / rate;
    const totalCostCdf = currency === "CDF" ? totalCost : totalCost * rate;
    const entryDate = input.purchaseDate ?? new Date();
    if (Number.isNaN(entryDate.getTime())) throw badRequest("Invalid purchase date");

    const [purchase] = await tx.insert(stockPurchasesTable).values({
      purchaseNumber,
      productId,
      productName: product.name,
      quantityAdded: input.quantityAdded,
      costPerUnit: input.costPerUnit,
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
    const oldTotalCostUsd = (product.currency === "USD" ? product.costPrice : product.costPrice / rate) * product.quantity;
    const newAverageCostUsd = newQuantity > 0
      ? (oldTotalCostUsd + totalCostUsd) / newQuantity
      : totalCostUsd / input.quantityAdded;
    const newCostPrice = product.currency === "USD" ? newAverageCostUsd : newAverageCostUsd * rate;

    await tx.update(productsTable)
      .set({ quantity: newQuantity, costPrice: newCostPrice })
      .where(eq(productsTable.id, productId));

    if (input.paidFromCash) {
      const description = `Stock purchase: ${product.name} (${input.quantityAdded} units)`;
      await appendLedgerEntry({
        entryDate,
        sourceType: "stock_purchase",
        sourceNumber: purchaseNumber,
        sourceId: purchase.id,
        direction: "out",
        amount: totalCost,
        currency,
        exchangeRate: rate,
        description,
        createdBy: actor,
      }, tx);

      await postDoubleEntry({
        entryDate,
        sourceType: "stock_purchase",
        sourceId: purchase.id,
        sourceNumber: purchaseNumber,
        debitName: "Inventory",
        debitType: "asset",
        creditName: "Cash",
        creditType: "asset",
        amount: totalCost,
        amountUsd: totalCostUsd,
        amountCdf: totalCostCdf,
        currency,
        exchangeRate: rate,
        description,
        createdBy: actor,
      }, tx);
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
