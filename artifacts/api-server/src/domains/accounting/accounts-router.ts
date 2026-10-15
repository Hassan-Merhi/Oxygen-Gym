import { contractBody, contractParams, contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
import { getCurrentUser } from "../../shared/auth/permissions";
import { badRequest } from "../../shared/http/errors";
import {
  asRecord,
  optionalString,
  parseId,
  parseLimit,
  parsePage,
  requiredString,
} from "../../shared/http/validation";
import {
  createChartAccount,
  deactivateChartAccount,
  listChartAccounts,
  updateChartAccount,
} from "./chart-service";
import { getBalanceSheet, getTrialBalance } from "./ledger-reports";
import { closePeriod, listClosedPeriods } from "./period-close-service";
import { rangeEnd, rangeStart } from "./report-dates";
import {
  getAccountStatement,
  getAccountsSummary,
  getProfitLoss,
  listAccountExpenses,
  listAccountSales,
} from "./reporting-service";

const router = Router();
router.use(requireAuth());

function listInput(query: Record<string, string | undefined>) {
  return {
    page: parsePage(query.page),
    limit: parseLimit(query.limit, 50, 200),
    search: optionalString(query.search),
    dateFrom: rangeStart(query.dateFrom),
    dateTo: rangeEnd(query.dateTo),
    currency: optionalString(query.currency),
  };
}

function optionalAmount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw badRequest(`${field} must be a non-negative number`);
  return parsed;
}

router.get("/summary", async (_req, res) => {
  res.json(await getAccountsSummary());
});

router.get("/sales", async (req, res) => {
  res.json(await listAccountSales(listInput(contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListSalesEntriesQueryParams))));
});

router.get("/expenses", async (req, res) => {
  res.json(await listAccountExpenses(listInput(contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListExpenseEntriesQueryParams))));
});

router.get("/profit-loss", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.GetProfitLossQueryParams);
  const period = query.period ?? "month";
  const result = await getProfitLoss({ period, dateFrom: query.dateFrom, dateTo: query.dateTo });
  await logActivity(req, "view", "accounts", undefined, { period });
  res.json(result);
});

router.get("/trial-balance", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.GetTrialBalanceQueryParams);
  res.json(await getTrialBalance(rangeEnd(query.asOf, "asOf")));
});

router.get("/balance-sheet", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.GetBalanceSheetQueryParams);
  res.json(await getBalanceSheet(rangeEnd(query.asOf, "asOf")));
});

router.get("/periods", async (_req, res) => {
  res.json(await listClosedPeriods());
});

router.post("/periods/close", async (req, res) => {
  const body = asRecord(contractBody(req, ApiContracts.ClosePeriodBody));
  const result = await closePeriod({
    closedThroughDate: requiredString(body.closedThroughDate, "closedThroughDate"),
    confirmation: requiredString(body.confirmation, "confirmation"),
    countedUsd: optionalAmount(body.countedUsd, "countedUsd"),
    countedCdf: optionalAmount(body.countedCdf, "countedCdf"),
    notes: optionalString(body.notes),
  }, getCurrentUser(req).name);
  await logActivity(req, "create", "period_close", result.periodId, { closedThrough: result.closedThroughDate, netIncome: result.netIncome });
  res.json(result);
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
  res.json(await getAccountStatement(
    parseId(contractParams(req, ApiContracts.GetChartAccountStatementParams).id, "account id"),
    rangeStart(query.dateFrom),
    rangeEnd(query.dateTo),
  ));
});

export default router;
