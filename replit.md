# GymPro

A full gym management web application with multi-language support (English, French, Arabic). Built for gym operators to manage members, staff, payments, stock, and accounting from a single command center.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/gym-app run dev` — run the frontend (port 23457, preview at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — Clerk auth (auto-provisioned)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, wouter routing, Tailwind CSS v4, shadcn/ui
- Auth: Clerk (Replit-managed)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- i18n: Custom Zustand store with persist (EN/FR/AR, RTL support for Arabic)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for API contracts
- `lib/db/src/schema/` — Drizzle table definitions (users.ts, settings.ts)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/gym-app/src/` — React frontend
  - `src/lib/i18n.ts` — i18n store and translations (EN/FR/AR)
  - `src/components/layout/` — sidebar and topbar
  - `src/pages/` — page components

## Architecture decisions

- **JIT user provisioning**: First user to sign in via Clerk becomes admin. Subsequent users get staff role with minimal permissions. This avoids needing a separate admin invite flow.
- **Clerk proxy middleware**: API server proxies Clerk auth requests so the app works from a single domain in production.
- **Session-cookie auth**: The web app uses Clerk session cookies — no Bearer tokens needed on the frontend.
- **Per-user page permissions**: Stored as a JSONB column on the users table for flexible, admin-configurable access control.
- **i18n via Zustand**: Language preference persisted to localStorage, RTL applied to `<html dir>` on language change.

## Product

GymPro is a professional gym management system. Phase 1 delivers:
- Branded landing page + Clerk authentication
- Protected sidebar layout with 11 navigation sections
- Staff management page with full CRUD and 12 per-page permission toggles
- Settings page with gym info, currency (USD/CDF), exchange rate, and language preference
- Dashboard KPI card grid (skeleton, populated in Phase 3)
- Full EN / FR / AR translation with RTL layout for Arabic

## User preferences

- Build phase by phase — stop after each phase and wait for approval
- Multi-language: English, French, Arabic (with RTL)
- Currency: USD and CDF with configurable exchange rate
- Payments are cash only
- Admin controls which pages staff can access per-user
- Staff must NOT see cost prices, profit, or accounting details unless admin allows

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after editing `openapi.yaml`
- Run `pnpm run typecheck:libs` after any `lib/*` change before checking artifact typecheck
- `tailwindcss({ optimize: false })` in vite.config.ts is required for Clerk themes to work in production
- `@layer theme, base, clerk, components, utilities;` must come before `@import "tailwindcss"` in index.css

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Phases 2-13 are defined in `attached_assets/Pasted-Build-a-full-gym-management-web-application-in-phases-U_1781006994857.txt`
