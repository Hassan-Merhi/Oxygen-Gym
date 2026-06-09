import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { plansTable } from "@workspace/db/schema";
import { eq, isNull } from "drizzle-orm";
import { requireAuth } from "@clerk/express";

const router = Router();
router.use(requireAuth());

router.get("/", async (req: Request, res: Response) => {
  const plans = await db
    .select()
    .from(plansTable)
    .where(isNull(plansTable.deletedAt))
    .orderBy(plansTable.name);
  res.json(plans);
});

router.post("/", async (req: Request, res: Response) => {
  const { name, description, durationDays, price, currency, status } = req.body as {
    name: string;
    description?: string;
    durationDays: number;
    price: number;
    currency: string;
    status?: string;
  };
  if (!name || !durationDays || price === undefined || !currency) {
    res.status(400).json({ error: "name, durationDays, price, currency are required" });
    return;
  }
  const [plan] = await db
    .insert(plansTable)
    .values({ name, description, durationDays, price, currency, status: status ?? "active" })
    .returning();
  res.status(201).json(plan);
});

router.patch("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, description, durationDays, price, currency, status } = req.body as {
    name?: string;
    description?: string;
    durationDays?: number;
    price?: number;
    currency?: string;
    status?: string;
  };
  const [plan] = await db
    .update(plansTable)
    .set({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(durationDays !== undefined && { durationDays }),
      ...(price !== undefined && { price }),
      ...(currency !== undefined && { currency }),
      ...(status !== undefined && { status }),
    })
    .where(eq(plansTable.id, id))
    .returning();
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }
  res.json(plan);
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await db.update(plansTable).set({ deletedAt: new Date() }).where(eq(plansTable.id, id));
  res.json({ ok: true });
});

export default router;
