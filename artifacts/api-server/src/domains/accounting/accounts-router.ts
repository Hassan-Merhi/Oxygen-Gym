import { contractBody, contractParams, contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
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
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  const period = query.period ?? "month";
  const result = await getProfitLoss({
    period,
    dateFrom: optionalDate(query.dateFrom, "dateFrom"),
    dateTo,
  });
  await logActivity(req, "view", "accounts", undefined, { period });
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
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  res.json(await getAccountStatementWithRecovery(
    parseId(contractParams(req, ApiContracts.GetChartAccountStatementParams).id, "account id"),
    optionalDate(query.dateFrom, "dateFrom"),
    dateTo,
  ));
});

export default router;
