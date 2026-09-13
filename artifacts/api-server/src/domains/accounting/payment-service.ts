import { db } from "@workspace/db";
import {
  commissionsTable,
  membersTable,
  paymentsTable,
  plansTable,
  salesTable,
  settingsTable,
  vouchersTable,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, not, or, sum } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { categoryAccountNames, postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { getNextNumber } from "../../lib/numbering";
import { formatReceiptMessage, lookupPhoneOnWhatsApp, sendDirectMessage } from "../../lib/whatsapp";
import { lubumbashiTodayEnd, lubumbashiTodayStart } from "../../lib/timezone";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest, notFound } from "../../shared/http/errors";

export interface PaymentListInput {
  page: number;
  limit: number;
  search?: string;
  direction?: string;
  category?: string;
  currency?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortOrder?: "asc" | "desc";
}

export interface CreatePaymentInput {
  direction: "in" | "out";
  category: string;
  linkedEntity?: string;
  linkedEntityId?: number;
  linkedEntityName?: string;
  memberId?: number;
  memberName?: string;
  planId?: number;
  planName?: string;
  amount: number;
  discount?: number;
  currency: string;
  exchangeRate?: number;
  account?: string;
  notes?: string;
  paymentDate?: Date;
}

export interface UpdatePaymentInput {
  direction?: "in" | "out";
  category?: string;
  linkedEntity?: string | null;
  linkedEntityId?: number | null;
  linkedEntityName?: string | null;
  memberId?: number | null;
  memberName?: string | null;
  planId?: number | null;
  planName?: string | null;
  amount?: number;
  discount?: number;
  currency?: string;
  exchangeRate?: number;
  account?: string;
  notes?: string | null;
  paymentDate?: Date;
}

function assertDirection(value: string): asserts value is "in" | "out" {
  if (value !== "in" && value !== "out") throw badRequest("direction must be in or out");
}

export async function getPaymentSummary() {
  const [settings] = await db.select({ rate: settingsTable.usdToCdfRate, currency: settingsTable.defaultCurrency }).from(settingsTable);
  const rate = settings?.rate ?? 2800;
  const currency = settings?.currency ?? "USD";
  const todayStart = lubumbashiTodayStart();
  const todayEnd = lubumbashiTodayEnd();

  const [payTodayIn, payTodayOut, payAllIn, payAllOut, vchTodayIn, vchTodayOut, vchAllIn, vchAllOut] = await Promise.all([
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) }).from(paymentsTable).where(and(eq(paymentsTable.direction, "in"), eq(paymentsTable.status, "completed"), gte(paymentsTable.paymentDate, todayStart), lte(paymentsTable.paymentDate, todayEnd))),
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) }).from(paymentsTable).where(and(eq(paymentsTable.direction, "out"), eq(paymentsTable.status, "completed"), gte(paymentsTable.paymentDate, todayStart), lte(paymentsTable.paymentDate, todayEnd))),
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) }).from(paymentsTable).where(and(eq(paymentsTable.direction, "in"), eq(paymentsTable.status, "completed"))),
    db.select({ usd: sum(paymentsTable.amountUsd), cdf: sum(paymentsTable.amountCdf) }).from(paymentsTable).where(and(eq(paymentsTable.direction, "out"), eq(paymentsTable.status, "completed"))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) }).from(vouchersTable).where(and(eq(vouchersTable.direction, "in"), eq(vouchersTable.status, "recorded"), gte(vouchersTable.voucherDate, todayStart), lte(vouchersTable.voucherDate, todayEnd))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) }).from(vouchersTable).where(and(eq(vouchersTable.direction, "out"), eq(vouchersTable.status, "recorded"), gte(vouchersTable.voucherDate, todayStart), lte(vouchersTable.voucherDate, todayEnd))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) }).from(vouchersTable).where(and(eq(vouchersTable.direction, "in"), eq(vouchersTable.status, "recorded"))),
    db.select({ usd: sum(vouchersTable.amountUsd), cdf: sum(vouchersTable.amountCdf) }).from(vouchersTable).where(and(eq(vouchersTable.direction, "out"), eq(vouchersTable.status, "recorded"))),
  ]);

  const n = (value: unknown) => Number(value ?? 0);
  const cashInToday = n(payTodayIn[0]?.usd) + n(vchTodayIn[0]?.usd);
  const cashOutToday = n(payTodayOut[0]?.usd) + n(vchTodayOut[0]?.usd);
  const cashInTodayCdf = n(payTodayIn[0]?.cdf) + n(vchTodayIn[0]?.cdf);
  const cashOutTodayCdf = n(payTodayOut[0]?.cdf) + n(vchTodayOut[0]?.cdf);
  const totalIn = n(payAllIn[0]?.usd) + n(vchAllIn[0]?.usd);
  const totalOut = n(payAllOut[0]?.usd) + n(vchAllOut[0]?.usd);
  const totalInCdf = n(payAllIn[0]?.cdf) + n(vchAllIn[0]?.cdf);
  const totalOutCdf = n(payAllOut[0]?.cdf) + n(vchAllOut[0]?.cdf);

  return {
    cashInToday,
    cashOutToday,
    cashInTodayCdf,
    cashOutTodayCdf,
    netCashToday: cashInToday - cashOutToday,
    netCashTodayCdf: cashInTodayCdf - cashOutTodayCdf,
    balanceUsd: totalIn - totalOut,
    balanceCdf: totalInCdf - totalOutCdf,
    currency,
    rate,
  };
}

