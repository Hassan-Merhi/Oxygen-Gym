import { db } from "@workspace/db";
import {
  chartOfAccountsTable,
  checkInsTable,
  commissionsTable,
  membersTable,
  paymentsTable,
  plansTable,
} from "@workspace/db/schema";
import { and, between, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { ACCOUNTS, getBooksLockedThrough, newJournalId, postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { getNextNumber } from "../../lib/numbering";
import { businessDateKey, lubumbashiTodayEnd, lubumbashiTodayStart } from "../../lib/timezone";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { fxRate, money } from "../../shared/accounting/decimal";
import { withTransaction, type DatabaseTransaction } from "../../shared/db/transaction";
import { badRequest, notFound } from "../../shared/http/errors";
import { calculateMemberBalance, planPriceInCurrency } from "./pricing";

export interface CreateMemberInput {
  name: string;
  phone?: string;
  planId?: number;
  startDate?: Date;
  expiryDate?: Date;
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
}

export interface UpdateMemberInput {
  name?: string;
  phone?: string | null;
  planId?: number | null;
  startDate?: Date | null;
  expiryDate?: Date | null;
  status?: string;
  amountPaid?: number;
  discount?: number;
  currency?: string;
  photoUrl?: string | null;
  fingerprintId?: string | null;
  qrCodeId?: string | null;
  notes?: string | null;
  coachId?: number | null;
  commissionAmount?: number;
  cashAccountId?: number | null;
  planPrice?: number;
}

export interface RenewMemberInput {
  planId: number;
  startDate: Date;
  expiryDate: Date;
  amountPaid: number;
  discount: number;
  currency: string;
  cashAccountId?: number;
  notes?: string;
}

function normalizeCurrency(value: string): "USD" | "CDF" {
  const currency = value.toUpperCase();
  if (currency !== "USD" && currency !== "CDF") throw badRequest("currency must be USD or CDF");
  return currency;
}

async function cashAccountName(tx: DatabaseTransaction, accountId?: number | null): Promise<string> {
  if (!accountId) return ACCOUNTS.CASH;
  const [account] = await tx.select({ name: chartOfAccountsTable.name })
    .from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.id, accountId));
  return account?.name ?? ACCOUNTS.CASH;
}

/**
 * When the money for a membership was received: the start date when that is in
 * the past (a backdated registration), otherwise now. A plan that starts next
 * month is still cash in the drawer today. A start date inside a closed period
 * is received now, since closed books cannot change.
 */
async function receiptDate(tx: DatabaseTransaction, startDate?: Date | null): Promise<Date> {
  const now = new Date();
  if (!startDate || startDate.getTime() >= now.getTime()) return now;
  const lockedThrough = await getBooksLockedThrough(tx);
  if (lockedThrough && startDate.getTime() <= lockedThrough.getTime()) return now;
  return startDate;
}

async function postMembershipAccounting(params: {
  tx: DatabaseTransaction;
  journalId?: string;
  paymentId: number;
  paymentNumber?: string | null;
  memberName: string;
  planName?: string | null;
  amount: number;
  currency: string;
  rate: number;
  account?: string;
  entryDate?: Date;
  sourceType?: string;
}): Promise<void> {
  const amount = money(params.amount);
  if (amount <= 0) return;
  const rate = fxRate(params.rate);
  const { amountUsd, amountCdf } = toUsdCdf(amount, params.currency, rate);
  await postDoubleEntry({
    journalId: params.journalId,
    entryDate: params.entryDate,
    sourceType: params.sourceType ?? "payment",
    sourceId: params.paymentId,
    sourceNumber: params.paymentNumber ?? undefined,
    debitName: params.account ?? ACCOUNTS.CASH,
    debitType: "asset",
    creditName: ACCOUNTS.MEMBERSHIP_REVENUE,
    creditType: "income",
    amount,
    amountUsd,
    amountCdf,
    currency: params.currency,
    exchangeRate: rate,
    description: `Membership — ${params.planName ?? ""} (${params.memberName})`,
  }, params.tx);
}

