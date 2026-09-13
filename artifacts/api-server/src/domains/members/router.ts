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
  parseLimit,
  parsePage,
  requiredString,
} from "../../shared/http/validation";
import {
  archiveMember,
  checkInMember,
  createMember,
  freezeMember,
  reactivateMember,
  renewMember,
  setMemberStatus,
  updateMember,
  type UpdateMemberInput,
} from "./command-service";
import { getMember, getMemberCheckIns, getMemberPayments, listMembers } from "./query-service";
import { notifyMemberRenewal, notifyNewMember, refreshMemberWhatsAppIdentity } from "./notifications";

const router = Router();
router.use(requireAuth());

function nullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return String(value).trim();
}

function nullableDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return optionalDate(value, field);
}

function nullablePositiveInt(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return optionalPositiveInt(value, field);
}

router.get("/", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const sortBy = query.sortBy === "joinDate" || query.sortBy === "expiryDate" ? query.sortBy : "name";
  const sortOrder = query.sortOrder === "desc" ? "desc" : "asc";
  const expiryWindowDays = query.expiryWindow === undefined
    ? undefined
    : nonNegativeNumber(query.expiryWindow, "expiryWindow");

  res.json(await listMembers({
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
    search: optionalString(query.search),
    status: optionalString(query.status),
    planId: optionalPositiveInt(query.planId, "planId"),
    expiryWindowDays,
    sortBy,
    sortOrder,
    showDeleted: query.showDeleted === "true",
  }));
});

router.post("/", async (req, res) => {
  const body = asRecord(req.body);
  const member = await createMember({
    name: requiredString(body.name, "name"),
    phone: optionalString(body.phone),
    planId: optionalPositiveInt(body.planId, "planId"),
    startDate: optionalDate(body.startDate, "startDate"),
    expiryDate: optionalDate(body.expiryDate, "expiryDate"),
    status: optionalString(body.status),
    amountPaid: body.amountPaid === undefined ? undefined : nonNegativeNumber(body.amountPaid, "amountPaid"),
    discount: body.discount === undefined ? undefined : nonNegativeNumber(body.discount, "discount"),
    currency: optionalString(body.currency),
    cashAccountId: optionalPositiveInt(body.cashAccountId, "cashAccountId"),
    photoUrl: optionalString(body.photoUrl),
    fingerprintId: optionalString(body.fingerprintId),
    qrCodeId: optionalString(body.qrCodeId),
    notes: optionalString(body.notes),
    coachId: optionalPositiveInt(body.coachId, "coachId"),
    commissionAmount: body.commissionAmount === undefined ? undefined : nonNegativeNumber(body.commissionAmount, "commissionAmount"),
  });

  await logActivity(req, "create_member", "member", member.id, {
    name: member.name,
    memberNumber: member.memberNumber,
  });
  notifyNewMember(member);
  res.status(201).json(member);
});

router.get("/:id", async (req, res) => {
  res.json(await getMember(parseId(req.params.id, "member id")));
});

router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id, "member id");
  const body = asRecord(req.body);
  const input: UpdateMemberInput = {
    name: body.name === undefined ? undefined : requiredString(body.name, "name"),
    phone: nullableString(body.phone),
    planId: nullablePositiveInt(body.planId, "planId"),
    startDate: nullableDate(body.startDate, "startDate"),
    expiryDate: nullableDate(body.expiryDate, "expiryDate"),
    status: optionalString(body.status),
    amountPaid: body.amountPaid === undefined ? undefined : nonNegativeNumber(body.amountPaid, "amountPaid"),
    discount: body.discount === undefined ? undefined : nonNegativeNumber(body.discount, "discount"),
    currency: optionalString(body.currency),
    photoUrl: nullableString(body.photoUrl),
    fingerprintId: nullableString(body.fingerprintId),
    qrCodeId: nullableString(body.qrCodeId),
    notes: nullableString(body.notes),
    coachId: nullablePositiveInt(body.coachId, "coachId"),
    commissionAmount: body.commissionAmount === undefined ? undefined : nonNegativeNumber(body.commissionAmount, "commissionAmount"),
    cashAccountId: nullablePositiveInt(body.cashAccountId, "cashAccountId"),
    planPrice: body.planPrice === undefined ? undefined : nonNegativeNumber(body.planPrice, "planPrice"),
  };

  const result = await updateMember(id, input);
  await logActivity(req, "update_member", "member", id, { name: result.member.name });
  refreshMemberWhatsAppIdentity(result.member, result.previousPhone);
  res.json(result.member);
});

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id, "member id");
  const member = await archiveMember(id);
  await logActivity(req, "archive_member", "member", id, { name: member.name });
  res.json({ ok: true });
});

