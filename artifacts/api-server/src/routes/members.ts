import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  membersTable,
  checkInsTable,
  paymentsTable,
  plansTable,
} from "@workspace/db/schema";
import {
  eq,
  isNull,
  and,
  ilike,
  or,
  gte,
  lte,
  asc,
  desc,
  count,
  between,
} from "drizzle-orm";
import { requireAuth } from "@clerk/express";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth());

// ─── List ────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const {
    page = "1",
    limit = "20",
    search,
    status,
    planId,
    expiryWindow,
    sortBy = "name",
    sortOrder = "asc",
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [isNull(membersTable.deletedAt) as ReturnType<typeof eq>];

  if (search) {
    conditions.push(
      or(
        ilike(membersTable.name, `%${search}%`),
        ilike(membersTable.phone, `%${search}%`),
        ilike(membersTable.email, `%${search}%`),
        ilike(membersTable.memberNumber, `%${search}%`)
      ) as ReturnType<typeof eq>
    );
  }
  if (status && status !== "all") {
    conditions.push(eq(membersTable.status, status));
  }
  if (planId) {
    conditions.push(eq(membersTable.planId, parseInt(planId)));
  }
  if (expiryWindow) {
    const days = parseInt(expiryWindow);
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + days);
    conditions.push(
      and(gte(membersTable.expiryDate, now), lte(membersTable.expiryDate, future)) as ReturnType<typeof eq>
    );
  }

  const where = and(...conditions);
  const sortCol =
    sortBy === "joinDate" ? membersTable.joinDate
      : sortBy === "expiryDate" ? membersTable.expiryDate
      : membersTable.name;
  const order = sortOrder === "desc" ? desc(sortCol) : asc(sortCol);

  const [items, [totRow]] = await Promise.all([
    db.select().from(membersTable).where(where).orderBy(order).limit(limitNum).offset(offset),
    db.select({ total: count() }).from(membersTable).where(where),
  ]);

  res.json({ items, total: Number(totRow.total), page: pageNum, limit: limitNum });
});

// ─── Create ──────────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    emergencyContact?: string;
    gender?: string;
    joinDate?: string;
    planId?: number;
    startDate?: string;
    expiryDate?: string;
    status?: string;
    amountPaid?: number;
    discount?: number;
    currency?: string;
    photoUrl?: string;
    fingerprintId?: string;
    qrCodeId?: string;
    notes?: string;
  };

  if (!body.name) { res.status(400).json({ error: "name is required" }); return; }

  const memberNumber = await getNextNumber("MEM");

  let planName: string | undefined;
  let planPrice: number | undefined;
  if (body.planId) {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, body.planId));
    if (plan) { planName = plan.name; planPrice = plan.price; }
  }

  const amountPaid = body.amountPaid ?? 0;
  const discount = body.discount ?? 0;
  const balance = (planPrice ?? 0) - discount - amountPaid;

  const [member] = await db.insert(membersTable).values({
    memberNumber,
    name: body.name,
    email: body.email,
    phone: body.phone,
    address: body.address,
    emergencyContact: body.emergencyContact,
    gender: body.gender,
    joinDate: body.joinDate ? new Date(body.joinDate) : new Date(),
    planId: body.planId,
    planName,
    planPrice,
    startDate: body.startDate ? new Date(body.startDate) : undefined,
    expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
    status: body.status ?? "active",
    amountPaid,
    discount,
    balance,
    currency: body.currency ?? "USD",
    photoUrl: body.photoUrl,
    fingerprintId: body.fingerprintId,
    qrCodeId: body.qrCodeId,
    notes: body.notes,
  }).returning();

  if (body.planId && (amountPaid > 0 || planPrice)) {
    const paymentNumber = await getNextNumber("PAY");
    await db.insert(paymentsTable).values({
      paymentNumber,
      memberId: member.id,
      memberName: member.name,
      planId: body.planId,
      planName: planName ?? "",
      amount: amountPaid,
      discount,
      currency: member.currency,
      type: "membership",
      notes: body.notes,
      paymentDate: new Date(),
      status: "completed",
    });
  }

  await logActivity(req, "create_member", "member", member.id, { name: member.name, memberNumber });
  res.status(201).json(member);
});