export async function listPayments(input: PaymentListInput) {
  const conditions: ReturnType<typeof eq>[] = [not(eq(paymentsTable.status, "cancelled")) as ReturnType<typeof eq>];
  if (input.search) {
    conditions.push(or(
      ilike(paymentsTable.paymentNumber, `%${input.search}%`),
      ilike(paymentsTable.memberName, `%${input.search}%`),
      ilike(paymentsTable.notes, `%${input.search}%`),
      ilike(paymentsTable.linkedEntityName, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
  }
  if (input.direction) conditions.push(eq(paymentsTable.direction, input.direction));
  if (input.category) conditions.push(eq(paymentsTable.category, input.category));
  if (input.currency) conditions.push(eq(paymentsTable.currency, input.currency));
  if (input.dateFrom) conditions.push(gte(paymentsTable.paymentDate, input.dateFrom));
  if (input.dateTo) conditions.push(lte(paymentsTable.paymentDate, input.dateTo));

  const where = and(...conditions);
  const order = input.sortOrder === "asc" ? asc(paymentsTable.paymentDate) : desc(paymentsTable.paymentDate);
  const offset = (input.page - 1) * input.limit;
  const [items, [totalRow]] = await Promise.all([
    db.select().from(paymentsTable).where(where).orderBy(order).limit(input.limit).offset(offset),
    db.select({ total: count() }).from(paymentsTable).where(where),
  ]);

  const missingSaleIds = items
    .filter((payment) => payment.category === "product_sale" && !payment.notes && payment.linkedEntityId)
    .map((payment) => payment.linkedEntityId!);
  const saleItemMap = new Map<number, string>();
  if (missingSaleIds.length > 0) {
    const sales = await db.select({ id: salesTable.id, items: salesTable.items }).from(salesTable).where(inArray(salesTable.id, missingSaleIds));
    for (const sale of sales) {
      const summary = (sale.items ?? []).map((item) => item.quantity > 1 ? `${item.quantity}× ${item.productName}` : item.productName).join(", ");
      if (summary) saleItemMap.set(sale.id, summary);
    }
  }

  return {
    items: items.map((payment) => payment.category === "product_sale" && !payment.notes && payment.linkedEntityId && saleItemMap.has(payment.linkedEntityId)
      ? { ...payment, notes: saleItemMap.get(payment.linkedEntityId) }
      : payment),
    total: Number(totalRow.total),
    page: input.page,
    limit: input.limit,
  };
}

export async function createPayment(input: CreatePaymentInput, actor: string) {
  assertDirection(input.direction);
  if (input.amount < 0) throw badRequest("Amount cannot be negative");
  if ((input.discount ?? 0) < 0) throw badRequest("Discount cannot be negative");
  const rate = input.exchangeRate ?? await getExchangeRate();
  if (rate <= 0) throw badRequest("Exchange rate must be greater than zero");
  const converted = toUsdCdf(input.amount, input.currency, rate);
  const paymentNumber = await getNextNumber("PAY");

  return withTransaction(async (tx) => {
    const [payment] = await tx.insert(paymentsTable).values({
      paymentNumber,
      direction: input.direction,
      category: input.category,
      type: input.category,
      linkedEntity: input.linkedEntity,
      linkedEntityId: input.linkedEntityId,
      linkedEntityName: input.linkedEntityName,
      memberId: input.memberId,
      memberName: input.memberName,
      planId: input.planId,
      planName: input.planName,
      amount: input.amount,
      discount: input.discount ?? 0,
      currency: input.currency,
      exchangeRate: rate,
      ...converted,
      account: input.account ?? "cash",
      notes: input.notes,
      paymentDate: input.paymentDate ?? new Date(),
      status: "completed",
      createdBy: actor,
    }).returning();

    if (input.amount > 0) {
      const description = `${input.category} — ${input.linkedEntityName ?? input.memberName ?? ""}`;
      await appendLedgerEntry({
        entryDate: input.paymentDate,
        sourceType: "payment",
        sourceNumber: paymentNumber,
        sourceId: payment.id,
        direction: input.direction,
        amount: input.amount,
        currency: input.currency,
        exchangeRate: rate,
        description,
        createdBy: actor,
      }, tx);
      const names = categoryAccountNames(input.category, input.direction, input.account ?? "cash");
      await postDoubleEntry({
        entryDate: input.paymentDate,
        sourceType: "payment",
        sourceId: payment.id,
        sourceNumber: paymentNumber,
        ...names,
        amount: input.amount,
        ...converted,
        currency: input.currency,
        exchangeRate: rate,
        description,
        createdBy: actor,
      }, tx);
    }

    if (input.memberId && input.direction === "in") {
      const [member] = await tx.select().from(membersTable).where(eq(membersTable.id, input.memberId));
      if (member) {
        let coachId = member.coachId;
        let commissionAmount = member.commissionAmount ?? 0;
        if (!coachId && input.planId) {
          const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, input.planId));
          if (plan?.coachId) {
            coachId = plan.coachId;
            commissionAmount = plan.coachFee ?? 0;
            await tx.update(membersTable).set({ coachId, commissionAmount }).where(eq(membersTable.id, input.memberId));
          }
        }
        if (coachId && commissionAmount > 0) {
          await tx.insert(commissionsTable).values({
            staffEmployeeId: coachId,
            memberId: input.memberId,
            memberName: member.name,
            amount: commissionAmount,
            currency: input.currency,
            status: "pending",
            note: `Payment ${paymentNumber}`,
          });
        }
      }
    }

    return payment;
  });
}

export async function updatePayment(id: number, input: UpdatePaymentInput, actor: string) {
  if (input.amount !== undefined && input.amount < 0) throw badRequest("Amount cannot be negative");
  if (input.discount !== undefined && input.discount < 0) throw badRequest("Discount cannot be negative");
  if (input.exchangeRate !== undefined && input.exchangeRate <= 0) throw badRequest("Exchange rate must be greater than zero");

  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, id));
    if (!existing) throw notFound("Payment not found");

    const amount = input.amount ?? existing.amount ?? 0;
    const direction = input.direction ?? existing.direction as "in" | "out";
    assertDirection(direction);
    const currency = input.currency ?? existing.currency;
    const rate = input.exchangeRate ?? existing.exchangeRate ?? await getExchangeRate();
    const account = input.account ?? existing.account ?? "cash";
    const category = input.category ?? existing.category;
    const converted = toUsdCdf(amount, currency, rate);

    const [payment] = await tx.update(paymentsTable).set({
      ...(input.direction !== undefined && { direction: input.direction }),
      ...(input.category !== undefined && { category: input.category, type: input.category }),
      ...(input.linkedEntity !== undefined && { linkedEntity: input.linkedEntity }),
      ...(input.linkedEntityId !== undefined && { linkedEntityId: input.linkedEntityId }),
      ...(input.linkedEntityName !== undefined && { linkedEntityName: input.linkedEntityName }),
      ...(input.memberId !== undefined && { memberId: input.memberId }),
      ...(input.memberName !== undefined && { memberName: input.memberName }),
      ...(input.planId !== undefined && { planId: input.planId }),
      ...(input.planName !== undefined && { planName: input.planName }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.discount !== undefined && { discount: input.discount }),
      ...(input.currency !== undefined && { currency: input.currency }),
      exchangeRate: rate,
      ...converted,
      ...(input.account !== undefined && { account: input.account }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.paymentDate !== undefined && { paymentDate: input.paymentDate }),
    }).where(eq(paymentsTable.id, id)).returning();

    const oldDirection = existing.direction as "in" | "out";
    const financialsChanged = (existing.amount ?? 0) !== amount
      || oldDirection !== direction
      || existing.currency !== currency
      || Math.abs((existing.exchangeRate ?? 1) - rate) > 0.0001
      || existing.account !== account
      || existing.category !== category
      || (input.paymentDate !== undefined && input.paymentDate.getTime() !== existing.paymentDate.getTime());

    if (financialsChanged) {
      if ((existing.amount ?? 0) > 0) {
        await appendLedgerEntry({
          sourceType: "payment_correction",
          sourceId: id,
          direction: oldDirection === "in" ? "out" : "in",
          amount: existing.amount ?? 0,
          currency: existing.currency,
          exchangeRate: existing.exchangeRate ?? rate,
          description: `Correction: reversed payment ${existing.paymentNumber ?? id}`,
          createdBy: actor,
        }, tx);
      }
      if (amount > 0) {
        await appendLedgerEntry({
          sourceType: "payment_correction",
          sourceId: id,
          direction,
          amount,
          currency,
          exchangeRate: rate,
          description: `Correction: updated payment ${existing.paymentNumber ?? id}`,
          createdBy: actor,
          entryDate: input.paymentDate,
        }, tx);
      }

      await reverseEntries("payment", id, "payment_correction", actor, tx);
      if (amount > 0) {
        const names = categoryAccountNames(category || "other", direction, account);
        await postDoubleEntry({
          sourceType: "payment_correction",
          sourceId: id,
          sourceNumber: existing.paymentNumber ?? undefined,
          entryDate: input.paymentDate ?? existing.paymentDate,
          ...names,
          amount,
          ...converted,
          currency,
          exchangeRate: rate,
          description: `Corrected payment ${existing.paymentNumber ?? id}`,
          createdBy: actor,
        }, tx);
      }
    }

    return payment;
  });
}

