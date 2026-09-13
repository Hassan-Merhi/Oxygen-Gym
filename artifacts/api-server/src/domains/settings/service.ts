import { db, settingsTable } from "@workspace/db";
import { forbidden } from "../../shared/http/errors";

export interface UpdateSettingsInput {
  gymName?: string;
  phone?: string | null;
  address?: string | null;
  defaultCurrency?: "USD" | "CDF";
  usdToCdfRate?: number;
  language?: "en" | "fr" | "ar";
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  logoUrl?: string | null;
  receiptLogoUrl?: string | null;
  membershipCardFooter?: string | null;
  backupEnabled?: string;
  backupTime?: string;
  greenApiInstanceId?: string | null;
  greenApiToken?: string | null;
  dailySummaryEnabled?: string;
  dailySummaryHour?: number;
}

const ADMIN_ONLY_SETTINGS = [
  "backupEnabled",
  "backupTime",
  "greenApiInstanceId",
  "greenApiToken",
] as const satisfies readonly (keyof UpdateSettingsInput)[];

async function ensureSettings() {
  const existing = await db.query.settingsTable.findFirst();
  if (existing) return existing;

  const [created] = await db.insert(settingsTable).values({
    gymName: "My Gym",
    defaultCurrency: "USD",
    usdToCdfRate: 2800,
    language: "fr",
  }).returning();
  return created;
}

function redactAdminSettings<T extends Record<string, unknown>>(settings: T, isAdmin: boolean) {
  if (isAdmin) return settings;
  const safe = { ...settings } as Record<string, unknown>;
  for (const key of ADMIN_ONLY_SETTINGS) delete safe[key];
  return safe;
}

function assertAdminSettingsAccess(data: UpdateSettingsInput, isAdmin: boolean): void {
  if (isAdmin) return;
  if (ADMIN_ONLY_SETTINGS.some((key) => data[key] !== undefined)) {
    throw forbidden("Administrator permission is required for backup and integration settings");
  }
}

export async function getSettings(isAdmin: boolean) {
  const settings = await ensureSettings();
  return redactAdminSettings(settings as unknown as Record<string, unknown>, isAdmin);
}

export async function updateSettings(data: UpdateSettingsInput, isAdmin: boolean) {
  assertAdminSettingsAccess(data, isAdmin);

  const existing = await db.query.settingsTable.findFirst();
  if (!existing) {
    const [created] = await db.insert(settingsTable).values({
      gymName: data.gymName ?? "My Gym",
      phone: data.phone,
      address: data.address,
      defaultCurrency: data.defaultCurrency ?? "USD",
      usdToCdfRate: data.usdToCdfRate ?? 2800,
      language: data.language ?? "fr",
      receiptHeader: data.receiptHeader,
      receiptFooter: data.receiptFooter,
      logoUrl: data.logoUrl,
      receiptLogoUrl: data.receiptLogoUrl,
      membershipCardFooter: data.membershipCardFooter,
      ...(isAdmin && data.backupEnabled !== undefined && { backupEnabled: data.backupEnabled }),
      ...(isAdmin && data.backupTime !== undefined && { backupTime: data.backupTime }),
      ...(isAdmin && data.greenApiInstanceId !== undefined && { greenApiInstanceId: data.greenApiInstanceId }),
      ...(isAdmin && data.greenApiToken !== undefined && { greenApiToken: data.greenApiToken }),
      ...(data.dailySummaryEnabled !== undefined && { dailySummaryEnabled: data.dailySummaryEnabled }),
      ...(data.dailySummaryHour !== undefined && { dailySummaryHour: data.dailySummaryHour }),
    }).returning();
    return redactAdminSettings(created as unknown as Record<string, unknown>, isAdmin);
  }

  const [updated] = await db.update(settingsTable)
    .set({
      ...(data.gymName !== undefined && { gymName: data.gymName }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.defaultCurrency !== undefined && { defaultCurrency: data.defaultCurrency }),
      ...(data.usdToCdfRate !== undefined && { usdToCdfRate: data.usdToCdfRate }),
      ...(data.language !== undefined && { language: data.language }),
      ...(data.receiptHeader !== undefined && { receiptHeader: data.receiptHeader }),
      ...(data.receiptFooter !== undefined && { receiptFooter: data.receiptFooter }),
      ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
      ...(data.receiptLogoUrl !== undefined && { receiptLogoUrl: data.receiptLogoUrl }),
      ...(data.membershipCardFooter !== undefined && { membershipCardFooter: data.membershipCardFooter }),
      ...(isAdmin && data.backupEnabled !== undefined && { backupEnabled: data.backupEnabled }),
      ...(isAdmin && data.backupTime !== undefined && { backupTime: data.backupTime }),
      ...(isAdmin && data.greenApiInstanceId !== undefined && { greenApiInstanceId: data.greenApiInstanceId }),
      ...(isAdmin && data.greenApiToken !== undefined && { greenApiToken: data.greenApiToken }),
      ...(data.dailySummaryEnabled !== undefined && { dailySummaryEnabled: data.dailySummaryEnabled }),
      ...(data.dailySummaryHour !== undefined && { dailySummaryHour: data.dailySummaryHour }),
    })
    .returning();

  return redactAdminSettings(updated as unknown as Record<string, unknown>, isAdmin);
}
