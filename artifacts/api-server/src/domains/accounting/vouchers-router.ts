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
  const query = req.query as Record<string, string | undefined>;
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  res.json(await listVouchers({
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
    search: optionalString(query.search),
    voucherType: optionalString(query.voucherType),
    currency: optionalString(query.currency),
    dateFrom: optionalDate(query.dateFrom, "dateFrom"),
    dateTo,
  }));
});

router.post("/", async (req, res) => {
  const body = asRecord(req.body);
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
    exchangeRate: body.exchangeRate === undefined ? undefined : nonNegativeNumber(body.exchangeRate, "exchangeRate"),
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
  res.json(await getVoucher(parseId(req.params.id, "voucher id")));
});

router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id, "voucher id");
  const body = asRecord(req.body);
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
    exchangeRate: body.exchangeRate === undefined ? undefined : nonNegativeNumber(body.exchangeRate, "exchangeRate"),
    account: optionalString(body.account),
    category: nullableString(body.category),
    description: optionalString(body.description),
  };
  const voucher = await updateVoucher(id, input, getCurrentUser(req).name);
  await logActivity(req, "voucher_edited", "voucher", id, { number: voucher.voucherNumber });
  res.json(voucher);
});

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id, "voucher id");
  const voucher = await cancelVoucher(id, getCurrentUser(req).name);
  await logActivity(req, "voucher_archived", "voucher", id, { number: voucher.voucherNumber });
  res.json({ ok: true });
});

export default router;
