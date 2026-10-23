import { db } from "@workspace/db";
import {
  commissionsTable,
  membersTable,
  paymentsTable,
  plansTable,
  salesTable,
  settingsTable,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, not, or } from "drizzle-orm";
import { getCashMovements, getCurrentBalance, summarizeMovements } from "../../lib/ledger";
import { assertPeriodOpen, categoryAccountNames, newJournalId, postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { getNextNumber } from "../../lib/numbering";
import { formatReceiptMessage, lookupPhoneOnWhatsApp, sendDirectMessage } from "../../lib/whatsapp";
import { lubumbashiTodayEnd, lubumbashiTodayStart } from "../../lib/timezone";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { fxRate, money, subtractMoney } from "../../shared/accounting/decimal";
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

function assertCurrency(value: string): asserts value is "USD" | "CDF" {
  if (value !== "USD" && value !== "CDF") throw badRequest("currency must be USD or CDF");
}

/** Payments that belong to another document and must be corrected from it. */
const DOCUMENT_LINKED = new Set(["sale", "payroll", "supplier_payment", "stock_purchase"]);

function assertStandalone(payment: { linkedEntity: string | null; paymentNumber: string | null }, action: string) {
  if (payment.linkedEntity && DOCUMENT_LINKED.has(payment.linkedEntity)) {
    const screen = payment.linkedEntity === "sale" ? "Sales" : payment.linkedEntity === "payroll" ? "Payroll" : "Inventory";
    throw badRequest(`Payment ${payment.paymentNumber ?? ""} belongs to a ${payment.linkedEntity.replace("_", " ")}. ${action} it from the ${screen} screen so stock, payroll and supplier balances stay correct.`, {
      code: "LINKED_PAYMENT",
      linkedEntity: payment.linkedEntity,
    });
  }
}

/** A payment may be dated in the past (backdated receipts) but never after today's business day. */
export function assertNotFutureDated(date: Date | undefined, what = "A payment") {
  if (date && date.getTime() > lubumbashiTodayEnd().getTime()) throw badRequest(`${what} cannot be dated in the future`);
}

/** Today's money in/out and the drawer balance, read from the ledger (Cash account). */
export async function getPaymentSummary() {
  const [settings] = await db.select({ currency: settingsTable.defaultCurrency }).from(settingsTable);
  const [today, balance] = await Promise.all([
    getCashMovements({ dateFrom: lubumbashiTodayStart(), dateTo: lubumbashiTodayEnd() }),
    getCurrentBalance(),
  ]);
  const summary = summarizeMovements(today);
  const inCdf = money(today.filter((movement) => movement.direction === "in").reduce((total, movement) => total + movement.amountCdf, 0));
  const outCdf = money(today.filter((movement) => movement.direction === "out").reduce((total, movement) => total + movement.amountCdf, 0));

  return {
    cashInToday: summary.inBookUsd,
    cashOutToday: summary.outBookUsd,
    cashInTodayCdf: inCdf,
    cashOutTodayCdf: outCdf,
    netCashToday: summary.netBookUsd,
    netCashTodayCdf: subtractMoney(inCdf, outCdf),
    nativeInUsd: summary.inUsd,
    nativeOutUsd: summary.outUsd,
    nativeInCdf: summary.inCdf,
    nativeOutCdf: summary.outCdf,
    balanceUsd: balance.balanceUsd,
    balanceCdf: balance.balanceCdf,
    nativeUsd: balance.nativeUsd,
    nativeCdf: balance.nativeCdf,
    currency: settings?.currency ?? "USD",
    rate: balance.rate,
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
  const currency = input.currency.toUpperCase();
  assertCurrency(currency);
  assertNotFutureDated(input.paymentDate);

  return withTransaction(async (tx) => {
    await assertPeriodOpen(tx, input.paymentDate ?? new Date(), "This payment");
    const rate = fxRate(input.exchangeRate ?? await getExchangeRate(tx));
    const amount = money(input.amount);
    const discount = money(input.discount ?? 0);
    const converted = toUsdCdf(amount, currency, rate);
    const paymentNumber = await getNextNumber("PAY", tx);

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
      amount,
      discount,
      currency,
      exchangeRate: rate,
      ...converted,
      account: input.account ?? "cash",
      notes: input.notes,
      paymentDate: input.paymentDate ?? new Date(),
      status: "completed",
      createdBy: actor,
    }).returning();

    if (amount > 0) {
      const description = `${input.category} — ${input.linkedEntityName ?? input.memberName ?? ""}`;
      const names = categoryAccountNames(input.category, input.direction, input.account ?? "cash");
      await postDoubleEntry({
        entryDate: input.paymentDate,
        sourceType: "payment",
        sourceId: payment.id,
        sourceNumber: paymentNumber,
        ...names,
        amount,
        ...converted,
        currency,
        exchangeRate: rate,
        description,
        createdBy: actor,
      }, tx);
    }

    if (input.memberId && input.direction === "in") {
      const [member] = await tx.select().from(membersTable).where(eq(membersTable.id, input.memberId));
      if (member) {
        let coachId = member.coachId;
        let commissionAmount = money(member.commissionAmount ?? 0);
        if (!coachId && input.planId) {
          const [plan] = await tx.select().from(plansTable).where(eq(plansTable.id, input.planId));
          if (plan?.coachId) {
            coachId = plan.coachId;
            commissionAmount = money(plan.coachFee ?? 0);
            await tx.update(membersTable).set({ coachId, commissionAmount }).where(eq(membersTable.id, input.memberId));
          }
        }
        if (coachId && commissionAmount > 0) {
          await tx.insert(commissionsTable).values({
            staffEmployeeId: coachId,
            memberId: input.memberId,
            memberName: member.name,
            amount: commissionAmount,
            currency,
            status: "pending",
            paymentId: payment!.id,
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
    const [existing] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, id)).for("update");
    if (!existing) throw notFound("Payment not found");
    if (existing.status === "cancelled") throw badRequest("A cancelled payment cannot be edited. Record a new payment instead.");
    assertStandalone(existing, "Correct");
    assertNotFutureDated(input.paymentDate);

    const storedRate = Number(existing.exchangeRate ?? 0);
    if (input.exchangeRate !== undefined && storedRate > 0 && fxRate(input.exchangeRate) !== fxRate(storedRate)) {
      throw badRequest("Exchange rate is locked after a payment is posted");
    }
    const rate = fxRate(storedRate > 0 ? storedRate : (input.exchangeRate ?? await getExchangeRate(tx)));
    const amount = money(input.amount ?? existing.amount ?? 0);
    const discount = money(input.discount ?? existing.discount ?? 0);
    const direction = (input.direction ?? existing.direction) as "in" | "out";
    assertDirection(direction);
    const currency = (input.currency ?? existing.currency).toUpperCase();
    assertCurrency(currency);
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
      amount,
      discount,
      currency,
      exchangeRate: rate,
      ...converted,
      account,
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.paymentDate !== undefined && { paymentDate: input.paymentDate }),
    }).where(eq(paymentsTable.id, id)).returning();

    const oldDirection = existing.direction as "in" | "out";
    const financialsChanged = money(existing.amount ?? 0) !== amount
      || oldDirection !== direction
      || existing.currency.toUpperCase() !== currency
      || existing.account !== account
      || existing.category !== category
      || (input.paymentDate !== undefined && input.paymentDate.getTime() !== existing.paymentDate.getTime());

    if (financialsChanged) {
      // The original posting is reversed and the corrected one posted together,
      // both inside the open period, so every report agrees on the new figure.
      await assertPeriodOpen(tx, existing.paymentDate, "The original payment");
      await assertPeriodOpen(tx, input.paymentDate ?? existing.paymentDate, "The corrected payment");
      const journalId = newJournalId();
      await reverseEntries("payment", id, "payment_correction", actor, tx, {
        journalId,
        // Restate the original day; the corrected posting lands on its (new) date.
        entryDate: existing.paymentDate,
        description: `Correction: reversed payment ${existing.paymentNumber ?? id}`,
      });
      if (amount > 0) {
        const names = categoryAccountNames(category || "other", direction, account);
        await postDoubleEntry({
          journalId,
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
    const [existing] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, id)).for("update");
    if (!existing) throw notFound("Payment not found");
    if (existing.status === "cancelled") return existing;
    assertStandalone(existing, "Cancel");

    const [payment] = await tx.update(paymentsTable).set({ status: "cancelled" }).where(eq(paymentsTable.id, id)).returning();
    if (existing.status === "completed" && money(existing.amount ?? 0) > 0) {
      await reverseEntries("payment", id, "payment_reversal", actor, tx, {
        description: `Cancelled payment ${existing.paymentNumber ?? id}`,
      });
    }

    // Commissions earned by this payment and not yet paid out go with it.
    await tx.update(commissionsTable)
      .set({ status: "cancelled" })
      .where(and(eq(commissionsTable.paymentId, id), eq(commissionsTable.status, "pending")));

    // Cancelling the only receipt of a membership undoes the registration.
    // A member with another completed membership receipt stays active.
    if (existing.category === "membership" && existing.status === "completed" && existing.memberId) {
      const [remaining] = await tx.select({ total: count() }).from(paymentsTable).where(and(
        eq(paymentsTable.memberId, existing.memberId),
        eq(paymentsTable.category, "membership"),
        eq(paymentsTable.status, "completed"),
      ));
      if (Number(remaining?.total ?? 0) === 0) {
        await tx.update(membersTable).set({ status: "archived", deletedAt: new Date() }).where(eq(membersTable.id, existing.memberId));
      }
    }
    return payment;
  });
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
