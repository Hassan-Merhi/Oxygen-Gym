#!/usr/bin/env node
/**
 * Seeds a fresh database through the API so tests/ui-responsive.mjs renders real
 * pages: an admin, a plan, members, stock, a sale, an expense, and the reversal
 * lines (a cancelled payment, a voided sale) that the money pages must show.
 *
 *   UI_BASE_URL=http://localhost:8090 UI_USER=admin UI_PASSWORD=admin123 node tests/ui-seed.mjs
 */
import { randomUUID } from "node:crypto";

const BASE = (process.env.UI_BASE_URL ?? "http://localhost:8090").replace(/\/$/, "");
const USER = process.env.UI_USER ?? "admin";
const PASSWORD = process.env.UI_PASSWORD ?? "admin123";

async function call(method, route, body, token) {
  const response = await fetch(`${BASE}/api${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route} → ${response.status} ${JSON.stringify(json)}`);
  return json;
}

const setup = await fetch(`${BASE}/api/auth/setup`).then((r) => r.json()).catch(() => ({}));
if (setup?.needsSetup !== false) {
  await call("POST", "/auth/setup", { username: USER, fullName: "Admin", password: PASSWORD }).catch((error) => {
    if (!String(error.message).includes("Setup already complete")) throw error;
  });
}
const { token } = await call("POST", "/auth/login", { username: USER, password: PASSWORD });
const api = (method, route, body) => call(method, route, body, token);

const plan = await api("POST", "/plans", { name: "Monthly", price: 30, currency: "USD", durationDays: 30 });
const whey = await api("POST", "/stock", {
  name: "Whey Protein", category: "supplement", sellingPrice: 50, costPrice: 30,
  quantity: 20, alertQuantity: 3, currency: "USD", paidFromCash: true,
});
await api("POST", "/stock", {
  name: "Eau 50cl", category: "drink", sellingPrice: 2000, costPrice: 1000,
  quantity: 100, alertQuantity: 10, currency: "CDF", paidFromCash: true,
});

const today = new Date().toISOString();
for (const name of ["Jean Mukendi", "Aline Kabeya", "Patrick Ilunga"]) {
  await api("POST", "/members", {
    name, phone: "+243990000001", planId: plan.id, status: "active",
    discount: 0, startDate: today, amountPaid: 30, currency: "USD",
  });
}

const line = { productId: whey.id, quantity: 1, unitPrice: 50, discount: 0 };
await api("POST", "/sales", { items: [line], currency: "USD", paymentAmount: 50 });
const voided = await api("POST", "/sales", { items: [line], currency: "USD", paymentAmount: 50 });
await api("PATCH", `/sales/${voided.id}/void`, { reason: "Customer returned it" });

await api("POST", "/vouchers", {
  voucherType: "expense", direction: "out", amount: 15, currency: "USD",
  exchangeRate: 2800, category: "Utilities", description: "Electricity", account: "cash",
});
const locker = await api("POST", "/payments", { direction: "in", category: "other", amount: 12, currency: "USD", notes: "Locker rental" });
await api("DELETE", `/payments/${locker.id}`);

console.log("UI seed complete.");
