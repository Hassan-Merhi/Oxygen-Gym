import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
import { getCurrentUser } from "../../shared/auth/permissions";
import {
  asRecord,
  nonNegativeNumber,
  optionalDate,
  optionalPositiveInt,
  optionalString,
  parseId,
  requiredString,
} from "../../shared/http/validation";
import {
  addSupplierPayment,
  createSupplierCredit,
  deleteSupplierCredit,
  deleteSupplierPayment,
  getSupplierCreditSummary,
  getSupplierProductProfitSummary,
  listSupplierCredits,
  listSupplierPayments,
  updateSupplierCredit,
} from "./supplier-credit-service";

const router = Router();
router.use(requireAuth());

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return String(value).trim();
}

function nullablePositiveInt(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return optionalPositiveInt(value, field);
}

router.get("/summary", async (_req, res) => {
  res.json(await getSupplierCreditSummary());
});

router.get("/products", async (_req, res) => {
  res.json(await getSupplierProductProfitSummary());
});

router.get("/", async (_req, res) => {
  res.json(await listSupplierCredits());
});

router.post("/", async (req, res) => {
  const body = asRecord(req.body);
  const credit = await createSupplierCredit({
    supplier: requiredString(body.supplier, "supplier"),
    description: optionalString(body.description),
    productId: optionalPositiveInt(body.productId, "productId"),
    productName: optionalString(body.productName),
    totalAmount: nonNegativeNumber(body.totalAmount, "totalAmount"),
    currency: optionalString(body.currency),
    exchangeRate: body.exchangeRate === undefined ? undefined : nonNegativeNumber(body.exchangeRate, "exchangeRate"),
    purchaseDate: optionalDate(body.purchaseDate, "purchaseDate"),
    notes: optionalString(body.notes),
  }, getCurrentUser(req).name);
  await logActivity(req, "create_supplier_credit", "supplier_credit", credit.id, {
    supplier: credit.supplier,
    creditNumber: credit.creditNumber,
  });
  res.status(201).json(credit);
});

router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id, "supplier credit id");
  const body = asRecord(req.body);
  res.json(await updateSupplierCredit(id, {
    supplier: body.supplier === undefined ? undefined : requiredString(body.supplier, "supplier"),
    description: nullableString(body.description),
    productId: nullablePositiveInt(body.productId, "productId"),
    productName: nullableString(body.productName),
    totalAmount: body.totalAmount === undefined ? undefined : nonNegativeNumber(body.totalAmount, "totalAmount"),
    currency: optionalString(body.currency),
    exchangeRate: body.exchangeRate === undefined ? undefined : nonNegativeNumber(body.exchangeRate, "exchangeRate"),
    purchaseDate: optionalDate(body.purchaseDate, "purchaseDate"),
    notes: nullableString(body.notes),
    status: optionalString(body.status),
  }, getCurrentUser(req).name));
});

router.delete("/:id", async (req, res) => {
  res.json(await deleteSupplierCredit(
    parseId(req.params.id, "supplier credit id"),
    getCurrentUser(req).name,
  ));
});

router.get("/:id/payments", async (req, res) => {
  res.json(await listSupplierPayments(parseId(req.params.id, "supplier credit id")));
});

router.post("/:id/payments", async (req, res) => {
  const id = parseId(req.params.id, "supplier credit id");
  const body = asRecord(req.body);
  const result = await addSupplierPayment(id, {
    amount: nonNegativeNumber(body.amount, "amount"),
    currency: optionalString(body.currency),
    exchangeRate: body.exchangeRate === undefined ? undefined : nonNegativeNumber(body.exchangeRate, "exchangeRate"),
    account: optionalString(body.account),
    paymentDate: optionalDate(body.paymentDate, "paymentDate"),
    notes: optionalString(body.notes),
  }, getCurrentUser(req).name);
  await logActivity(req, "supplier_payment", "supplier_credit", id, {
    amount: result.payment.amount,
    supplier: result.credit.supplier,
  });
  res.status(201).json(result);
});

router.delete("/:id/payments/:paymentId", async (req, res) => {
  res.json(await deleteSupplierPayment(
    parseId(req.params.id, "supplier credit id"),
    parseId(req.params.paymentId, "supplier payment id"),
    getCurrentUser(req).name,
  ));
});

export default router;
