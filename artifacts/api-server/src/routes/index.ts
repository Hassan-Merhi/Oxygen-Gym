import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import settingsRouter from "./settings";
import activityLogsRouter from "./activity-logs";
import uploadRouter from "./upload";
import dashboardRouter from "./dashboard";
import plansRouter from "./plans";
import membersRouter from "./members";
import paymentsRouter from "./payments";
import vouchersRouter from "./vouchers";
import ledgerRouter from "./ledger";
import accountsRouter from "./accounts";

const router: IRouter = Router();

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

export default router;
