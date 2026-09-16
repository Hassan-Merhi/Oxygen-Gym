import { and, eq } from "drizzle-orm";
import {
  db,
  operationalRolloutsTable,
  type OperationalRollout,
} from "@workspace/db";
import { env } from "../../config/env";
import { badRequest, conflict } from "../../shared/http/errors";
import {
  buildReadinessSummary,
  runFullAudit,
  type ReadinessSummary,
} from "./readiness";

export const ROLLOUT_STAGES = ["internal", "canary", "general"] as const;
export type RolloutStage = (typeof ROLLOUT_STAGES)[number];

const ROLLOUT_ID = 1;
const FEATURE_KEY = "phase-13-operational-rollout";

export interface RolloutActor {
  id: number;
  name: string;
  role: string;
}

export interface RolloutAccess {
  stage: RolloutStage;
  allowed: boolean;
  cohort: "admin" | "internal" | "canary" | "general" | "none";
  reason: string;
}

export interface OperationalRolloutStatus {
  featureKey: string;
  stage: RolloutStage;
  nextStage: RolloutStage | null;
  canAdvance: boolean;
  updatedAt: string;
  lastTransitionAt: string | null;
  updatedBy: number | null;
  updatedByName: string | null;
  acknowledgedWarningKeys: string[];
  readiness: ReadinessSummary;
}

let cachedRecord: OperationalRollout | undefined;
let cacheExpiresAt = 0;

function isRolloutStage(value: string): value is RolloutStage {
  return (ROLLOUT_STAGES as readonly string[]).includes(value);
}

function asRolloutStage(value: string): RolloutStage {
  if (!isRolloutStage(value)) {
    throw new Error(`Invalid operational rollout stage in database: ${value}`);
  }
  return value;
}

function nextStage(stage: RolloutStage): RolloutStage | null {
  if (stage === "internal") return "canary";
  if (stage === "canary") return "general";
  return null;
}

