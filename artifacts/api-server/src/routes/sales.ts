import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import {
  productsTable,
  salesTable,
  settingsTable,
  paymentsTable,
} from "@workspace/db/schema";
import { eq, and, ilike, or, desc, count, gte, lte } from "drizzle-orm";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry } from "../lib/ledger";
import type { SaleItem } from "@workspace/db/schema";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return (req as unknown as { __gymproUserName?: string }).__gymproUserName ?? "System";
}

async function getSettings() {
  const [s] = await db.select().from(settingsTable);
  return s ?? { usdToCdfRate: 2800, defaultCurrency: "USD" };
}

// ── Lookup product by barcode ──────────────────────────────────────────────────
router.get("/lookup-barcode", async (req: Request, res: Response) => {
  const { barcode } = req.query as Record<string, string>;
  if (!barcode) {
    res.status(400).json({ error: "barcode query param required" });
    return;
  }

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.barcode, barcode));

  if (!product) {
    await logActivity(req, "barcode_not_found", "product", undefined, { barcode });
    res.status(404).json({ error: "Product not found for barcode" });
    return;
  }

  res.json(product);
});

// ── List sales ─────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const { page = "1", limit = "20", search, status, currency, dateFrom, dateTo } =
    req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [];

  if (search) {
    conditions.push(
      or(
        ilike(salesTable.saleNumber, `%${search}%`),
        ilike(salesTable.createdBy, `%${search}%`)
      ) as ReturnType<typeof eq>
    );
  }
  if (status) conditions.push(eq(salesTable.status, status));
  if (currency) conditions.push(eq(salesTable.currency, currency));
  if (dateFrom) conditions.push(gte(salesTable.saleDate, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(salesTable.saleDate, new Date(dateTo + "T23:59:59")));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [items, [totRow]] = await Promise.all([
    db.select().from(salesTable).where(where).orderBy(desc(salesTable.saleDate)).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(salesTable).where(where),
  ]);

  res.json({ items, total: Number(totRow.total), page: pageNum, limit: limitNum });
});

// ── Get single sale ────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!sale) {
    res.status(404).json({ error: "Sale not found" });
    return;
  }
  res.json(sale);
});

