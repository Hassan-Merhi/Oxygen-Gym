import { Router, type Request, type Response } from "express";
import { db, withTransaction } from "@workspace/db";
import {
  membersTable,
  checkInsTable,
  paymentsTable,
  plansTable,
  vouchersTable,
  chartOfAccountsTable,
  commissionsTable,
  whatsappReminderLogsTable,
} from "@workspace/db/schema";
import { sendToAllChats, formatNewMemberMessage, formatMemberInfoMessage, lookupPhoneOnWhatsApp } from "../lib/whatsapp";
import { logger } from "../lib/logger";
import {
  eq,
  isNull,
  isNotNull,
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
import { lubumbashiTodayStart, lubumbashiTodayEnd } from "../lib/timezone";
import { getExchangeRate } from "../repositories/settings";

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
    showDeleted = "false",
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const deletedCondition = showDeleted === "true"
    ? (isNotNull(membersTable.deletedAt) as ReturnType<typeof eq>)
    : (isNull(membersTable.deletedAt) as ReturnType<typeof eq>);

  const conditions: ReturnType<typeof eq>[] = [deletedCondition];

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
    if (status === "expired") {
      const now = new Date();
      conditions.push(
        or(
          eq(membersTable.status, "expired"),
          and(eq(membersTable.status, "active"), lte(membersTable.expiryDate, now))
        ) as ReturnType<typeof eq>
      );
    } else {
      conditions.push(eq(membersTable.status, status));
    }
  }
  if (planId) conditions.push(eq(membersTable.planId, parseInt(planId)));
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

  const result = await withTransaction(async (tx) => {
    const memberNumber = await getNextNumber("MEM", tx);
    const memberCurrency = body.currency ?? "USD";
    const rate = await getExchangeRate(tx);

    let planName: string | undefined;
    let planPrice: number | undefined;
    if (body.planId) {
      const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, body.planId));
      if (plan) {
        planName = plan.name;
        const planCurrency = plan.currency ?? "USD";
        planPrice = planCurrency === memberCurrency
          ? plan.price
          : planCurrency === "CDF"
            ? plan.price / rate
            : plan.price * rate;
      }
    }

    const amountPaid = body.amountPaid ?? 0;
    const discount = body.discount ?? 0;
    const balance = (planPrice ?? 0) - discount - amountPaid;

    const [member] = await tx.insert(membersTable).values({
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
      currency: memberCurrency,
      photoUrl: body.photoUrl,
      fingerprintId: body.fingerprintId,
      qrCodeId: body.qrCodeId,
      notes: body.notes,
      coachId: body.coachId ?? null,
      commissionAmount: body.commissionAmount ?? 0,
      cashAccountId: body.cashAccountId ?? null,
    }).returning();
    if (!member) throw new Error("Unable to create member");

    if (body.planId && (amountPaid > 0 || planPrice)) {
      const paymentNumber = await getNextNumber("PAY", tx);
      const { amountUsd, amountCdf } = toUsdCdf(amountPaid, member.currency, rate);
      const paymentDate = body.startDate ? new Date(body.startDate) : new Date();
      const [newPayment] = await tx.insert(paymentsTable).values({
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
        paymentDate,
        status: "completed",
      }).returning();
      if (!newPayment) throw new Error("Unable to create membership payment");

      if (amountPaid > 0) {
        await appendLedgerEntry({
          sourceType: "payment",
          sourceNumber: paymentNumber,
          sourceId: newPayment.id,
          direction: "in",
          amount: amountPaid,
          currency: member.currency,
          exchangeRate: rate,
          description: `Membership — ${planName ?? ""} (${member.name})`,
          entryDate: paymentDate,
        }, tx);
      }
    }

    if (amountPaid > 0 && member.coachId && (member.commissionAmount ?? 0) > 0) {
      await tx.insert(commissionsTable).values({
        staffEmployeeId: member.coachId,
        memberId: member.id,
        memberName: member.name,
        amount: member.commissionAmount!,
        currency: member.currency,
        status: "pending",
        note: `Commission — ${member.name} (membership payment)`,
      });
    }

    return { member, memberNumber };
  });

  await logActivity(req, "create_member", "member", result.member.id, {
    name: result.member.name,
    memberNumber: result.memberNumber,
  });
  res.status(201).json(result.member);

  db.query.settingsTable.findFirst().then(async (settings) => {
    if (!settings?.greenApiInstanceId || !settings?.greenApiToken) return;
    const { greenApiInstanceId: instanceId, greenApiToken: token } = settings;

    if (result.member.phone) {
      const chatId = await lookupPhoneOnWhatsApp(result.member.phone, instanceId, token);
      if (chatId) {
        await db.update(membersTable).set({ waChatId: chatId }).where(eq(membersTable.id, result.member.id));
        logger.info({ memberId: result.member.id, chatId }, "WhatsApp chatId resolved for new member");
      }
    }

    const message = formatNewMemberMessage({ ...result.member, exchangeRate: settings.usdToCdfRate ?? 1 });
    const sent = await sendToAllChats(instanceId, token, message);
    if (sent) {
      await db.insert(whatsappReminderLogsTable).values({ memberId: result.member.id, reminderType: "new_member" });
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
  const cashAccountId = body.cashAccountId ? Number(body.cashAccountId) : undefined;

  const result = await withTransaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, id))
      .for("update");
    if (!existing) return { kind: "not_found" as const };

    let planName: string | undefined;
    let planRawPrice: number | undefined;
    if (body.planId !== undefined && body.planId) {
      const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, body.planId as number));
      if (plan) { planName = plan.name; planRawPrice = plan.price; }
    }

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
    if (planName) {
      updateData.planName = planName;
      if (updateData.planPrice === undefined) updateData.planPrice = planRawPrice;
    }

    const newAp = Number(updateData.amountPaid ?? existing.amountPaid ?? 0);
    const newDisc = Number(updateData.discount ?? existing.discount ?? 0);
    if (newAp < 0 || newDisc < 0) return { kind: "invalid_amount" as const };
    const pp = Number(updateData.planPrice ?? existing.planPrice ?? 0);
    updateData.balance = pp - newDisc - newAp;

    const [member] = await tx.update(membersTable).set(updateData).where(eq(membersTable.id, id)).returning();
    if (!member) throw new Error("Unable to update member");

    const currency = String(updateData.currency ?? existing.currency ?? "USD");
    const effectivePlanId = (updateData.planId ?? existing.planId) as number | undefined;
    const effectivePlanName = planName ?? existing.planName ?? "";
    const amountChanged = body.amountPaid !== undefined || body.discount !== undefined || body.currency !== undefined;
    const amountActuallyChanged =
      newAp !== Number(existing.amountPaid ?? 0) ||
      newDisc !== Number(existing.discount ?? 0) ||
      currency !== (existing.currency ?? "USD");

    let hadExistingPayment = false;
    if (amountChanged) {
      const [existingPayment] = await tx
        .select()
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.memberId, id),
          eq(paymentsTable.type, "membership"),
          eq(paymentsTable.status, "completed"),
        ))
        .orderBy(desc(paymentsTable.createdAt))
        .limit(1)
        .for("update");

      const rate = await getExchangeRate(tx);
      const { amountUsd: pUsd, amountCdf: pCdf } = toUsdCdf(newAp, currency, rate);
      if (existingPayment) {
        hadExistingPayment = true;
        const oldAmount = existingPayment.amount ?? 0;
        const oldRate = existingPayment.exchangeRate ?? rate;
        const ledgerChanged =
          oldAmount !== newAp ||
          existingPayment.currency !== currency ||
          Math.abs(oldRate - rate) > 0.0001;

        await tx.update(paymentsTable)
          .set({ amount: newAp, discount: newDisc, currency, planName: effectivePlanName, exchangeRate: rate, amountUsd: pUsd, amountCdf: pCdf })
          .where(eq(paymentsTable.id, existingPayment.id));

        if (ledgerChanged) {
          if (oldAmount > 0) {
            await appendLedgerEntry({
              sourceType: "payment_correction",
              sourceId: existingPayment.id,
              direction: "out",
              amount: oldAmount,
              currency: existingPayment.currency,
              exchangeRate: oldRate,
              description: `Correction: membership payment reversed — ${member.name}`,
            }, tx);
          }
          if (newAp > 0) {
            await appendLedgerEntry({
              sourceType: "payment_correction",
              sourceId: existingPayment.id,
              direction: "in",
              amount: newAp,
              currency,
              exchangeRate: rate,
              description: `Correction: membership payment updated — ${member.name}`,
            }, tx);
          }
        }
      } else if (effectivePlanId) {
        const paymentNumber = await getNextNumber("PAY", tx);
        const effectiveDate = body.startDate ? new Date(body.startDate as string) : (existing.startDate ?? new Date());
        const [newPayment] = await tx.insert(paymentsTable).values({
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
        if (!newPayment) throw new Error("Unable to create membership payment");
        if (newAp > 0) {
          await appendLedgerEntry({
            sourceType: "payment",
            sourceNumber: paymentNumber,
            sourceId: newPayment.id,
            direction: "in",
            amount: newAp,
            currency,
            exchangeRate: rate,
            description: `Membership payment — ${effectivePlanName} (${member.name})`,
            entryDate: effectiveDate,
          }, tx);
        }
      }
    }

    if (cashAccountId && newAp > 0 && amountChanged) {
      const rate = await getExchangeRate(tx);
      const { amountUsd: vUsd, amountCdf: vCdf } = toUsdCdf(newAp, currency, rate);
      const voucherEffectiveDate = body.startDate ? new Date(body.startDate as string) : (existing.startDate ?? new Date());

      let accountName = "cash";
      const [acct] = await tx.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, cashAccountId));
      if (acct) accountName = acct.name.toLowerCase().replace(/ /g, "_");

      const [existingVoucher] = await tx.select()
        .from(vouchersTable)
        .where(and(
          eq(vouchersTable.linkedEntity, "member"),
          eq(vouchersTable.linkedEntityId, id),
          eq(vouchersTable.voucherType, "cash_receipt"),
          eq(vouchersTable.status, "recorded"),
          isNull(vouchersTable.deletedAt),
        ))
        .orderBy(desc(vouchersTable.id))
        .limit(1)
        .for("update");

      if (existingVoucher) {
        await tx.update(vouchersTable)
          .set({
            amount: newAp,
            currency,
            exchangeRate: rate,
            amountUsd: vUsd,
            amountCdf: vCdf,
            account: accountName,
            description: `Membership payment — ${effectivePlanName}`,
            voucherDate: voucherEffectiveDate,
          })
          .where(eq(vouchersTable.id, existingVoucher.id));
      } else if (amountActuallyChanged && !hadExistingPayment) {
        await tx.update(vouchersTable)
          .set({ status: "cancelled" })
          .where(and(
            eq(vouchersTable.linkedEntity, "member"),
            eq(vouchersTable.linkedEntityId, id),
            eq(vouchersTable.voucherType, "cash_receipt"),
            isNull(vouchersTable.deletedAt),
          ));
        const voucherNumber = await getNextNumber("VCH", tx);
        await tx.insert(vouchersTable).values({
          voucherNumber,
          voucherType: "cash_receipt",
          direction: "in",
          receivedFrom: member.name,
          linkedEntity: "member",
          linkedEntityId: id,
          linkedEntityName: member.name,
          amount: newAp,
          currency,
          exchangeRate: rate,
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

    return { kind: "ok" as const, member, existing };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (result.kind === "invalid_amount") { res.status(400).json({ error: "Amount paid and discount cannot be negative" }); return; }

  await logActivity(req, "update_member", "member", id, { name: result.member.name });
  res.json(result.member);

  const phoneChanged = body.phone !== undefined && body.phone !== result.existing.phone;
  const needsLookup = phoneChanged || (result.member.phone && !result.member.waChatId);
  if (needsLookup && result.member.phone) {
    db.query.settingsTable.findFirst().then(async (settings) => {
      if (!settings?.greenApiInstanceId || !settings?.greenApiToken) return;
      const chatId = await lookupPhoneOnWhatsApp(result.member.phone!, settings.greenApiInstanceId, settings.greenApiToken);
      if (chatId) {
        await db.update(membersTable).set({ waChatId: chatId }).where(eq(membersTable.id, id));
        logger.info({ memberId: id, chatId }, "WhatsApp chatId resolved/updated for member");
      }
    }).catch((err) => logger.error({ err, memberId: id }, "WhatsApp chatId re-lookup failed"));
  }
});

// ─── Archive ─────────────────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const member = await withTransaction(async (tx) => {
    const [updated] = await tx.update(membersTable)
      .set({ status: "archived", deletedAt: new Date() })
      .where(eq(membersTable.id, id)).returning();
    if (!updated) return null;
    await tx.update(vouchersTable)
      .set({ status: "cancelled", deletedAt: new Date() })
      .where(and(eq(vouchersTable.linkedEntity, "member"), eq(vouchersTable.linkedEntityId, id), eq(vouchersTable.status, "recorded"), isNull(vouchersTable.deletedAt)));
    return updated;
  });
  if (!member) { res.status(404).json({ error: "Not found" }); return; }
  await logActivity(req, "archive_member", "member", id, { name: member.name });
  res.json({ ok: true });
});

