import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { whatsappChatsTable, settingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { sendToAllChats } from "../lib/whatsapp";

const router = Router();
router.use(requireAuth());

// All WhatsApp routes require admin role
function requireAdmin(req: Request, res: Response): boolean {
  const caller = (req as any).__gymproUser;
  if (caller?.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return false;
  }
  return true;
}

// GET /api/whatsapp/chats
router.get("/chats", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const chats = await db.select().from(whatsappChatsTable).orderBy(whatsappChatsTable.createdAt);
    res.json(chats);
  } catch (err) {
    req.log.error({ err }, "Failed to list WhatsApp chats");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/whatsapp/chats
router.post("/chats", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { label, chatId } = req.body as Record<string, unknown>;
  if (typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (typeof chatId !== "string" || !chatId.trim()) {
    res.status(400).json({ error: "chatId is required" });
    return;
  }
  try {
    const [chat] = await db.insert(whatsappChatsTable).values({ label: label.trim(), chatId: chatId.trim() }).returning();
    res.status(201).json(chat);
  } catch (err) {
    req.log.error({ err }, "Failed to create WhatsApp chat");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/whatsapp/chats/:id
router.patch("/chats/:id", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { label, chatId, enabled } = req.body as Record<string, unknown>;
  const updates: Partial<{ label: string; chatId: string; enabled: boolean }> = {};
  if (typeof label === "string" && label.trim()) updates.label = label.trim();
  if (typeof chatId === "string" && chatId.trim()) updates.chatId = chatId.trim();
  if (typeof enabled === "boolean") updates.enabled = enabled;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  try {
    const [chat] = await db.update(whatsappChatsTable)
      .set(updates)
      .where(eq(whatsappChatsTable.id, id))
      .returning();
    if (!chat) { res.status(404).json({ error: "Not found" }); return; }
    res.json(chat);
  } catch (err) {
    req.log.error({ err }, "Failed to update WhatsApp chat");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/whatsapp/chats/:id
router.delete("/chats/:id", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(whatsappChatsTable).where(eq(whatsappChatsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete WhatsApp chat");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/whatsapp/contacts — fetch chats from Green API so user can pick
router.get("/contacts", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const settings = await db.query.settingsTable.findFirst();
    if (!settings?.greenApiInstanceId || !settings?.greenApiToken) {
      res.status(400).json({ error: "Green API credentials not configured" });
      return;
    }
    const url = `https://api.green-api.com/waInstance${settings.greenApiInstanceId}/getChats/${settings.greenApiToken}`;
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      req.log.error({ status: response.status, text }, "Green API getChats failed");
      res.status(502).json({ error: `Green API error ${response.status}` });
      return;
    }
    const raw = await response.json() as Array<{ id: string; name?: string; type?: string }>;
    const contacts = raw.map((c) => ({
      id: c.id,
      name: c.name ?? c.id,
      type: c.type ?? "contact",
    }));
    res.json(contacts);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch Green API contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/whatsapp/test
router.post("/test", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const settings = await db.query.settingsTable.findFirst();
    if (!settings?.greenApiInstanceId || !settings?.greenApiToken) {
      res.status(400).json({ error: "Green API credentials not configured" });
      return;
    }
    const sent = await sendToAllChats(
      settings.greenApiInstanceId,
      settings.greenApiToken,
      `✅ *GymPro* — ${new Date().toISOString()}`
    );
    res.json({ ok: sent });
  } catch (err) {
    req.log.error({ err }, "WhatsApp test failed");
    res.status(500).json({ error: "Test failed" });
  }
});

export default router;
