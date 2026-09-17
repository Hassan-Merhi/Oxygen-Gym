import { test, expect } from "@playwright/test";

const PHONE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
];

const ADMIN_USER = {
  id: 1,
  username: "mobile-admin",
  name: "Mobile Admin",
  role: "admin",
  status: "active",
  permissions: {
    dashboard: true,
    viewProfit: true,
    members: true,
    plans: true,
    staff: true,
    payroll: true,
    payments: true,
    accounts: true,
    viewAccounting: true,
    viewCost: true,
    stock: true,
    sales: true,
    manageSettings: true,
  },
};

const EMPTY_PAGE = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
};

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installHarness(page, language = "en") {
  const requestCounts = new Map();
  const pageErrors = [];

  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    const key = `${request.method()} ${url.pathname}`;
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  });

  await page.addInitScript(({ language }) => {
    localStorage.setItem("gym_token", "mobile-regression-token");
    localStorage.setItem("gympro-i18n", JSON.stringify({ state: { language }, version: 0 }));
  }, { language });

  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/me") return json(route, ADMIN_USER);
    if (path === "/api/auth/logout") return json(route, {});
    if (path === "/api/dashboard/kpis") {
      return json(route, {
        activeMembers: { count: 0 },
        profit: { total: 0 },
        revenue: { day: 0, month: 0, year: 0 },
        expenses: { day: 0, month: 0, year: 0 },
      });
    }
    if (path === "/api/notifications/count") return json(route, { unread: 0 });
    if (path === "/api/notifications") return json(route, { items: [], total: 0, unread: 0 });
    if (path === "/api/plans") return json(route, []);
    if (path === "/api/members") return json(route, EMPTY_PAGE);
    if (path === "/api/accounts/chart") return json(route, []);
    if (path.startsWith("/api/accounts/chart/") && path.endsWith("/statement")) {
      return json(route, { account: null, rows: [] });
    }
    if (path === "/api/stock/summary") {
      return json(route, {
        totalProducts: 0,
        activeProducts: 0,
        lowStockProducts: 0,
        totalQuantity: 0,
        totalValue: 0,
      });
    }
    if (path === "/api/stock") return json(route, EMPTY_PAGE);
    if (path === "/api/sales") return json(route, EMPTY_PAGE);
    if (path === "/api/settings") {
      return json(route, {
        gymName: "Oxygen Gym",
        currency: "USD",
        exchangeRate: 2800,
      });
    }
    if (path === "/api/payments/summary") {
      return json(route, {
        todayUsd: 0,
        todayCdf: 0,
        balanceUsd: 0,
        balanceCdf: 0,
      });
    }
    if (path === "/api/payments" || path === "/api/vouchers") return json(route, EMPTY_PAGE);
    if (path === "/api/ledger/balance") return json(route, { usd: 0, cdf: 0 });
    if (path === "/api/ledger" || path === "/api/accounts/sales" || path === "/api/accounts/expenses") return json(route, EMPTY_PAGE);
    if (path === "/api/accounts/summary") return json(route, {});
    if (path === "/api/accounts/profit-loss") return json(route, {});
    if (path === "/api/supplier-credits" || path === "/api/supplier-credits/products") return json(route, []);
    if (path === "/api/supplier-credits/summary") return json(route, {});
    if (path === "/api/users") return json(route, []);
    if (path === "/api/staff-employees" || path === "/api/payroll") return json(route, EMPTY_PAGE);
    if (path === "/api/financials") return json(route, {});
    if (path.startsWith("/api/attendance/")) {
      if (path === "/api/attendance/summary") return json(route, {});
      return json(route, []);
    }
    if (path === "/api/whatsapp/state") return json(route, {});

    if (method === "GET") return json(route, {});
    return json(route, {});
  });

  return { requestCounts, pageErrors };
}

async function expectNoDocumentOverflow(page) {
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html, "documentElement horizontal overflow").toBeLessThanOrEqual(1);
  expect(overflow.body, "body horizontal overflow").toBeLessThanOrEqual(1);
}

async function waitForMobileShell(page) {
  await expect(page.getByTestId("button-mobile-menu")).toBeVisible();
  await expect(page.locator("main")).toBeVisible();
}

test("six target phone viewports render without page-wide overflow", async ({ page }) => {
  const harness = await installHarness(page);

  for (const viewport of PHONE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    harness.pageErrors.length = 0;
    await page.goto("/dashboard");
    await waitForMobileShell(page);
    await expectNoDocumentOverflow(page);
    expect(harness.pageErrors, `page errors at ${viewport.width}x${viewport.height}`).toEqual([]);
  }
});

test("core routes remain phone-safe without duplicate current-user reads", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const harness = await installHarness(page);

  await page.goto("/dashboard");
  await waitForMobileShell(page);
  await expectNoDocumentOverflow(page);
  expect(harness.requestCounts.get("GET /api/auth/me") ?? 0).toBe(1);
  expect(harness.requestCounts.get("GET /api/notifications/count") ?? 0).toBe(1);

  for (const testId of ["nav-members", "nav-plans", "nav-accounts", "nav-stock", "nav-sales"]) {
    harness.pageErrors.length = 0;
    await page.getByTestId("button-mobile-menu").click();
    const link = page.getByTestId(testId);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByTestId("button-mobile-menu")).toBeVisible();
    await expectNoDocumentOverflow(page);
    expect(harness.pageErrors, `page errors after ${testId}`).toEqual([]);
  }

  expect(harness.requestCounts.get("GET /api/auth/me") ?? 0, "auth profile must be fetched once per SPA session").toBe(1);
  expect(harness.requestCounts.get("GET /api/notifications/count") ?? 0, "route navigation must not refetch notification count").toBe(1);
});

test("closed drawer is not keyboard-focusable and Escape restores scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installHarness(page);
  await page.goto("/dashboard");
  await waitForMobileShell(page);

  const sidebar = page.locator("aside");
  await expect.poll(() => sidebar.evaluate(element => element.inert)).toBe(true);
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");

  const menuButton = page.getByTestId("button-mobile-menu");
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => sidebar.evaluate(element => element.inert)).toBe(false);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect.poll(() => sidebar.evaluate(element => element.inert)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("plan dialog stays reachable at 320px and closes from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installHarness(page);
  await page.goto("/plans");
  await waitForMobileShell(page);

  await page.getByRole("button", { name: /add plan/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(321);
  expect(box.y + box.height).toBeLessThanOrEqual(569);

  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  expect(focused).toBe("name");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expectNoDocumentOverflow(page);
});

test("Arabic uses RTL and opens the mobile drawer from the right edge", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installHarness(page, "ar");
  await page.goto("/dashboard");
  await waitForMobileShell(page);

  await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await page.getByTestId("button-mobile-menu").click();
  const sidebar = page.locator("aside");
  await expect(sidebar).toBeVisible();
  await page.waitForTimeout(350);
  const box = await sidebar.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(125);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  await expectNoDocumentOverflow(page);
  await page.keyboard.press("Escape");
});

test("landscape mobile and desktop breakpoint transitions stay overflow-free", async ({ page }) => {
  await installHarness(page);

  await page.setViewportSize({ width: 740, height: 390 });
  await page.goto("/sales");
  await waitForMobileShell(page);
  await expectNoDocumentOverflow(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/accounts");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByTestId("button-mobile-menu")).toBeHidden();
  await expectNoDocumentOverflow(page);
});
