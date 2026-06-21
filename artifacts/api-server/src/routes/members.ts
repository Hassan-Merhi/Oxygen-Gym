import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  membersTable,
  checkInsTable,
  paymentsTable,
  plansTable,
  vouchersTable,
  chartOfAccountsTable,
  commissionsTable,
  staffEmployeesTable,
  settingsTable,
  whatsappReminderLogsTable,
} from "@workspace/db/schema";

import { sendToAllChats, formatNewMemberMessage } from "../lib/whatsapp";
import { logger } from "../lib/logger";
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
import { requireAuth } from "../middlewares/auth";
import { getNextNumber } from "../lib/numbering";
import { logActivity } from "../lib/activity";
import { appendLedgerEntry } from "../lib/ledger";

async function getExchangeRate(): Promise<number> {
  const [s] = await db.select({ rate: settingsTable.usdToCdfRate }).from(settingsTable);
  return s?.rate ?? 2800;
}

function toUsdCdf(amount: number, currency: string, rate: number): { amountUsd: number; amountCdf: number } {
  const amountUsd = currency === "USD" ? amount : amount / rate;
  const amountCdf = currency === "CDF" ? amount : amount * rate;
  return { amountUsd, amountCdf };
}

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
    phone?: string;
    planId?: number;
    startDate?: string;
    expiryDate?: string;
    status?: string;
    amountPaid?: number;
    discount?: number;
    currency?: string;
    cashAccountId?: number;
    photoUrl?: string;
    fingerprintId?: string;
    qrCodeId?: string;
    notes?: string;
    coachId?: number;
    commissionAmount?: number;
  };

  if (!body.name) { res.status(400).json({ error: "name is required" }); return; }

  if (body.startDate && body.expiryDate && new Date(body.expiryDate) <= new Date(body.startDate)) {
    res.status(400).json({ error: "Expiry date must be after start date" });
    return;
  }
  if ((body.amountPaid ?? 0) < 0) {
    res.status(400).json({ error: "Amount paid cannot be negative" });
    return;
  }
  if ((body.discount ?? 0) < 0) {
    res.status(400).json({ error: "Discount cannot be negative" });
    return;
  }

  const memberNumber = await getNextNumber("MEM");

  let planName: string | undefined;
  let planPrice: number | undefined;
  if (body.planId) {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, body.planId));
    if (plan) {
      planName = plan.name;
      // Convert plan price to the member's chosen currency if they differ
      const memberCurrency = body.currency ?? "USD";
      const planCurrency = (plan as unknown as Record<string, unknown>).currency as string ?? "USD";
      if (planCurrency !== memberCurrency) {
        const rate = await getExchangeRate();
        planPrice = planCurrency === "CDF" ? plan.price / rate : plan.price * rate;
      } else {
        planPrice = plan.price;
      }
    }
  }

  const amountPaid = body.amountPaid ?? 0;
  const discount = body.discount ?? 0;
  const balance = (planPrice ?? 0) - discount - amountPaid;

  const [member] = await db.insert(membersTable).values({
    memberNumber,
    name: body.name,
    phone: body.phone,
    joinDate: new Date(),
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
    coachId: body.coachId ?? null,
    commissionAmount: body.commissionAmount ?? 0,
    cashAccountId: body.cashAccountId ?? null,
  }).returning();

  if (body.planId && (amountPaid > 0 || planPrice)) {
    const paymentNumber = await getNextNumber("PAY");
    const rate = await getExchangeRate();
    const { amountUsd, amountCdf } = toUsdCdf(amountPaid, member.currency, rate);
    const [newPayment] = await db.insert(paymentsTable).values({
      paymentNumber,
      memberId: member.id,
      memberName: member.name,
      planId: body.planId,
      planName: planName ?? "",
      amount: amountPaid,
      discount,
      currency: member.currency,
      exchangeRate: rate,
      amountUsd,
      amountCdf,
      type: "membership",
      category: "membership",
      direction: "in",
      notes: body.notes,
      paymentDate: body.startDate ? new Date(body.startDate) : new Date(),
      status: "completed",
    }).returning();
    // Write to cash ledger so balance and KPIs reflect membership payments
    if (amountPaid > 0) {
      await appendLedgerEntry({ sourceType: "payment", sourceNumber: paymentNumber, sourceId: newPayment.id, direction: "in", amount: amountPaid, currency: member.currency, exchangeRate: rate, description: `Membership — ${planName ?? ""} (${member.name})`, entryDate: body.startDate ? new Date(body.startDate) : new Date() });
    }
  }

  // Auto-commission: if coach assigned and amount > 0
  if (amountPaid > 0 && member.coachId && (member.commissionAmount ?? 0) > 0) {
    await db.insert(commissionsTable).values({
      staffEmployeeId: member.coachId,
      memberId: member.id,
      memberName: member.name,
      amount: member.commissionAmount!,
      currency: member.currency,
      status: "pending",
      note: `Commission — ${member.name} (membership payment)`,
    });
  }

  await logActivity(req, "create_member", "member", member.id, { name: member.name, memberNumber });
  res.status(201).json(member);

  // Fire-and-forget WhatsApp notification
  db.query.settingsTable.findFirst().then(async (settings) => {
    if (settings?.greenApiInstanceId && settings?.greenApiToken) {
      const message = formatNewMemberMessage({
        ...member,
        exchangeRate: settings.usdToCdfRate ?? 1,
      });
      const sent = await sendToAllChats(settings.greenApiInstanceId, settings.greenApiToken, message);
      if (sent) {
        await db.insert(whatsappReminderLogsTable).values({ memberId: member.id, reminderType: "new_member" });
      }
    }
  }).catch((err) => logger.error({ err }, "WhatsApp new-member notification failed"));
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

  // cashAccountId is not a member column — extract it separately
  const cashAccountId = body.cashAccountId ? Number(body.cashAccountId) : undefined;

  let planName: string | undefined;
  let planRawPrice: number | undefined;
  if (body.planId !== undefined && body.planId) {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, body.planId as number));
    if (plan) { planName = plan.name; planRawPrice = plan.price; }
  }

  const [existing] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updateData: Record<string, unknown> = {};
  const dateFields = ["startDate", "expiryDate"];
  const allowed = ["name","phone","planId","startDate","expiryDate","status","amountPaid","discount","currency","photoUrl","fingerprintId","qrCodeId","notes","coachId","commissionAmount","cashAccountId","planPrice"];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updateData[key] = dateFields.includes(key) && body[key]
        ? new Date(body[key] as string)
        : body[key];
    }
  }
  // If client sent a converted planPrice, it takes precedence; fall back to raw plan price
  if (planName) {
    updateData.planName = planName;
    if (updateData.planPrice === undefined) updateData.planPrice = planRawPrice;
  }

  const newAp = (updateData.amountPaid ?? existing.amountPaid ?? 0) as number;
  const newDisc = (updateData.discount ?? existing.discount ?? 0) as number;
  const pp = (updateData.planPrice ?? existing.planPrice ?? 0) as number;
  updateData.balance = pp - newDisc - newAp;

  const [member] = await db.update(membersTable).set(updateData).where(eq(membersTable.id, id)).returning();

  const currency = (updateData.currency ?? existing.currency ?? "USD") as string;
  const effectivePlanId = (updateData.planId ?? existing.planId) as number | undefined;
  const effectivePlanName = planName ?? existing.planName ?? "";

  // ── Sync payment record when amountPaid or discount changes ───────────────
  const amountChanged = body.amountPaid !== undefined || body.discount !== undefined;
  // True only when the numeric values actually differ from what's stored — prevents
  // duplicate vouchers from being created on every edit form save.
  const amountActuallyChanged =
    newAp !== Number(existing.amountPaid ?? 0) ||
    newDisc !== Number(existing.discount ?? 0) ||
    currency !== ((existing.currency as string) ?? "USD");
  if (amountChanged) {
    // Find the most recent membership payment for this member
    const [existingPayment] = await db
      .select()
      .from(paymentsTable)
      .where(and(eq(paymentsTable.memberId, id), eq(paymentsTable.type, "membership")))
      .orderBy(desc(paymentsTable.createdAt))
      .limit(1);

    const rate = await getExchangeRate();
    const { amountUsd: pUsd, amountCdf: pCdf } = toUsdCdf(newAp, currency, rate);
    if (existingPayment) {
      const oldAmount = existingPayment.amount ?? 0;
      // Update the existing payment record
      await db.update(paymentsTable)
        .set({ amount: newAp, discount: newDisc, currency, planName: effectivePlanName, exchangeRate: rate, amountUsd: pUsd, amountCdf: pCdf })
        .where(eq(paymentsTable.id, existingPayment.id));
      // Ledger correction: reverse old, write new
      if (oldAmount !== newAp) {
        if (oldAmount > 0) {
          await appendLedgerEntry({ sourceType: "payment_correction", sourceId: existingPayment.id, direction: "out", amount: oldAmount, currency: existingPayment.currency, exchangeRate: existingPayment.exchangeRate ?? rate, description: `Correction: membership payment reversed — ${member.name}` });
        }
        if (newAp > 0) {
          await appendLedgerEntry({ sourceType: "payment_correction", sourceId: existingPayment.id, direction: "in", amount: newAp, currency, exchangeRate: rate, description: `Correction: membership payment updated — ${member.name}` });
        }
      }
    } else if (effectivePlanId) {
      // No prior payment existed — create one now
      const paymentNumber = await getNextNumber("PAY");
      const effectiveDate = body.startDate ? new Date(body.startDate as string) : (existing.startDate ?? new Date());
      const [newPayment] = await db.insert(paymentsTable).values({
        paymentNumber,
        memberId: id,
        memberName: member.name,
        planId: effectivePlanId,
        planName: effectivePlanName,
        amount: newAp,
        discount: newDisc,
        currency,
        exchangeRate: rate,
        amountUsd: pUsd,
        amountCdf: pCdf,
        type: "membership",
        category: "membership",
        direction: "in",
        paymentDate: effectiveDate,
        status: "completed",
      }).returning();
      if (newAp > 0) {
        await appendLedgerEntry({ sourceType: "payment", sourceNumber: paymentNumber, sourceId: newPayment.id, direction: "in", amount: newAp, currency, exchangeRate: rate, description: `Membership payment — ${effectivePlanName} (${member.name})`, entryDate: effectiveDate });
      }
    }
  }

  // ── Sync Cash Receipt voucher whenever payment fields are in the body ────────
  // Always update in place so exchange rate + currency stay fresh.
  // Only create a new voucher when none exists yet.
  if (cashAccountId && newAp > 0 && amountChanged) {
    const rate2 = await getExchangeRate();
    const { amountUsd: vUsd, amountCdf: vCdf } = toUsdCdf(newAp, currency, rate2);
    const voucherEffectiveDate = body.startDate ? new Date(body.startDate as string) : (existing.startDate ?? new Date());

    let accountName = "cash";
    const [acct] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, cashAccountId));
    if (acct) accountName = acct.name.toLowerCase().replace(/ /g, "_");

    // Find the current recorded Cash Receipt for this member (if any)
    const [existingVoucher] = await db.select()
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.linkedEntity, "member"),
        eq(vouchersTable.linkedEntityId, id),
        eq(vouchersTable.voucherType, "cash_receipt"),
        eq(vouchersTable.status, "recorded"),
        isNull(vouchersTable.deletedAt),
      ))
      .orderBy(desc(vouchersTable.id))
      .limit(1);

    if (existingVoucher) {
      // Update in place — refreshes amount, currency, and exchange rate
      await db.update(vouchersTable)
        .set({
          amount: newAp,
          currency,
          exchangeRate: rate2,
          amountUsd: vUsd,
          amountCdf: vCdf,
          account: accountName,
          description: `Membership payment — ${effectivePlanName}`,
          voucherDate: voucherEffectiveDate,
        })
        .where(eq(vouchersTable.id, existingVoucher.id));
    } else if (amountActuallyChanged) {
      // No recorded voucher — create one (cancel any stale cancelled remnants first)
      await db.update(vouchersTable)
        .set({ status: "cancelled" })
        .where(and(
          eq(vouchersTable.linkedEntity, "member"),
          eq(vouchersTable.linkedEntityId, id),
          eq(vouchersTable.voucherType, "cash_receipt"),
          isNull(vouchersTable.deletedAt),
        ));
      const voucherNumber = await getNextNumber("VCH");
      await db.insert(vouchersTable).values({
        voucherNumber,
        voucherType: "cash_receipt",
        direction: "in",
        receivedFrom: member.name,
        linkedEntity: "member",
        linkedEntityId: id,
        linkedEntityName: member.name,
        amount: newAp,
        currency,
        exchangeRate: rate2,
        amountUsd: vUsd,
        amountCdf: vCdf,
        account: accountName,
        category: "membership",
        description: `Membership payment — ${effectivePlanName}`,
        voucherDate: voucherEffectiveDate,
        status: "recorded",
      });
    }
  }

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
  await db.update(vouchersTable)
    .set({ status: "cancelled", deletedAt: new Date() })
    .where(and(eq(vouchersTable.linkedEntity, "member"), eq(vouchersTable.linkedEntityId, id), eq(vouchersTable.status, "recorded"), isNull(vouchersTable.deletedAt)));
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
  const body = req.body as { planId: number; startDate: string; expiryDate: string; amountPaid: number; discount: number; currency: string; cashAccountId?: number; notes?: string };

  const [existing] = await db.select().from(membersTable).where(eq(membersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (body.startDate && body.expiryDate && new Date(body.expiryDate) <= new Date(body.startDate)) {
    res.status(400).json({ error: "Expiry date must be after start date" });
    return;
  }
  if ((body.amountPaid ?? 0) < 0) {
    res.status(400).json({ error: "Amount paid cannot be negative" });
    return;
  }
  if ((body.discount ?? 0) < 0) {
    res.status(400).json({ error: "Discount cannot be negative" });
    return;
  }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, body.planId));
  if (!plan) { res.status(400).json({ error: "Plan not found" }); return; }

  const balance = plan.price - (body.discount ?? 0) - (body.amountPaid ?? 0);

  const [member] = await db.update(membersTable).set({
    planId: body.planId, planName: plan.name, planPrice: plan.price,
    startDate: new Date(body.startDate), expiryDate: new Date(body.expiryDate),
    amountPaid: body.amountPaid, discount: body.discount ?? 0, balance,
    currency: body.currency, status: "active",
    ...(body.cashAccountId ? { cashAccountId: body.cashAccountId } : {}),
  }).where(eq(membersTable.id, id)).returning();

  const renewRate = await getExchangeRate();
  const { amountUsd: renewUsd, amountCdf: renewCdf } = toUsdCdf(body.amountPaid, body.currency, renewRate);

  const paymentNumber = await getNextNumber("PAY");
  const [renewPayment] = await db.insert(paymentsTable).values({
    paymentNumber, memberId: id, memberName: existing.name,
    planId: body.planId, planName: plan.name,
    amount: body.amountPaid, discount: body.discount ?? 0,
    currency: body.currency, exchangeRate: renewRate,
    amountUsd: renewUsd, amountCdf: renewCdf,
    type: "renewal", category: "membership", direction: "in",
    notes: body.notes ? body.notes : `Renewal: ${body.startDate} → ${body.expiryDate}`,
    paymentDate: new Date(body.startDate), status: "completed",
  }).returning();
  const renewEntryDate = new Date(body.startDate);
  // Write to cash ledger
  if (body.amountPaid > 0) {
    await appendLedgerEntry({ sourceType: "payment", sourceNumber: paymentNumber, sourceId: renewPayment.id, direction: "in", amount: body.amountPaid, currency: body.currency, exchangeRate: renewRate, description: `Renewal — ${plan.name} (${existing.name})`, entryDate: renewEntryDate });
  }

  // Auto-commission on renewal
  if ((body.amountPaid ?? 0) > 0 && member.coachId && (member.commissionAmount ?? 0) > 0) {
    await db.insert(commissionsTable).values({
      staffEmployeeId: member.coachId,
      memberId: member.id,
      memberName: member.name,
      amount: member.commissionAmount!,
      currency: member.currency,
      status: "pending",
      note: `Commission — ${member.name} (renewal: ${plan.name})`,
    });
  }

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
