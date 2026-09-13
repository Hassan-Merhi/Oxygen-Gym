import { authenticatedUser } from "../middlewares/auth";
import { contractQueryAs } from "../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "@workspace/db";
import { membersTable, productsTable, payrollTable, notificationReadsTable } from "@workspace/db/schema";
import { and, eq, lte, gte, sql } from "drizzle-orm";
import { logActivity } from "../lib/activity";
import { sqlRows } from "../lib/sql-rows";

const router = Router();
router.use(requireAuth());

type Priority = "high" | "medium" | "low";
type NotificationType =
  | "member_expiring"
  | "stock_low"
  | "stock_out"
  | "payroll_due"
  | "member_frozen"
  | "member_inactive";

interface NotificationSqlRow {
  id?: number;
  name?: string;
  quantity?: number | string;
  alertQuantity?: number | string;
}

interface Notification {
  key: string;
  type: NotificationType;
  priority: Priority;
  message: string;
  date: string;
  isRead: boolean;
  metadata?: Record<string, unknown>;
}

function daysFromNow(d: Date | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

async function computeNotifications(userId: number, permissions: Record<string, boolean> | null): Promise<Notification[]> {
  const now = new Date();
  const in30 = new Date(now); in30.setDate(in30.getDate() + 30);

  const [expiringMembers, lowStockProducts, outOfStockProducts, draftPayrolls, frozenMembers, inactiveMembers, readKeys] = await Promise.all([
    db.select({ id: membersTable.id, name: membersTable.name, planName: membersTable.planName, expiryDate: membersTable.expiryDate })
      .from(membersTable)
      .where(and(
        eq(membersTable.status, "active"),
        gte(membersTable.expiryDate, now),
        lte(membersTable.expiryDate, in30),
      )),

    db.execute(sql`
      SELECT id, name, quantity, alert_quantity AS "alertQuantity"
      FROM products
      WHERE status = 'active' AND quantity > 0 AND quantity <= alert_quantity
    `),

    db.execute(sql`
      SELECT id, name, quantity FROM products WHERE status = 'active' AND quantity = 0
    `),

    permissions?.managePayroll !== false
      ? db.select({ id: payrollTable.id, payrollNumber: payrollTable.payrollNumber, staffName: payrollTable.staffName, createdAt: payrollTable.createdAt })
          .from(payrollTable).where(eq(payrollTable.status, "draft"))
      : Promise.resolve([]),

    db.select({ id: membersTable.id, name: membersTable.name, frozenUntil: membersTable.frozenUntil })
      .from(membersTable).where(eq(membersTable.status, "frozen")),

    db.select({ id: membersTable.id, name: membersTable.name })
      .from(membersTable).where(eq(membersTable.status, "inactive")),

    db.select({ notificationKey: notificationReadsTable.notificationKey })
      .from(notificationReadsTable)
      .where(eq(notificationReadsTable.userId, userId)),
  ]);

  const readSet = new Set(readKeys.map(r => r.notificationKey));
  const notifications: Notification[] = [];

  for (const m of expiringMembers) {
    const days = daysFromNow(m.expiryDate);
    if (days === null) continue;
    const key = `member_expiring_${m.id}`;
    const priority: Priority = days <= 0 ? "high" : days <= 7 ? "high" : days <= 14 ? "medium" : "low";
    const urgency = days <= 0 ? "today" : days <= 7 ? `in ${days} day${days === 1 ? "" : "s"}` : days <= 14 ? "in 14 days" : "in 30 days";
    notifications.push({
      key,
      type: "member_expiring",
      priority,
      message: `${m.name}'s membership expires ${urgency}${m.planName ? ` (${m.planName})` : ""}`,
      date: now.toISOString(),
      isRead: readSet.has(key),
      metadata: { memberId: m.id, daysRemaining: days, planName: m.planName },
    });
  }

  if (permissions?.viewCost !== false || permissions?.manageInventory !== false) {
    for (const p of sqlRows<NotificationSqlRow>(lowStockProducts)) {
      const key = `stock_low_${p.id}`;
      notifications.push({
        key, type: "stock_low", priority: "medium",
        message: `Low stock: ${p.name} (${p.quantity}/${p.alertQuantity} remaining)`,
        date: now.toISOString(), isRead: readSet.has(key),
        metadata: { productId: p.id, quantity: p.quantity, alertQuantity: p.alertQuantity },
      });
    }
    for (const p of sqlRows<NotificationSqlRow>(outOfStockProducts)) {
      const key = `stock_out_${p.id}`;
      notifications.push({
        key, type: "stock_out", priority: "high",
        message: `Out of stock: ${p.name}`,
        date: now.toISOString(), isRead: readSet.has(key),
        metadata: { productId: p.id },
      });
    }
  }

  for (const pr of draftPayrolls) {
    const key = `payroll_draft_${pr.id}`;
    notifications.push({
      key, type: "payroll_due", priority: "medium",
      message: `Payroll ${pr.payrollNumber ?? `#${pr.id}`} for ${pr.staffName} is pending payment`,
      date: now.toISOString(), isRead: readSet.has(key),
      metadata: { payrollId: pr.id },
    });
  }

  for (const m of frozenMembers) {
    const key = `member_frozen_${m.id}`;
    notifications.push({
      key, type: "member_frozen", priority: "low",
      message: `${m.name}'s membership is frozen${m.frozenUntil ? ` until ${new Date(m.frozenUntil).toLocaleDateString()}` : ""}`,
      date: now.toISOString(), isRead: readSet.has(key),
      metadata: { memberId: m.id },
    });
  }

  for (const m of inactiveMembers) {
    const key = `member_inactive_${m.id}`;
    notifications.push({
      key, type: "member_inactive", priority: "low",
      message: `${m.name} is an inactive member`,
      date: now.toISOString(), isRead: readSet.has(key),
      metadata: { memberId: m.id },
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  notifications.sort((a, b) => {
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return notifications;
}

// ── List notifications ────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  const typeFilter = (contractQueryAs<Record<string, string>>(req, ApiContracts.ListNotificationsQueryParams)).type as string | undefined;
  const readFilter = (contractQueryAs<Record<string, string>>(req, ApiContracts.ListNotificationsQueryParams)).read as string | undefined;
  const permissions = (user?.permissions ?? {}) as Record<string, boolean>;
  const isAdmin = user?.role === "admin";

  let items = await computeNotifications(user.id, isAdmin ? null : permissions);
  if (typeFilter) items = items.filter(n => n.type === typeFilter);
  if (readFilter === "read") items = items.filter(n => n.isRead);
  if (readFilter === "unread") items = items.filter(n => !n.isRead);

  res.json({ items, total: items.length, unreadCount: items.filter(n => !n.isRead).length });
});

// ── Unread count ──────────────────────────────────────────────────────────────
router.get("/count", async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  const permissions = (user?.permissions ?? {}) as Record<string, boolean>;
  const isAdmin = user?.role === "admin";
  const items = await computeNotifications(user.id, isAdmin ? null : permissions);
  res.json({ unread: items.filter(n => !n.isRead).length });
});

// ── Mark one as read ──────────────────────────────────────────────────────────
router.patch("/:key/read", async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  const key = req.params.key as string;

  await db.insert(notificationReadsTable).values({
    userId: user.id,
    notificationKey: key,
  }).onConflictDoNothing();

  await logActivity(req, "notification_read", "notification", undefined, { key });
  res.json({ ok: true });
});

// ── Mark all read ─────────────────────────────────────────────────────────────
router.patch("/read-all", async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  const permissions = (user?.permissions ?? {}) as Record<string, boolean>;
  const isAdmin = user?.role === "admin";

  const allItems = await computeNotifications(user.id, isAdmin ? null : permissions);
  const unread = allItems.filter(n => !n.isRead);

  if (unread.length > 0) {
    await db.insert(notificationReadsTable)
      .values(unread.map(n => ({ userId: user.id, notificationKey: n.key })))
      .onConflictDoNothing();
  }

  await logActivity(req, "notifications_read_all", "notification", undefined, { count: unread.length });
  res.json({ ok: true, marked: unread.length });
});

export default router;
