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
  assert.equal(evaluateEndpointAccess("PATCH", "/payments/42", user(1, ["payments"])).allowed, true);
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

