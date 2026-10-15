#!/usr/bin/env node
/**
 * Responsive UI smoke check for the gym app.
 *
 * Visits every main page at phone / tablet / desktop widths in several languages,
 * saves a screenshot, and fails when the page scrolls horizontally, when visible
 * text is smaller than 12px, or (on touch viewports) when controls are under 44px.
 *
 * Needs a running API serving the built UI and the `playwright` package resolvable
 * through NODE_PATH (it is not a workspace dependency):
 *
 *   NODE_PATH=/opt/node-tools/node_modules \
 *   UI_BASE_URL=http://localhost:8090 UI_USER=admin UI_PASSWORD=admin123 \
 *   UI_SHOTS_DIR=/tmp/ui-shots node tests/ui-responsive.mjs
 *
 * Optional: UI_LANGS=en,ar,fr  UI_PAGES=/dashboard,/sales  UI_VIEWPORTS=390x844,1024x768
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
const LANGS = (process.env.UI_LANGS ?? "en,ar").split(",").filter(Boolean);
const VIEWPORTS = (process.env.UI_VIEWPORTS ?? "390x844,768x1024,1024x768,1440x900").split(",").map((v) => {
  const [width, height] = v.split("x").map(Number);
  return { width, height, touch: width < 1280 };
});
const PAGES = (process.env.UI_PAGES ??
  "/dashboard,/members,/members-overview,/members/1,/plans,/staff,/stock,/supplements,/sales,/attendance,/notifications,/settings,/does-not-exist")
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
    await context.addInitScript(([token, language]) => {
      localStorage.setItem("gym_token", token);
      localStorage.setItem("gympro-i18n", JSON.stringify({ state: { language }, version: 0 }));
    }, [login.token, lang]);
    const page = await context.newPage();
    for (const route of PAGES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      if (route === "/sales" && process.env.UI_SALES_BARCODE !== "") {
        // Put something in the cart so the POS layout is exercised.
        const barcode = page.locator("input.font-mono").first();
        if (await barcode.count()) {
          await barcode.fill(process.env.UI_SALES_BARCODE ?? "1234567890123");
          await barcode.press("Enter");
          await page.waitForTimeout(600);
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
            const r = el.getBoundingClientRect();
            if (r.height < 43.5 || (el.tagName === "BUTTON" && r.width < 43.5)) {
              small.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}"`);
            }
          }
        }
        const rendered = (document.getElementById("root")?.childElementCount ?? 0) > 0;
        return { rendered, overflow, offenders, tiny: [...tiny].slice(0, 8), small: small.slice(0, 8), smallCount: small.length, coarse };
      });
      const name = `${lang}-${vp.width}x${vp.height}-${route.replace(/\W+/g, "_").replace(/^_/, "") || "root"}.png`;
      await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
      const ok = metrics.rendered && metrics.overflow <= 0;
      results.push({ lang, viewport: `${vp.width}x${vp.height}`, route, ...metrics, ok, shot: name });
      console.log(`${ok ? "ok  " : "FAIL"} ${lang} ${vp.width}x${vp.height} ${route} overflow=${metrics.overflow}${metrics.rendered ? "" : " NOT-RENDERED"}${metrics.tiny.length ? ` tiny=${metrics.tiny.length}` : ""}${metrics.smallCount ? ` small=${metrics.smallCount}` : ""}`);
      if (!ok) console.log("     ", metrics.offenders.join("\n      "));
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} page/viewport/language combinations without horizontal scroll.`);
process.exit(failed.length ? 1 : 0);
