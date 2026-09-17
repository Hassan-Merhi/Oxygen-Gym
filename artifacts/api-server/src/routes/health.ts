import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isRuntimeReady } from "../shared/runtime/readiness";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  if (!isRuntimeReady()) {
    res.status(503).json({ status: "draining" });
    return;
  }

  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
