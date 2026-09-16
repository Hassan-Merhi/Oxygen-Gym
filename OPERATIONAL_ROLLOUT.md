# Phase 13 — Operational rollout

The application is released through a persisted, fail-closed rollout control plane:

```text
internal → canary → general
```

The initial database state is always `internal`. No deployment turns on general access by default.

## Cohorts

- **Internal** — administrators plus user IDs listed in `ROLLOUT_INTERNAL_USER_IDS`.
- **Canary** — the internal cohort plus user IDs listed in `ROLLOUT_CANARY_USER_IDS`.
- **General** — every active user.

Both environment variables accept comma-separated numeric user IDs. Administrators retain access to the control plane at every stage. Leave the lists empty when only administrators should receive the internal release.

## Readiness gates

The existing system audit is the source of rollout readiness. Its `error` issues are **blockers** and its `warning` issues are **warnings**; the rollout service does not create a second, divergent checklist.

- `internal → canary` is allowed only when the current audit has zero blockers. Warnings remain visible and are carried into the rollout record.
- `canary → general` is allowed only when there are zero blockers and every current warning has been explicitly acknowledged by an administrator.
- A warning acknowledgement is keyed to the current audit section, severity, record ID, and description. If the underlying warning changes, it becomes a new unacknowledged warning.
- Promotion is one stage at a time. A promotion request is rechecked against a fresh audit report immediately before the state change.
- Rollback is always one stage at a time and requires a reason. It is available for incident response without bypassing the next promotion's readiness gates.

## Operator workflow

1. Run the versioned migration before accepting application traffic:

   ```sh
   DATABASE_URL=... pnpm run db:migrate
   ```

2. Set the cohort IDs in the deployment environment and deploy. The migration creates the singleton `operational_rollouts` row at `internal`.
3. Sign in as an administrator and open **Audit**. The **Operational rollout** panel runs the existing audit checks and shows blockers and warnings.
4. Resolve every blocker. Refresh the panel; do not acknowledge a blocker as a workaround.
5. Promote to **canary**. Confirm login, member workflows, payments, sales, inventory, accounting, and background jobs with the configured canary users.
6. Review the warnings with the owners. Click **Acknowledge warnings** only for risks that have an owner/mitigation, then promote to **general**.
7. Continue monitoring. Use **Roll back** from the same panel if production behavior regresses; include the incident or change reference as the rollback reason.

The control-plane endpoints are also available to an administrator for automation:

- `GET /api/rollout` — current stage plus a fresh readiness report.
- `GET /api/rollout/access` — the current user's cohort decision.
- `POST /api/rollout/acknowledge-warnings` — acknowledge current warning keys.
- `POST /api/rollout/advance` — promote exactly one stage.
- `POST /api/rollout/rollback` — roll back exactly one stage with a reason.

Promotion and rollback actions are recorded in the existing activity log. Do not update `operational_rollouts.stage` directly in production; doing so skips the blockers, warning acknowledgement, and audit trail.

## Emergency behavior

The API authorization gate applies the active stage to all protected application endpoints. Identity, logout, password change, and the access probe remain available to users held outside the active cohort so they can sign out and see why access is paused. If the rollout state cannot be read, protected requests fail closed rather than silently becoming general access.
