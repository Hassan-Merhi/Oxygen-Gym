import { contractBody, contractParams } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
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
  const body = asRecord(contractBody(req, ApiContracts.CreateSupplierCreditBody));
  const credit = await createSupplierCredit({
    supplier: requiredString(body.supplier, "supplier"),
    description: optionalString(body.description),
    productId: optionalPositiveInt(body.productId, "productId"),
    productName: optionalString(body.productName),
    totalAmount: nonNegativeNumber(body.totalAmount, "totalAmount"),
    currency: optionalString(body.currency),
    purchaseDate: optionalDate(body.purchaseDate, "purchaseDate"),
    notes: optionalString(body.notes),
  });
  await logActivity(req, "create_supplier_credit", "supplier_credit", credit.id, {
    supplier: credit.supplier,
    creditNumber: credit.creditNumber,
  });
  res.status(201).json(credit);
});

router.patch("/:id", async (req, res) => {
  const id = parseId(contractParams(req, ApiContracts.UpdateSupplierCreditParams).id, "supplier credit id");
  const body = asRecord(contractBody(req, ApiContracts.UpdateSupplierCreditBody));
  res.json(await updateSupplierCredit(id, {
    supplier: body.supplier === undefined ? undefined : requiredString(body.supplier, "supplier"),
    description: nullableString(body.description),
    productId: nullablePositiveInt(body.productId, "productId"),
    productName: nullableString(body.productName),
    totalAmount: body.totalAmount === undefined ? undefined : nonNegativeNumber(body.totalAmount, "totalAmount"),
    currency: optionalString(body.currency),
    purchaseDate: optionalDate(body.purchaseDate, "purchaseDate"),
    notes: nullableString(body.notes),
    status: optionalString(body.status),
  }));
});

router.delete("/:id", async (req, res) => {
  res.json(await deleteSupplierCredit(parseId(contractParams(req, ApiContracts.DeleteSupplierCreditParams).id, "supplier credit id")));
});

router.get("/:id/payments", async (req, res) => {
  res.json(await listSupplierPayments(parseId(contractParams(req, ApiContracts.ListSupplierPaymentsParams).id, "supplier credit id")));
});

router.post("/:id/payments", async (req, res) => {
  const id = parseId(contractParams(req, ApiContracts.CreateSupplierPaymentParams).id, "supplier credit id");
  const body = asRecord(contractBody(req, ApiContracts.CreateSupplierPaymentBody));
  const result = await addSupplierPayment(id, {
    amount: nonNegativeNumber(body.amount, "amount"),
    currency: optionalString(body.currency),
    paymentDate: optionalDate(body.paymentDate, "paymentDate"),
    notes: optionalString(body.notes),
  });
  await logActivity(req, "supplier_payment", "supplier_credit", id, {
    amount: result.payment.amount,
    supplier: result.credit.supplier,
  });
  res.status(201).json(result);
});

router.delete("/:id/payments/:paymentId", async (req, res) => {
  res.json(await deleteSupplierPayment(
    parseId(contractParams(req, ApiContracts.DeleteSupplierPaymentParams).id, "supplier credit id"),
    parseId(contractParams(req, ApiContracts.DeleteSupplierPaymentParams).paymentId, "supplier payment id"),
  ));
});

export default router;