// ─── Get by ID ───────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [member] = await db.select().from(membersTable)
    .where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt)));
  if (!member) { res.status(404).json({ error: "Not found" }); return; }
  res.json(member);
});

// ─── Update ──────────────────────────────────────────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;

  let planName: string | undefined;
  let planPrice: number | undefined;
  if (body.planId !== undefined && body.planId) {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, body.planId as number));
    if (plan) { planName = plan.name; planPrice = plan.price; }
  }

  const [existing] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updateData: Record<string, unknown> = {};
  const dateFields = ["joinDate", "startDate", "expiryDate"];
  const allowed = ["name","email","phone","address","emergencyContact","gender","joinDate","planId","startDate","expiryDate","status","amountPaid","discount","currency","photoUrl","fingerprintId","qrCodeId","notes"];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updateData[key] = dateFields.includes(key) && body[key]
        ? new Date(body[key] as string)
        : body[key];
    }
  }
  if (planName) { updateData.planName = planName; updateData.planPrice = planPrice; }

  const ap = (updateData.amountPaid ?? existing.amountPaid ?? 0) as number;
  const disc = (updateData.discount ?? existing.discount ?? 0) as number;
  const pp = (updateData.planPrice ?? existing.planPrice ?? 0) as number;
  updateData.balance = pp - disc - ap;

  const [member] = await db.update(membersTable).set(updateData).where(eq(membersTable.id, id)).returning();
  await logActivity(req, "update_member", "member", id, { name: member.name });
  res.json(member);
});

// ─── Archive ─────────────────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [member] = await db.update(membersTable)
    .set({ status: "archived", deletedAt: new Date() })
    .where(eq(membersTable.id, id)).returning();
  if (!member) { res.status(404).json({ error: "Not found" }); return; }
  await logActivity(req, "archive_member", "member", id, { name: member.name });
  res.json({ ok: true });
});

// ─── Check-in ────────────────────────────────────────────────────────────────
router.post("/:id/checkin", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const force = !!(req.body as { force?: boolean }).force;

  const [member] = await db.select().from(membersTable)
    .where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt)));
  if (!member) { res.status(404).json({ error: "Not found" }); return; }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const existing = await db.select().from(checkInsTable).where(
    and(eq(checkInsTable.memberId, id), between(checkInsTable.checkedInAt, todayStart, todayEnd))
  );

  if (existing.length > 0 && !force) {
    res.json({ success: false, alreadyCheckedIn: true, checkIn: null });
    return;
  }

  const [checkIn] = await db.insert(checkInsTable)
    .values({ memberId: id, memberName: member.name, checkedInAt: new Date() })
    .returning();

  await db.update(membersTable).set({ lastCheckIn: new Date() }).where(eq(membersTable.id, id));
  await logActivity(req, "check_in_member", "member", id, { name: member.name });

  res.json({
    success: true,
    alreadyCheckedIn: false,
    checkIn: { id: checkIn.id, memberId: checkIn.memberId, memberName: checkIn.memberName, memberNumber: member.memberNumber, checkedInAt: checkIn.checkedInAt, note: null },
  });
});

