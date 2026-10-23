/**
 * End-to-end accounting tests against a real PostgreSQL database.
 *
 * Runs only when LEDGER_TEST_DATABASE_URL points at a disposable, freshly
 * migrated database (CI creates one). It posts real business events through the
 * services the API uses and checks that every report tells the same story.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

const databaseUrl = process.env.LEDGER_TEST_DATABASE_URL;
const skip = !databaseUrl && "LEDGER_TEST_DATABASE_URL is not set";
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;

type Modules = Awaited<ReturnType<typeof load>>;
let m: Modules;

async function load() {
  const [dbModule, payments, sales, inventory, suppliers, ledgerService, periodClose, reports, health, financials, ledger, accounting] = await Promise.all([
    import("../lib/db/src/index"),
    import("../artifacts/api-server/src/domains/accounting/payment-service"),
    import("../artifacts/api-server/src/domains/sales/service"),
    import("../artifacts/api-server/src/domains/inventory/service"),
    import("../artifacts/api-server/src/domains/inventory/supplier-credit-service"),
    import("../artifacts/api-server/src/domains/accounting/ledger-service"),
    import("../artifacts/api-server/src/domains/accounting/period-close-service"),
    import("../artifacts/api-server/src/domains/accounting/ledger-reports"),
    import("../artifacts/api-server/src/domains/accounting/ledger-health"),
    import("../artifacts/api-server/src/domains/accounting/financials-service"),
    import("../artifacts/api-server/src/lib/ledger"),
    import("../artifacts/api-server/src/lib/accounting"),
  ]);
  return { dbModule, payments, sales, inventory, suppliers, ledgerService, periodClose, reports, health, financials, ledger, accounting };
}

const ACTOR = "ledger-test";
const DAY = 24 * 60 * 60 * 1000;
const RATE = 2800;

async function assertBooksAgree(label: string) {
  const [trial, sheet, ledgerHealth, balance, cashBook, pnl, report] = await Promise.all([
    m.reports.getTrialBalance(),
    m.reports.getBalanceSheet(),
    m.health.getLedgerHealth(),
    m.ledger.getCurrentBalance(),
    m.ledgerService.listCashMovements({}),
    m.reports.getProfitAndLoss(),
    m.financials.getFinancialReport({ period: "all" }),
  ]);
  assert.equal(trial.balanced, true, `${label}: trial balance must balance`);
  assert.equal(sheet.balanced, true, `${label}: balance sheet must balance`);
  for (const check of ledgerHealth.checks.filter((c) => !c.key.startsWith("cash_"))) {
    assert.equal(check.ok, true, `${label}: ${check.key} — ${check.message} (${check.expected} vs ${check.actual})`);
  }
  // Cash Book closing balance is the drawer balance.
  assert.equal(cashBook.closing.usd, balance.nativeUsd, `${label}: Cash Book USD equals drawer`);
  assert.equal(cashBook.closing.cdf, balance.nativeCdf, `${label}: Cash Book CDF equals drawer`);
  // Financials and P&L read the same ledger.
  assert.equal(report.net.usd, pnl.net.usd, `${label}: Financials net equals P&L net`);
  const monthsNet = report.months.reduce((total, month) => total + month.net.usd, 0);
  assert.ok(Math.abs(monthsNet - pnl.net.usd) < 0.000001, `${label}: monthly breakdown adds up to P&L`);
}

before(async () => {
  if (skip) return;
  m = await load();
  const { db, settingsTable } = m.dbModule;
  const existing = await db.select().from(settingsTable).limit(1);
  if (existing.length === 0) await db.insert(settingsTable).values({ usdToCdfRate: RATE });
});

after(async () => {
  if (skip) return;
  await m.dbModule.pool.end();
});

test("payments post, correct and cancel through balanced journals", { skip }, async () => {
  const before = await m.reports.getProfitAndLoss();
  const income = await m.payments.createPayment({ direction: "in", category: "other", amount: 30, currency: "USD", notes: "Locker rental" }, ACTOR);
  const expense = await m.payments.createPayment({ direction: "out", category: "expense", amount: 28_000, currency: "CDF", exchangeRate: RATE, notes: "Cleaning" }, ACTOR);

  let pnl = await m.reports.getProfitAndLoss();
  assert.equal(pnl.revenue.usd - before.revenue.usd, 30);
  assert.equal(pnl.expenses.usd - before.expenses.usd, 10);

  await m.payments.updatePayment(income!.id, { amount: 40 }, ACTOR);
  await m.payments.cancelPayment(expense!.id, ACTOR);
  pnl = await m.reports.getProfitAndLoss();
  assert.equal(pnl.revenue.usd - before.revenue.usd, 40);
  assert.equal(pnl.expenses.usd - before.expenses.usd, 0);

  await assert.rejects(m.payments.updatePayment(expense!.id, { amount: 1 }, ACTOR), /cancelled payment cannot be edited/);
  await assert.rejects(
    m.payments.createPayment({ direction: "in", category: "other", amount: 1, currency: "USD", paymentDate: new Date(Date.now() + 3 * DAY) }, ACTOR),
    /future/,
  );
  await assertBooksAgree("after payments");
});

test("cancelling one membership receipt keeps a member who has another", { skip }, async () => {
  const { db, membersTable, pool } = m.dbModule;
  const memberRow = async (id: number) =>
    (await pool.query("SELECT status, deleted_at FROM members WHERE id = $1", [id])).rows[0] as { status: string; deleted_at: Date | null };
  const [member] = await db.insert(membersTable).values({ name: "Receipt Test Member", status: "active" }).returning();
  const receipt = { direction: "in" as const, category: "membership", currency: "USD", memberId: member!.id, memberName: member!.name };
  const first = await m.payments.createPayment({ ...receipt, amount: 30 }, ACTOR);
  const duplicate = await m.payments.createPayment({ ...receipt, amount: 30 }, ACTOR);

  await m.payments.cancelPayment(duplicate!.id, ACTOR);
  let row = await memberRow(member!.id);
  assert.equal(row.status, "active", "a duplicate receipt's cancel leaves the member active");
  assert.equal(row.deleted_at, null);

  await m.payments.cancelPayment(first!.id, ACTOR);
  row = await memberRow(member!.id);
  assert.equal(row.status, "archived", "cancelling the last receipt undoes the registration");
  await assertBooksAgree("after membership receipt cancels");
});

test("stock, sales and supplier balances stay in step with the ledger", { skip }, async () => {
  const { product } = await m.inventory.createProduct({ name: `Test bar ${Date.now()}`, quantity: 10, costPrice: 2, sellingPrice: 5, currency: "USD" }, ACTOR);
  const purchase = await m.inventory.addStockPurchase(product.id, { quantityAdded: 5, costPerUnit: 2, supplier: "Acme", paidFromCash: false }, ACTOR);
  const credits = await m.suppliers.listSupplierCredits();
  const credit = credits.find((row) => row.stockPurchaseId === purchase!.id);
  assert.ok(credit, "a purchase on credit opens a supplier balance");
  assert.equal(credit!.remaining, 10);
  await assert.rejects(m.suppliers.deleteSupplierCredit(credit!.id, ACTOR), /stock purchase on credit/);

  const sale = await m.sales.createSale({ items: [{ productId: product.id, quantity: 2, unitPrice: 5, discount: 0 }], currency: "USD", paymentAmount: 10 }, ACTOR);
  await assertBooksAgree("after sale");
  await assert.rejects(m.payments.cancelPayment(
    (await m.payments.listPayments({ page: 1, limit: 50, search: sale!.saleNumber ?? "" })).items[0]!.id,
    ACTOR,
  ), /Sales screen/);
  await m.sales.voidSale(sale!.id, "Customer returned it", ACTOR);

  await m.inventory.updateProduct(product.id, { quantity: 13, adjustmentReason: "Two bars damaged" }, ACTOR);
  await m.suppliers.addSupplierPayment(credit!.id, { amount: 4 }, ACTOR);
  await assertBooksAgree("after stock adjustments and supplier payment");
});

test("a cash count posts the difference and the drawer then matches the count", { skip }, async () => {
  const balance = await m.ledger.getCurrentBalance();
  const counted = Math.max(0, balance.nativeUsd - 3);
  await m.ledgerService.recordCashCount({ countedUsd: counted, countedCdf: Math.max(0, balance.nativeCdf) }, ACTOR);
  const after = await m.ledger.getCurrentBalance();
  assert.equal(after.nativeUsd, counted);
  await assertBooksAgree("after cash count");
});

test("closing the books moves profit to equity and locks the period", { skip }, async () => {
  const backdated = await m.payments.createPayment({
    direction: "in", category: "other", amount: 12, currency: "USD", paymentDate: new Date(Date.now() - 10 * DAY),
  }, ACTOR);
  const closeDate = new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10);
  // Close with a cash count: the count, revaluation and closing journal land in one transaction.
  const result = await m.periodClose.closePeriod({ closedThroughDate: closeDate, confirmation: m.periodClose.PERIOD_CLOSE_CONFIRMATION, countedUsd: 0, countedCdf: 0 }, ACTOR);
  assert.equal(result.ok, true);
  assert.equal(result.closedThroughDate, closeDate);
  const periods = await m.periodClose.listClosedPeriods();
  assert.equal(periods.items.filter((period) => period.closedThroughDate === closeDate).length, 1, "one period row per close");

  // Income and expense accounts are zero through the close date.
  const closedTotals = await m.reports.getAccountTotals({ to: new Date(result.closedThrough) });
  for (const row of closedTotals.filter((total) => total.type === "income" || total.type === "expense")) {
    assert.ok(Math.abs(row.debitUsd - row.creditUsd) < 0.000001, `${row.name} is closed to Retained Earnings`);
  }

  await assert.rejects(m.payments.updatePayment(backdated!.id, { amount: 13 }, ACTOR), /closed period/);
  await assert.rejects(
    m.payments.createPayment({ direction: "in", category: "other", amount: 1, currency: "USD", paymentDate: new Date(Date.now() - 8 * DAY) }, ACTOR),
    /closed period/,
  );
  // Cancelling is still possible: the reversal lands in the open period.
  await m.payments.cancelPayment(backdated!.id, ACTOR);
  await assert.rejects(
    m.periodClose.closePeriod({ closedThroughDate: closeDate, confirmation: m.periodClose.PERIOD_CLOSE_CONFIRMATION }, ACTOR),
    /already closed/,
  );
  await assertBooksAgree("after period close");
});

test("the database refuses tampering with posted entries", { skip }, async () => {
  const { pool } = m.dbModule;
  await assert.rejects(pool.query("UPDATE accounting_entries SET debit_usd = debit_usd + 1 WHERE id = (SELECT MIN(id) FROM accounting_entries)"));
  await assert.rejects(pool.query("DELETE FROM accounting_entries WHERE id = (SELECT MIN(id) FROM accounting_entries)"));
  await assert.rejects(m.accounting.postJournal({
    entryDate: new Date(),
    sourceType: "test",
    exchangeRate: RATE,
    description: "unbalanced",
    lines: [{ account: "Cash", debitUsd: 1, debitCdf: RATE }],
  }), /does not balance/);
});
