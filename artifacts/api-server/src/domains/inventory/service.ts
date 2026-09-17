import { db } from "@workspace/db";
import {
  activityLogsTable,
  productsTable,
  stockPurchasesTable,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, ilike, lte, not, or, sql } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { getNextNumber } from "../../lib/numbering";
import { ACCOUNTS, postDoubleEntry } from "../../lib/accounting";
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
    costPrice: money(input.costPrice ?? 0),
    sellingPrice: money(input.sellingPrice ?? 0),
    currency: (input.currency ?? "USD").toUpperCase(),
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

  const [existing] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!existing) throw notFound("Product not found");

  if (input.barcode && input.barcode !== existing.barcode) {
    const duplicate = await db.select({ id: productsTable.id }).from(productsTable).where(and(
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

  const [updated] = await db.update(productsTable).set(patch).where(eq(productsTable.id, id)).returning();
  const action = input.status === "deleted" ? "product_deleted"
    : input.status === "archived" ? "product_archived"
      : input.status === "active" && existing.status !== "active" ? "product_restored"
        : input.barcode !== undefined && input.barcode !== existing.barcode ? "product_barcode_changed"
          : "product_edited";
  const rate = await getExchangeRate();
  return { product: enrichProduct(updated, rate), action };
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

  return withTransaction(async (tx) => {
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
    if (input.paidFromCash) {
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
    }

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

    return purchase;
  });
}

export async function getProductHistory(productId: number) {
  return db.select().from(activityLogsTable).where(and(
    eq(activityLogsTable.entity, "product"),
    eq(activityLogsTable.entityId, productId),
  )).orderBy(desc(activityLogsTable.createdAt)).limit(100);
}