// ─── Renew ───────────────────────────────────────────────────────────────────
router.post("/:id/renew", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as { planId: number; startDate: string; expiryDate: string; amountPaid: number; discount: number; currency: string; notes?: string };

  const [existing] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, body.planId));
  if (!plan) { res.status(400).json({ error: "Plan not found" }); return; }

  const balance = plan.price - (body.discount ?? 0) - (body.amountPaid ?? 0);

  const [member] = await db.update(membersTable).set({
    planId: body.planId, planName: plan.name, planPrice: plan.price,
    startDate: new Date(body.startDate), expiryDate: new Date(body.expiryDate),
    amountPaid: body.amountPaid, discount: body.discount ?? 0, balance,
    currency: body.currency, status: "active",
  }).where(eq(membersTable.id, id)).returning();

  const paymentNumber = await getNextNumber("PAY");
  await db.insert(paymentsTable).values({
    paymentNumber, memberId: id, memberName: existing.name,
    planId: body.planId, planName: plan.name,
    amount: body.amountPaid, discount: body.discount ?? 0,
    currency: body.currency, type: "membership", notes: body.notes,
    paymentDate: new Date(), status: "completed",
  });

  await logActivity(req, "renew_member", "member", id, { name: existing.name, plan: plan.name });
  res.json(member);
});

// ─── Freeze ──────────────────────────────────────────────────────────────────
router.post("/:id/freeze", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as { frozenAt: string; frozenUntil: string; reason?: string };
  const frozenAt = new Date(body.frozenAt);
  const frozenUntil = new Date(body.frozenUntil);
  const frozenDays = Math.round((frozenUntil.getTime() - frozenAt.getTime()) / (1000 * 60 * 60 * 24));

  const [member] = await db.update(membersTable)
    .set({ frozenAt, frozenUntil, frozenDays, status: "frozen" })
    .where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt)))
    .returning();
  if (!member) { res.status(404).json({ error: "Not found" }); return; }
  await logActivity(req, "freeze_member", "member", id, { name: member.name, days: frozenDays, reason: body.reason });
  res.json(member);
});

// ─── Reactivate ──────────────────────────────────────────────────────────────
router.post("/:id/reactivate", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(membersTable)
    .where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const newExpiry = existing.expiryDate ? new Date(existing.expiryDate) : new Date();
  if (existing.frozenDays && existing.frozenDays > 0) {
    newExpiry.setDate(newExpiry.getDate() + existing.frozenDays);
  }
  const newStatus = newExpiry >= new Date() ? "active" : "expired";

  const [member] = await db.update(membersTable).set({
    status: newStatus, expiryDate: newExpiry,
    frozenAt: null, frozenUntil: null, frozenDays: 0,
  }).where(eq(membersTable.id, id)).returning();

  await logActivity(req, "reactivate_member", "member", id, { name: existing.name, newStatus });
  res.json(member);
});

// ─── Set status ──────────────────────────────────────────────────────────────
router.patch("/:id/status", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { status } = req.body as { status: string };
  if (!["active","inactive","archived"].includes(status)) {
    res.status(400).json({ error: "Invalid status" }); return;
  }
  const [member] = await db.update(membersTable).set({ status })
    .where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt))).returning();
  if (!member) { res.status(404).json({ error: "Not found" }); return; }
  await logActivity(req, `set_member_status_${status}`, "member", id, { name: member.name });
  res.json(member);
});

// ─── Payment history ─────────────────────────────────────────────────────────
router.get("/:id/payments", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const payments = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.memberId, id)).orderBy(desc(paymentsTable.createdAt));
  res.json(payments.map((p) => ({
    id: p.id, paymentNumber: p.paymentNumber, type: p.type,
    amount: p.amount, discount: p.discount ?? 0, currency: p.currency,
    planName: p.planName, notes: p.notes, createdAt: p.createdAt,
  })));
});

// ─── Check-in history ────────────────────────────────────────────────────────
router.get("/:id/checkins", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  const checkins = await db.select().from(checkInsTable)
    .where(eq(checkInsTable.memberId, id))
    .orderBy(desc(checkInsTable.checkedInAt)).limit(200);
  res.json(checkins.map((c) => ({
    id: c.id, memberId: c.memberId, memberName: c.memberName,
    memberNumber: member?.memberNumber ?? null, checkedInAt: c.checkedInAt, note: null,
  })));
});

export default router;
