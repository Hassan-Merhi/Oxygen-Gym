import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { whatsappChatsTable, settingsTable, membersTable, plansTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { sendToAllChats, sendDailySummaryNow, formatMemberInfoMessage } from "../lib/whatsapp";

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

// GET /api/whatsapp/contacts — fetch chats + contacts from Green API so user can pick
router.get("/contacts", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const settings = await db.query.settingsTable.findFirst();
    if (!settings?.greenApiInstanceId || !settings?.greenApiToken) {
      res.status(400).json({ error: "Green API credentials not configured" });
      return;
    }
    const base = `https://api.green-api.com/waInstance${settings.greenApiInstanceId}`;
    const token = settings.greenApiToken;

    // Fetch chats (existing conversations) and contacts (phone book) in parallel
    const [chatsRes, contactsRes] = await Promise.allSettled([
      fetch(`${base}/getChats/${token}`),
      fetch(`${base}/getContacts/${token}`),
    ]);

    // If both failed, return an error from the chats call
    if (chatsRes.status === "rejected" && contactsRes.status === "rejected") {
      req.log.error({ err: chatsRes.reason }, "Both Green API calls failed");
      res.status(502).json({ error: "Could not reach Green API" });
      return;
    }

    const merged = new Map<string, { id: string; name: string; type: string }>();

    // Parse chats
    if (chatsRes.status === "fulfilled" && chatsRes.value.ok) {
      const raw = await chatsRes.value.json() as Array<{ id: string; name?: string; type?: string }>;
      for (const c of raw) {
        if (c.id) merged.set(c.id, { id: c.id, name: c.name ?? c.id, type: c.type ?? "contact" });
      }
    } else if (chatsRes.status === "fulfilled") {
      req.log.warn({ status: chatsRes.value.status }, "Green API getChats returned non-ok");
    }

    // Parse contacts (phone book) — overwrite with better name if available
    if (contactsRes.status === "fulfilled" && contactsRes.value.ok) {
      const raw = await contactsRes.value.json() as Array<{ id: string; name?: string; type?: string; contactName?: string }>;
      for (const c of raw) {
        if (!c.id) continue;
        const name = c.name ?? c.contactName ?? c.id;
        if (merged.has(c.id)) {
          // Keep existing entry but update name if better
          merged.get(c.id)!.name = name;
        } else {
          merged.set(c.id, { id: c.id, name, type: c.type ?? "contact" });
        }
      }
    } else if (contactsRes.status === "fulfilled") {
      req.log.warn({ status: contactsRes.value.status }, "Green API getContacts returned non-ok");
    }

    if (merged.size === 0) {
      // Return a helpful error if we got no data at all
      const status = chatsRes.status === "fulfilled" ? chatsRes.value.status : 502;
      res.status(502).json({ error: `Green API error ${status} — check your Instance ID and Token` });
      return;
    }

    res.json(Array.from(merged.values()));
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

// POST /api/whatsapp/send-member/:id — send a per-member notification
router.post("/send-member/:id", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  try {
    const settings = await db.query.settingsTable.findFirst();
    if (!settings?.greenApiInstanceId || !settings?.greenApiToken) {
      res.status(400).json({ error: "Green API credentials not configured" });
      return;
    }
    const [member] = await db.select().from(membersTable).where(eq(membersTable.id, id));
    if (!member) { res.status(404).json({ error: "Member not found" }); return; }

    // Compute balance using the plan's authoritative price converted to the member's
    // payment currency — same logic as the frontend list — so stale DB values don't appear.
    const rate = Number(settings.usdToCdfRate ?? 1);
    const memberCur = (member.currency as string) ?? "USD";
    let convertedPlanPrice: number = member.planPrice ?? 0;

    if (member.planId) {
      const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, member.planId));
      if (plan) {
        const planCur = (plan.currency as string) ?? "USD";
        if (planCur === memberCur) {
          convertedPlanPrice = plan.price;
        } else if (planCur === "USD" && memberCur === "CDF") {
          convertedPlanPrice = plan.price * rate;
        } else {
          convertedPlanPrice = plan.price / rate;
        }
      }
    }

    const liveBalance = convertedPlanPrice - (member.discount ?? 0) - (member.amountPaid ?? 0);

    const message = formatMemberInfoMessage({ ...member, balance: liveBalance });
    const sent = await sendToAllChats(settings.greenApiInstanceId, settings.greenApiToken, message);
    res.json({ ok: sent });
  } catch (err) {
    req.log.error({ err }, "Send member WhatsApp failed");
    res.status(500).json({ error: "Failed" });
  }
});

// POST /api/whatsapp/send-daily-summary — trigger daily summary immediately
router.post("/send-daily-summary", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await sendDailySummaryNow();
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "Send daily summary failed");
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
