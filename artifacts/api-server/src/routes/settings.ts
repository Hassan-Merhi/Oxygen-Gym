import { contractBody } from "../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { db, settingsTable } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";

const router = Router();

router.use(requireAuth());

// GET /api/settings — returns settings; greenApiToken is redacted for non-admin users
router.get("/", async (req, res) => {
  try {
    let settings = await db.query.settingsTable.findFirst();

    if (!settings) {
      const [created] = await db.insert(settingsTable).values({
        gymName: "My Gym",
        defaultCurrency: "USD",
        usdToCdfRate: 2800,
        language: "fr",
      }).returning();
      settings = created;
    }

    const caller = req.__gymproUser;
    const isAdmin = caller?.role === "admin";

    // Redact token for non-admin users
    if (!isAdmin && settings.greenApiToken) {
      res.json({ ...settings, greenApiToken: "••••••••" });
      return;
    }

    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/settings — credential fields (greenApiInstanceId, greenApiToken) are admin-only
router.patch("/", async (req, res) => {
  const parsed = UpdateSettingsBody.safeParse(contractBody(req, ApiContracts.UpdateSettingsBody));
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }

  const data = parsed.data;
  const caller = req.__gymproUser;
  const isAdmin = caller?.role === "admin";

  // Credential fields require admin
  if (!isAdmin && (data.greenApiInstanceId !== undefined || data.greenApiToken !== undefined)) {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  try {
    let settings = await db.query.settingsTable.findFirst();

    if (!settings) {
      const [created] = await db.insert(settingsTable).values({
        gymName: data.gymName ?? "My Gym",
        phone: data.phone,
        address: data.address,
        defaultCurrency: (data.defaultCurrency as "USD" | "CDF") ?? "USD",
        usdToCdfRate: data.usdToCdfRate ?? 2800,
        language: (data.language as "en" | "fr" | "ar") ?? "fr",
        receiptHeader: data.receiptHeader,
        receiptFooter: data.receiptFooter,
        logoUrl: data.logoUrl,
        receiptLogoUrl: data.receiptLogoUrl,
        membershipCardFooter: data.membershipCardFooter,
        backupEnabled: data.backupEnabled ?? "false",
        backupTime: data.backupTime ?? "02:00",
      }).returning();
      res.json(created);
      return;
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
        ...(data.backupEnabled !== undefined && { backupEnabled: data.backupEnabled }),
        ...(data.backupTime !== undefined && { backupTime: data.backupTime }),
        ...(isAdmin && data.greenApiInstanceId !== undefined && { greenApiInstanceId: data.greenApiInstanceId }),
        ...(isAdmin && data.greenApiToken !== undefined && { greenApiToken: data.greenApiToken }),
        ...(data.dailySummaryEnabled !== undefined && { dailySummaryEnabled: data.dailySummaryEnabled }),
        ...(data.dailySummaryHour !== undefined && { dailySummaryHour: data.dailySummaryHour }),
      })
      .returning();

    // Redact token in response for non-admin
    if (!isAdmin && updated.greenApiToken) {
      res.json({ ...updated, greenApiToken: "••••••••" });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
