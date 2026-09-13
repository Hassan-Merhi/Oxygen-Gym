# Backend domain architecture

Backend business workflows follow one direction:

`route -> validation/auth -> domain service -> database`

## Rules

- Routers are HTTP adapters only. They parse inputs, apply authentication/permissions, call a service, log activity where needed, and return the response.
- Business rules and multi-table workflows belong in `src/domains/<domain>/service.ts` or focused service modules.
- Multi-write workflows use `shared/db/transaction.ts` so operational, ledger, and accounting writes commit or roll back together.
- Currency conversion and exchange-rate access use `shared/accounting/currency.ts`.
- Reusable authorization checks use `shared/auth/permissions.ts`.
- Request parsing uses `shared/http/validation.ts`.
- Domain failures throw typed errors from `shared/http/errors.ts`; `app.ts` maps them to API responses centrally.
- New domain logic must not be duplicated in `src/routes`.

## Domain folders

- `members`: member queries, membership commands, pricing, and member notifications.
- `sales`: POS sale, correction, stock deduction, and void workflows.
- `payroll`: payroll generation, payment, cancellation, and commission state transitions.
- `accounting`: payments, vouchers, ledger, chart of accounts, statements, and financial reporting.
- `inventory`: products, stock purchases, supplier credits, and supplier payments.
- `settings`: settings defaults, credential protection, and updates.

The remaining files under `src/routes` are legacy domains that were outside Phase 1. Migrated Phase 1 domains must be mounted from `src/domains` in `src/routes/index.ts`.
