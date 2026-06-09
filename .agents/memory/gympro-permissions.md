---
name: GymPro permissions model
description: Roles, permission flags, and soft-delete architecture for GymPro
---

## Roles
- `admin` — full access, all permissions true by default
- `manager` — elevated access, no accounting/settings by default
- `staff` — minimal, dashboard-only by default

## Permission flags (PagePermissions type in lib/db/src/schema/users.ts)
Page access (11): dashboard, members, plans, staff, payroll, payments, vouchers, accounts, stock, sales, settings
Feature access (9): viewCost, viewProfit, viewAccounting, manageStaff, manageSettings, managePayroll, manageInventory, manageMembers, managePlans

## Soft delete
- `users` table has `deletedAt` timestamp column (null = active).
- All list/get queries must filter `where isNull(usersTable.deletedAt)`.
- DELETE route sets `deletedAt = new Date()` — never hard-deletes.
- Same pattern planned for members, staff records, products, plans.

## Activity logging
- `activity_logs` table: userId, userName, action, entity, entityId, details (jsonb), createdAt.
- `logActivity()` helper in users.ts — wraps insert, swallows errors so logging never breaks requests.
- GET /api/activity-logs returns paginated logs ordered by createdAt desc.

**Why:** Admin must be able to recover deleted records; audit trail required for payroll/accounting integrity.
