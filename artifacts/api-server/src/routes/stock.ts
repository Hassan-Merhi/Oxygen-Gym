import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db, withTransaction } from "@workspace/db";
import {
  productsTable,
  stockPurchasesTable,
  activityLogsTable,
} from "@workspace/db/schema";
import { eq, and, ilike, or, desc, not, asc } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry } from "../lib/ledger";
import { postDoubleEntry } from "../lib/accounting";
import { getExchangeRate } from "../repositories/settings";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return (req as unknown as { __gymproUserName?: string }).__gymproUserName ?? "System";
}

function enrichProduct(p: typeof productsTable.$inferSelect, rate: number) {
  const safeRate = rate > 0 ? rate : 2800;
  const sellingUsd = p.currency === "USD" ? p.sellingPrice : p.sellingPrice / safeRate;
  const costUsd = p.currency === "USD" ? p.costPrice : p.costPrice / safeRate;
  const stockValueUsd = costUsd * p.quantity;
  const stockValueCdf = stockValueUsd * safeRate;
  const retailValueUsd = sellingUsd * p.quantity;
  const retailValueCdf = retailValueUsd * safeRate;
  const profitPerUnit = sellingUsd - costUsd;
  const isLowStock = p.quantity <= p.alertQuantity;

  return {
    ...p,
    stockValueUsd,
    stockValueCdf,
    retailValueUsd,
    retailValueCdf,
    profitPerUnit,
    isLowStock,
  };
}

// ── Summary ───────────────────────────────────────────────────────────────────
router.get("/summary", async (_req: Request, res: Response) => {
  const rate = await getExchangeRate();
  const safeRate = rate > 0 ? rate : 2800;
  const all = await db
    .select()
    .from(productsTable)
    .where(not(eq(productsTable.status, "deleted")));

  const active = all.filter((p) => p.status === "active");
  const lowStockCount = active.filter((p) => p.quantity <= p.alertQuantity).length;
  const totalQuantity = active.reduce((s, p) => s + p.quantity, 0);
  const totalValueUsd = active.reduce((sumValue, p) => {
    const costUsd = p.currency === "USD" ? p.costPrice : p.costPrice / safeRate;
    return sumValue + costUsd * p.quantity;
  }, 0);

  res.json({
    totalProducts: all.length,
    activeProducts: active.length,
    lowStockCount,
    totalQuantity,
    totalValueUsd,
    totalValueCdf: totalValueUsd * safeRate,
  });
});

// ── List ──────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const {
    page = "1", limit = "20", search, category, status, lowStock,
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;
  const rate = await getExchangeRate();

  const conditions: ReturnType<typeof eq>[] = [];
  if (status) {
    conditions.push(eq(productsTable.status, status) as ReturnType<typeof eq>);
  } else {
    conditions.push(not(eq(productsTable.status, "deleted")) as ReturnType<typeof eq>);
  }

  if (search) {
    conditions.push(
      or(
        ilike(productsTable.name, `%${search}%`),
        ilike(productsTable.productNumber, `%${search}%`),
        ilike(productsTable.barcode, `%${search}%`),
        ilike(productsTable.category, `%${search}%`),
        ilike(productsTable.supplier, `%${search}%`),
      ) as ReturnType<typeof eq>,
    );
  }
  if (category) conditions.push(ilike(productsTable.category, category) as ReturnType<typeof eq>);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(productsTable)
    .where(where)
    .orderBy(asc(productsTable.name));

  const enriched = rows.map((p) => enrichProduct(p, rate));
  const filtered = lowStock === "true"
    ? enriched.filter((p) => p.isLowStock)
    : enriched;

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limitNum);
  res.json({ items, total, page: pageNum, limit: limitNum });
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const {
    name, barcode, description, category, supplier, notes,
    quantity = 0, alertQuantity = 5,
    costPrice = 0, sellingPrice = 0, currency = "USD", status = "active",
  } = req.body;

  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  if (barcode) {
    const existing = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.barcode, barcode));
    if (existing.length > 0) {
      res.status(409).json({ error: "Barcode already exists" });
      return;
    }
  }

  const created = await withTransaction(async (tx) => {
    const productNumber = await getNextNumber("product", tx);
    const [product] = await tx
      .insert(productsTable)
      .values({
        productNumber,
        name,
        barcode: barcode || null,
        description: description || null,
        category: category || null,
        supplier: supplier || null,
        notes: notes || null,
        quantity: Number(quantity),
        alertQuantity: Number(alertQuantity),
        costPrice: Number(costPrice),
        sellingPrice: Number(sellingPrice),
        currency,
        status,
      })
      .returning();
    if (!product) throw new Error("Unable to create product");
    return product;
  });

  await logActivity(req, "product_created", "product", created.id, {
    name,
    productNumber: created.productNumber,
    quantity,
  });

  const rate = await getExchangeRate();
  res.status(201).json(enrichProduct(created, rate));
});

