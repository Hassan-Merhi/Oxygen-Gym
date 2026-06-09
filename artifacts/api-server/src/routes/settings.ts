import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { db, settingsTable } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";

const router = Router();

router.use(requireAuth());

// GET /api/settings
router.get("/", async (req, res) => {
  try {
    let settings = await db.query.settingsTable.findFirst();

    if (!settings) {
      // Seed default settings
      const [created] = await db.insert(settingsTable).values({
        gymName: "My Gym",
        defaultCurrency: "USD",
        usdToCdfRate: 2800,
        language: "en",
      }).returning();
      settings = created;
    }

    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/settings
router.patch("/", async (req, res) => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }

  const data = parsed.data;

  try {
    let settings = await db.query.settingsTable.findFirst();

    if (!settings) {
      const [created] = await db.insert(settingsTable).values({
        gymName: data.gymName ?? "My Gym",
        phone: data.phone,
        address: data.address,
        defaultCurrency: (data.defaultCurrency as "USD" | "CDF") ?? "USD",
        usdToCdfRate: data.usdToCdfRate ?? 2800,
        language: (data.language as "en" | "fr" | "ar") ?? "en",
        receiptHeader: data.receiptHeader,
        receiptFooter: data.receiptFooter,
        logoUrl: data.logoUrl,
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
      })
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