function previousStage(stage: RolloutStage): RolloutStage | null {
  if (stage === "general") return "canary";
  if (stage === "canary") return "internal";
  return null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

async function ensureRolloutRecord(): Promise<OperationalRollout> {
  const existing = await db.query.operationalRolloutsTable.findFirst({
    where: (table, operators) => operators.eq(table.id, ROLLOUT_ID),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(operationalRolloutsTable)
    .values({
      id: ROLLOUT_ID,
      featureKey: FEATURE_KEY,
      stage: "internal",
      acknowledgedWarningKeys: [],
    })
    .onConflictDoNothing({ target: operationalRolloutsTable.id })
    .returning();

  if (created) return created;
  const retried = await db.query.operationalRolloutsTable.findFirst({
    where: (table, operators) => operators.eq(table.id, ROLLOUT_ID),
  });
  if (!retried)
    throw new Error("Operational rollout state could not be initialized");
  return retried;
}

async function getRecord(): Promise<OperationalRollout> {
  const now = Date.now();
  if (cachedRecord && cacheExpiresAt > now) return cachedRecord;
  const record = await ensureRolloutRecord();
  cachedRecord = record;
  cacheExpiresAt = now + 5_000;
  return record;
}

function invalidateRecordCache(): void {
  cachedRecord = undefined;
  cacheExpiresAt = 0;
}

function accessFor(stage: RolloutStage, actor: RolloutActor): RolloutAccess {
  if (actor.role === "admin") {
    return {
      stage,
      allowed: true,
      cohort: "admin",
      reason:
        "Administrators retain control-plane access at every rollout stage.",
    };
  }

  const isInternal = env.rolloutInternalUserIds.includes(actor.id);
  const isCanary = env.rolloutCanaryUserIds.includes(actor.id);
  if (stage === "general") {
    return {
      stage,
      allowed: true,
      cohort: "general",
      reason: "The rollout is enabled for all active users.",
    };
  }
  if (stage === "canary" && (isInternal || isCanary)) {
    return {
      stage,
      allowed: true,
      cohort: isInternal ? "internal" : "canary",
      reason: "This user is included in the internal or canary cohort.",
    };
  }
  if (stage === "internal" && isInternal) {
    return {
      stage,
      allowed: true,
      cohort: "internal",
      reason: "This user is included in the internal cohort.",
    };
  }

  return {
    stage,
    allowed: false,
    cohort: "none",
    reason:
      stage === "internal"
        ? "The rollout is currently limited to the internal cohort."
        : "The rollout is currently limited to the internal and canary cohorts.",
  };
}

function statusFrom(
  record: OperationalRollout,
  readiness: ReadinessSummary,
): OperationalRolloutStatus {
  const stage = asRolloutStage(record.stage);
  const following = nextStage(stage);
  const canAdvance =
    stage === "internal"
      ? readiness.readyForCanary
      : stage === "canary"
        ? readiness.readyForGeneral
        : false;

  return {
    featureKey: record.featureKey,
    stage,
    nextStage: following,
    canAdvance,
    updatedAt: record.updatedAt.toISOString(),
    lastTransitionAt: isoOrNull(record.lastTransitionAt),
    updatedBy: record.updatedBy,
    updatedByName: record.updatedByName,
    acknowledgedWarningKeys: readiness.acknowledgedWarningKeys,
    readiness,
  };
}

export async function getRolloutAccess(
  actor: RolloutActor,
): Promise<RolloutAccess> {
  const record = await getRecord();
  return accessFor(asRolloutStage(record.stage), actor);
}

export async function getOperationalRollout(): Promise<OperationalRolloutStatus> {
  const record = await getRecord();
  const report = await runFullAudit();
  return statusFrom(
    record,
    buildReadinessSummary(report, record.acknowledgedWarningKeys),
  );
}

function assertWarningKeysExist(
  requestedKeys: readonly string[],
  readiness: ReadinessSummary,
): void {
  const available = new Set(readiness.warnings.map((warning) => warning.key));
  const unknown = requestedKeys.filter((key) => !available.has(key));
  if (unknown.length > 0) {
    throw badRequest(
      "One or more warning acknowledgements no longer match the current readiness report",
      {
        unknownWarningKeys: unknown,
      },
    );
  }
}

async function updateRecord(
  current: OperationalRollout,
  values: {
    stage?: RolloutStage;
    acknowledgedWarningKeys?: string[];
    actor: RolloutActor;
    transition: boolean;
  },
): Promise<OperationalRollout> {
  const now = new Date();
  const [updated] = await db
    .update(operationalRolloutsTable)
    .set({
      ...(values.stage ? { stage: values.stage } : {}),
      ...(values.acknowledgedWarningKeys
        ? { acknowledgedWarningKeys: values.acknowledgedWarningKeys }
        : {}),
      updatedBy: values.actor.id,
      updatedByName: values.actor.name,
      ...(values.transition ? { lastTransitionAt: now } : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(operationalRolloutsTable.id, ROLLOUT_ID),
        eq(operationalRolloutsTable.stage, current.stage),
        eq(operationalRolloutsTable.updatedAt, current.updatedAt),
      ),
    )
    .returning();

  if (!updated) {
    invalidateRecordCache();
    throw conflict(
      "Operational rollout changed in another session. Refresh readiness and try again.",
    );
  }
  invalidateRecordCache();
  return updated;
}

export async function acknowledgeWarnings(
  actor: RolloutActor,
  warningKeys: readonly string[],
): Promise<OperationalRolloutStatus> {
  const record = await getRecord();
  const report = await runFullAudit();
  const readiness = buildReadinessSummary(
    report,
    record.acknowledgedWarningKeys,
  );
  const requested = unique(warningKeys);
  assertWarningKeysExist(requested, readiness);

  const acknowledgedWarningKeys = unique([
    ...record.acknowledgedWarningKeys,
    ...requested,
  ]);
  const updated = await updateRecord(record, {
    acknowledgedWarningKeys,
    actor,
    transition: false,
  });
  const updatedReport = await runFullAudit();
  return statusFrom(
    updated,
    buildReadinessSummary(updatedReport, updated.acknowledgedWarningKeys),
  );
}

export async function advanceOperationalRollout(
  actor: RolloutActor,
  target: RolloutStage,
  warningKeys: readonly string[] = [],
): Promise<OperationalRolloutStatus> {
  const record = await getRecord();
  const stage = asRolloutStage(record.stage);
  const expectedTarget = nextStage(stage);
  if (!expectedTarget || target !== expectedTarget) {
    throw conflict(
      `Rollout can only advance one stage at a time from ${stage}`,
      {
        currentStage: stage,
        requestedStage: target,
        expectedStage: expectedTarget,
      },
    );
  }

  const report = await runFullAudit();
  const requested = unique(warningKeys);
  const currentReadiness = buildReadinessSummary(
    report,
    record.acknowledgedWarningKeys,
  );
  assertWarningKeysExist(requested, currentReadiness);
  const acknowledgedWarningKeys = unique([
    ...record.acknowledgedWarningKeys,
    ...requested,
  ]);
  const readiness = buildReadinessSummary(report, acknowledgedWarningKeys);

  if (
    readiness.blockerCount > 0 ||
    (target === "general" && !readiness.readyForGeneral)
  ) {
    throw conflict(
      target === "general"
        ? "General rollout is blocked until all readiness blockers are fixed and warnings are acknowledged."
        : "Canary rollout is blocked until all readiness blockers are fixed.",
      {
        currentStage: stage,
        requestedStage: target,
        readiness,
      },
    );
  }

  const updated = await updateRecord(record, {
    stage: target,
    acknowledgedWarningKeys,
    actor,
    transition: true,
  });
  const updatedReport = await runFullAudit();
  return statusFrom(
    updated,
    buildReadinessSummary(updatedReport, updated.acknowledgedWarningKeys),
  );
}

export async function rollbackOperationalRollout(
  actor: RolloutActor,
  target: RolloutStage,
): Promise<OperationalRolloutStatus> {
  const record = await getRecord();
  const stage = asRolloutStage(record.stage);
  const expectedTarget = previousStage(stage);
  if (!expectedTarget || target !== expectedTarget) {
    throw conflict(
      `Rollout can only roll back one stage at a time from ${stage}`,
      {
        currentStage: stage,
        requestedStage: target,
        expectedStage: expectedTarget,
      },
    );
  }

  const updated = await updateRecord(record, {
    stage: target,
    actor,
    transition: true,
  });
  const report = await runFullAudit();
  return statusFrom(
    updated,
    buildReadinessSummary(report, updated.acknowledgedWarningKeys),
  );
}

/**
 * These endpoints keep an operator able to inspect the rollout and leave the
 * application safely even when the current user is outside the active cohort.
 */
export function isRolloutControlEndpoint(
  method: string,
  path: string,
): boolean {
  const normalizedMethod = method.toUpperCase();
  return (
    (normalizedMethod === "GET" && path === "/auth/me") ||
    (normalizedMethod === "POST" &&
      (path === "/auth/logout" || path === "/auth/change-password")) ||
    (normalizedMethod === "GET" && path === "/rollout/access")
  );
}