// ── Get one ───────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const rate = await getExchangeRate();
  const [p] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!p) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(enrichProduct(p, rate));
});

// ── Update ────────────────────────────────────────────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const {
    name, barcode, description, category, supplier, notes,
    quantity, alertQuantity, costPrice, sellingPrice, currency, status,
  } = req.body;

  if (barcode && barcode !== existing.barcode) {
    const dup = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(and(eq(productsTable.barcode, barcode), not(eq(productsTable.id, id))));
    if (dup.length > 0) {
      res.status(409).json({ error: "Barcode already exists" });
      return;
    }
  }

  const patch: Partial<typeof productsTable.$inferInsert> = {};
  if (name !== undefined) patch.name = name;
  if (barcode !== undefined) patch.barcode = barcode || null;
  if (description !== undefined) patch.description = description || null;
  if (category !== undefined) patch.category = category || null;
  if (supplier !== undefined) patch.supplier = supplier || null;
  if (notes !== undefined) patch.notes = notes || null;
  if (quantity !== undefined) patch.quantity = Number(quantity);
  if (alertQuantity !== undefined) patch.alertQuantity = Number(alertQuantity);
  if (costPrice !== undefined) patch.costPrice = Number(costPrice);
  if (sellingPrice !== undefined) patch.sellingPrice = Number(sellingPrice);
  if (currency !== undefined) patch.currency = currency;
  if (status !== undefined) {
    patch.status = status;
    if (status === "deleted") patch.deletedAt = new Date();
    else patch.deletedAt = null;
  }

  const [updated] = await db
    .update(productsTable)
    .set(patch)
    .where(eq(productsTable.id, id))
    .returning();

  const action =
    status === "deleted" ? "product_deleted"
    : status === "archived" ? "product_archived"
    : status === "active" && existing.status !== "active" ? "product_restored"
    : barcode !== existing.barcode ? "product_barcode_changed"
    : "product_edited";

  await logActivity(req, action, "product", id, { name, status });

  const rate = await getExchangeRate();
  res.json(enrichProduct(updated, rate));
});

// ── List purchases ────────────────────────────────────────────────────────────
router.get("/:id/purchases", async (req: Request, res: Response) => {
  const productId = parseInt(req.params.id as string);
  const purchases = await db
    .select()
    .from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.productId, productId))
    .orderBy(desc(stockPurchasesTable.purchaseDate));
  res.json(purchases);
});

