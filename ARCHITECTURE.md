# Oxygen Gym Architecture

## Contract ownership

`lib/api-spec/openapi.yaml` is the single source of truth for HTTP request and response shapes. `@workspace/api-zod` and `@workspace/api-client-react` are generated from that contract. Generated files are never edited by hand; `pnpm run contracts:check` regenerates both packages and fails when committed output drifts.

## Module boundaries

- `artifacts/gym-app` is the presentation/client layer. It may depend on the generated API client, but never on the database, API server internals, or server-only Node modules.
- `artifacts/api-server` is the HTTP/application layer. It may depend on generated Zod contracts and database/domain packages, but never on the React client or UI artifacts.
- `lib/db` owns database schema, versioned migrations, and database connectivity. It must not depend on HTTP or UI packages.
- `lib/api-zod` and `lib/api-client-react` are generated contract consumers and must remain independent of application implementations.
- Runtime environment variables are read only by each package's `config/env` module.

## HTTP boundary rules

Every router mounted by `artifacts/api-server/src/routes/index.ts`, including routers implemented under `src/domains`, must validate external input with generated Zod schemas before using it. Request bodies, params, and query strings are treated as untrusted data; raw `req.body`, `req.query`, `req.params`, manual request casts, `router.all`, and `as any` request-context escapes are prohibited by the architecture gates.

Existing implementations may use the centralized `contract*As` adapters while retaining a legacy local view, but validation and normalization still happen through the generated OpenAPI/Zod schema before route logic executes. New route code should consume generated contract output directly.

Contract violations are handled centrally by the API contract error middleware, so invalid inputs return a consistent `400` response rather than leaking parsing details into every route. Important response boundaries should use generated response schemas as the contract is migrated.

## Startup, jobs, and migrations

The API server entrypoint only composes validated configuration, background-job scheduling, and listening. It must not alter schema, seed data, repair historical rows, or perform destructive maintenance during runtime startup.

Schema and data migrations are owned by the versioned `lib/db` migration layer and run explicitly through the deployment migration command. Repair and destructive maintenance remain guarded offline admin operations rather than application routes or startup side effects.

## Regression gates

Run the full Phase 3 gate locally with:

```sh
pnpm run architecture:check
```

It checks generated contract drift, mounted legacy/domain request boundaries, layer imports, environment access, unsafe API casts, explicit-any policy, Express/OpenAPI route coverage, duplicate and dead routers, migration ownership, duplicate package dependency declarations, and TypeScript type safety. The same permanent gate is enforced by `.github/workflows/architecture.yml` on pull requests and `main`, alongside the backend migration/financial-atomicity workflow.