// ── Complete sale (POS checkout) ───────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const { items, currency, paymentAmount, notes } = req.body as {
    items: Array<{ productId: number; quantity: number; unitPrice: number; discount: number }>;
    currency: string;
    paymentAmount: number;
    notes?: string;
  };

  if (!items || items.length === 0) {
    res.status(400).json({ error: "Cart is empty" });
    return;
  }

  const settings = await getSettings();
  const rate = settings.usdToCdfRate ?? 2800;

  // Validate & load products
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await db.select().from(productsTable).where(
    or(...productIds.map((pid) => eq(productsTable.id, pid))) as ReturnType<typeof eq>
  );

  const productMap = new Map(products.map((p) => [p.id, p]));

  // Validate stock and status
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) {
      res.status(400).json({ error: `Product ${item.productId} not found` });
      return;
    }
    if (product.status !== "active") {
      res.status(400).json({ error: `Product "${product.name}" is not active` });
      return;
    }
    if (product.quantity < item.quantity) {
      await logActivity(req, "stock_insufficient", "product", product.id, {
        productName: product.name,
        requested: item.quantity,
        available: product.quantity,
      });
      res.status(400).json({ error: `Insufficient stock for "${product.name}" (available: ${product.quantity})` });
      return;
    }
  }

  // Build sale items with cost/profit
  let totalAmount = 0;
  let totalDiscount = 0;
  let totalCost = 0;
  let totalProfit = 0;

  const saleItems: SaleItem[] = items.map((item) => {
    const product = productMap.get(item.productId)!;

    // Convert cost to sale currency if needed
    let costInSaleCurrency = product.costPrice;
    if (product.currency !== currency) {
      if (currency === "USD" && product.currency === "CDF") {
        costInSaleCurrency = product.costPrice / rate;
      } else if (currency === "CDF" && product.currency === "USD") {
        costInSaleCurrency = product.costPrice * rate;
      }
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
      currency,
    };
  });

  const changeDue = Math.max(0, paymentAmount - totalAmount);

  // Convert to USD for reporting
  const toUsd = (amount: number) => currency === "USD" ? amount : amount / rate;
  const totalAmountUsd = toUsd(totalAmount);
  const totalCostUsd = toUsd(totalCost);
  const totalProfitUsd = toUsd(totalProfit);

  const saleNumber = await getNextNumber("sale");
  const paymentNumber = await getNextNumber("PAY");
  const creator = callerName(req);
  const amountCdf = currency === "CDF" ? totalAmount : totalAmount * rate;

  const { sale, payment } = await db.transaction(async (tx) => {
    // 1. Create sale record
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
      notes: notes ?? null,
      createdBy: creator,
      status: "completed",
    }).returning();

    // 2. Deduct stock
    for (const item of items) {
      const product = productMap.get(item.productId)!;
      await tx
        .update(productsTable)
        .set({ quantity: product.quantity - item.quantity })
        .where(eq(productsTable.id, item.productId));
    }

    // 3. Create payment record
    const [payment] = await tx.insert(paymentsTable).values({
      paymentNumber,
      direction: "in",
      category: "product_sale",
      type: "product_sale",
      amount: totalAmountUsd,
      currency: "USD",
      exchangeRate: rate,
      amountUsd: totalAmountUsd,
      amountCdf,
      account: "cash",
      notes: `Sale ${saleNumber}`,
      createdBy: creator,
      status: "completed",
    }).returning();

    // 4. Link payment to sale
    await tx.update(salesTable).set({ paymentId: payment.id }).where(eq(salesTable.id, sale.id));

    return { sale, payment };
  });

  // 5. Cash ledger entry (outside transaction — non-critical)
  await appendLedgerEntry({
    sourceType: "product_sale",
    sourceNumber: saleNumber,
    sourceId: sale.id,
    direction: "in",
    amount: totalAmountUsd,
    currency: "USD",
    exchangeRate: rate,
    description: `Product sale ${saleNumber}`,
    createdBy: creator,
  });

  // 6. Activity log
  await logActivity(req, "sale_created", "sale", sale.id, {
    saleNumber,
    totalAmount,
    currency,
    itemCount: items.length,
  });

  res.status(201).json({ ...sale, paymentId: payment.id });
});

// ── Void sale ──────────────────────────────────────────────────────────────────
router.patch("/:id/void", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { reason } = req.body as { reason: string };

  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!sale) {
    res.status(404).json({ error: "Sale not found" });
    return;
  }
  if (sale.status === "voided") {
    res.status(400).json({ error: "Sale is already voided" });
    return;
  }

  const settings = await getSettings();
  const rate = settings.usdToCdfRate ?? 2800;
  const creator = callerName(req);

  // 1. Restore stock quantities
  const saleItems = (sale.items ?? []) as SaleItem[];
  for (const item of saleItems) {
    const [product] = await db.select({ quantity: productsTable.quantity })
      .from(productsTable)
      .where(eq(productsTable.id, item.productId));
    if (product) {
      await db
        .update(productsTable)
        .set({ quantity: product.quantity + item.quantity })
        .where(eq(productsTable.id, item.productId));
    }
  }

  // 2. Mark sale as voided
  const [voided] = await db
    .update(salesTable)
    .set({
      status: "voided",
      voidedAt: new Date(),
      voidedBy: creator,
      voidReason: reason,
    })
    .where(eq(salesTable.id, id))
    .returning();

  // 3. Reverse cash ledger entry
  const totalAmountUsd = sale.totalAmountUsd ?? sale.totalAmount;
  const amountCdf = sale.currency === "CDF" ? sale.totalAmount : totalAmountUsd * rate;

  await appendLedgerEntry({
    sourceType: "void_sale",
    sourceNumber: sale.saleNumber ?? undefined,
    sourceId: sale.id,
    direction: "out",
    amount: totalAmountUsd,
    currency: "USD",
    exchangeRate: rate,
    description: `Void sale ${sale.saleNumber ?? id} — ${reason}`,
    createdBy: creator,
  });

  void amountCdf; // recorded in ledger internally via currency conversion

  // 4. Activity log
  await logActivity(req, "sale_voided", "sale", sale.id, {
    saleNumber: sale.saleNumber,
    reason,
    voidedBy: creator,
  });

  res.json(voided);
});

export default router;