export async function createMember(input: CreateMemberInput) {
  if (input.startDate && input.expiryDate && input.expiryDate <= input.startDate) throw badRequest("Expiry date must be after start date");
  if ((input.amountPaid ?? 0) < 0) throw badRequest("Amount paid cannot be negative");
  if ((input.discount ?? 0) < 0) throw badRequest("Discount cannot be negative");
  if ((input.commissionAmount ?? 0) < 0) throw badRequest("Commission amount cannot be negative");

  return withTransaction(async (tx) => {
    const rate = fxRate(await getExchangeRate(tx));
    const memberNumber = await getNextNumber("MEM", tx);
    const paymentNumber = input.planId ? await getNextNumber("PAY", tx) : undefined;
    const currency = normalizeCurrency(input.currency ?? "USD");
    let planName: string | undefined;
    let planPrice: number | undefined;

    if (input.planId) {
      const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, input.planId));
      if (!plan) throw badRequest("Plan not found");
      planName = plan.name;
      planPrice = planPriceInCurrency(plan, currency, rate);
    }

    const amountPaid = money(input.amountPaid ?? 0);
    const discount = money(input.discount ?? 0);
    const balance = calculateMemberBalance(planPrice ?? 0, amountPaid, discount);
    const commissionAmount = money(input.commissionAmount ?? 0);

    const [member] = await tx.insert(membersTable).values({
      memberNumber,
      name: input.name,
      phone: input.phone,
      joinDate: new Date(),
      planId: input.planId,
      planName,
      planPrice,
      startDate: input.startDate,
      expiryDate: input.expiryDate,
      status: input.status ?? "active",
      amountPaid,
      discount,
      balance,
      currency,
      cashAccountId: input.cashAccountId ?? null,
      photoUrl: input.photoUrl,
      fingerprintId: input.fingerprintId,
      qrCodeId: input.qrCodeId,
      notes: input.notes,
      coachId: input.coachId ?? null,
      commissionAmount,
    }).returning();

    let membershipPaymentId: number | null = null;
    if (input.planId && paymentNumber && (amountPaid > 0 || (planPrice ?? 0) > 0)) {
      const converted = toUsdCdf(amountPaid, currency, rate);
      const account = await cashAccountName(tx, input.cashAccountId);
      const paymentDate = await receiptDate(tx, input.startDate);
      const [payment] = await tx.insert(paymentsTable).values({
        paymentNumber,
        memberId: member.id,
        memberName: member.name,
        planId: input.planId,
        planName: planName ?? "",
        amount: amountPaid,
        discount,
        currency,
        exchangeRate: rate,
        ...converted,
        type: "membership",
        category: "membership",
        direction: "in",
        account,
        notes: input.notes,
        paymentDate,
        status: "completed",
      }).returning();

      membershipPaymentId = payment!.id;
      if (amountPaid > 0) {
        await postMembershipAccounting({
          tx,
          paymentId: payment.id,
          paymentNumber,
          memberName: member.name,
          planName,
          amount: amountPaid,
          currency,
          rate,
          account,
          entryDate: paymentDate,
        });
      }
    }

    if (amountPaid > 0 && member.coachId && money(member.commissionAmount ?? 0) > 0) {
      await tx.insert(commissionsTable).values({
        staffEmployeeId: member.coachId,
        memberId: member.id,
        memberName: member.name,
        amount: money(member.commissionAmount ?? 0),
        currency: member.currency,
        status: "pending",
        paymentId: membershipPaymentId,
        note: `Commission — ${member.name} (membership payment)`,
      });
    }

    return member;
  });
}