// ─── Check-in ────────────────────────────────────────────────────────────────
router.post("/:id/checkin", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const force = !!(req.body as { force?: boolean }).force;
  const todayStart = lubumbashiTodayStart();
  const todayEnd = lubumbashiTodayEnd();

  const result = await withTransaction(async (tx) => {
    const [member] = await tx.select().from(membersTable)
      .where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt)))
      .for("update");
    if (!member) return { kind: "not_found" as const };

    const existing = await tx.select().from(checkInsTable).where(
      and(eq(checkInsTable.memberId, id), between(checkInsTable.checkedInAt, todayStart, todayEnd))
    );
    if (existing.length > 0 && !force) {
      return { kind: "duplicate" as const };
    }

    const now = new Date();
    const [checkIn] = await tx.insert(checkInsTable)
      .values({ memberId: id, memberName: member.name, checkedInAt: now })
      .returning();
    if (!checkIn) throw new Error("Unable to create check-in");
    await tx.update(membersTable).set({ lastCheckIn: now }).where(eq(membersTable.id, id));
    return { kind: "ok" as const, member, checkIn };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (result.kind === "duplicate") {
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

// ─── Renew ───────────────────────────────────────────────────────────────────
router.post("/:id/renew", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as { planId: number; startDate: string; expiryDate: string; amountPaid: number; discount: number; currency: string; cashAccountId?: number; notes?: string };

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

  const result = await withTransaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, id))
      .for("update");
    if (!existing) return { kind: "not_found" as const };

    const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, body.planId));
    if (!plan) return { kind: "plan_not_found" as const };

    const renewRate = await getExchangeRate(tx);
    const sameDayStart = new Date(body.startDate);
    sameDayStart.setHours(0, 0, 0, 0);
    const sameDayEnd = new Date(body.startDate);
    sameDayEnd.setHours(23, 59, 59, 999);

    const sameDayPayments = await tx
      .select()
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.memberId, id),
        eq(paymentsTable.category, "membership"),
        gte(paymentsTable.paymentDate, sameDayStart),
        lte(paymentsTable.paymentDate, sameDayEnd),
        eq(paymentsTable.status, "completed"),
      ))
      .for("update");

    for (const sp of sameDayPayments) {
      await tx.update(paymentsTable)
        .set({ status: "cancelled" })
        .where(eq(paymentsTable.id, sp.id));
      if ((sp.amount ?? 0) > 0) {
        await appendLedgerEntry({
          sourceType: "payment_correction",
          sourceId: sp.id,
          direction: "out",
          amount: sp.amount ?? 0,
          currency: sp.currency,
          exchangeRate: sp.exchangeRate ?? renewRate,
          description: `Reversal: plan changed same-day — ${existing.name}`,
        }, tx);
      }
    }

    const balance = plan.price - (body.discount ?? 0) - (body.amountPaid ?? 0);
    const [member] = await tx.update(membersTable).set({
      planId: body.planId,
      planName: plan.name,
      planPrice: plan.price,
      startDate: new Date(body.startDate),
      expiryDate: new Date(body.expiryDate),
      amountPaid: body.amountPaid,
      discount: body.discount ?? 0,
      balance,
      currency: body.currency,
      status: "active",
      ...(body.cashAccountId ? { cashAccountId: body.cashAccountId } : {}),
    }).where(eq(membersTable.id, id)).returning();
    if (!member) throw new Error("Unable to renew member");

    const { amountUsd: renewUsd, amountCdf: renewCdf } = toUsdCdf(body.amountPaid, body.currency, renewRate);
    const paymentNumber = await getNextNumber("PAY", tx);
    const [renewPayment] = await tx.insert(paymentsTable).values({
      paymentNumber,
      memberId: id,
      memberName: existing.name,
      planId: body.planId,
      planName: plan.name,
      amount: body.amountPaid,
      discount: body.discount ?? 0,
      currency: body.currency,
      exchangeRate: renewRate,
      amountUsd: renewUsd,
      amountCdf: renewCdf,
      type: "renewal",
      category: "membership",
      direction: "in",
      notes: body.notes ? body.notes : `Renewal: ${body.startDate} → ${body.expiryDate}`,
      paymentDate: new Date(body.startDate),
      status: "completed",
    }).returning();
    if (!renewPayment) throw new Error("Unable to create renewal payment");

    if (body.amountPaid > 0) {
      await appendLedgerEntry({
        sourceType: "payment",
        sourceNumber: paymentNumber,
        sourceId: renewPayment.id,
        direction: "in",
        amount: body.amountPaid,
        currency: body.currency,
        exchangeRate: renewRate,
        description: `Renewal — ${plan.name} (${existing.name})`,
        entryDate: new Date(body.startDate),
      }, tx);
    }

    if ((body.amountPaid ?? 0) > 0 && member.coachId && (member.commissionAmount ?? 0) > 0) {
      await tx.insert(commissionsTable).values({
        staffEmployeeId: member.coachId,
        memberId: member.id,
        memberName: member.name,
        amount: member.commissionAmount!,
        currency: member.currency,
        status: "pending",
        note: `Commission — ${member.name} (renewal: ${plan.name})`,
      });
    }

    return { kind: "ok" as const, member, existing, plan, balance };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (result.kind === "plan_not_found") { res.status(400).json({ error: "Plan not found" }); return; }

  await logActivity(req, "renew_member", "member", id, { name: result.existing.name, plan: result.plan.name });
  res.json(result.member);

  db.query.settingsTable.findFirst().then(async (settings) => {
    if (settings?.greenApiInstanceId && settings?.greenApiToken) {
      const message = formatMemberInfoMessage({
        name: result.member.name ?? "",
        phone: result.member.phone,
        planName: result.member.planName,
        amountPaid: result.member.amountPaid,
        currency: result.member.currency,
        expiryDate: result.member.expiryDate,
        balance: result.balance,
      });
      await sendToAllChats(settings.greenApiInstanceId, settings.greenApiToken, message).catch(() => {});
    }
  }).catch((err) => logger.error({ err }, "WhatsApp renewal notification failed"));
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
    status: newStatus,
    expiryDate: newExpiry,
    frozenAt: null,
    frozenUntil: null,
    frozenDays: 0,
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
    id: p.id,
    paymentNumber: p.paymentNumber,
    type: p.type,
    amount: p.amount,
    discount: p.discount ?? 0,
    currency: p.currency,
    planName: p.planName,
    notes: p.notes,
    createdAt: p.createdAt,
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
    id: c.id,
    memberId: c.memberId,
    memberName: c.memberName,
    memberNumber: member?.memberNumber ?? null,
    checkedInAt: c.checkedInAt,
    note: null,
  })));
});

export default router;