export async function cancelPayment(id: number, actor: string) {
  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, id));
    if (!existing) throw notFound("Payment not found");
    const [payment] = await tx.update(paymentsTable).set({ status: "cancelled" }).where(eq(paymentsTable.id, id)).returning();

    if (existing.status === "completed" && (existing.amount ?? 0) > 0) {
      const rate = existing.exchangeRate ?? await getExchangeRate();
      const direction = existing.direction as "in" | "out";
      await appendLedgerEntry({
        sourceType: "payment_reversal",
        sourceId: id,
        direction: direction === "in" ? "out" : "in",
        amount: existing.amount ?? 0,
        currency: existing.currency,
        exchangeRate: rate,
        description: `Cancelled payment ${existing.paymentNumber ?? id}`,
        createdBy: actor,
      }, tx);
      await reverseEntries("payment", id, "payment_reversal", actor, tx);
    }

    if (existing.category === "membership" && existing.memberId) {
      await tx.update(membersTable).set({ status: "archived", deletedAt: new Date() }).where(eq(membersTable.id, existing.memberId));
    }
    return payment;
  });
}

export async function cashCleanup(dryRun: boolean) {
  const memberVouchers = await db.select({
    id: vouchersTable.id,
    name: vouchersTable.linkedEntityName,
    amountUsd: vouchersTable.amountUsd,
    amountCdf: vouchersTable.amountCdf,
    voucherDate: vouchersTable.voucherDate,
  }).from(vouchersTable).where(and(
    eq(vouchersTable.linkedEntity, "member"),
    eq(vouchersTable.voucherType, "cash_receipt"),
    eq(vouchersTable.status, "recorded"),
    inArray(
      vouchersTable.linkedEntityId,
      db.select({ id: paymentsTable.memberId }).from(paymentsTable).where(and(
        eq(paymentsTable.type, "membership"),
        eq(paymentsTable.status, "completed"),
        not(eq(paymentsTable.memberId, 0)),
      )) as never,
    ),
  ));

  const salePayments = await db.select({
    id: paymentsTable.id,
    notes: paymentsTable.notes,
    amountUsd: paymentsTable.amountUsd,
    amountCdf: paymentsTable.amountCdf,
    paymentDate: paymentsTable.paymentDate,
  }).from(paymentsTable).where(and(
    eq(paymentsTable.category, "product_sale"),
    eq(paymentsTable.status, "completed"),
  ));

  if (!dryRun) {
    await withTransaction(async (tx) => {
      if (memberVouchers.length > 0) {
        await tx.update(vouchersTable).set({ status: "cancelled" }).where(inArray(vouchersTable.id, memberVouchers.map((voucher) => voucher.id)));
      }
      if (salePayments.length > 0) {
        await tx.update(paymentsTable).set({ status: "cancelled" }).where(inArray(paymentsTable.id, salePayments.map((payment) => payment.id)));
      }
    });
  }

  return {
    dry_run: dryRun,
    member_vouchers_affected: memberVouchers.length,
    sale_payments_affected: salePayments.length,
    member_vouchers_preview: memberVouchers.slice(0, 20),
    sale_payments_preview: salePayments.slice(0, 20),
  };
}

export async function sendPaymentReceipt(paymentId: number) {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1);
  if (!payment) throw notFound("Payment not found");

  let phone: string | null = null;
  if (payment.memberId) {
    const [member] = await db.select({ phone: membersTable.phone }).from(membersTable).where(eq(membersTable.id, payment.memberId)).limit(1);
    phone = member?.phone ?? null;
  }
  if (!phone) throw badRequest("no_phone");

  const settings = await db.query.settingsTable.findFirst();
  if (!settings?.greenApiInstanceId || !settings.greenApiToken) throw badRequest("WhatsApp not configured");
  const chatId = await lookupPhoneOnWhatsApp(phone, settings.greenApiInstanceId, settings.greenApiToken);
  if (!chatId) throw badRequest("not_on_whatsapp");

  const message = formatReceiptMessage({
    memberName: payment.memberName,
    planName: payment.planName,
    category: payment.category,
    amount: payment.amount,
    currency: payment.currency,
    paymentDate: payment.paymentDate,
    gymName: settings.gymName,
  });
  await sendDirectMessage(settings.greenApiInstanceId, settings.greenApiToken, chatId, message);
  return { ok: true };
}
