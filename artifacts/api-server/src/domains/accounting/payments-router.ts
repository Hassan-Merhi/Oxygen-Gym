import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
import { getCurrentUser, requireAdmin } from "../../shared/auth/permissions";
import { badRequest } from "../../shared/http/errors";
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
import {
  cancelPayment,
  cashCleanup,
  createPayment,
  getPaymentSummary,
  listPayments,
  sendPaymentReceipt,
  updatePayment,
  type UpdatePaymentInput,
} from "./payment-service";

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

function direction(value: unknown, required = false): "in" | "out" | undefined {
  if (value === undefined && !required) return undefined;
  if (value !== "in" && value !== "out") throw badRequest("direction must be in or out");
  return value;
}

router.get("/summary", async (_req, res) => {
  res.json(await getPaymentSummary());
});

router.get("/", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  res.json(await listPayments({
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
    search: optionalString(query.search),
    direction: optionalString(query.direction),
    category: optionalString(query.category),
    currency: optionalString(query.currency),
    dateFrom: optionalDate(query.dateFrom, "dateFrom"),
    dateTo,
    sortOrder: query.sortOrder === "asc" ? "asc" : "desc",
  }));
});

router.post("/", async (req, res) => {
  const body = asRecord(req.body);
  const paymentDirection = direction(body.direction, true)!;
  const payment = await createPayment({
    direction: paymentDirection,
    category: requiredString(body.category, "category"),
    linkedEntity: optionalString(body.linkedEntity),
    linkedEntityId: optionalPositiveInt(body.linkedEntityId, "linkedEntityId"),
    linkedEntityName: optionalString(body.linkedEntityName),
    memberId: optionalPositiveInt(body.memberId, "memberId"),
    memberName: optionalString(body.memberName),
    planId: optionalPositiveInt(body.planId, "planId"),
    planName: optionalString(body.planName),
    amount: nonNegativeNumber(body.amount, "amount"),
    discount: body.discount === undefined ? undefined : nonNegativeNumber(body.discount, "discount"),
    currency: requiredString(body.currency, "currency"),
    exchangeRate: body.exchangeRate === undefined ? undefined : nonNegativeNumber(body.exchangeRate, "exchangeRate"),
    account: optionalString(body.account),
    notes: optionalString(body.notes),
    paymentDate: optionalDate(body.paymentDate, "paymentDate"),
  }, getCurrentUser(req).name);

  await logActivity(req, "payment_recorded", "payment", payment.id, {
    number: payment.paymentNumber,
    direction: payment.direction,
    category: payment.category,
    amount: payment.amount,
    currency: payment.currency,
  });
  res.status(201).json(payment);
});

router.all("/admin/cash-cleanup", requireAdmin(), async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const dryRun = req.method === "GET" || body.dry_run !== false;
  res.json(await cashCleanup(dryRun));
});

router.post("/:id/send-receipt", async (req, res) => {
  res.json(await sendPaymentReceipt(parseId(req.params.id, "payment id")));
});

router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id, "payment id");
  const body = asRecord(req.body);
  const input: UpdatePaymentInput = {
    direction: direction(body.direction),
    category: optionalString(body.category),
    linkedEntity: nullableString(body.linkedEntity),
    linkedEntityId: nullablePositiveInt(body.linkedEntityId, "linkedEntityId"),
    linkedEntityName: nullableString(body.linkedEntityName),
    memberId: nullablePositiveInt(body.memberId, "memberId"),
    memberName: nullableString(body.memberName),
    planId: nullablePositiveInt(body.planId, "planId"),
    planName: nullableString(body.planName),
    amount: body.amount === undefined ? undefined : nonNegativeNumber(body.amount, "amount"),
    discount: body.discount === undefined ? undefined : nonNegativeNumber(body.discount, "discount"),
    currency: optionalString(body.currency),
    exchangeRate: body.exchangeRate === undefined ? undefined : nonNegativeNumber(body.exchangeRate, "exchangeRate"),
    account: optionalString(body.account),
    notes: nullableString(body.notes),
    paymentDate: optionalDate(body.paymentDate, "paymentDate"),
  };
  const payment = await updatePayment(id, input, getCurrentUser(req).name);
  await logActivity(req, "payment_edited", "payment", id, { number: payment.paymentNumber });
  res.json(payment);
});

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id, "payment id");
  const payment = await cancelPayment(id, getCurrentUser(req).name);
  await logActivity(req, "payment_archived", "payment", id, { number: payment.paymentNumber });
  res.json({ ok: true });
});

export default router;
