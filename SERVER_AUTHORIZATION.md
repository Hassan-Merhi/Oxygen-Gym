# Server-Side Authorization

The backend is the security boundary. Frontend navigation, hidden buttons, and page visibility are UX only and never grant access.

`artifacts/api-server/src/shared/auth/authorization-policy.ts` is the canonical runtime endpoint policy. `artifacts/api-server/src/shared/auth/authorization-gate.ts` runs before every application API router and denies unclassified or ambiguous endpoints by default.

## Roles and feature permissions

The supported roles remain `admin`, `manager`, and `staff`.

- `admin` is the recovery/superuser role and can access every protected endpoint.
- `manager` and `staff` are authorized by their effective feature permissions. Stored permission JSON is normalized against the role defaults, so legacy partial rows have deterministic behavior.
- An unknown role is denied with `403`.
- Permission failures and escalation attempts return `403`; missing/invalid authentication returns `401`.

The feature-permission keys are `dashboard`, `members`, `plans`, `staff`, `payroll`, `payments`, `vouchers`, `accounts`, `stock`, `sales`, `settings`, `viewCost`, `viewProfit`, `viewAccounting`, `manageStaff`, `manageSettings`, `managePayroll`, `manageInventory`, `manageMembers`, and `managePlans`.

`viewCost` and `viewProfit` are data-visibility permissions, not merely menu flags. Inventory and sales responses are redacted server-side when those permissions are absent.

The authorization gate also enforces the persisted Phase 13 operational rollout. Administrators retain control-plane access at every stage; application requests for other users are limited to the configured internal/canary cohort until the rollout reaches `general`. Identity, logout, password change, and `GET /rollout/access` remain available to held users so the client can explain the staged hold.

## Endpoint → permission matrix

`self` below means the authenticated user's own user ID. `authenticated` means any known active role. `admin` means the administrator role only. Multiple permissions joined by `+` are all required; permissions joined by `OR` require at least one.

