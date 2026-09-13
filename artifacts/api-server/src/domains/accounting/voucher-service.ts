import { db } from "@workspace/db";
import { vouchersTable } from "@workspace/db/schema";
import { and, count, desc, eq, gte, ilike, isNull, lte, or } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { categoryAccountNames, postDoubleEntry, reverseEntries } from "../../lib/accounting";
import { getNextNumber } from "../../lib/numbering";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import { withTransaction } from "../../shared/db/transaction";
import { badRequest, notFound } from "../../shared/http/errors";

export interface VoucherListInput {
  page: number;
  limit: number;
  search?: string;
  voucherType?: string;
  currency?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface CreateVoucherInput {
  voucherType: string;
  voucherDate?: Date;
  paidTo?: string;
  receivedFrom?: string;
  linkedEntity?: string;
  linkedEntityId?: number;
  linkedEntityName?: string;
  amount: number;
  currency: string;
  exchangeRate?: number;
  account?: string;
  category?: string;
  description: string;
}

export interface UpdateVoucherInput {
  voucherType?: string;
  voucherDate?: Date;
  paidTo?: string | null;
  receivedFrom?: string | null;
  linkedEntity?: string | null;
  linkedEntityId?: number | null;
  linkedEntityName?: string | null;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  account?: string;
  category?: string | null;
  description?: string;
}

export function voucherDirection(voucherType: string): "in" | "out" {
  return ["cash_receipt", "customer_payment"].includes(voucherType) ? "in" : "out";
}

export async function listVouchers(input: VoucherListInput) {
  const conditions: ReturnType<typeof eq>[] = [
    isNull(vouchersTable.deletedAt) as ReturnType<typeof eq>,
    eq(vouchersTable.status, "recorded"),
  ];
  if (input.search) {
    conditions.push(or(
      ilike(vouchersTable.voucherNumber, `%${input.search}%`),
      ilike(vouchersTable.description, `%${input.search}%`),
      ilike(vouchersTable.paidTo, `%${input.search}%`),
      ilike(vouchersTable.receivedFrom, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
  }
  if (input.voucherType) conditions.push(eq(vouchersTable.voucherType, input.voucherType));
  if (input.currency) conditions.push(eq(vouchersTable.currency, input.currency));
  if (input.dateFrom) conditions.push(gte(vouchersTable.voucherDate, input.dateFrom));
  if (input.dateTo) conditions.push(lte(vouchersTable.voucherDate, input.dateTo));

  const where = and(...conditions);
  const offset = (input.page - 1) * input.limit;
  const [items, [totalRow]] = await Promise.all([
    db.select().from(vouchersTable).where(where).orderBy(desc(vouchersTable.voucherDate)).limit(input.limit).offset(offset),
    db.select({ total: count() }).from(vouchersTable).where(where),
  ]);
  return { items, total: Number(totalRow.total), page: input.page, limit: input.limit };
}

export async function getVoucher(id: number) {
  const [voucher] = await db.select().from(vouchersTable).where(and(
    eq(vouchersTable.id, id),
    isNull(vouchersTable.deletedAt),
  ));
  if (!voucher) throw notFound("Voucher not found");
  return voucher;
}

export async function createVoucher(input: CreateVoucherInput, actor: string) {
  if (input.amount < 0) throw badRequest("Amount cannot be negative");
  const rate = input.exchangeRate ?? await getExchangeRate();
  if (rate <= 0) throw badRequest("Exchange rate must be greater than zero");
  const voucherNumber = await getNextNumber("VCH");
  const direction = voucherDirection(input.voucherType);
  const converted = toUsdCdf(input.amount, input.currency, rate);

  return withTransaction(async (tx) => {
    const [voucher] = await tx.insert(vouchersTable).values({
      voucherNumber,
      voucherType: input.voucherType,
      direction,
      voucherDate: input.voucherDate ?? new Date(),
      paidTo: input.paidTo,
      receivedFrom: input.receivedFrom,
      linkedEntity: input.linkedEntity,
      linkedEntityId: input.linkedEntityId,
      linkedEntityName: input.linkedEntityName,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: rate,
      ...converted,
      account: input.account ?? "cash",
      category: input.category,
      description: input.description,
      status: "recorded",
      createdBy: actor,
    }).returning();

    if (input.amount > 0) {
      await appendLedgerEntry({
        sourceType: "voucher",
        sourceNumber: voucherNumber,
        sourceId: voucher.id,
        direction,
        amount: input.amount,
        currency: input.currency,
        exchangeRate: rate,
        description: input.description,
        createdBy: actor,
        entryDate: input.voucherDate,
      }, tx);

      const voucherCategory = direction === "in" ? "other" : "expense";
      const names = categoryAccountNames(voucherCategory, direction, input.account ?? "cash", input.category);
      await postDoubleEntry({
        sourceType: "voucher",
        sourceId: voucher.id,
        sourceNumber: voucherNumber,
        entryDate: input.voucherDate,
        ...names,
        amount: input.amount,
        ...converted,
        currency: input.currency,
        exchangeRate: rate,
        description: input.description,
        createdBy: actor,
      }, tx);
    }

    return voucher;
  });
}

export async function updateVoucher(id: number, input: UpdateVoucherInput, actor: string) {
  if (input.amount !== undefined && input.amount < 0) throw badRequest("Amount cannot be negative");
  if (input.exchangeRate !== undefined && input.exchangeRate <= 0) throw badRequest("Exchange rate must be greater than zero");

  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(vouchersTable).where(and(
      eq(vouchersTable.id, id),
      isNull(vouchersTable.deletedAt),
    ));
    if (!existing) throw notFound("Voucher not found");

    const amount = input.amount ?? existing.amount ?? 0;
    const currency = input.currency ?? existing.currency;
    const rate = input.exchangeRate ?? await getExchangeRate();
    const voucherType = input.voucherType ?? existing.voucherType;
    const direction = voucherDirection(voucherType);
    const converted = toUsdCdf(amount, currency, rate);
    const account = input.account ?? existing.account ?? "cash";
    const category = input.category !== undefined ? input.category : existing.category;
    const description = input.description ?? existing.description;

    const [voucher] = await tx.update(vouchersTable).set({
      ...(input.voucherType !== undefined && { voucherType: input.voucherType }),
      direction,
      ...(input.voucherDate !== undefined && { voucherDate: input.voucherDate }),
      ...(input.paidTo !== undefined && { paidTo: input.paidTo }),
      ...(input.receivedFrom !== undefined && { receivedFrom: input.receivedFrom }),
      ...(input.linkedEntity !== undefined && { linkedEntity: input.linkedEntity }),
      ...(input.linkedEntityId !== undefined && { linkedEntityId: input.linkedEntityId }),
      ...(input.linkedEntityName !== undefined && { linkedEntityName: input.linkedEntityName }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.currency !== undefined && { currency: input.currency }),
      exchangeRate: rate,
      ...converted,
      ...(input.account !== undefined && { account: input.account }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.description !== undefined && { description: input.description }),
    }).where(eq(vouchersTable.id, id)).returning();

    const oldDirection = voucherDirection(existing.voucherType);
    const financialsChanged = existing.status === "recorded" && (
      (existing.amount ?? 0) !== amount
      || oldDirection !== direction
      || existing.currency !== currency
      || Math.abs((existing.exchangeRate ?? 1) - rate) > 0.0001
      || existing.account !== account
      || existing.category !== category
      || (input.voucherDate !== undefined && input.voucherDate.getTime() !== existing.voucherDate.getTime())
    );

    if (financialsChanged) {
      if ((existing.amount ?? 0) > 0) {
        await appendLedgerEntry({
          sourceType: "voucher_correction",
          sourceNumber: existing.voucherNumber ?? undefined,
          sourceId: id,
          direction: oldDirection === "in" ? "out" : "in",
          amount: existing.amount ?? 0,
          currency: existing.currency,
          exchangeRate: existing.exchangeRate ?? rate,
          description: `Correction: reversed voucher ${existing.voucherNumber ?? id}`,
          createdBy: actor,
        }, tx);
      }
      if (amount > 0) {
        await appendLedgerEntry({
          sourceType: "voucher_correction",
          sourceNumber: existing.voucherNumber ?? undefined,
          sourceId: id,
          direction,
          amount,
          currency,
          exchangeRate: rate,
          description: `Correction: updated voucher ${existing.voucherNumber ?? id}`,
          createdBy: actor,
          entryDate: input.voucherDate,
        }, tx);
      }

      await reverseEntries("voucher", id, "voucher_correction", actor, tx);
      if (amount > 0) {
        const voucherCategory = direction === "in" ? "other" : "expense";
        const names = categoryAccountNames(voucherCategory, direction, account, category ?? undefined);
        await postDoubleEntry({
          sourceType: "voucher_correction",
          sourceId: id,
          sourceNumber: existing.voucherNumber ?? undefined,
          entryDate: input.voucherDate ?? existing.voucherDate,
          ...names,
          amount,
          ...converted,
          currency,
          exchangeRate: rate,
          description: `Corrected voucher ${existing.voucherNumber ?? id}`,
          createdBy: actor,
        }, tx);
      }
    }

    return voucher;
  });
}

export async function cancelVoucher(id: number, actor: string) {
  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(vouchersTable).where(and(
      eq(vouchersTable.id, id),
      isNull(vouchersTable.deletedAt),
    ));
    if (!existing) throw notFound("Voucher not found");

    const [voucher] = await tx.update(vouchersTable)
      .set({ status: "cancelled", deletedAt: new Date() })
      .where(eq(vouchersTable.id, id))
      .returning();

    if (existing.status === "recorded" && (existing.amount ?? 0) > 0) {
      const rate = existing.exchangeRate ?? await getExchangeRate();
      const direction = existing.direction as "in" | "out";
      await appendLedgerEntry({
        sourceType: "voucher_reversal",
        sourceNumber: existing.voucherNumber ?? undefined,
        sourceId: id,
        direction: direction === "in" ? "out" : "in",
        amount: existing.amount ?? 0,
        currency: existing.currency,
        exchangeRate: rate,
        description: `Cancelled voucher ${existing.voucherNumber ?? id}`,
        createdBy: actor,
      }, tx);
      await reverseEntries("voucher", id, "voucher_reversal", actor, tx);
    }

    return voucher;
  });
}