export async function updateMember(id: number, input: UpdateMemberInput) {
  if ((input.amountPaid ?? 0) < 0) throw badRequest("Amount paid cannot be negative");
  if ((input.discount ?? 0) < 0) throw badRequest("Discount cannot be negative");
  if ((input.commissionAmount ?? 0) < 0) throw badRequest("Commission amount cannot be negative");
  if (input.startDate && input.expiryDate && input.expiryDate <= input.startDate) throw badRequest("Expiry date must be after start date");

  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(membersTable).where(eq(membersTable.id, id)).for("update");
    if (!existing) throw notFound("Member not found");

    const currentRate = fxRate(await getExchangeRate(tx));
    const currency = normalizeCurrency(input.currency ?? existing.currency ?? "USD");
    let planName = existing.planName ?? undefined;
    let planPrice = money(input.planPrice ?? existing.planPrice ?? 0);

    if (input.planId !== undefined && input.planId !== null) {
      const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, input.planId));
      if (!plan) throw badRequest("Plan not found");
      planName = plan.name;
      if (input.planPrice === undefined) planPrice = planPriceInCurrency(plan, currency, currentRate);
    } else if (input.currency && input.currency !== existing.currency && existing.planId && input.planPrice === undefined) {
      const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, existing.planId));
      if (plan) planPrice = planPriceInCurrency(plan, currency, currentRate);
    }

    const amountPaid = money(input.amountPaid ?? existing.amountPaid ?? 0);
    const discount = money(input.discount ?? existing.discount ?? 0);
    const commissionAmount = money(input.commissionAmount ?? existing.commissionAmount ?? 0);
    const updateData: Partial<typeof membersTable.$inferInsert> = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.planId !== undefined && { planId: input.planId }),
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.expiryDate !== undefined && { expiryDate: input.expiryDate }),
      ...(input.status !== undefined && { status: input.status }),
      amountPaid,
      discount,
      currency,
      ...(input.photoUrl !== undefined && { photoUrl: input.photoUrl }),
      ...(input.fingerprintId !== undefined && { fingerprintId: input.fingerprintId }),
      ...(input.qrCodeId !== undefined && { qrCodeId: input.qrCodeId }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.coachId !== undefined && { coachId: input.coachId }),
      commissionAmount,
      ...(input.cashAccountId !== undefined && { cashAccountId: input.cashAccountId }),
      planName,
      planPrice,
      balance: calculateMemberBalance(planPrice, amountPaid, discount),
    };

    const [member] = await tx.update(membersTable).set(updateData).where(eq(membersTable.id, id)).returning();

    const amountFieldsPresent = input.amountPaid !== undefined || input.discount !== undefined || input.currency !== undefined;
    const amountActuallyChanged = amountPaid !== money(existing.amountPaid ?? 0)
      || discount !== money(existing.discount ?? 0)
      || currency !== (existing.currency ?? "USD").toUpperCase();

    if (amountFieldsPresent) {
      const [existingPayment] = await tx.select().from(paymentsTable)
        .where(and(
          eq(paymentsTable.memberId, id),
          eq(paymentsTable.category, "membership"),
          eq(paymentsTable.status, "completed"),
        ))
        .orderBy(desc(paymentsTable.createdAt))
        .limit(1)
        .for("update");
      const account = await cashAccountName(tx, input.cashAccountId ?? member.cashAccountId);
      const effectivePlanId = member.planId ?? undefined;
      const effectivePlanName = member.planName ?? "";

      if (existingPayment) {
        const paymentRate = fxRate(Number(existingPayment.exchangeRate ?? currentRate));
        const oldAmount = money(existingPayment.amount ?? 0);
        const converted = toUsdCdf(amountPaid, currency, paymentRate);
        await tx.update(paymentsTable).set({
          amount: amountPaid,
          discount,
          currency,
          planName: effectivePlanName,
          exchangeRate: paymentRate,
          account,
          ...converted,
        }).where(eq(paymentsTable.id, existingPayment.id));

        if (amountActuallyChanged) {
          // Restate the original receipt when its day is still open; otherwise correct today.
          const correctionDate = await receiptDate(tx, existingPayment.paymentDate);
          const journalId = newJournalId();
          await reverseEntries("payment", existingPayment.id, "payment_correction", member.name, tx, {
            journalId,
            entryDate: correctionDate,
            description: `Correction: membership payment reversed — ${member.name}`,
          });
          await postMembershipAccounting({
            tx,
            journalId,
            entryDate: correctionDate,
            paymentId: existingPayment.id,
            paymentNumber: existingPayment.paymentNumber,
            memberName: member.name,
            planName: effectivePlanName,
            amount: amountPaid,
            currency,
            rate: paymentRate,
            account,
            sourceType: "payment_correction",
          });
        }
      } else if (effectivePlanId) {
        const paymentRate = currentRate;
        const paymentNumber = await getNextNumber("PAY", tx);
        const effectiveDate = await receiptDate(tx, input.startDate ?? existing.startDate);
        const converted = toUsdCdf(amountPaid, currency, paymentRate);
        const [payment] = await tx.insert(paymentsTable).values({
          paymentNumber,
          memberId: id,
          memberName: member.name,
          planId: effectivePlanId,
          planName: effectivePlanName,
          amount: amountPaid,
          discount,
          currency,
          exchangeRate: paymentRate,
          account,
          ...converted,
          type: "membership",
          category: "membership",
          direction: "in",
          paymentDate: effectiveDate,
          status: "completed",
        }).returning();
        if (amountPaid > 0) {
          await postMembershipAccounting({
            tx,
            paymentId: payment.id,
            paymentNumber,
            memberName: member.name,
            planName: effectivePlanName,
            amount: amountPaid,
            currency,
            rate: paymentRate,
            account,
            entryDate: effectiveDate,
          });
        }
      }
    }

    return { member, previousPhone: existing.phone };
  });
}

