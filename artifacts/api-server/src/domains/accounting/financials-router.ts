import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { optionalString } from "../../shared/http/validation";
import { getFinancialReport } from "./financials-service";

const router = Router();
router.use(requireAuth());

router.get("/", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  res.json(await getFinancialReport({
    period: optionalString(query.period),
    dateFrom: optionalString(query.dateFrom),
    dateTo: optionalString(query.dateTo),
  }));
});

export default router;
