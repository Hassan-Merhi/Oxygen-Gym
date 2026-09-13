import { db } from "@workspace/db";
import {
  chartOfAccountsTable,
  checkInsTable,
  commissionsTable,
  membersTable,
  paymentsTable,
  plansTable,
  vouchersTable,
} from "@workspace/db/schema";
import { and, between, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { getNextNumber } from "../../lib/numbering";
import { postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { lubumbashiTodayEnd, lubumbashiTodayStart } from "../../lib/timezone";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
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

async function cashAccountName(tx: DatabaseTransaction, accountId?: number | null): Promise<string> {
  if (!accountId) return "cash";
  const [account] = await tx.select({ name: chartOfAccountsTable.name })
    .from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.id, accountId));
  return account?.name.toLowerCase().replace(/ /g, "_") ?? "cash";
}

async function postMembershipAccounting(params: {
  tx: DatabaseTransaction;
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
  if (params.amount <= 0) return;
  const { amountUsd, amountCdf } = toUsdCdf(params.amount, params.currency, params.rate);
  await postDoubleEntry({
    entryDate: params.entryDate,
    sourceType: params.sourceType ?? "payment",
    sourceId: params.paymentId,
    sourceNumber: params.paymentNumber ?? undefined,
    debitName: params.account ?? "cash",
    debitType: "asset",
    creditName: "Membership Revenue",
    creditType: "income",
    amount: params.amount,
    amountUsd,
    amountCdf,
    currency: params.currency,
    exchangeRate: params.rate,
    description: `Membership — ${params.planName ?? ""} (${params.memberName})`,
  }, params.tx);
}

export async function createMember(input: CreateMemberInput) {
  if (input.startDate && input.expiryDate && input.expiryDate <= input.startDate) throw badRequest("Expiry date must be after start date");
  if ((input.amountPaid ?? 0) < 0) throw badRequest("Amount paid cannot be negative");
  if ((input.discount ?? 0) < 0) throw badRequest("Discount cannot be negative");
  if ((input.commissionAmount ?? 0) < 0) throw badRequest("Commission amount cannot be negative");

  const memberNumber = await getNextNumber("MEM");
  const rate = await getExchangeRate();
  const paymentNumber = input.planId ? await getNextNumber("PAY") : undefined;

  return withTransaction(async (tx) => {
    const currency = input.currency ?? "USD";
    let planName: string | undefined;
    let planPrice: number | undefined;

    if (input.planId) {
      const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, input.planId));
      if (!plan) throw badRequest("Plan not found");
      planName = plan.name;
      planPrice = planPriceInCurrency(plan, currency, rate);
    }

    const amountPaid = input.amountPaid ?? 0;
    const discount = input.discount ?? 0;
    const balance = calculateMemberBalance(planPrice ?? 0, amountPaid, discount);

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
      commissionAmount: input.commissionAmount ?? 0,
    }).returning();

    if (input.planId && paymentNumber && (amountPaid > 0 || (planPrice ?? 0) > 0)) {
      const converted = toUsdCdf(amountPaid, currency, rate);
      const account = await cashAccountName(tx, input.cashAccountId);
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
        paymentDate: input.startDate ?? new Date(),
        status: "completed",
      }).returning();

      if (amountPaid > 0) {
        await appendLedgerEntry({
          sourceType: "payment",
          sourceNumber: paymentNumber,
          sourceId: payment.id,
          direction: "in",
          amount: amountPaid,
          currency,
          exchangeRate: rate,
          description: `Membership — ${planName ?? ""} (${member.name})`,
          entryDate: input.startDate ?? new Date(),
        }, tx);
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
          entryDate: input.startDate,
        });
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

    return member;
  });
}

