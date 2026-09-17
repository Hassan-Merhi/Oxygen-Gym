import { authenticatedUser } from "../middlewares/auth";
import { contractParams, contractQueryAs } from "../http/contracts";
import * as ApiContracts from "@workspace/api-zod";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db, type PagePermissions } from "@workspace/db";
import { membersTable, payrollTable, notificationReadsTable } from "@workspace/db/schema";
import { and, eq, lte, gte, sql } from "drizzle-orm";
import { logActivity } from "../lib/activity";
import { sqlRows } from "../lib/sql-rows";
import { normalizePermissions } from "../shared/auth/permissions";

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

interface NotificationCountSqlRow {
  unread?: number | string;
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

async function computeNotifications(userId: number, permissions: PagePermissions): Promise<Notification[]> {
  const now = new Date();
  const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
  const canMembers = permissions.members || permissions.manageMembers;
  const canStock = permissions.stock || permissions.manageInventory;
  const canPayroll = permissions.payroll || permissions.managePayroll;

  const [expiringMembers, lowStockProducts, outOfStockProducts, draftPayrolls, frozenMembers, inactiveMembers, readKeys] = await Promise.all([
    canMembers
      ? db.select({ id: membersTable.id, name: membersTable.name, planName: membersTable.planName, expiryDate: membersTable.expiryDate })
          .from(membersTable)
          .where(and(
            eq(membersTable.status, "active"),
            gte(membersTable.expiryDate, now),
            lte(membersTable.expiryDate, in30),
          ))
      : Promise.resolve([]),

    canStock
      ? db.execute(sql`
          SELECT id, name, quantity, alert_quantity AS "alertQuantity"
          FROM products
          WHERE status = 'active' AND quantity > 0 AND quantity <= alert_quantity
        `)
      : Promise.resolve({ rows: [] }),

    canStock
      ? db.execute(sql`
          SELECT id, name, quantity FROM products WHERE status = 'active' AND quantity = 0
        `)
      : Promise.resolve({ rows: [] }),

    canPayroll
      ? db.select({ id: payrollTable.id, payrollNumber: payrollTable.payrollNumber, staffName: payrollTable.staffName, createdAt: payrollTable.createdAt })
          .from(payrollTable).where(eq(payrollTable.status, "draft"))
      : Promise.resolve([]),

    canMembers
      ? db.select({ id: membersTable.id, name: membersTable.name, frozenUntil: membersTable.frozenUntil })
          .from(membersTable).where(eq(membersTable.status, "frozen"))
      : Promise.resolve([]),

    canMembers
      ? db.select({ id: membersTable.id, name: membersTable.name })
          .from(membersTable).where(eq(membersTable.status, "inactive"))
      : Promise.resolve([]),

    db.select({ notificationKey: notificationReadsTable.notificationKey })
      .from(notificationReadsTable)
      .where(eq(notificationReadsTable.userId, userId)),
  ]);

  const readSet = new Set(readKeys.map((r) => r.notificationKey));
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

async function computeUnreadCount(userId: number, permissions: PagePermissions): Promise<number> {
  const now = new Date();
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);
  const canMembers = permissions.members || permissions.manageMembers;
  const canStock = permissions.stock || permissions.manageInventory;
  const canPayroll = permissions.payroll || permissions.managePayroll;

  // The bell only needs a number. Do not materialize every notification and run
  // seven separate queries every polling interval; count all eligible unread
  // sources in one database round trip instead.
  const result = await db.execute(sql`
    SELECT (
      CASE WHEN ${canMembers} THEN
        (SELECT COUNT(*) FROM members m
          WHERE m.status = 'active'
            AND m.expiry_date >= ${now}
            AND m.expiry_date <= ${in30}
            AND NOT EXISTS (
              SELECT 1 FROM notification_reads nr
              WHERE nr.user_id = ${userId}
                AND nr.notification_key = 'member_expiring_' || m.id::text
            ))
        + (SELECT COUNT(*) FROM members m
          WHERE m.status = 'frozen'
            AND NOT EXISTS (
              SELECT 1 FROM notification_reads nr
              WHERE nr.user_id = ${userId}
                AND nr.notification_key = 'member_frozen_' || m.id::text
            ))
        + (SELECT COUNT(*) FROM members m
          WHERE m.status = 'inactive'
            AND NOT EXISTS (
              SELECT 1 FROM notification_reads nr
              WHERE nr.user_id = ${userId}
                AND nr.notification_key = 'member_inactive_' || m.id::text
            ))
      ELSE 0 END
      + CASE WHEN ${canStock} THEN
        (SELECT COUNT(*) FROM products p
          WHERE p.status = 'active'
            AND p.quantity > 0
            AND p.quantity <= p.alert_quantity
            AND NOT EXISTS (
              SELECT 1 FROM notification_reads nr
              WHERE nr.user_id = ${userId}
                AND nr.notification_key = 'stock_low_' || p.id::text
            ))
        + (SELECT COUNT(*) FROM products p
          WHERE p.status = 'active'
            AND p.quantity = 0
            AND NOT EXISTS (
              SELECT 1 FROM notification_reads nr
              WHERE nr.user_id = ${userId}
                AND nr.notification_key = 'stock_out_' || p.id::text
            ))
      ELSE 0 END
      + CASE WHEN ${canPayroll} THEN
        (SELECT COUNT(*) FROM payroll p
          WHERE p.status = 'draft'
            AND NOT EXISTS (
              SELECT 1 FROM notification_reads nr
              WHERE nr.user_id = ${userId}
                AND nr.notification_key = 'payroll_draft_' || p.id::text
            ))
      ELSE 0 END
    ) AS unread
  `);

  return Number(sqlRows<NotificationCountSqlRow>(result)[0]?.unread ?? 0);
}

function effectivePermissions(req: Request): PagePermissions {
  const user = authenticatedUser(req);
  return normalizePermissions(user.role, user.permissions);
}

router.get("/", async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  const query = contractQueryAs<Record<string, string>>(req, ApiContracts.ListNotificationsQueryParams);
  const typeFilter = query.type as string | undefined;
  const readFilter = query.read as string | undefined;

  let items = await computeNotifications(user.id, effectivePermissions(req));
  if (typeFilter) items = items.filter((n) => n.type === typeFilter);
  if (readFilter === "read") items = items.filter((n) => n.isRead);
  if (readFilter === "unread") items = items.filter((n) => !n.isRead);

  res.json({ items, total: items.length, unreadCount: items.filter((n) => !n.isRead).length });
});

router.get("/count", async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  res.json({ unread: await computeUnreadCount(user.id, effectivePermissions(req)) });
});

router.patch("/:key/read", async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  const key = contractParams(req, ApiContracts.MarkNotificationReadParams).key as string;

  await db.insert(notificationReadsTable).values({
    userId: user.id,
    notificationKey: key,
  }).onConflictDoNothing();

  await logActivity(req, "notification_read", "notification", undefined, { key });
  res.json({ ok: true });
});

router.patch("/read-all", async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  const allItems = await computeNotifications(user.id, effectivePermissions(req));
  const unread = allItems.filter((n) => !n.isRead);

  if (unread.length > 0) {
    await db.insert(notificationReadsTable)
      .values(unread.map((n) => ({ userId: user.id, notificationKey: n.key })))
      .onConflictDoNothing();
  }

  await logActivity(req, "notifications_read_all", "notification", undefined, { count: unread.length });
  res.json({ ok: true, marked: unread.length });
});

export default router;
