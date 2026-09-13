# Database migrations and transaction policy

The application runtime must be read-only with respect to database schema and historical data repair. `artifacts/api-server/src/index.ts` starts the HTTP server and scheduled application jobs only; it must never create/alter tables, seed accounting rows, backfill history, wipe data, or run repair SQL.

## Versioned migrations

The canonical migration history lives in `lib/db/drizzle/` and is applied with:

```sh
pnpm run db:migrate
```

Render runs this command during the deploy build before the application is built. The migration runner takes a PostgreSQL advisory lock so overlapping deploys cannot advance the Drizzle migration journal concurrently.

`0000_current_schema.sql` is an idempotent baseline. It can initialize a fresh database and safely baseline a database that existed before Phase 2. It contains schema creation, legacy-compatible `ADD COLUMN IF NOT EXISTS` statements, indexes, and deterministic chart-of-accounts seed rows. It does **not** contain historical data repairs or destructive cleanup.

Future schema changes must be added as immutable, incrementally numbered SQL migrations (for example `0001_...sql`, `0002_...sql`) and registered in `drizzle/meta/_journal.json`. Do not edit an already-applied migration to change production state, and do not use `drizzle-kit push` as a production migration path.

## One-time repair/admin scripts

Repairs are offline admin operations and are never called from server startup or normal HTTP routes.

- `repair:legacy-financials` requires `DB_REPAIR_CONFIRM=repair_legacy_financials_v1`.
- `repair:inventory-quantities` requires `DB_REPAIR_CONFIRM=repair_inventory_quantities_v1`.
- `admin:cash-wipe-v1` is destructive and requires **all three** confirmations: `ALLOW_DESTRUCTIVE_DB_ADMIN=YES`, `CASH_WIPE_CONFIRM=cash_wipe_v1`, and `CASH_WIPE_PHRASE=DELETE_FINANCIAL_HISTORY`.

Each repair/wipe script requires `DATABASE_URL`, uses a database transaction, and takes an advisory lock. Never add these commands to `start`, `build`, deploy startup hooks, cron jobs, or HTTP endpoints.

## Transaction policy

Use `withTransaction()` from `@workspace/db` for any workflow that performs more than one consistency-related database write. Repository/helper functions accept `DbExecutor`, which lets the same helper run on the root database client for a single read or join an existing transaction for multi-step work.

Rules:

1. Number allocation (`getNextNumber`) must use the same transaction as the row being created when the number belongs to that row.
2. Cash-ledger writes must use `appendLedgerEntry`; it serializes running-balance writes with an advisory transaction lock.
3. Inventory quantity/cost changes, sale + stock + payment writes, payment/voucher accounting corrections, payroll lifecycle changes, supplier-credit balances, and member renewal/payment changes must commit or roll back as one unit.
4. Rows whose current value is used to calculate a new balance/status/cost should be locked with `FOR UPDATE` inside the transaction.
5. Do not swallow database/accounting errors inside a consistency transaction. Let the transaction roll back.
6. External side effects such as WhatsApp messages and activity notifications that do not define database correctness should run after the database transaction commits.

## Query/repository helpers

Repeated database reads belong in `artifacts/api-server/src/repositories/` rather than being copied into routes. For example, exchange-rate/default-currency reads are centralized in `repositories/settings.ts`. Add another repository helper when the same query or normalization rule appears in multiple domains.

## Deployment safety

The current Render Blueprint applies migrations in the build command because the configured service plan does not provide a separate paid pre-deploy migration hook. This means a successful migration can be applied even if a later application build step fails. Migrations therefore must remain forward-compatible, deterministic, and safe to apply before the new process starts.
