import { db } from "@workspace/db";
import { paymentsTable, vouchersTable } from "@workspace/db/schema";
import { and, eq, inArray, not } from "drizzle-orm";
import { appendLedgerEntry } from "../../lib/ledger";
import { reverseEntries } from "../../lib/accounting";
import { getExchangeRate } from "../../shared/accounting/currency";
import { withTransaction, type DatabaseTransaction } from "../../shared/db/transaction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = any;

async function findDuplicateMemberVouchers(executor: Executor) {
  return executor.select().from(vouchersTable).where(and(
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
}

async function findSaleShadowPayments(executor: Executor) {
  return executor.select().from(paymentsTable).where(and(
    eq(paymentsTable.category, "product_sale"),
    eq(paymentsTable.status, "completed"),
  ));
}

async function reverseDuplicateMemberVoucher(
  tx: DatabaseTransaction,
  voucher: typeof vouchersTable.$inferSelect,
  actor: string,
): Promise<void> {
  if ((voucher.amount ?? 0) > 0) {
    const rate = voucher.exchangeRate && voucher.exchangeRate > 0
      ? voucher.exchangeRate
      : await getExchangeRate();
    await appendLedgerEntry({
      entryDate: new Date(),
      sourceType: "voucher_reversal",
      sourceNumber: voucher.voucherNumber ?? undefined,
      sourceId: voucher.id,
      direction: voucher.direction === "in" ? "out" : "in",
      amount: voucher.amount ?? 0,
      currency: voucher.currency,
      exchangeRate: rate,
      description: `Cleanup reversal: duplicate member voucher ${voucher.voucherNumber ?? voucher.id}`,
      createdBy: actor,
    }, tx);
    await reverseEntries("voucher", voucher.id, "voucher_reversal", actor, tx);
  }

  await tx.update(vouchersTable)
    .set({ status: "cancelled", deletedAt: new Date() })
    .where(eq(vouchersTable.id, voucher.id));
}

export async function cashCleanup(dryRun: boolean, actor = "cash-cleanup") {
  if (dryRun) {
    const [memberVouchers, salePayments] = await Promise.all([
      findDuplicateMemberVouchers(db),
      findSaleShadowPayments(db),
    ]);
    return {
      dry_run: true,
      member_vouchers_affected: memberVouchers.length,
      sale_payments_affected: 0,
      sale_payments_preserved: salePayments.length,
      member_vouchers_preview: memberVouchers.slice(0, 20),
      sale_payments_preview: salePayments.slice(0, 20),
    };
  }

  return withTransaction(async (tx) => {
    // Re-read after the financial lock is held; never mutate a stale preview set.
    const [memberVouchers, salePayments] = await Promise.all([
      findDuplicateMemberVouchers(tx),
      findSaleShadowPayments(tx),
    ]);

    for (const voucher of memberVouchers) {
      await reverseDuplicateMemberVoucher(tx, voucher, actor);
    }

    // Product-sale payment rows are the cash representation linked to each sale.
    // Cancelling them would remove legitimate sale cash from current balance.
    return {
      dry_run: false,
      member_vouchers_affected: memberVouchers.length,
      sale_payments_affected: 0,
      sale_payments_preserved: salePayments.length,
      member_vouchers_preview: memberVouchers.slice(0, 20),
      sale_payments_preview: salePayments.slice(0, 20),
    };
  });
}
