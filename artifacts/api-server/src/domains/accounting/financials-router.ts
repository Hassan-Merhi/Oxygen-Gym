import { contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { toUsdCdf } from "../../shared/accounting/currency";
import { optionalString } from "../../shared/http/validation";
import { getFinancialReport } from "./financials-service";

const router = Router();
router.use(requireAuth());

router.get("/", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.GetFinancialsQueryParams);
  const report = await getFinancialReport({
    period: optionalString(query.period),
    dateFrom: optionalString(query.dateFrom),
    dateTo: optionalString(query.dateTo),
  });

  const currentCdf = (usd: number) => toUsdCdf(Number(usd ?? 0), "USD", report.rate).amountCdf;
  const currentMoney = (value: { usd: number; cdf: number }) => ({
    usd: value.usd,
    cdf: currentCdf(value.usd),
  });

  res.json({
    ...report,
    revenue: currentMoney(report.revenue),
    expenses: currentMoney(report.expenses),
    net: currentMoney(report.net),
    categories: report.categories.map((category) => ({
      ...category,
      cdf: currentCdf(category.usd),
    })),
    months: report.months.map((month) => ({
      ...month,
      revenue: currentMoney(month.revenue),
      expenses: currentMoney(month.expenses),
      net: currentMoney(month.net),
      transactions: month.transactions.map((transaction) => ({
        ...transaction,
        amountCdf: currentCdf(transaction.amountUsd),
      })),
    })),
  });
});

export default router;
