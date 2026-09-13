import { db } from "@workspace/db";
import { checkInsTable, membersTable, paymentsTable } from "@workspace/db/schema";
import { and, asc, count, desc, eq, gte, ilike, isNotNull, isNull, lte, or } from "drizzle-orm";
import { notFound } from "../../shared/http/errors";

export interface MemberListInput {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  planId?: number;
  expiryWindowDays?: number;
  sortBy?: "name" | "joinDate" | "expiryDate";
  sortOrder?: "asc" | "desc";
  showDeleted?: boolean;
}

export async function listMembers(input: MemberListInput) {
  const conditions: ReturnType<typeof eq>[] = [
    (input.showDeleted ? isNotNull(membersTable.deletedAt) : isNull(membersTable.deletedAt)) as ReturnType<typeof eq>,
  ];

  if (input.search) {
    conditions.push(or(
      ilike(membersTable.name, `%${input.search}%`),
      ilike(membersTable.phone, `%${input.search}%`),
      ilike(membersTable.email, `%${input.search}%`),
      ilike(membersTable.memberNumber, `%${input.search}%`),
    ) as ReturnType<typeof eq>);
  }

  if (input.status && input.status !== "all") {
    if (input.status === "expired") {
      conditions.push(or(
        eq(membersTable.status, "expired"),
        and(eq(membersTable.status, "active"), lte(membersTable.expiryDate, new Date())),
      ) as ReturnType<typeof eq>);
    } else {
      conditions.push(eq(membersTable.status, input.status));
    }
  }

  if (input.planId) conditions.push(eq(membersTable.planId, input.planId));
  if (input.expiryWindowDays !== undefined) {
    const future = new Date();
    future.setDate(future.getDate() + input.expiryWindowDays);
    conditions.push(and(
      gte(membersTable.expiryDate, new Date()),
      lte(membersTable.expiryDate, future),
    ) as ReturnType<typeof eq>);
  }

  const where = and(...conditions);
  const sortColumn = input.sortBy === "joinDate"
    ? membersTable.joinDate
    : input.sortBy === "expiryDate"
      ? membersTable.expiryDate
      : membersTable.name;
  const order = input.sortOrder === "desc" ? desc(sortColumn) : asc(sortColumn);
  const offset = (input.page - 1) * input.limit;

  const [items, [totalRow]] = await Promise.all([
    db.select().from(membersTable).where(where).orderBy(order).limit(input.limit).offset(offset),
    db.select({ total: count() }).from(membersTable).where(where),
  ]);

  return { items, total: Number(totalRow.total), page: input.page, limit: input.limit };
}

export async function getMember(id: number) {
  const [member] = await db.select().from(membersTable).where(and(
    eq(membersTable.id, id),
    isNull(membersTable.deletedAt),
  ));
  if (!member) throw notFound("Member not found");
  return member;
}

export async function getMemberPayments(id: number) {
  const payments = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.memberId, id))
    .orderBy(desc(paymentsTable.createdAt));

  return payments.map((payment) => ({
    id: payment.id,
    paymentNumber: payment.paymentNumber,
    type: payment.type,
    amount: payment.amount,
    discount: payment.discount ?? 0,
    currency: payment.currency,
    planName: payment.planName,
    notes: payment.notes,
    createdAt: payment.createdAt,
  }));
}

export async function getMemberCheckIns(id: number) {
  const [member] = await db.select({ memberNumber: membersTable.memberNumber }).from(membersTable).where(eq(membersTable.id, id));
  if (!member) throw notFound("Member not found");

  const checkIns = await db.select().from(checkInsTable)
    .where(eq(checkInsTable.memberId, id))
    .orderBy(desc(checkInsTable.checkedInAt))
    .limit(200);

  return checkIns.map((checkIn) => ({
    id: checkIn.id,
    memberId: checkIn.memberId,
    memberName: checkIn.memberName,
    memberNumber: member.memberNumber,
    checkedInAt: checkIn.checkedInAt,
    note: null,
  }));
}