/**
 * Archive a member. Their receipts stay in the books: archiving someone does
 * not mean the money they paid was never received.
 */
export async function archiveMember(id: number) {
  return withTransaction(async (tx) => {
    const [member] = await tx.update(membersTable)
      .set({ status: "archived", deletedAt: new Date() })
      .where(eq(membersTable.id, id))
      .returning();
    if (!member) throw notFound("Member not found");
    return member;
  });
}

export async function checkInMember(id: number, force = false) {
  return withTransaction(async (tx) => {
    const [member] = await tx.select().from(membersTable).where(and(
      eq(membersTable.id, id),
      isNull(membersTable.deletedAt),
    ));
    if (!member) throw notFound("Member not found");

    const existing = await tx.select({ id: checkInsTable.id }).from(checkInsTable).where(and(
      eq(checkInsTable.memberId, id),
      between(checkInsTable.checkedInAt, lubumbashiTodayStart(), lubumbashiTodayEnd()),
    ));
    if (existing.length > 0 && !force) return { member, alreadyCheckedIn: true, checkIn: null };

    const now = new Date();
    const [checkIn] = await tx.insert(checkInsTable).values({
      memberId: id,
      memberName: member.name,
      checkedInAt: now,
    }).returning();
    await tx.update(membersTable).set({ lastCheckIn: now }).where(eq(membersTable.id, id));
    return { member, alreadyCheckedIn: false, checkIn };
  });
}

