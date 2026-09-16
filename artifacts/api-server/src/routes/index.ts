import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import settingsRouter from "../domains/settings/router";
import activityLogsRouter from "./activity-logs";
import uploadRouter from "./upload";
import dashboardRouter from "./dashboard";
import plansRouter from "./plans";
import membersRouter from "../domains/members/router";
import paymentsRouter from "../domains/accounting/payments-router";
import vouchersRouter from "../domains/accounting/vouchers-router";
import ledgerRouter from "../domains/accounting/ledger-router";
import accountsRouter from "../domains/accounting/accounts-router";
import financialsRouter from "../domains/accounting/financials-router";
import stockRouter from "../domains/inventory/router";
import supplierCreditsRouter from "../domains/inventory/supplier-credits-router";
import salesRouter from "../domains/sales/router";
import staffEmployeesRouter from "./staff-employees";
import payrollRouter from "../domains/payroll/router";
import commissionsRouter from "./commissions";
import attendanceRouter from "./attendance";
import notificationsRouter from "./notifications";
import auditRouter from "./audit";
import rolloutRouter from "./rollout";
import whatsappRouter from "./whatsapp";
import { enforceApiAuthorization } from "../shared/auth/authorization-gate";

const router: IRouter = Router();

// This is intentionally before every API router. Public endpoints are explicit
// matrix entries; all unclassified endpoints are authenticated and denied.
router.use(enforceApiAuthorization());

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/settings", settingsRouter);
router.use("/activity-logs", activityLogsRouter);
router.use("/upload", uploadRouter);
router.use("/dashboard", dashboardRouter);
router.use("/plans", plansRouter);
router.use("/members", membersRouter);
router.use("/payments", paymentsRouter);
router.use("/vouchers", vouchersRouter);
router.use("/ledger", ledgerRouter);
router.use("/accounts", accountsRouter);
router.use("/financials", financialsRouter);
router.use("/stock", stockRouter);
router.use("/supplier-credits", supplierCreditsRouter);
router.use("/sales", salesRouter);
router.use("/staff-employees", staffEmployeesRouter);
router.use("/payroll", payrollRouter);
router.use("/commissions", commissionsRouter);
router.use("/attendance", attendanceRouter);
router.use("/notifications", notificationsRouter);
router.use("/audit", auditRouter);
router.use("/rollout", rolloutRouter);
router.use("/whatsapp", whatsappRouter);

export default router;
