import { contractBody, contractParams, contractQuery, contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { PatchSaleBody as PatchSaleBodySchema } from "@workspace/api-zod";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
import { getCurrentUser, requireAdmin } from "../../shared/auth/permissions";
import { redactFinancialFieldsForRequest } from "../../shared/auth/response-redaction";
import { badRequest, notFound } from "../../shared/http/errors";
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
  createSale,
  getSale,
  listSales,
  lookupProductByBarcode,
  patchSale,
  voidSale,
  type SaleLineInput,
} from "./service";

const router = Router();
router.use(requireAuth());

router.get("/lookup-barcode", async (req, res) => {
  const barcode = requiredString(contractQuery(req, ApiContracts.LookupBarcodeQueryParams).barcode, "barcode");
  const product = await lookupProductByBarcode(barcode);
  if (!product) {
    await logActivity(req, "barcode_not_found", "product", undefined, { barcode });
    throw notFound("Product not found for barcode");
  }
  res.json(redactFinancialFieldsForRequest(req, product));
});

router.get("/", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListSalesQueryParams);
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  const result = await listSales({
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
    search: optionalString(query.search),
    status: optionalString(query.status),
    currency: optionalString(query.currency),
    dateFrom: optionalDate(query.dateFrom, "dateFrom"),
    dateTo,
  });
  res.json(redactFinancialFieldsForRequest(req, result));
});

router.get("/:id", async (req, res) => {
  const sale = await getSale(parseId(contractParams(req, ApiContracts.GetSaleParams).id, "sale id"));
  res.json(redactFinancialFieldsForRequest(req, sale));
});

router.post("/", async (req, res) => {
  const body = asRecord(contractBody(req, ApiContracts.CompleteSaleBody));
  if (!Array.isArray(body.items)) throw badRequest("Cart is empty");
  const items: SaleLineInput[] = body.items.map((raw) => {
    const item = asRecord(raw);
    return {
      productId: parseId(item.productId as string | number | undefined, "productId"),
      quantity: nonNegativeNumber(item.quantity, "quantity"),
      unitPrice: nonNegativeNumber(item.unitPrice, "unitPrice"),
      discount: nonNegativeNumber(item.discount, "discount"),
    };
  });

  const actor = getCurrentUser(req).name;
  const sale = await createSale({
    items,
    currency: requiredString(body.currency, "currency"),
    paymentAmount: nonNegativeNumber(body.paymentAmount, "paymentAmount"),
    notes: optionalString(body.notes),
  }, actor);

  await logActivity(req, "sale_created", "sale", sale.id, {
    saleNumber: sale.saleNumber,
    totalAmount: sale.totalAmount,
    currency: sale.currency,
    itemCount: items.length,
  });
  res.status(201).json(redactFinancialFieldsForRequest(req, sale));
});

router.patch("/:id", requireAdmin(), async (req, res) => {
  const id = parseId(contractParams(req, ApiContracts.PatchSaleParams).id, "sale id");
  const parsed = PatchSaleBodySchema.safeParse(contractBody(req, ApiContracts.PatchSaleBody));
  if (!parsed.success) throw badRequest("Invalid patch body", parsed.error.issues);

  const data = parsed.data;
  const actor = getCurrentUser(req).name;
  const sale = await patchSale(id, {
    currency: data.currency,
    notes: data.notes,
    saleDate: data.saleDate ? new Date(data.saleDate as string) : undefined,
    paymentAmount: data.paymentAmount ?? undefined,
    items: data.items?.map((item) => ({
      productId: item.productId,
      unitPrice: item.unitPrice,
      discount: item.discount,
    })),
  }, actor);

  await logActivity(req, "sale_updated", "sale", id, { updatedBy: actor });
  res.json(redactFinancialFieldsForRequest(req, sale));
});

router.patch("/:id/void", async (req, res) => {
  const id = parseId(contractParams(req, ApiContracts.VoidSaleParams).id, "sale id");
  const reason = requiredString(asRecord(contractBody(req, ApiContracts.VoidSaleBody)).reason, "reason");
  const actor = getCurrentUser(req).name;
  const sale = await voidSale(id, reason, actor);
  await logActivity(req, "sale_voided", "sale", id, {
    saleNumber: sale.saleNumber,
    reason,
    voidedBy: actor,
  });
  res.json(redactFinancialFieldsForRequest(req, sale));
});

export default router;
