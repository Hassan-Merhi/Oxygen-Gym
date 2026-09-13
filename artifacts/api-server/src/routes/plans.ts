import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { plansTable } from "@workspace/db/schema";
import { CreatePlanBody, UpdatePlanBody, UpdatePlanParams } from "@workspace/api-zod";
import { eq, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { parseBody, parseParams } from "../http/contracts";

const router = Router();
router.use(requireAuth());

router.get("/", async (_req: Request, res: Response) => {
  const plans = await db.select().from(plansTable).where(isNull(plansTable.deletedAt)).orderBy(plansTable.name);
  res.json(plans);
});

router.post("/", async (req: Request, res: Response) => {
  const body = parseBody(req, res, CreatePlanBody);
  if (!body) return;
  const [plan] = await db.insert(plansTable).values({
    name: body.name,
    description: body.description ?? null,
    durationDays: body.durationDays,
    price: body.price,
    currency: body.currency,
    status: body.status ?? "active",
    coachId: body.coachId ?? null,
    coachFee: body.coachFee ?? 0,
    coachName: body.coachName ?? null,
  }).returning();
  res.status(201).json(plan);
});

router.patch("/:id", async (req: Request, res: Response) => {
  const params = parseParams(req, res, UpdatePlanParams);
  const body = parseBody(req, res, UpdatePlanBody);
  if (!params || !body) return;
  const [plan] = await db.update(plansTable).set({
    name: body.name,
    description: body.description ?? null,
    durationDays: body.durationDays,
    price: body.price,
    currency: body.currency,
    status: body.status,
    coachId: body.coachId ?? null,
    coachFee: body.coachFee ?? 0,
    coachName: body.coachName ?? null,
  }).where(eq(plansTable.id, params.id)).returning();
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }
  res.json(plan);
});

router.delete("/:id", async (req: Request, res: Response) => {
  const params = parseParams(req, res, UpdatePlanParams);
  if (!params) return;
  await db.update(plansTable).set({ deletedAt: new Date() }).where(eq(plansTable.id, params.id));
  res.json({ ok: true });
});

export default router;
