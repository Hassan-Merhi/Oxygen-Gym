import { contractBody, contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
import { getCurrentUser } from "../../shared/auth/permissions";
import { asRecord, optionalDate, optionalString, parseLimit, parsePage } from "../../shared/http/validation";
import { badRequest } from "../../shared/http/errors";
import { getLedgerHealth } from "./ledger-health";
import { getLedgerBalance, listCashMovements, listLedger, recordCashCount } from "./ledger-service";
import { rangeEnd, rangeStart } from "./report-dates";

const router = Router();
router.use(requireAuth());

function optionalAmount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw badRequest(`${field} must be a non-negative number`);
  return parsed;
}

router.get("/balance", async (_req, res) => {
  res.json(await getLedgerBalance());
});

router.get("/health", async (_req, res) => {
  res.json(await getLedgerHealth());
});

router.get("/movements", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListCurrentCashMovementsQueryParams);
  res.json(await listCashMovements({
    account: optionalString(query.account),
    dateFrom: rangeStart(query.dateFrom),
    dateTo: rangeEnd(query.dateTo),
  }));
});

router.post("/opening-balance", async (req, res) => {
  const body = asRecord(contractBody(req, ApiContracts.SetOpeningBalanceBody));
  const result = await recordCashCount({
    countedUsd: optionalAmount(body.countedUsd ?? body.targetAmountUsd, "countedUsd"),
    countedCdf: optionalAmount(body.countedCdf, "countedCdf"),
    date: optionalDate(body.date, "date"),
    notes: optionalString(body.notes),
    account: optionalString(body.account),
  }, getCurrentUser(req).name);
  await logActivity(req, "create", "cash_count", undefined, { adjustments: result.adjustments });
  res.json(result);
});

router.get("/", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListLedgerQueryParams);
  res.json(await listLedger({
    page: parsePage(query.page),
    limit: parseLimit(query.limit, 50, 200),
    dateFrom: rangeStart(query.dateFrom),
    dateTo: rangeEnd(query.dateTo),
    direction: optionalString(query.direction),
  }));
});

export default router;
