import { contractBody } from "../../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router } from "express";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth } from "../../middlewares/auth";
import { getCurrentUser } from "../../shared/auth/permissions";
import { badRequest } from "../../shared/http/errors";
import { getSettings, updateSettings, type UpdateSettingsInput } from "./service";

const router = Router();
router.use(requireAuth());

router.get("/", async (req, res) => {
  const isAdmin = getCurrentUser(req).role === "admin";
  res.json(await getSettings(isAdmin));
});

router.patch("/", async (req, res) => {
  const parsed = UpdateSettingsBody.safeParse(contractBody(req, ApiContracts.UpdateSettingsBody));
  if (!parsed.success) throw badRequest("Invalid input", parsed.error.issues);

  const isAdmin = getCurrentUser(req).role === "admin";
  res.json(await updateSettings(parsed.data as UpdateSettingsInput, isAdmin));
});

export default router;