export async function updateMember(id: number, input: UpdateMemberInput) {
  if ((input.amountPaid ?? 0) < 0) throw badRequest("Amount paid cannot be negative");
  if ((input.discount ?? 0) < 0) throw badRequest("Discount cannot be negative");
  if ((input.commissionAmount ?? 0) < 0) throw badRequest("Commission amount cannot be negative");
  if (input.startDate && input.expiryDate && input.expiryDate <= input.startDate) throw badRequest("Expiry date must be after start date");

  const rate = await getExchangeRate();

  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(membersTable).where(eq(membersTable.id, id));
    if (!existing) throw notFound("Member not found");

    const currency = input.currency ?? existing.currency ?? "USD";
    let planName = existing.planName ?? undefined;
    let planPrice = input.planPrice ?? existing.planPrice ?? 0;

    if (input.planId !== undefined && input.planId !== null) {
      const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, input.planId));
      if (!plan) throw badRequest("Plan not found");
      planName = plan.name;
      if (input.planPrice === undefined) planPrice = planPriceInCurrency(plan, currency, rate);
    } else if (input.currency && input.currency !== existing.currency && existing.planId && input.planPrice === undefined) {
      const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, existing.planId));
      if (plan) planPrice = planPriceInCurrency(plan, currency, rate);
    }

    const amountPaid = input.amountPaid ?? existing.amountPaid ?? 0;
    const discount = input.discount ?? existing.discount ?? 0;
    const updateData: Partial<typeof membersTable.$inferInsert> = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.planId !== undefined && { planId: input.planId }),
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.expiryDate !== undefined && { expiryDate: input.expiryDate }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.amountPaid !== undefined && { amountPaid: input.amountPaid }),
      ...(input.discount !== undefined && { discount: input.discount }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.photoUrl !== undefined && { photoUrl: input.photoUrl }),
      ...(input.fingerprintId !== undefined && { fingerprintId: input.fingerprintId }),
      ...(input.qrCodeId !== undefined && { qrCodeId: input.qrCodeId }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.coachId !== undefined && { coachId: input.coachId }),
      ...(input.commissionAmount !== undefined && { commissionAmount: input.commissionAmount }),
      ...(input.cashAccountId !== undefined && { cashAccountId: input.cashAccountId }),
      planName,
      planPrice,
      balance: calculateMemberBalance(planPrice, amountPaid, discount),
    };

    const [member] = await tx.update(membersTable).set(updateData).where(eq(membersTable.id, id)).returning();

    const amountFieldsPresent = input.amountPaid !== undefined || input.discount !== undefined || input.currency !== undefined;
    const amountActuallyChanged = amountPaid !== Number(existing.amountPaid ?? 0)
      || discount !== Number(existing.discount ?? 0)
      || currency !== (existing.currency ?? "USD");

    if (amountFieldsPresent) {
      const [existingPayment] = await tx.select().from(paymentsTable)
        .where(and(eq(paymentsTable.memberId, id), eq(paymentsTable.type, "membership")))
        .orderBy(desc(paymentsTable.createdAt))
        .limit(1);
      const account = await cashAccountName(tx, input.cashAccountId ?? member.cashAccountId);
      const effectivePlanId = member.planId ?? undefined;
      const effectivePlanName = member.planName ?? "";
      const converted = toUsdCdf(amountPaid, currency, rate);

      if (existingPayment) {
        const oldAmount = existingPayment.amount ?? 0;
        await tx.update(paymentsTable).set({
          amount: amountPaid,
          discount,
          currency,
          planName: effectivePlanName,
          exchangeRate: rate,
          account,
          ...converted,
        }).where(eq(paymentsTable.id, existingPayment.id));

        if (amountActuallyChanged) {
          if (oldAmount > 0) {
            await appendLedgerEntry({
              sourceType: "payment_correction",
              sourceId: existingPayment.id,
              direction: "out",
              amount: oldAmount,
              currency: existingPayment.currency,
              exchangeRate: existingPayment.exchangeRate ?? rate,
              description: `Correction: membership payment reversed — ${member.name}`,
            }, tx);
          }
          if (amountPaid > 0) {
            await appendLedgerEntry({
              sourceType: "payment_correction",
              sourceId: existingPayment.id,
              direction: "in",
              amount: amountPaid,
              currency,
              exchangeRate: rate,
              description: `Correction: membership payment updated — ${member.name}`,
            }, tx);
          }
          await reverseEntries("payment", existingPayment.id, "payment_correction", member.name, tx);
          await postMembershipAccounting({
            tx,
            paymentId: existingPayment.id,
            paymentNumber: existingPayment.paymentNumber,
            memberName: member.name,
            planName: effectivePlanName,
            amount: amountPaid,
            currency,
            rate,
            account,
            sourceType: "payment_correction",
          });
        }
      } else if (effectivePlanId) {
        const paymentNumber = await getNextNumber("PAY");
        const effectiveDate = input.startDate ?? existing.startDate ?? new Date();
        const [payment] = await tx.insert(paymentsTable).values({
          paymentNumber,
          memberId: id,
          memberName: member.name,
          planId: effectivePlanId,
          planName: effectivePlanName,
          amount: amountPaid,
          discount,
          currency,
          exchangeRate: rate,
          account,
          ...converted,
          type: "membership",
          category: "membership",
          direction: "in",
          paymentDate: effectiveDate,
          status: "completed",
        }).returning();
        if (amountPaid > 0) {
          await appendLedgerEntry({
            sourceType: "payment",
            sourceNumber: paymentNumber,
            sourceId: payment.id,
            direction: "in",
            amount: amountPaid,
            currency,
            exchangeRate: rate,
            description: `Membership payment — ${effectivePlanName} (${member.name})`,
            entryDate: effectiveDate,
          }, tx);
          await postMembershipAccounting({
            tx,
            paymentId: payment.id,
            paymentNumber,
            memberName: member.name,
            planName: effectivePlanName,
            amount: amountPaid,
            currency,
            rate,
            account,
            entryDate: effectiveDate,
          });
        }
      }

      // Legacy member-linked cash receipt vouchers duplicated the payment cash flow.
      // Keep any existing receipt synchronized for audit/display, but never create a
      // second financial record when the payment is already the canonical source.
      const [existingVoucher] = await tx.select().from(vouchersTable).where(and(
        eq(vouchersTable.linkedEntity, "member"),
        eq(vouchersTable.linkedEntityId, id),
        eq(vouchersTable.voucherType, "cash_receipt"),
        eq(vouchersTable.status, "recorded"),
        isNull(vouchersTable.deletedAt),
      )).orderBy(desc(vouchersTable.id)).limit(1);

      if (existingVoucher) {
        const effectiveDate = input.startDate ?? existing.startDate ?? new Date();
        await tx.update(vouchersTable).set({
          amount: amountPaid,
          currency,
          exchangeRate: rate,
          ...converted,
          account,
          description: `Membership payment — ${member.planName ?? ""}`,
          voucherDate: effectiveDate,
        }).where(eq(vouchersTable.id, existingVoucher.id));
      }
    }

    return { member, previousPhone: existing.phone };
  });
}

