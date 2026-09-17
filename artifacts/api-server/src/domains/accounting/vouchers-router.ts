import { contractBody, contractParams, contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
import { getCurrentUser } from "../../shared/auth/permissions";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import {
  asRecord,
  nonNegativeNumber,
  optionalDate,
  optionalPositiveInt,
  optionalString,
  parseId,
  parseLimit,
  parsePage,
  requiredString,
} from "../../shared/http/validation";
import { cancelVoucher, createVoucher, getVoucher, listVouchers, updateVoucher, type UpdateVoucherInput } from "./voucher-service";

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

router.get("/", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListVouchersQueryParams);
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  const [result, rate] = await Promise.all([
    listVouchers({
      page: parsePage(query.page),
      limit: parseLimit(query.limit),
      search: optionalString(query.search),
      voucherType: optionalString(query.voucherType),
      currency: optionalString(query.currency),
      dateFrom: optionalDate(query.dateFrom, "dateFrom"),
      dateTo,
    }),
    getExchangeRate(),
  ]);
  res.json({
    ...result,
    items: result.items.map((voucher) => ({
      ...voucher,
      exchangeRate: rate,
      ...toUsdCdf(Number(voucher.amount ?? 0), voucher.currency, rate),
    })),
  });
});

router.post("/", async (req, res) => {
  const body = asRecord(contractBody(req, ApiContracts.CreateVoucherBody));
  const actor = getCurrentUser(req).name;
  const voucher = await createVoucher({
    voucherType: requiredString(body.voucherType, "voucherType"),
    voucherDate: optionalDate(body.voucherDate, "voucherDate"),
    paidTo: optionalString(body.paidTo),
    receivedFrom: optionalString(body.receivedFrom),
    linkedEntity: optionalString(body.linkedEntity),
    linkedEntityId: optionalPositiveInt(body.linkedEntityId, "linkedEntityId"),
    linkedEntityName: optionalString(body.linkedEntityName),
    amount: nonNegativeNumber(body.amount, "amount"),
    currency: requiredString(body.currency, "currency"),
    account: optionalString(body.account),
    category: optionalString(body.category),
    description: requiredString(body.description, "description"),
  }, actor);
  await logActivity(req, "voucher_created", "voucher", voucher.id, {
    number: voucher.voucherNumber,
    type: voucher.voucherType,
    amount: voucher.amount,
    currency: voucher.currency,
  });
  res.status(201).json(voucher);
});

router.get("/:id", async (req, res) => {
  const [voucher, rate] = await Promise.all([
    getVoucher(parseId(contractParams(req, ApiContracts.GetVoucherParams).id, "voucher id")),
    getExchangeRate(),
  ]);
  res.json({
    ...voucher,
    exchangeRate: rate,
    ...toUsdCdf(Number(voucher.amount ?? 0), voucher.currency, rate),
  });
});

router.patch("/:id", async (req, res) => {
  const id = parseId(contractParams(req, ApiContracts.UpdateVoucherParams).id, "voucher id");
  const body = asRecord(contractBody(req, ApiContracts.UpdateVoucherBody));
  const input: UpdateVoucherInput = {
    voucherType: optionalString(body.voucherType),
    voucherDate: optionalDate(body.voucherDate, "voucherDate"),
    paidTo: nullableString(body.paidTo),
    receivedFrom: nullableString(body.receivedFrom),
    linkedEntity: nullableString(body.linkedEntity),
    linkedEntityId: nullablePositiveInt(body.linkedEntityId, "linkedEntityId"),
    linkedEntityName: nullableString(body.linkedEntityName),
    amount: body.amount === undefined ? undefined : nonNegativeNumber(body.amount, "amount"),
    currency: optionalString(body.currency),
    account: optionalString(body.account),
    category: nullableString(body.category),
    description: optionalString(body.description),
  };
  const voucher = await updateVoucher(id, input, getCurrentUser(req).name);
  await logActivity(req, "voucher_edited", "voucher", id, { number: voucher.voucherNumber });
  res.json(voucher);
});

router.delete("/:id", async (req, res) => {
  const id = parseId(contractParams(req, ApiContracts.DeleteVoucherParams).id, "voucher id");
  const voucher = await cancelVoucher(id, getCurrentUser(req).name);
  await logActivity(req, "voucher_archived", "voucher", id, { number: voucher.voucherNumber });
  res.json({ ok: true });
});

export default router;
