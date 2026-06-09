---
name: GymPro auth
description: Local JWT auth replacing Clerk — patterns, token storage, middleware wiring, setup flow
---

## Auth system (Clerk fully removed)

**Provider:** Local username + bcrypt password. JWT signed with `SESSION_SECRET`, 7-day expiry.

**Token storage:** `localStorage` key `gym_token`. Sent as `Authorization: Bearer <token>` on every API request via `setAuthTokenGetter()` from `@workspace/api-spec`.

**Middleware:** `requireAuth()` in `artifacts/api-server/src/middlewares/auth.ts`. Reads Bearer token, calls `verifyToken()`, attaches `req.user = { userId, role, username }`.

**Routes:** `artifacts/api-server/src/routes/auth.ts` — endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/setup`, `POST /api/auth/setup`, `POST /api/auth/change-password`.

**Frontend context:** `artifacts/gym-app/src/lib/auth.tsx` — `AuthProvider` + `useAuth()` hook. Calls `setAuthTokenGetter` in `useEffect` on mount.

**First-run setup flow:**
- `GET /api/auth/setup` returns `{ needsSetup: true }` when no admin has a `passwordHash`.
- Login page auto-redirects to `/setup` if `needsSetup: true`.
- `/setup` page creates the first admin (any existing user row is adopted; a new row is inserted otherwise).
- After setup, `needsSetup` returns `false` — login page shows normally.

**Why:** Replaced Clerk to support future desktop/offline use. No OAuth dependencies. All tokens are local JWTs.

**Staff creation:** Username auto-generated from name (lowercase, spaces → `_`), editable. Password optional on create (admin can set later). `prevUsernameRef` tracks whether username was auto-generated to allow override detection.
