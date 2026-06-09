import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { db, activityLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

router.use(requireAuth());

// GET /api/activity-logs
router.get("/", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
  const offset = parseInt(String(req.query.offset ?? "0"));

  if (isNaN(limit) || isNaN(offset)) {
    res.status(400).json({ error: "Invalid pagination params" });
    return;
  }

  try {
    const logs = await db
      .select()
      .from(activityLogsTable)
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(logs);
  } catch (err) {
    req.log.error({ err }, "Failed to list activity logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
