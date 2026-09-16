import { Router, type Request, type Response } from "express";
import {
  AcknowledgeOperationalRolloutWarningsBody,
  AdvanceOperationalRolloutBody,
  GetOperationalRolloutResponse,
  GetRolloutAccessResponse,
  RollbackOperationalRolloutBody,
} from "@workspace/api-zod";
import { authenticatedUser, requireAuth } from "../middlewares/auth";
import { logActivity } from "../lib/activity";
import { parseBody, sendContract } from "../http/contracts";
import {
  acknowledgeWarnings,
  advanceOperationalRollout,
  getOperationalRollout,
  getRolloutAccess,
  rollbackOperationalRollout,
  type RolloutActor,
} from "../domains/rollout/service";

const router = Router();
router.use(requireAuth());

function actorFrom(req: Request): RolloutActor {
  const user = authenticatedUser(req);
  return { id: user.id, name: user.name, role: user.role };
}

router.get("/access", async (req: Request, res: Response) => {
  const access = await getRolloutAccess(actorFrom(req));
  sendContract(req, res, GetRolloutAccessResponse, access);
});

router.get("/", async (req: Request, res: Response) => {
  const status = await getOperationalRollout();
  sendContract(req, res, GetOperationalRolloutResponse, status);
});

router.post("/acknowledge-warnings", async (req: Request, res: Response) => {
  const body = parseBody(req, res, AcknowledgeOperationalRolloutWarningsBody);
  if (!body) return;

  const actor = actorFrom(req);
  const status = await acknowledgeWarnings(actor, body.warningKeys);
  await logActivity(
    req,
    "rollout_warnings_acknowledged",
    "operational_rollout",
    undefined,
    {
      warningKeys: body.warningKeys,
      note: body.note ?? null,
    },
  );
  sendContract(req, res, GetOperationalRolloutResponse, status);
});

router.post("/advance", async (req: Request, res: Response) => {
  const body = parseBody(req, res, AdvanceOperationalRolloutBody);
  if (!body) return;

  const actor = actorFrom(req);
  const status = await advanceOperationalRollout(
    actor,
    body.targetStage,
    body.warningKeys ?? [],
  );
  await logActivity(
    req,
    "rollout_stage_advanced",
    "operational_rollout",
    undefined,
    {
      targetStage: body.targetStage,
      warningKeys: body.warningKeys ?? [],
      note: body.note ?? null,
    },
  );
  sendContract(req, res, GetOperationalRolloutResponse, status);
});

router.post("/rollback", async (req: Request, res: Response) => {
  const body = parseBody(req, res, RollbackOperationalRolloutBody);
  if (!body) return;

  const actor = actorFrom(req);
  const status = await rollbackOperationalRollout(actor, body.targetStage);
  await logActivity(
    req,
    "rollout_stage_rolled_back",
    "operational_rollout",
    undefined,
    {
      targetStage: body.targetStage,
      reason: body.reason,
    },
  );
  sendContract(req, res, GetOperationalRolloutResponse, status);
});

export default router;
