---
name: GymPro auth quirks
description: Clerk setup details and JIT provisioning pattern for GymPro
---

## JIT provisioning
- First user to sign in via Clerk → becomes admin with all permissions.
- Subsequent users → get staff role with minimal permissions.
- Implemented in `artifacts/api-server/src/routes/auth.ts` GET /api/auth/me.
- Uses `getAuth(req)` from `@clerk/express` (not `req.auth` — that's untyped).

## Clerk proxy middleware
- Copied from `.local/skills/clerk-auth/templates/api-server/src/middlewares/clerkProxyMiddleware.ts`.
- Mounted in app.ts BEFORE body parsers and BEFORE clerkMiddleware.
- `clerkMiddleware` uses `publishableKeyFromHost(getClerkProxyHost(req), process.env.CLERK_PUBLISHABLE_KEY)`.

## Frontend wiring
- `publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)` — required, never inline the env var.
- `proxyUrl={clerkProxyUrl}` is unconditional (empty string in dev, auto-set in prod).
- Routes must be exactly `path="/sign-in/*?"` and `path="/sign-up/*?"` for Clerk OAuth sub-paths to work.
- `vite.config.ts`: `tailwindcss({ optimize: false })` required for Clerk themes in prod.
- `index.css`: `@layer theme, base, clerk, components, utilities;` must be before `@import "tailwindcss"`.

**Why:** Any deviation from these patterns breaks OAuth callbacks or prod proxy routing.
