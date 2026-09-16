import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runFullAudit, withReadiness } from "../domains/rollout/readiness";

const router = Router();
router.use(requireAuth());

router.get("/run", async (_req: Request, res: Response) => {
  const report = await runFullAudit();
  res.json(withReadiness(report));
});

// Repairs are deliberately not available through the running HTTP service.
// Keep this compatibility endpoint non-mutating so older UI versions fail safely.
router.post("/fix/inventory", async (_req: Request, res: Response) => {
  res.status(410).json({
    error:
      "Inventory repair is an offline admin operation. Run the guarded repair:inventory-quantities database script explicitly.",
  });
});

router.post("/fix/dashboard", async (_req: Request, res: Response) => {
  res.json({
    message: "Dashboard KPIs are computed dynamically — no cache to clear.",
  });
});

router.post("/fix/accounts", async (_req: Request, res: Response) => {
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN direction='in' THEN amount_usd ELSE -amount_usd END), 0) AS balance_usd,
      COALESCE(SUM(CASE WHEN direction='in' THEN amount_cdf ELSE -amount_cdf END), 0) AS balance_cdf,
      COUNT(*) AS entries
    FROM cash_ledger
  `);
  res.json({ summary: result.rows[0] });
});

export default router;