export async function archiveMember(id: number) {
  return withTransaction(async (tx) => {
    const [member] = await tx.update(membersTable)
      .set({ status: "archived", deletedAt: new Date() })
      .where(eq(membersTable.id, id))
      .returning();
    if (!member) throw notFound("Member not found");

    await tx.update(vouchersTable).set({ status: "cancelled", deletedAt: new Date() }).where(and(
      eq(vouchersTable.linkedEntity, "member"),
      eq(vouchersTable.linkedEntityId, id),
      eq(vouchersTable.status, "recorded"),
      isNull(vouchersTable.deletedAt),
    ));
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

  const rate = await getExchangeRate();
  const paymentNumber = await getNextNumber("PAY");

  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(membersTable).where(eq(membersTable.id, id));
    if (!existing) throw notFound("Member not found");
    const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, input.planId));
    if (!plan) throw badRequest("Plan not found");

    const sameDayStart = new Date(input.startDate);
    sameDayStart.setHours(0, 0, 0, 0);
    const sameDayEnd = new Date(input.startDate);
    sameDayEnd.setHours(23, 59, 59, 999);
    const sameDayPayments = await tx.select().from(paymentsTable).where(and(
      eq(paymentsTable.memberId, id),
      eq(paymentsTable.category, "membership"),
      gte(paymentsTable.paymentDate, sameDayStart),
      lte(paymentsTable.paymentDate, sameDayEnd),
      eq(paymentsTable.status, "completed"),
    ));

    for (const payment of sameDayPayments) {
      await tx.update(paymentsTable).set({ status: "cancelled" }).where(eq(paymentsTable.id, payment.id));
      if ((payment.amount ?? 0) > 0) {
        await appendLedgerEntry({
          sourceType: "payment_correction",
          sourceId: payment.id,
          direction: "out",
          amount: payment.amount ?? 0,
          currency: payment.currency,
          exchangeRate: payment.exchangeRate ?? rate,
          description: `Reversal: plan changed same-day — ${existing.name}`,
        }, tx);
        await reverseEntries("payment", payment.id, "payment_correction", existing.name, tx);
      }
    }

    const planPrice = planPriceInCurrency(plan, input.currency, rate);
    const balance = calculateMemberBalance(planPrice, input.amountPaid, input.discount);
    const [member] = await tx.update(membersTable).set({
      planId: input.planId,
      planName: plan.name,
      planPrice,
      startDate: input.startDate,
      expiryDate: input.expiryDate,
      amountPaid: input.amountPaid,
      discount: input.discount,
      balance,
      currency: input.currency,
      status: "active",
      ...(input.cashAccountId !== undefined && { cashAccountId: input.cashAccountId }),
    }).where(eq(membersTable.id, id)).returning();

    const converted = toUsdCdf(input.amountPaid, input.currency, rate);
    const account = await cashAccountName(tx, input.cashAccountId ?? member.cashAccountId);
    const [payment] = await tx.insert(paymentsTable).values({
      paymentNumber,
      memberId: id,
      memberName: existing.name,
      planId: input.planId,
      planName: plan.name,
      amount: input.amountPaid,
      discount: input.discount,
      currency: input.currency,
      exchangeRate: rate,
      account,
      ...converted,
      type: "renewal",
      category: "membership",
      direction: "in",
      notes: input.notes ?? `Renewal: ${input.startDate.toISOString()} → ${input.expiryDate.toISOString()}`,
      paymentDate: input.startDate,
      status: "completed",
    }).returning();

    if (input.amountPaid > 0) {
      await appendLedgerEntry({
        sourceType: "payment",
        sourceNumber: paymentNumber,
        sourceId: payment.id,
        direction: "in",
        amount: input.amountPaid,
        currency: input.currency,
        exchangeRate: rate,
        description: `Renewal — ${plan.name} (${existing.name})`,
        entryDate: input.startDate,
      }, tx);
      await postMembershipAccounting({
        tx,
        paymentId: payment.id,
        paymentNumber,
        memberName: existing.name,
        planName: plan.name,
        amount: input.amountPaid,
        currency: input.currency,
        rate,
        account,
        entryDate: input.startDate,
      });
    }

    if (input.amountPaid > 0 && member.coachId && (member.commissionAmount ?? 0) > 0) {
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
