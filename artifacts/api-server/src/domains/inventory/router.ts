import { contractBody, contractParams, contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
import { getCurrentUser } from "../../shared/auth/permissions";
import { redactFinancialFieldsForRequest } from "../../shared/auth/response-redaction";
import {
  asRecord,
  nonNegativeNumber,
  optionalDate,
  optionalString,
  parseId,
  parseLimit,
  parsePage,
  requiredString,
} from "../../shared/http/validation";
import {
  addStockPurchase,
  createProduct,
  getInventorySummary,
  getProduct,
  getProductHistory,
  listProducts,
  listStockPurchases,
  updateProduct,
  type UpdateProductInput,
} from "./service";

const router = Router();
router.use(requireAuth());

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return String(value).trim() || null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

router.get("/summary", async (req, res) => {
  res.json(redactFinancialFieldsForRequest(req, await getInventorySummary()));
});

router.get("/", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListProductsQueryParams);
  const result = await listProducts({
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
    search: optionalString(query.search),
    category: optionalString(query.category),
    status: optionalString(query.status),
    lowStock: query.lowStock === "true",
  });
  res.json(redactFinancialFieldsForRequest(req, result));
});

router.post("/", async (req, res) => {
  const body = asRecord(contractBody(req, ApiContracts.CreateProductBody));
  const name = requiredString(body.name, "name");
  const result = await createProduct({
    name,
    barcode: optionalString(body.barcode),
    description: optionalString(body.description),
    category: optionalString(body.category),
    supplier: optionalString(body.supplier),
    notes: optionalString(body.notes),
    quantity: body.quantity === undefined ? undefined : nonNegativeNumber(body.quantity, "quantity"),
    alertQuantity: body.alertQuantity === undefined ? undefined : nonNegativeNumber(body.alertQuantity, "alertQuantity"),
    costPrice: body.costPrice === undefined ? undefined : nonNegativeNumber(body.costPrice, "costPrice"),
    sellingPrice: body.sellingPrice === undefined ? undefined : nonNegativeNumber(body.sellingPrice, "sellingPrice"),
    currency: optionalString(body.currency),
    status: optionalString(body.status),
  });
  await logActivity(req, "product_created", "product", result.product.id, {
    name,
    productNumber: result.productNumber,
    quantity: result.product.quantity,
  });
  res.status(201).json(result.product);
});

router.get("/:id", async (req, res) => {
  const product = await getProduct(parseId(contractParams(req, ApiContracts.GetProductParams).id, "product id"));
  res.json(redactFinancialFieldsForRequest(req, product));
});

router.patch("/:id", async (req, res) => {
  const id = parseId(contractParams(req, ApiContracts.UpdateProductParams).id, "product id");
  const body = asRecord(contractBody(req, ApiContracts.UpdateProductBody));
  const input: UpdateProductInput = {
    name: body.name === undefined ? undefined : requiredString(body.name, "name"),
    barcode: nullableString(body.barcode),
    description: nullableString(body.description),
    category: nullableString(body.category),
    supplier: nullableString(body.supplier),
    notes: nullableString(body.notes),
    quantity: body.quantity === undefined ? undefined : nonNegativeNumber(body.quantity, "quantity"),
    alertQuantity: body.alertQuantity === undefined ? undefined : nonNegativeNumber(body.alertQuantity, "alertQuantity"),
    costPrice: body.costPrice === undefined ? undefined : nonNegativeNumber(body.costPrice, "costPrice"),
    sellingPrice: body.sellingPrice === undefined ? undefined : nonNegativeNumber(body.sellingPrice, "sellingPrice"),
    currency: optionalString(body.currency),
    status: optionalString(body.status),
  };
  const result = await updateProduct(id, input);
  await logActivity(req, result.action, "product", id, { name: input.name, status: input.status });
  res.json(result.product);
});

router.get("/:id/purchases", async (req, res) => {
  const purchases = await listStockPurchases(parseId(contractParams(req, ApiContracts.ListProductPurchasesParams).id, "product id"));
  res.json(redactFinancialFieldsForRequest(req, purchases));
});

router.post("/:id/purchases", async (req, res) => {
  const productId = parseId(contractParams(req, ApiContracts.AddStockPurchaseParams).id, "product id");
  const body = asRecord(contractBody(req, ApiContracts.AddStockPurchaseBody));
  const actor = getCurrentUser(req).name;
  const purchase = await addStockPurchase(productId, {
    quantityAdded: nonNegativeNumber(body.quantityAdded, "quantityAdded"),
    costPerUnit: nonNegativeNumber(body.costPerUnit, "costPerUnit"),
    totalCost: body.totalCost === undefined ? undefined : nonNegativeNumber(body.totalCost, "totalCost"),
    currency: optionalString(body.currency),
    exchangeRate: body.exchangeRate === undefined ? undefined : nonNegativeNumber(body.exchangeRate, "exchangeRate"),
    supplier: optionalString(body.supplier),
    notes: optionalString(body.notes),
    paidFromCash: asBoolean(body.paidFromCash),
    purchaseDate: optionalDate(body.purchaseDate, "purchaseDate"),
  }, actor);

  await logActivity(req, "stock_purchase_added", "product", productId, {
    purchaseNumber: purchase.purchaseNumber,
    quantityAdded: purchase.quantityAdded,
    totalCost: purchase.totalCost,
    currency: purchase.currency,
    supplier: purchase.supplier,
    paidFromCash: purchase.paidFromCash === 1,
  });
  res.status(201).json(purchase);
});

router.get("/:id/history", async (req, res) => {
  const history = await getProductHistory(parseId(contractParams(req, ApiContracts.GetProductHistoryParams).id, "product id"));
  res.json(redactFinancialFieldsForRequest(req, history));
});

export default router;
