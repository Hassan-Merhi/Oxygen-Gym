import { contractBody, contractParams, contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
import { getExchangeRate, toUsdCdf } from "../../shared/accounting/currency";
import {
  asRecord,
  optionalDate,
  optionalString,
  parseId,
  parseLimit,
  parsePage,
  requiredString,
} from "../../shared/http/validation";
import { listAccountSales } from "./accounts-service";
import { getAccountStatementWithRecovery } from "./account-statement-recovery";
import {
  createChartAccount,
  deactivateChartAccount,
  listChartAccounts,
  updateChartAccount,
} from "./chart-service";
import { getAccountsSummary, getProfitLoss, listAccountExpenses } from "./reporting-service";

const router = Router();
router.use(requireAuth());

function listInput(query: Record<string, string | undefined>) {
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  return {
    page: parsePage(query.page),
    limit: parseLimit(query.limit, 50, 200),
    search: optionalString(query.search),
    dateFrom: optionalDate(query.dateFrom, "dateFrom"),
    dateTo,
    currency: optionalString(query.currency),
  };
}

function cdfFromUsd(usd: number, rate: number) {
  return toUsdCdf(Number(usd ?? 0), "USD", rate).amountCdf;
}

router.get("/summary", async (_req, res) => {
  const [summary, rate] = await Promise.all([getAccountsSummary(), getExchangeRate()]);
  res.json({
    ...summary,
    rate,
    cash: {
      ...summary.cash,
      balanceCdf: cdfFromUsd(summary.cash.balanceUsd, rate),
    },
    sales: {
      ...summary.sales,
      todayCdf: cdfFromUsd(summary.sales.todayUsd, rate),
      monthCdf: cdfFromUsd(summary.sales.monthUsd, rate),
    },
    expenses: {
      ...summary.expenses,
      todayCdf: cdfFromUsd(summary.expenses.todayUsd, rate),
      monthCdf: cdfFromUsd(summary.expenses.monthUsd, rate),
    },
    profit: {
      ...summary.profit,
      todayCdf: cdfFromUsd(summary.profit.todayUsd, rate),
      monthCdf: cdfFromUsd(summary.profit.monthUsd, rate),
    },
  });
});

router.get("/sales", async (req, res) => {
  const [result, rate] = await Promise.all([
    listAccountSales(listInput(contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListSalesEntriesQueryParams))),
    getExchangeRate(),
  ]);
  res.json({
    ...result,
    rate,
    items: result.items.map((item) => ({
      ...item,
      exchangeRate: rate,
      ...toUsdCdf(Number(item.amount ?? 0), item.currency, rate),
    })),
  });
});

router.get("/expenses", async (req, res) => {
  const [result, rate] = await Promise.all([
    listAccountExpenses(listInput(contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListExpenseEntriesQueryParams))),
    getExchangeRate(),
  ]);
  res.json({
    ...result,
    rate,
    items: result.items.map((item) => ({
      ...item,
      exchangeRate: rate,
      ...toUsdCdf(Number(item.amount ?? 0), item.currency, rate),
    })),
  });
});

router.get("/profit-loss", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.GetProfitLossQueryParams);
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  const period = query.period ?? "month";
  const [result, rate] = await Promise.all([
    getProfitLoss({
      period,
      dateFrom: optionalDate(query.dateFrom, "dateFrom"),
      dateTo,
    }),
    getExchangeRate(),
  ]);
  await logActivity(req, "view", "accounts", undefined, { period });
  const currentMoney = (value: { usd: number; cdf: number }) => ({
    usd: value.usd,
    cdf: cdfFromUsd(value.usd, rate),
  });
  res.json({
    ...result,
    rate,
    revenue: currentMoney(result.revenue),
    expenses: currentMoney(result.expenses),
    net: currentMoney(result.net),
    breakdown: Object.fromEntries(
      Object.entries(result.breakdown).map(([key, value]) => [key, {
        ...value,
        cdf: cdfFromUsd(value.usd, rate),
      }]),
    ),
  });
});

router.get("/chart", async (_req, res) => {
  res.json(await listChartAccounts());
});

router.post("/chart", async (req, res) => {
  const body = asRecord(contractBody(req, ApiContracts.CreateChartAccountBody));
  res.status(201).json(await createChartAccount(
    requiredString(body.name, "name"),
    requiredString(body.type, "type"),
    optionalString(body.description),
  ));
});

router.put("/chart/:id", async (req, res) => {
  const body = asRecord(contractBody(req, ApiContracts.UpdateChartAccountBody));
  res.json(await updateChartAccount(parseId(contractParams(req, ApiContracts.UpdateChartAccountParams).id, "account id"), {
    name: optionalString(body.name),
    type: optionalString(body.type),
    description: optionalString(body.description),
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
  }));
});

router.delete("/chart/:id", async (req, res) => {
  res.json(await deactivateChartAccount(parseId(contractParams(req, ApiContracts.DeactivateChartAccountParams).id, "account id")));
});

router.get("/chart/:id/statement", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.GetChartAccountStatementQueryParams);
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  res.json(await getAccountStatementWithRecovery(
    parseId(contractParams(req, ApiContracts.GetChartAccountStatementParams).id, "account id"),
    optionalDate(query.dateFrom, "dateFrom"),
    dateTo,
  ));
});

export default router;
