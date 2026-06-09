import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import settingsRouter from "./settings";
import activityLogsRouter from "./activity-logs";
import uploadRouter from "./upload";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/settings", settingsRouter);
router.use("/activity-logs", activityLogsRouter);
router.use("/upload", uploadRouter);

export default router;
