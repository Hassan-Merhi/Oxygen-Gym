import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateEndpointAccess,
  matchingEndpointPolicies,
  type AuthorizationUser,
  type FeaturePermission,
} from "../artifacts/api-server/src/shared/auth/authorization-policy";
import {
  addMoney,
  divideMoney,
  fxRate,
  money,
  multiplyMoney,
  subtractMoney,
} from "../artifacts/api-server/src/shared/accounting/decimal";
import { AddStockPurchaseBody, CreatePaymentBody, UpdatePaymentBody } from "../lib/api-zod/src/generated/api";
import { dailySummaryBusinessDay } from "../artifacts/api-server/src/lib/timezone";

function user(id: number, permissions: FeaturePermission[] = [], role = "manager"): AuthorizationUser {
  return {
    id,
    role,
    permissions: Object.fromEntries(permissions.map((permission) => [permission, true])) as AuthorizationUser["permissions"],
  };
}

test("critical API routes have one unambiguous authorization policy", () => {
  const routes: Array<[string, string]> = [
    ["GET", "/ledger/movements"],
    ["GET", "/ledger/balance"],
    ["POST", "/payments"],
    ["PATCH", "/payments/42"],
    ["GET", "/members/42"],
    ["PATCH", "/members/42"],
    ["GET", "/stock/42"],
    ["POST", "/stock/42/purchases"],
  ];

  for (const [method, path] of routes) {
    assert.equal(matchingEndpointPolicies(method, path).length, 1, `${method} ${path} must have exactly one policy`);
  }
});

test("ledger and accounting reads require viewAccounting", () => {
  assert.equal(evaluateEndpointAccess("GET", "/ledger/movements").status, 401);
  assert.equal(evaluateEndpointAccess("GET", "/ledger/movements", user(1)).status, 403);
  assert.equal(evaluateEndpointAccess("GET", "/ledger/movements", user(1, ["viewAccounting"])).allowed, true);
  assert.equal(evaluateEndpointAccess("GET", "/ledger/balance", user(1, ["viewAccounting"])).allowed, true);
});

test("payments remain permission-gated", () => {
  assert.equal(evaluateEndpointAccess("POST", "/payments", user(1)).status, 403);
  assert.equal(evaluateEndpointAccess("POST", "/payments", user(1, ["payments"])).allowed, true);
  // Corrections are maker-checker: recording a payment does not allow editing or cancelling one.
  assert.equal(evaluateEndpointAccess("PATCH", "/payments/42", user(1, ["payments"])).status, 403);
  assert.equal(evaluateEndpointAccess("PATCH", "/payments/42", user(1, ["payments", "approveCorrections"])).allowed, true);
  assert.equal(evaluateEndpointAccess("DELETE", "/vouchers/42", user(1, ["vouchers"])).status, 403);
  assert.equal(evaluateEndpointAccess("PATCH", "/sales/42/void", user(1, ["sales"])).status, 403);
  assert.equal(evaluateEndpointAccess("PATCH", "/sales/42/void", user(1, ["sales", "approveCorrections"])).allowed, true);
});

test("closing the books is admin-only", () => {
  assert.equal(evaluateEndpointAccess("POST", "/accounts/periods/close", user(1, ["viewAccounting", "approveCorrections"])).status, 403);
  assert.equal(evaluateEndpointAccess("POST", "/accounts/periods/close", user(1, [], "admin")).allowed, true);
  assert.equal(evaluateEndpointAccess("GET", "/accounts/trial-balance", user(1, ["viewAccounting"])).allowed, true);
});

test("member reads and mutations use separate permissions", () => {
  assert.equal(evaluateEndpointAccess("GET", "/members/42", user(1, ["members"])).allowed, true);
  assert.equal(evaluateEndpointAccess("PATCH", "/members/42", user(1, ["members"])).status, 403);
  assert.equal(evaluateEndpointAccess("PATCH", "/members/42", user(1, ["manageMembers"])).allowed, true);
});

test("stock reads and purchases use the intended inventory permissions", () => {
  assert.equal(evaluateEndpointAccess("GET", "/stock/42", user(1, ["stock"])).allowed, true);
  assert.equal(evaluateEndpointAccess("POST", "/stock/42/purchases", user(1, ["stock"])).status, 403);
  assert.equal(evaluateEndpointAccess("POST", "/stock/42/purchases", user(1, ["manageInventory"])).allowed, true);
});

test("admin-only accounting mutations cannot be delegated", () => {
  assert.equal(evaluateEndpointAccess("POST", "/ledger/opening-balance", user(1, ["viewAccounting"])).status, 403);
  assert.equal(evaluateEndpointAccess("POST", "/ledger/opening-balance", user(1, [], "admin")).allowed, true);
});