| Method | Endpoint | Backend rule |
| --- | --- | --- |
| GET | `/healthz` | public |
| GET | `/auth/setup` | public |
| POST | `/auth/setup` | public one-time bootstrap; route itself refuses after setup |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | authenticated |
| GET | `/auth/me` | authenticated |
| POST | `/auth/change-password` | authenticated/self |
| GET | `/users` | admin |
| POST | `/users` | admin |
| GET | `/users/:id` | self or admin |
| PATCH | `/users/:id` | self or admin; `role`, `status`, `permissions` are admin-only fields |
| DELETE | `/users/:id` | admin |
| PATCH | `/users/:id/permissions` | admin |
| POST | `/users/:id/reset-password` | admin |
| GET | `/settings` | `manageSettings` |
| PATCH | `/settings` | `manageSettings`; backup configuration and Green API credentials are admin-only fields |
| GET | `/activity-logs` | admin |
| GET | `/audit/run` | admin |
| GET | `/rollout/access` | authenticated; staged cohort check is evaluated after endpoint authorization |
| GET | `/rollout` | admin |
| POST | `/rollout/acknowledge-warnings` | admin |
| POST | `/rollout/advance` | admin; zero blockers, plus warning acknowledgement for general |
| POST | `/rollout/rollback` | admin; one-stage rollback with an operator reason |
| POST | `/audit/fix/inventory` | admin |
| POST | `/audit/fix/dashboard` | admin |
| POST | `/audit/fix/accounts` | admin |
| POST | `/upload` | `manageMembers OR manageStaff OR manageInventory OR manageSettings` |
| GET | `/dashboard/kpis` | `dashboard + viewProfit` |
| GET | `/plans` | `plans` |
| POST | `/plans` | `managePlans` |
| PATCH | `/plans/:id` | `managePlans` |
| DELETE | `/plans/:id` | `managePlans` |
| GET | `/members` | `members` |
| POST | `/members` | `manageMembers` |
| GET | `/members/:id` | `members` |
| PATCH | `/members/:id` | `manageMembers` |
| DELETE | `/members/:id` | `manageMembers` |
| POST | `/members/:id/checkin` | `members` |
| POST | `/members/:id/renew` | `manageMembers` |
| POST | `/members/:id/freeze` | `manageMembers` |
| POST | `/members/:id/reactivate` | `manageMembers` |
| PATCH | `/members/:id/status` | `manageMembers` |
| GET | `/members/:id/payments` | `members + payments` |
| GET | `/members/:id/checkins` | `members` |
| GET | `/payments/summary` | `payments` |
| GET | `/payments` | `payments` |
| POST | `/payments` | `payments` |
| GET | `/payments/admin/cash-cleanup` | admin |
| POST | `/payments/admin/cash-cleanup` | admin |
| POST | `/payments/:id/send-receipt` | `payments` |
| PATCH | `/payments/:id` | `payments` |
| DELETE | `/payments/:id` | `payments` |
| GET | `/vouchers` | `vouchers` |
| POST | `/vouchers` | `vouchers` |
| GET | `/vouchers/:id` | `vouchers` |
| PATCH | `/vouchers/:id` | `vouchers` |
| DELETE | `/vouchers/:id` | `vouchers` |
| GET | `/ledger/balance` | `viewAccounting` |
| POST | `/ledger/opening-balance` | admin |
| GET | `/ledger` | `viewAccounting` |
| GET | `/accounts/summary` | `viewAccounting` |
| GET | `/accounts/sales` | `viewAccounting` |
| GET | `/accounts/expenses` | `viewAccounting` |
| GET | `/accounts/profit-loss` | `viewAccounting + viewProfit` |
| GET | `/accounts/chart` | `viewAccounting` |
| POST | `/accounts/chart` | admin |
| PUT | `/accounts/chart/:id` | admin |
| DELETE | `/accounts/chart/:id` | admin |
| GET | `/accounts/chart/:id/statement` | `viewAccounting` |
| GET | `/financials` | `viewAccounting + viewProfit + viewCost` |
| GET | `/stock/summary` | `stock`; cost/profit fields redacted without their visibility permissions |
| GET | `/stock` | `stock`; cost/profit fields redacted without their visibility permissions |
| POST | `/stock` | `manageInventory` |
| GET | `/stock/:id` | `stock`; cost/profit fields redacted without their visibility permissions |
| PATCH | `/stock/:id` | `manageInventory` |
| GET | `/stock/:id/purchases` | `stock`; cost/profit fields redacted without their visibility permissions |
| POST | `/stock/:id/purchases` | `manageInventory` |
| GET | `/stock/:id/history` | `stock`; cost/profit fields redacted without their visibility permissions |
| GET | `/supplier-credits/summary` | `stock + viewCost` |
| GET | `/supplier-credits/products` | `stock + viewCost + viewProfit` |
| GET | `/supplier-credits` | `stock + viewCost` |
| POST | `/supplier-credits` | `manageInventory` |
| PATCH | `/supplier-credits/:id` | `manageInventory` |
| DELETE | `/supplier-credits/:id` | `manageInventory` |
| GET | `/supplier-credits/:id/payments` | `stock + viewCost` |
| POST | `/supplier-credits/:id/payments` | `manageInventory` |
| DELETE | `/supplier-credits/:id/payments/:paymentId` | `manageInventory` |
| GET | `/sales/lookup-barcode` | `sales`; cost/profit fields redacted without their visibility permissions |
| GET | `/sales` | `sales`; cost/profit fields redacted without their visibility permissions |
| GET | `/sales/:id` | `sales`; cost/profit fields redacted without their visibility permissions |
| POST | `/sales` | `sales`; response is redacted without `viewCost`/`viewProfit` |
| PATCH | `/sales/:id` | admin |
| PATCH | `/sales/:id/void` | `sales`; response is redacted without `viewCost`/`viewProfit` |
| GET | `/staff-employees` | `staff + payroll` |
| GET | `/staff-employees/:id` | `staff + payroll` |
| POST | `/staff-employees` | `manageStaff` |
| PATCH | `/staff-employees/:id` | `manageStaff` |
| PATCH | `/staff-employees/:id/archive` | `manageStaff` |
| GET | `/payroll` | `payroll` |
| GET | `/payroll/:id` | `payroll` |
| POST | `/payroll` | `managePayroll` |
| PATCH | `/payroll/:id/pay` | `managePayroll` |
| PATCH | `/payroll/:id/cancel` | `managePayroll` |
| GET | `/commissions/summary` | `payroll` |
| GET | `/attendance/summary` | `members` |
| GET | `/attendance/daily` | `members` |
| GET | `/attendance/monthly` | `members` |
| GET | `/attendance/hourly` | `members` |
| GET | `/attendance/top-members` | `members` |
| GET | `/attendance/today` | `members` |
| GET | `/attendance/week` | `members` |
| GET | `/attendance/list` | `members` |
| GET | `/attendance/plans` | `members` |
| GET | `/attendance/member/:id` | `members` |
| GET | `/notifications` | authenticated; member/stock/payroll notification sources are independently filtered by effective feature permissions |
| GET | `/notifications/count` | authenticated with the same source filtering |
| PATCH | `/notifications/:key/read` | authenticated/self notification state |
| PATCH | `/notifications/read-all` | authenticated/self notification state |
| GET | `/whatsapp/chats` | admin |
| POST | `/whatsapp/chats` | admin |
| PATCH | `/whatsapp/chats/:id` | admin |
| DELETE | `/whatsapp/chats/:id` | admin |
| GET | `/whatsapp/contacts` | admin |
| GET | `/whatsapp/state` | admin |
| POST | `/whatsapp/test` | admin |
| POST | `/whatsapp/send-member/:id` | admin |
| POST | `/whatsapp/broadcast` | admin |
| POST | `/whatsapp/send-daily-summary` | admin |

## Default-deny rule

Every request under the application `/api` router is evaluated by the authorization gate before reaching its endpoint. If a developer adds a new route but does not add exactly one matching entry to the canonical matrix, an authenticated request receives `403`. CI independently parses the mounted Express routers and fails if an endpoint is missing from the matrix or if a matrix entry is stale/ambiguous.

The only exception is `/api/uploads/*`, which is static asset delivery mounted before the application API router so existing `<img>` URLs continue to work. Creating a new upload still requires the protected `POST /api/upload` endpoint. Static uploaded files must therefore be treated as public assets and must not contain secrets, backups, exports, or administrative data.

## Administrative settings and backups

There is currently no HTTP backup/restore/export endpoint. The only backup-related API surface is the settings fields `backupEnabled` and `backupTime`; those fields are hidden from non-admin settings responses and rejected with `403` when a non-admin attempts to change them. Green API credentials are protected the same way.

## Security invariants

1. UI visibility never grants authorization.
2. The database user record, not the role embedded in a JWT, determines the current role and permission set on every authenticated request.
3. Admin-only endpoints remain admin-only even if a manager or staff user is manually granted every feature permission.
4. Role/permission escalation fields are blocked server-side.
5. New unclassified application API routes fail closed.
6. Authorization matrix coverage and role/permission combinations are CI-gated.
7. Rollout promotion re-runs the existing readiness audit; blockers cannot be acknowledged away, and general access requires explicit warning acknowledgement.
8. Rollout state is database-backed and promotion/rollback actions are activity-logged.
