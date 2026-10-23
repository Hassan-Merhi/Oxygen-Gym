#!/usr/bin/env node
/**
 * Responsive UI smoke check for the gym app.
 *
 * Visits every main page at phone / tablet / desktop widths in several languages,
 * saves a screenshot, and fails when the page scrolls horizontally, when visible
 * text is smaller than 12px, (on touch viewports) when controls are under 44px,
 * or when the POS checkout is out of view below 1280px with a product in the cart.
 *
 * Needs a running API serving the built UI and the `playwright` package resolvable
 * through NODE_PATH (it is not a workspace dependency):
 *
 *   NODE_PATH=/opt/node-tools/node_modules \
 *   UI_BASE_URL=http://localhost:8090 UI_USER=admin UI_PASSWORD=admin123 \
 *   UI_SHOTS_DIR=/tmp/ui-shots node tests/ui-responsive.mjs
 *
 * Seed a fresh database first with `node tests/ui-seed.mjs` (CI does) so pages have data.
 *
 * Optional: UI_LANGS=en,ar,fr  UI_PAGES=/dashboard,/sales  UI_VIEWPORTS=390x844,1024x768  UI_THEME=dark
 *           CHROMIUM_PATH=/opt/pw-browsers/chromium/chrome-linux/chrome
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  console.error("playwright is not resolvable. Set NODE_PATH to a node_modules folder that contains it.");
  process.exit(2);
}

const BASE = (process.env.UI_BASE_URL ?? "http://localhost:8090").replace(/\/$/, "");
const USER = process.env.UI_USER ?? "admin";
const PASSWORD = process.env.UI_PASSWORD ?? "admin123";
const SHOTS = process.env.UI_SHOTS_DIR ?? path.resolve("ui-shots");
const THEME = process.env.UI_THEME === "dark" ? "dark" : "light";
const LANGS = (process.env.UI_LANGS ?? "en,ar").split(",").filter(Boolean);
const VIEWPORTS = (process.env.UI_VIEWPORTS ?? "390x844,768x1024,1024x768,1440x900").split(",").map((v) => {
  const [width, height] = v.split("x").map(Number);
  return { width, height, touch: width < 1280 };
});
const PAGES = (process.env.UI_PAGES ??
  "/dashboard,/members,/members-overview,/members/1,/plans,/staff,/stock,/supplements,/sales,/attendance,/notifications,/settings," +
  "/payments,/accounts,/financials,/audit,/period-reset,/does-not-exist")
  .split(",").filter(Boolean);

mkdirSync(SHOTS, { recursive: true });

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASSWORD }),
}).then((r) => r.json());
if (!login?.token) {
  console.error("Login failed", login);
  process.exit(2);
}

// A product in stock, so the POS check can put something in the cart.
const stock = await fetch(`${BASE}/api/stock`, { headers: { authorization: `Bearer ${login.token}` } }).then((r) => r.json());
const stockRows = Array.isArray(stock) ? stock : (stock?.items ?? []);
const cartProduct = process.env.UI_SALES_PRODUCT ?? stockRows.find((row) => Number(row.quantity) > 0)?.name;
if (PAGES.includes("/sales") && !cartProduct) {
  console.error("No product in stock: the POS cart cannot be exercised. Run tests/ui-seed.mjs first.");
  process.exit(2);
}

const browser = await playwright.chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

const results = [];
for (const lang of LANGS) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      hasTouch: vp.touch,
      isMobile: vp.width < 768,
    });
    await context.addInitScript(([token, language, theme]) => {
      localStorage.setItem("gym-theme", JSON.stringify({ state: { theme }, version: 0 }));
      localStorage.setItem("gym_token", token);
      localStorage.setItem("gympro-i18n", JSON.stringify({ state: { language }, version: 0 }));
    }, [login.token, lang, THEME]);
    const page = await context.newPage();
    for (const route of PAGES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      let checkoutOutOfView = false;
      if (route === "/sales" && cartProduct) {
        // Put a real product in the cart so the cart and checkout layouts are exercised.
        await page.locator('input[type=search][role=combobox]').first().fill(cartProduct);
        await page.locator('[role=listbox] [role=option] button').first().click();
        await page.waitForTimeout(400);
        // Below 1280px the checkout stays pinned to the bottom of the screen.
        if (vp.width < 1280) {
          const box = await page.locator("[data-pos-checkout]").boundingBox();
          checkoutOutOfView = !box || box.y + box.height > vp.height + 1 || box.y < 0;
        }
      }
      const metrics = await page.evaluate(() => {
        const vw = window.innerWidth;
        const overflow = document.documentElement.scrollWidth - vw;
        const offenders = [];
        if (overflow > 0) {
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
              offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
              if (offenders.length > 6) break;
            }
          }
        }
        const isVisible = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const s = getComputedStyle(el);
          return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
        };
        const tiny = new Set();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent?.trim()) continue;
          const el = node.parentElement;
          if (!el || !isVisible(el)) continue;
          if (el.closest(".sr-only, svg")) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 12) tiny.add(`${size}px "${node.textContent.trim().slice(0, 30)}"`);
        }
        const coarse = matchMedia("(pointer: coarse)").matches;
        const small = [];
        if (coarse || vw < 768) {
          for (const el of document.querySelectorAll("main button, main input:not([type=checkbox]):not([type=radio]):not([type=file]), main [role=combobox], header button")) {
            if (!isVisible(el)) continue;
            // A small checkbox or switch counts by its clickable label when it has one.
            const label = el.closest("label");
            const r = (label && label.getBoundingClientRect().height >= 43.5 ? label : el).getBoundingClientRect();
            if (r.height < 43.5 || (el.tagName === "BUTTON" && r.width < 43.5)) {
              small.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}"`);
            }
          }
        }
        const rendered = (document.getElementById("root")?.childElementCount ?? 0) > 0;
        return { rendered, overflow, offenders, tiny: [...tiny].slice(0, 8), small: small.slice(0, 8), smallCount: small.length, coarse };
      });
      const name = `${THEME === "dark" ? "dark-" : ""}${lang}-${vp.width}x${vp.height}-${route.replace(/\W+/g, "_").replace(/^_/, "") || "root"}.png`;
      await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
      const ok = metrics.rendered && metrics.overflow <= 0 && metrics.tiny.length === 0 && metrics.smallCount === 0 && !checkoutOutOfView;
      results.push({ lang, viewport: `${vp.width}x${vp.height}`, route, ...metrics, ok, shot: name });
      console.log(`${ok ? "ok  " : "FAIL"} ${lang} ${vp.width}x${vp.height} ${route} overflow=${metrics.overflow}${metrics.rendered ? "" : " NOT-RENDERED"}${checkoutOutOfView ? " CHECKOUT-OUT-OF-VIEW" : ""}${metrics.tiny.length ? ` tiny=${metrics.tiny.length}` : ""}${metrics.smallCount ? ` small=${metrics.smallCount}` : ""}`);
      if (!ok) console.log("     ", [...metrics.offenders, ...metrics.tiny, ...metrics.small].join("\n      "));
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} page/viewport/language combinations pass (no sideways scroll, no tiny text, touch-size controls, POS checkout in view).`);
process.exit(failed.length ? 1 : 0);
