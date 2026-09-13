import { contractBody, contractParams, contractQueryAs } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { logActivity } from "../../lib/activity";
import { getCurrentUser } from "../../shared/auth/permissions";
import {
  asRecord,
  nonNegativeNumber,
  optionalDate,
  optionalPositiveInt,
  optionalString,
  parseId,
  parseLimit,
  parsePage,
  requiredString,
} from "../../shared/http/validation";
import { cancelPayroll, createPayroll, getPayroll, listPayroll, payPayroll } from "./service";

const router = Router();
router.use(requireAuth());

router.get("/", async (req, res) => {
  const query = contractQueryAs<Record<string, string | undefined>>(req, ApiContracts.ListPayrollQueryParams);
  const dateTo = optionalDate(query.dateTo, "dateTo");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);

  res.json(await listPayroll({
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
    search: optionalString(query.search),
    status: optionalString(query.status),
    staffEmployeeId: optionalPositiveInt(query.staffEmployeeId, "staffEmployeeId"),
    dateFrom: optionalDate(query.dateFrom, "dateFrom"),
    dateTo,
  }));
});

router.get("/:id", async (req, res) => {
  res.json(await getPayroll(parseId(contractParams(req, ApiContracts.GetPayrollParams).id, "payroll id")));
});

router.post("/", async (req, res) => {
  const body = asRecord(contractBody(req, ApiContracts.CreatePayrollBody));
  const actor = getCurrentUser(req).name;
  const record = await createPayroll({
    staffEmployeeId: parseId(body.staffEmployeeId as string | number | undefined, "staffEmployeeId"),
    periodStart: optionalDate(body.periodStart, "periodStart"),
    periodEnd: optionalDate(body.periodEnd, "periodEnd"),
    baseSalary: nonNegativeNumber(body.baseSalary, "baseSalary"),
    bonus: body.bonus === undefined ? undefined : nonNegativeNumber(body.bonus, "bonus"),
    deduction: body.deduction === undefined ? undefined : nonNegativeNumber(body.deduction, "deduction"),
    currency: optionalString(body.currency),
    exchangeRate: body.exchangeRate === undefined ? undefined : nonNegativeNumber(body.exchangeRate, "exchangeRate"),
    notes: optionalString(body.notes),
  }, actor);

  await logActivity(req, "payroll_generated", "payroll", record.id, {
    payrollNumber: record.payrollNumber,
    staffName: record.staffName,
    netPay: record.netPay,
    currency: record.currency,
  });
  res.status(201).json(record);
});

router.patch("/:id/pay", async (req, res) => {
  const id = parseId(contractParams(req, ApiContracts.MarkPayrollPaidParams).id, "payroll id");
  const actor = getCurrentUser(req).name;
  const record = await payPayroll(id, actor);
  await logActivity(req, "payroll_paid", "payroll", id, {
    payrollNumber: record.payrollNumber,
    staffName: record.staffName,
    netPay: record.netPay,
    currency: record.currency,
  });
  res.json(record);
});

router.patch("/:id/cancel", async (req, res) => {
  const id = parseId(contractParams(req, ApiContracts.CancelPayrollParams).id, "payroll id");
  const reason = requiredString(asRecord(contractBody(req, ApiContracts.CancelPayrollBody)).reason, "reason");
  const actor = getCurrentUser(req).name;
  const record = await cancelPayroll(id, reason, actor);
  await logActivity(req, "payroll_cancelled", "payroll", id, {
    payrollNumber: record.payrollNumber,
    staffName: record.staffName,
    reason,
  });
  res.json(record);
});

export default router;
