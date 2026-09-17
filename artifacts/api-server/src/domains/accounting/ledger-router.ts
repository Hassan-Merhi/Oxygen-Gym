import { contractBody, contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { getCurrentUser } from "../../shared/auth/permissions";
import {
  asRecord,
  nonNegativeNumber,
  optionalDate,
  optionalString,
  parseLimit,
  parsePage,
} from "../../shared/http/validation";
import { getLedgerBalance, listCurrentCashMovements, listLedger, setOpeningBalance } from "./ledger-service";
import { resetOperationalPeriod } from "./period-reset-service";

const router = Router();
router.use(requireAuth());

router.get("/balance", async (_req, res) => {
  res.json(await getLedgerBalance());
});

router.get("/movements", async (_req, res) => {
  res.json(await listCurrentCashMovements());
});

router.post("/opening-balance", async (req, res) => {
  const body = asRecord(contractBody(req, ApiContracts.SetOpeningBalanceBody));
  const targetAmountUsd = nonNegativeNumber(body.targetAmountUsd, "targetAmountUsd");
  const date = optionalDate(body.date, "date");
  const notes = optionalString(body.notes);
  const actor = getCurrentUser(req).name;
  const resetConfirmation = String(req.headers["x-reset-confirmation"] ?? "");

  if (resetConfirmation) {
    res.json(await resetOperationalPeriod({
      openingCashUsd: targetAmountUsd,
      resetDate: date,
      notes,
      confirmation: resetConfirmation,
    }, actor));
    return;
  }

  res.json(await setOpeningBalance({
    targetAmountUsd,
    date,
    notes,
  }, actor));
});

router.get("/", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListLedgerQueryParams);
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
  res.json(await listLedger({
    page: parsePage(query.page),
    limit: parseLimit(query.limit, 50, 200),
    dateFrom: optionalDate(query.dateFrom, "dateFrom"),
    dateTo,
    direction: optionalString(query.direction),
  }));
});

export default router;