export async function renewMember(id: number, input: RenewMemberInput) {
  if (input.expiryDate <= input.startDate) throw badRequest("Expiry date must be after start date");
  if (input.amountPaid < 0) throw badRequest("Amount paid cannot be negative");
  if (input.discount < 0) throw badRequest("Discount cannot be negative");

  return withTransaction(async (tx) => {
    const rate = fxRate(await getExchangeRate(tx));
    const paymentNumber = await getNextNumber("PAY", tx);
    const [existing] = await tx.select().from(membersTable).where(eq(membersTable.id, id)).for("update");
    if (!existing) throw notFound("Member not found");
    const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, input.planId));
    if (!plan) throw badRequest("Plan not found");

    const currency = normalizeCurrency(input.currency);
    const amountPaid = money(input.amountPaid);
    const discount = money(input.discount);
    const paymentDate = await receiptDate(tx, input.startDate);
    // A renewal entered twice the same business day (for example to change the
    // plan) replaces the earlier one. Older renewals are real receipts and stay.
    const todayKey = businessDateKey(new Date());
    const sameDayRenewals = (await tx.select().from(paymentsTable).where(and(
      eq(paymentsTable.memberId, id),
      eq(paymentsTable.category, "membership"),
      eq(paymentsTable.type, "renewal"),
      eq(paymentsTable.status, "completed"),
      gte(paymentsTable.createdAt, lubumbashiTodayStart()),
      lte(paymentsTable.createdAt, lubumbashiTodayEnd()),
    )).for("update")).filter((payment) => businessDateKey(payment.paymentDate) === businessDateKey(paymentDate)
      && businessDateKey(payment.createdAt) === todayKey);

    for (const payment of sameDayRenewals) {
      await tx.update(paymentsTable).set({ status: "cancelled" }).where(eq(paymentsTable.id, payment.id));
      await tx.update(commissionsTable)
        .set({ status: "cancelled" })
        .where(and(eq(commissionsTable.paymentId, payment.id), eq(commissionsTable.status, "pending")));
      if (money(payment.amount ?? 0) > 0) {
        await reverseEntries("payment", payment.id, "payment_correction", existing.name, tx, {
          entryDate: payment.paymentDate,
          description: `Reversal: renewal replaced the same day — ${existing.name}`,
        });
      }
    }

    const planPrice = planPriceInCurrency(plan, currency, rate);
    const balance = calculateMemberBalance(planPrice, amountPaid, discount);
    const [member] = await tx.update(membersTable).set({
      planId: input.planId,
      planName: plan.name,
      planPrice,
      startDate: input.startDate,
      expiryDate: input.expiryDate,
      amountPaid,
      discount,
      balance,
      currency,
      status: "active",
      ...(input.cashAccountId !== undefined && { cashAccountId: input.cashAccountId }),
    }).where(eq(membersTable.id, id)).returning();

    const converted = toUsdCdf(amountPaid, currency, rate);
    const account = await cashAccountName(tx, input.cashAccountId ?? member.cashAccountId);
    const [payment] = await tx.insert(paymentsTable).values({
      paymentNumber,
      memberId: id,
      memberName: existing.name,
      planId: input.planId,
      planName: plan.name,
      amount: amountPaid,
      discount,
      currency,
      exchangeRate: rate,
      account,
      ...converted,
      type: "renewal",
      category: "membership",
      direction: "in",
      notes: input.notes ?? `Renewal: ${input.startDate.toISOString()} → ${input.expiryDate.toISOString()}`,
      paymentDate,
      status: "completed",
    }).returning();

    if (amountPaid > 0) {
      await postMembershipAccounting({
        tx,
        paymentId: payment.id,
        paymentNumber,
        memberName: existing.name,
        planName: plan.name,
        amount: amountPaid,
        currency,
        rate,
        account,
        entryDate: paymentDate,
      });
    }

    if (amountPaid > 0 && member.coachId && money(member.commissionAmount ?? 0) > 0) {
      await tx.insert(commissionsTable).values({
        staffEmployeeId: member.coachId,
        memberId: member.id,
        memberName: member.name,
        amount: money(member.commissionAmount ?? 0),
        currency: member.currency,
        status: "pending",
        paymentId: payment!.id,
        note: `Commission — ${member.name} (renewal: ${plan.name})`,
      });
    }

    return member;
  });
}

export async function freezeMember(id: number, frozenAt: Date, frozenUntil: Date) {
  if (frozenUntil <= frozenAt) throw badRequest("Frozen until date must be after frozen date");
  const frozenDays = Math.max(1, Math.ceil((frozenUntil.getTime() - frozenAt.getTime()) / 86_400_000));
  const [member] = await db.update(membersTable).set({
    frozenAt,
    frozenUntil,
    frozenDays,
    status: "frozen",
  }).where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt))).returning();
  if (!member) throw notFound("Member not found");
  return member;
}

export async function reactivateMember(id: number) {
  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(membersTable).where(and(
      eq(membersTable.id, id),
      isNull(membersTable.deletedAt),
    ));
    if (!existing) throw notFound("Member not found");

    const newExpiry = existing.expiryDate ? new Date(existing.expiryDate) : new Date();
    if ((existing.frozenDays ?? 0) > 0) newExpiry.setDate(newExpiry.getDate() + (existing.frozenDays ?? 0));
    const status = newExpiry >= new Date() ? "active" : "expired";
    const [member] = await tx.update(membersTable).set({
      status,
      expiryDate: newExpiry,
      frozenAt: null,
      frozenUntil: null,
      frozenDays: 0,
    }).where(eq(membersTable.id, id)).returning();
    return member;
  });
}

export async function setMemberStatus(id: number, status: string) {
  if (!["active", "inactive", "archived"].includes(status)) throw badRequest("Invalid status");
  const [member] = await db.update(membersTable).set({ status })
    .where(and(eq(membersTable.id, id), isNull(membersTable.deletedAt)))
    .returning();
  if (!member) throw notFound("Member not found");
  return member;
}