router.post("/:id/checkin", async (req, res) => {
  const id = parseId(req.params.id, "member id");
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const result = await checkInMember(id, body.force === true);
  if (result.alreadyCheckedIn || !result.checkIn) {
    res.json({ success: false, alreadyCheckedIn: true, checkIn: null });
    return;
  }

  await logActivity(req, "check_in_member", "member", id, { name: result.member.name });
  res.json({
    success: true,
    alreadyCheckedIn: false,
    checkIn: {
      id: result.checkIn.id,
      memberId: result.checkIn.memberId,
      memberName: result.checkIn.memberName,
      memberNumber: result.member.memberNumber,
      checkedInAt: result.checkIn.checkedInAt,
      note: null,
    },
  });
});

router.post("/:id/renew", async (req, res) => {
  const id = parseId(req.params.id, "member id");
  const body = asRecord(req.body);
  const startDate = optionalDate(body.startDate, "startDate");
  const expiryDate = optionalDate(body.expiryDate, "expiryDate");
  if (!startDate || !expiryDate) throw new Error("startDate and expiryDate are required");

  const member = await renewMember(id, {
    planId: parseId(body.planId as string | number | undefined, "planId"),
    startDate,
    expiryDate,
    amountPaid: nonNegativeNumber(body.amountPaid, "amountPaid"),
    discount: nonNegativeNumber(body.discount, "discount"),
    currency: requiredString(body.currency, "currency"),
    cashAccountId: optionalPositiveInt(body.cashAccountId, "cashAccountId"),
    notes: optionalString(body.notes),
  });

  await logActivity(req, "renew_member", "member", id, { name: member.name, plan: member.planName });
  notifyMemberRenewal(member);
  res.json(member);
});

router.post("/:id/freeze", async (req, res) => {
  const id = parseId(req.params.id, "member id");
  const body = asRecord(req.body);
  const frozenAt = optionalDate(body.frozenAt, "frozenAt");
  const frozenUntil = optionalDate(body.frozenUntil, "frozenUntil");
  if (!frozenAt || !frozenUntil) throw new Error("frozenAt and frozenUntil are required");
  const member = await freezeMember(id, frozenAt, frozenUntil);
  await logActivity(req, "freeze_member", "member", id, {
    name: member.name,
    days: member.frozenDays,
    reason: optionalString(body.reason),
  });
  res.json(member);
});

router.post("/:id/reactivate", async (req, res) => {
  const id = parseId(req.params.id, "member id");
  const member = await reactivateMember(id);
  await logActivity(req, "reactivate_member", "member", id, { name: member.name, newStatus: member.status });
  res.json(member);
});

router.patch("/:id/status", async (req, res) => {
  const id = parseId(req.params.id, "member id");
  const status = requiredString(asRecord(req.body).status, "status");
  const member = await setMemberStatus(id, status);
  await logActivity(req, `set_member_status_${status}`, "member", id, { name: member.name });
  res.json(member);
});

router.get("/:id/payments", async (req, res) => {
  res.json(await getMemberPayments(parseId(req.params.id, "member id")));
});

router.get("/:id/checkins", async (req, res) => {
  res.json(await getMemberCheckIns(parseId(req.params.id, "member id")));
});

export default router;
