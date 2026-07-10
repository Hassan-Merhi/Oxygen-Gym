---
name: GymPro timezone handling
description: Server runs in UTC but the gym's business day is Lubumbashi time (UTC+2); "today" boundaries must use the shared helper, not raw server-local Date.
---

The API server container clock is UTC, but GymPro's business day boundaries (caisse/cash summary, check-ins, dashboard KPIs, accounting totals) must follow Lubumbashi local time (UTC+2).

**Why:** Early on, only one route (payments/caisse summary) was patched with a hardcoded Lubumbashi offset. Other routes kept computing "today" via server-local `new Date()` + `setHours(0,0,0,0)`, which is really UTC. This caused inconsistent day-rollover behavior across pages (some "today" data reset, others didn't) — reported by the user as "caisse doesn't reset to 0 after 9pm."

**How to apply:** Any new "today" boundary in `artifacts/api-server` must use `lubumbashiTodayStart()` / `lubumbashiTodayEnd()` from `artifacts/api-server/src/lib/timezone.ts`. Never use raw `new Date()` + `setHours()` for day boundaries — it silently uses the server's UTC clock, not the gym's local day.