// ── Add stock purchase ────────────────────────────────────────────────────────
router.post("/:id/purchases", async (req: Request, res: Response) => {
  const productId = parseInt(req.params.id as string);
  const [productPreview] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!productPreview) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const {
    quantityAdded,
    costPerUnit,
    totalCost,
    currency = productPreview.currency,
    exchangeRate,
    supplier,
    notes,
    paidFromCash = false,
    purchaseDate,
  } = req.body;

  const qty = Number(quantityAdded);
  const unitCost = Number(costPerUnit ?? 0);
  const suppliedTotal = Number(totalCost);
  if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) {
    res.status(400).json({ error: "quantityAdded must be a whole number >= 1" });
    return;
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    res.status(400).json({ error: "costPerUnit must be >= 0" });
    return;
  }
  if (currency !== "USD" && currency !== "CDF") {
    res.status(400).json({ error: "currency must be USD or CDF" });
    return;
  }

  const fallbackRate = await getExchangeRate();
  const requestedRate = Number(exchangeRate);
  const rate = Number.isFinite(requestedRate) && requestedRate > 0 ? requestedRate : fallbackRate;
  if (!Number.isFinite(rate) || rate <= 0) {
    res.status(400).json({ error: "A valid exchange rate is required" });
    return;
  }

  const computedTotal = unitCost * qty;
  const totalCostNum = Number.isFinite(suppliedTotal) && suppliedTotal >= 0 ? suppliedTotal : computedTotal;
  const totalCostUsd = currency === "USD" ? totalCostNum : totalCostNum / rate;
  const totalCostCdf = currency === "CDF" ? totalCostNum : totalCostNum * rate;
  const creator = callerName(req);
  const entryDate = purchaseDate ? new Date(purchaseDate) : new Date();
  if (Number.isNaN(entryDate.getTime())) {
    res.status(400).json({ error: "Invalid purchase date" });
    return;
  }

  const result = await withTransaction(async (tx) => {
    // Row lock is required because weighted-average cost depends on the exact
    // quantity and unit cost immediately before this purchase.
    const [product] = await tx
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, productId))
      .for("update");
    if (!product) return { kind: "not_found" as const };

    const purchaseNumber = await getNextNumber("purchase", tx);
    const [createdPurchase] = await tx
      .insert(stockPurchasesTable)
      .values({
        purchaseNumber,
        productId,
        productName: product.name,
        quantityAdded: qty,
        costPerUnit: unitCost,
        totalCost: totalCostNum,
        currency,
        exchangeRate: rate,
        totalCostUsd,
        totalCostCdf,
        supplier: supplier || null,
        notes: notes || null,
        paidFromCash: paidFromCash ? 1 : 0,
        purchaseDate: entryDate,
        createdBy: creator,
      })
      .returning();
    if (!createdPurchase) throw new Error("Unable to create stock purchase");

    const newQty = product.quantity + qty;
    const oldTotalCostUsd = (product.currency === "USD" ? product.costPrice : product.costPrice / rate) * product.quantity;
    const newAvgCostUsd = newQty > 0 ? (oldTotalCostUsd + totalCostUsd) / newQty : totalCostUsd / qty;
    const newCostPrice = product.currency === "USD" ? newAvgCostUsd : newAvgCostUsd * rate;

    await tx
      .update(productsTable)
      .set({ quantity: newQty, costPrice: newCostPrice })
      .where(eq(productsTable.id, productId));

    if (paidFromCash) {
      const description = `Stock purchase: ${product.name} (${qty} units)`;
      await appendLedgerEntry({
        entryDate,
        sourceType: "stock_purchase",
        sourceNumber: purchaseNumber,
        sourceId: createdPurchase.id,
        direction: "out",
        amount: totalCostNum,
        currency,
        exchangeRate: rate,
        description,
        createdBy: creator,
      }, tx);

      await postDoubleEntry({
        entryDate,
        sourceType: "stock_purchase",
        sourceId: createdPurchase.id,
        sourceNumber: purchaseNumber,
        debitName: "Inventory",
        debitType: "asset",
        creditName: "Cash",
        creditType: "asset",
        amount: totalCostNum,
        amountUsd: totalCostUsd,
        amountCdf: totalCostCdf,
        currency,
        exchangeRate: rate,
        description,
        createdBy: creator,
      }, tx);
    }

    return { kind: "ok" as const, purchase: createdPurchase, purchaseNumber };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  await logActivity(req, "stock_purchase_added", "product", productId, {
    purchaseNumber: result.purchaseNumber,
    quantityAdded: qty,
    totalCost: totalCostNum,
    currency,
    supplier,
    paidFromCash,
  });

  res.status(201).json(result.purchase);
});

// ── Product history ───────────────────────────────────────────────────────────
router.get("/:id/history", async (req: Request, res: Response) => {
  const productId = parseInt(req.params.id as string);
  const entries = await db
    .select()
    .from(activityLogsTable)
    .where(
      and(
        eq(activityLogsTable.entity, "product"),
        eq(activityLogsTable.entityId, productId),
      ),
    )
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(100);
  res.json(entries);
});

export default router;
