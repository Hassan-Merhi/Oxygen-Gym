import { contractBodyAs, contractQueryAs } from "../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router, type Request, type Response } from "express";
import { PatchSaleBody as PatchSaleBodySchema } from "@workspace/api-zod";
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
import { reverseEntries } from "../lib/accounting";
import { appendLedgerEntry } from "../lib/ledger";
import type { SaleItem } from "@workspace/db/schema";

const router = Router();
router.use(requireAuth());

function callerName(req: Request): string {
  return req.__gymproUserName ?? "System";
}

async function getSettings() {
  const [s] = await db.select().from(settingsTable);
  return s ?? { usdToCdfRate: 2800, defaultCurrency: "USD" };
}

// ── Lookup product by barcode ──────────────────────────────────────────────────
router.get("/lookup-barcode", async (req: Request, res: Response) => {
  const { barcode } = contractQueryAs<Record<string, string>>(req, ApiContracts.LookupBarcodeQueryParams);
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
    contractQueryAs<Record<string, string>>(req, ApiContracts.ListSalesQueryParams);

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
  const { items, currency, paymentAmount, notes } = contractBodyAs<{
    items: Array<{ productId: number; quantity: number; unitPrice: number; discount: number }>;
    currency: string;
    paymentAmount: number;
    notes?: string;
  }>(req, ApiContracts.CompleteSaleBody);

  if (!items || items.length === 0) {
    res.status(400).json({ error: "Cart is empty" });
    return;
  }

  const settings = await getSettings();
  const rate = settings.usdToCdfRate ?? 2800;

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await db.select().from(productsTable).where(
    or(...productIds.map((pid) => eq(productsTable.id, pid))) as ReturnType<typeof eq>
  );

  const productMap = new Map(products.map((p) => [p.id, p]));

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

  let totalAmount = 0;
  let totalDiscount = 0;
  let totalCost = 0;
  let totalProfit = 0;

  const saleItems: SaleItem[] = items.map((item) => {
    const product = productMap.get(item.productId)!;

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

  const toUsd = (amount: number) => currency === "USD" ? amount : amount / rate;
  const totalAmountUsd = toUsd(totalAmount);
  const totalCostUsd = toUsd(totalCost);
  const totalProfitUsd = toUsd(totalProfit);
  const amountCdf = currency === "CDF" ? totalAmount : totalAmount * rate;

  const saleNumber = await getNextNumber("sale");
  const paymentNumber = await getNextNumber("PAY");
  const creator = callerName(req);

  const { sale } = await db.transaction(async (tx) => {
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

    // 3. Create payment record so it appears in the Cash Book
    const amountUsd = currency === "USD" ? totalAmount : totalAmount / rate;
    const amountCdf = currency === "CDF" ? totalAmount : totalAmount * rate;
    const itemSummary = saleItems
      .map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.productName}`)
      .join(", ");
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
      notes: itemSummary || notes || null,
      paymentDate: new Date(),
      status: "completed",
      createdBy: creator,
    });

    return { sale };
  });

  // 4. Append ledger entry for the cash balance
  try {
    await appendLedgerEntry({
      sourceType: "sale",
      sourceNumber: saleNumber,
      sourceId: sale.id,
      direction: "in",
      amount: totalAmount,
      currency,
      exchangeRate: rate,
      description: `Sale ${saleNumber}`,
      createdBy: creator,
    });
  } catch { /* non-fatal */ }

  await logActivity(req, "sale_created", "sale", sale.id, {
    saleNumber,
    totalAmount,
    currency,
    itemCount: items.length,
  });

  res.status(201).json(sale);
});

// ── Patch sale (admin: edit currency, date, notes, item prices) ───────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const user = req.__gymproUser as { role?: string } | undefined;
  if (user?.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const id = parseInt(req.params.id as string);

  const parsed = PatchSaleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid patch body", details: parsed.error.issues });
    return;
  }
  const { currency, notes, saleDate, paymentAmount: patchPayment, items: patchItems } = parsed.data;

  const [existing] = await db.select().from(salesTable).where(eq(salesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Sale not found" });
    return;
  }

  const editSettings = await getSettings();
  const rate = editSettings.usdToCdfRate ?? 2800;
  const existingItems = (existing.items ?? []) as SaleItem[];

  let newItems: SaleItem[] = existingItems;
  let newTotalAmount: number = existing.totalAmount ?? 0;
  let newTotalDiscount: number = existing.totalDiscount ?? 0;
  let newTotalCost: number = existing.totalCost ?? 0;
  let newTotalProfit: number = existing.totalProfit ?? 0;
  let newTotalAmountUsd: number = existing.totalAmountUsd ?? existing.totalAmount ?? 0;

  if (patchItems && patchItems.length > 0) {
    newItems = existingItems.map((item) => {
      const patch = patchItems.find((p) => p.productId === item.productId);
      if (!patch) return item;
      const lineTotal = (patch.unitPrice - patch.discount) * item.quantity;
      const lineProfit = lineTotal - (item.costPrice ?? 0) * item.quantity;
      return { ...item, unitPrice: patch.unitPrice, discount: patch.discount, lineTotal, profit: lineProfit };
    });

    const targetCur = currency ?? existing.currency;
    newTotalAmount = newItems.reduce((s, i) => s + (i.lineTotal ?? 0), 0);
    newTotalDiscount = newItems.reduce((s, i) => s + (i.discount ?? 0) * i.quantity, 0);
    newTotalCost = newItems.reduce((s, i) => s + (i.costPrice ?? 0) * i.quantity, 0);
    newTotalProfit = newTotalAmount - newTotalCost;
    newTotalAmountUsd = targetCur === "CDF" ? newTotalAmount / rate : newTotalAmount;
  } else if (currency && currency !== existing.currency) {
    newTotalAmount = existing.totalAmount ?? 0;
    newTotalAmountUsd = currency === "CDF" ? newTotalAmount / rate : newTotalAmount;
  }

  const newPaymentAmount = patchPayment !== undefined && patchPayment !== null
    ? patchPayment
    : (existing.paymentAmount ?? 0);
  const newChangeDue = Math.max(0, newPaymentAmount - newTotalAmount);

  // Recompute USD equivalents for cost and profit
  const newTotalCostUsd   = (currency ?? existing.currency) === "CDF" ? newTotalCost   / rate : newTotalCost;
  const newTotalProfitUsd = (currency ?? existing.currency) === "CDF" ? newTotalProfit / rate : newTotalProfit;

  const [updated] = await db
    .update(salesTable)
    .set({
      items: newItems,
      totalAmount: newTotalAmount,
      totalDiscount: newTotalDiscount,
      totalCost: newTotalCost,
      totalProfit: newTotalProfit,
      totalAmountUsd: newTotalAmountUsd,
      totalCostUsd: newTotalCostUsd,
      totalProfitUsd: newTotalProfitUsd,
      exchangeRate: rate,
      paymentAmount: newPaymentAmount,
      changeDue: newChangeDue,
      ...(currency !== undefined && { currency }),
      ...(notes !== undefined && { notes }),
      ...(saleDate !== undefined && { saleDate: new Date(saleDate as string) }),
    })
    .where(eq(salesTable.id, id))
    .returning();

  await logActivity(req, "sale_updated", "sale", id, {
    updatedBy: callerName(req),
  });

  res.json(updated);
});

// ── Void sale ──────────────────────────────────────────────────────────────────
router.patch("/:id/void", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { reason } = contractBodyAs<{ reason: string }>(req, ApiContracts.VoidSaleBody);

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

  // 3. Reverse accounting entries
  try {
    await reverseEntries("sale", sale.id, "void_sale", creator);
  } catch { /* non-fatal */ }

  // 4. Cancel the corresponding payment record so it's removed from Cash Book balance
  try {
    await db
      .update(paymentsTable)
      .set({ status: "cancelled" })
      .where(and(eq(paymentsTable.linkedEntity, "sale"), eq(paymentsTable.linkedEntityId, id)));
  } catch { /* non-fatal */ }

  // 5. Reverse the ledger entry for the void
  try {
    const voidSettings = await getSettings();
    const voidRate = voidSettings.usdToCdfRate ?? 2800;
    await appendLedgerEntry({
      sourceType: "sale_void",
      sourceNumber: sale.saleNumber ?? undefined,
      sourceId: sale.id,
      direction: "out",
      amount: sale.totalAmount ?? 0,
      currency: sale.currency ?? "USD",
      exchangeRate: voidRate,
      description: `Void Sale ${sale.saleNumber}`,
      createdBy: creator,
    });
  } catch { /* non-fatal */ }

  await logActivity(req, "sale_voided", "sale", sale.id, {
    saleNumber: sale.saleNumber,
    reason,
    voidedBy: creator,
  });

  res.json(voided);
});

export default router;
