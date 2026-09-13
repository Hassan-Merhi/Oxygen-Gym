# Oxygen Gym Architecture

## Contract ownership

`lib/api-spec/openapi.yaml` is the single source of truth for HTTP request and response shapes. `@workspace/api-zod` and `@workspace/api-client-react` are generated from that contract. Generated files are never edited by hand; `pnpm run contracts:check` regenerates both packages and fails when committed output drifts.

## Module boundaries

- `artifacts/gym-app` is the presentation/client layer. It may depend on the generated API client, but never on the database, API server internals, or server-only Node modules.
- `artifacts/api-server` is the HTTP/application layer. It may depend on generated Zod contracts and database/domain packages, but never on the React client or UI artifacts.
- `lib/db` owns database schema and database connectivity. It must not depend on HTTP or UI packages.
- `lib/api-zod` and `lib/api-client-react` are generated contract consumers and must remain independent of application implementations.
- Runtime environment variables are read only by each package's `config/env` module.

## HTTP boundary rules

Routes validate external input with generated Zod schemas before using it. Request bodies, params, and query strings are treated as untrusted data; manual request casts and `as any` escapes are prohibited by the architecture audit. Important response boundaries should use generated response schemas as the contract is migrated.

## Startup and migrations

The server entrypoint should only compose startup concerns: validated configuration, controlled migrations, background-job scheduling, and listening. Schema/data migrations must be idempotent and tracked; business logic belongs in services/jobs rather than the entrypoint or route files.

## Regression gates

Run the full Phase 3 gate locally with:

```sh
pnpm run architecture:check
```

It checks generated contract drift, layer imports, environment access, unsafe API casts, Express/OpenAPI route coverage, duplicate package dependency declarations, and TypeScript type safety. The same gate is enforced by `.github/workflows/architecture.yml` on pull requests and `main`.
