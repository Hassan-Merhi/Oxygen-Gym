import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import {
  productsTable,
  stockPurchasesTable,
  settingsTable,
  activityLogsTable,
} from "@workspace/db/schema";
import {
  eq, and, ilike, or, desc, count, sum, lte, not,
  asc,
} from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry } from "../lib/ledger";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return (req as unknown as { __gymproUserName?: string }).__gymproUserName ?? "System";
}

async function getExchangeRate(): Promise<number> {
  const [s] = await db.select({ rate: settingsTable.usdToCdfRate }).from(settingsTable);
  return s?.rate ?? 1;
}

function enrichProduct(p: typeof productsTable.$inferSelect, rate: number) {
  const sellingUsd = p.currency === "USD" ? p.sellingPrice : p.sellingPrice / rate;
  const costUsd = p.currency === "USD" ? p.costPrice : p.costPrice / rate;
  const stockValueUsd = sellingUsd * p.quantity;
  const stockValueCdf = stockValueUsd * rate;
  const profitPerUnit = sellingUsd - costUsd;
  const isLowStock = p.quantity <= p.alertQuantity;
  return { ...p, stockValueUsd, stockValueCdf, profitPerUnit, isLowStock };
}

// ── Summary ───────────────────────────────────────────────────────────────────
router.get("/summary", async (req: Request, res: Response) => {
  const rate = await getExchangeRate();
  const all = await db
    .select()
    .from(productsTable)
    .where(not(eq(productsTable.status, "deleted")));

  const active = all.filter((p) => p.status === "active");
  const lowStockCount = active.filter((p) => p.quantity <= p.alertQuantity).length;
  const totalQuantity = active.reduce((s, p) => s + p.quantity, 0);

  let totalValueUsd = 0;
  for (const p of active) {
    const sellingUsd = p.currency === "USD" ? p.sellingPrice : p.sellingPrice / rate;
    totalValueUsd += sellingUsd * p.quantity;
  }

  res.json({
    totalProducts: all.length,
    activeProducts: active.length,
    lowStockCount,
    totalQuantity,
    totalValueUsd,
    totalValueCdf: totalValueUsd * rate,
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
      ) as ReturnType<typeof eq>
    );
  }

  if (category) {
    conditions.push(ilike(productsTable.category, category) as ReturnType<typeof eq>);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  let rows = await db
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

  const productNumber = await getNextNumber("product");

  const [created] = await db
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

  await logActivity(req, "product_created", "product", created.id, { name, productNumber, quantity });

  const rate = await getExchangeRate();
  res.status(201).json(enrichProduct(created, rate));
});

// ── Get one ───────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const rate = await getExchangeRate();
  const [p] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!p) { res.status(404).json({ error: "Not found" }); return; }
  res.json(enrichProduct(p, rate));
});

// ── Update ────────────────────────────────────────────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);

  const [existing] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

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
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const {
    quantityAdded, costPerUnit, totalCost, currency, exchangeRate,
    supplier, notes, paidFromCash = false, purchaseDate,
  } = req.body;

  if (!quantityAdded || quantityAdded < 1) {
    res.status(400).json({ error: "quantityAdded must be >= 1" });
    return;
  }

  const rate = Number(exchangeRate) || (await getExchangeRate());
  const totalCostNum = Number(totalCost) || Number(costPerUnit) * Number(quantityAdded);
  const totalCostUsd = currency === "USD" ? totalCostNum : totalCostNum / rate;
  const totalCostCdf = currency === "CDF" ? totalCostNum : totalCostNum * rate;

  const purchaseNumber = await getNextNumber("purchase");

  const [purchase] = await db
    .insert(stockPurchasesTable)
    .values({
      purchaseNumber,
      productId,
      productName: product.name,
      quantityAdded: Number(quantityAdded),
      costPerUnit: Number(costPerUnit),
      totalCost: totalCostNum,
      currency,
      exchangeRate: rate,
      totalCostUsd,
      totalCostCdf,
      supplier: supplier || null,
      notes: notes || null,
      paidFromCash: paidFromCash ? 1 : 0,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      createdBy: callerName(req),
    })
    .returning();

  // Update product quantity and average cost
  const newQty = product.quantity + Number(quantityAdded);
  const oldTotalCostUsd = (product.currency === "USD" ? product.costPrice : product.costPrice / rate) * product.quantity;
  const newAvgCostUsd = newQty > 0 ? (oldTotalCostUsd + totalCostUsd) / newQty : totalCostUsd / Number(quantityAdded);
  const newCostPrice = product.currency === "USD" ? newAvgCostUsd : newAvgCostUsd * rate;

  await db
    .update(productsTable)
    .set({ quantity: newQty, costPrice: newCostPrice })
    .where(eq(productsTable.id, productId));

  // Cash ledger entry if paid from cash
  if (paidFromCash) {
    await appendLedgerEntry({
      entryDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      sourceType: "stock_purchase",
      sourceNumber: purchaseNumber,
      sourceId: purchase.id,
      direction: "out",
      amount: totalCostNum,
      currency,
      exchangeRate: rate,
      description: `Stock purchase: ${product.name} (${quantityAdded} units)`,
      createdBy: callerName(req),
    });
  }

  await logActivity(req, "stock_purchase_added", "product", productId, {
    purchaseNumber,
    quantityAdded,
    totalCost: totalCostNum,
    currency,
    supplier,
    paidFromCash,
  });

  res.status(201).json(purchase);
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
      )
    )
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(100);
  res.json(entries);
});

export default router;