test("authorization remains default-deny for unclassified routes", () => {
  const decision = evaluateEndpointAccess("GET", "/internal/not-classified", user(1, ["viewAccounting"]));
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 403);
  assert.match(decision.reason, /not classified/i);
});

test("self-service user endpoints do not allow cross-user access", () => {
  assert.equal(evaluateEndpointAccess("GET", "/users/7", user(7)).allowed, true);
  assert.equal(evaluateEndpointAccess("GET", "/users/8", user(7)).status, 403);
});

test("accounting decimal helpers preserve configured precision and reject invalid math", () => {
  assert.equal(money(0.1 + 0.2), 0.3);
  assert.equal(addMoney(0.1, 0.2, 0.3), 0.6);
  assert.equal(subtractMoney(10.1234567, 0.1234562), 10.000001);
  assert.equal(multiplyMoney(12.345678, 2), 24.691356);
  assert.equal(divideMoney(10, 4), 2.5);
  assert.equal(fxRate(2800.123456789), 2800.12345679);
  assert.throws(() => fxRate(0), /greater than zero/i);
  assert.throws(() => divideMoney(10, 0), /non-zero/i);
});


test("stock purchase contract allows system exchange rate fallback", () => {
  const parsed = AddStockPurchaseBody.safeParse({
    quantityAdded: 3,
    costPerUnit: 12.5,
    totalCost: 37.5,
    currency: "CDF",
    supplier: null,
    notes: null,
    paidFromCash: false,
    purchaseDate: "2026-09-18",
  });

  assert.equal(parsed.success, true, "exchangeRate should be optional so the server can use the configured system rate");
});

test("payment contract allows the server to own the exchange rate", () => {
  const payment = {
    direction: "out",
    category: "expense",
    linkedEntityName: null,
    amount: 30000,
    discount: 0,
    currency: "CDF",
    account: "cash",
    notes: "POUBELLE",
    paymentDate: "2026-09-19",
  };

  assert.equal(
    CreatePaymentBody.safeParse(payment).success,
    true,
    "new payments should not require a client-supplied exchange rate",
  );
  assert.equal(
    UpdatePaymentBody.safeParse(payment).success,
    true,
    "payment edits should not require a client-supplied exchange rate",
  );
});


test("scheduled 21:00 WhatsApp closeout covers the business day that just ended", () => {
  // 19:00 UTC is 21:00 in Lubumbashi: the previous business day
  // is 20/10/2026, NOT the just-opened 21/10/2026.
  const cutoff = new Date("2026-10-20T19:00:00.000Z");
  const closed = dailySummaryBusinessDay(cutoff, true);
  assert.equal(closed.dateKey, "2026-10-20");
  assert.equal(closed.start.toISOString(), "2026-10-19T19:00:00.000Z");
  assert.equal(closed.end.toISOString(), "2026-10-20T18:59:59.999Z");

  const current = dailySummaryBusinessDay(cutoff);
  assert.equal(current.dateKey, "2026-10-21");
  assert.equal(current.start.toISOString(), "2026-10-20T19:00:00.000Z");
  assert.equal(current.end.toISOString(), "2026-10-21T18:59:59.999Z");
});

test("manual WhatsApp summary keeps the ongoing business day before cutoff", () => {
  const beforeCutoff = new Date("2026-10-20T18:59:59.999Z");
  const current = dailySummaryBusinessDay(beforeCutoff);
  assert.equal(current.dateKey, "2026-10-20");
  assert.equal(current.end.toISOString(), "2026-10-20T18:59:59.999Z");
});

test("list date filters use the 21:00 Lubumbashi business day like the reports", async () => {
  const { rangeEnd, rangeStart } = await import("../artifacts/api-server/src/domains/accounting/report-dates");
  // 23/10/2026 runs from 22/10 21:00 to 23/10 21:00 Lubumbashi (UTC+2).
  assert.equal(rangeStart("2026-10-23")!.toISOString(), "2026-10-22T19:00:00.000Z");
  assert.equal(rangeEnd("2026-10-23")!.toISOString(), "2026-10-23T18:59:59.999Z");

  const { readFileSync } = await import("node:fs");
  for (const file of [
    "artifacts/api-server/src/domains/accounting/payments-router.ts",
    "artifacts/api-server/src/domains/accounting/vouchers-router.ts",
    "artifacts/api-server/src/domains/sales/router.ts",
    "artifacts/api-server/src/domains/payroll/router.ts",
    "artifacts/api-server/src/routes/attendance.ts",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /setHours\(23/, `${file} must not end a filter at server midnight`);
  }
});
