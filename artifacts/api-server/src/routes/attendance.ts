import { Router, type Request, type Response } from "express";
import { requireAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { checkInsTable, membersTable } from "@workspace/db/schema";
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";

const router = Router();
router.use(requireAuth());

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Summary cards ─────────────────────────────────────────────────────────────
router.get("/summary", async (_req: Request, res: Response) => {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek();
  const monthStart = startOfMonth();
  const thirtyDaysAgo = daysAgo(30);

  const [[todayRow], [weekRow], [monthRow], dailyRows] = await Promise.all([
    db.select({ c: count() }).from(checkInsTable).where(and(
      gte(checkInsTable.checkedInAt, todayStart),
      lte(checkInsTable.checkedInAt, todayEnd)
    )),
    db.select({ c: count() }).from(checkInsTable).where(gte(checkInsTable.checkedInAt, weekStart)),
    db.select({ c: count() }).from(checkInsTable).where(gte(checkInsTable.checkedInAt, monthStart)),
    db.execute(sql`
      SELECT DATE(checked_in_at AT TIME ZONE 'UTC') AS day, COUNT(*) AS cnt
      FROM check_ins
      WHERE checked_in_at >= ${thirtyDaysAgo}
      GROUP BY day
    `),
  ]);

  const todayCount = Number(todayRow.c);
  const weekCount = Number(weekRow.c);
  const monthCount = Number(monthRow.c);

  const dailyCounts = (dailyRows.rows as any[]).map((r: any) => Number(r.cnt));
  const avgDaily = dailyCounts.length > 0
    ? Math.round(dailyCounts.reduce((a: number, b: number) => a + b, 0) / 30)
    : 0;

  // Active members today = distinct member_ids checked in today
  const activeTodayResult = await db.execute(sql`
    SELECT COUNT(DISTINCT member_id) AS cnt FROM check_ins
    WHERE checked_in_at >= ${todayStart} AND checked_in_at <= ${todayEnd} AND member_id IS NOT NULL
  `);
  const activeTodayRow = (activeTodayResult.rows as any[])[0];

  res.json({
    today: todayCount,
    thisWeek: weekCount,
    thisMonth: monthCount,
    activeToday: Number(activeTodayRow?.cnt ?? 0),
    avgDaily,
  });
});

// ── Daily chart (last N days) ─────────────────────────────────────────────────
router.get("/daily", async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(7, parseInt((req.query as any).days ?? "30")));
  const from = daysAgo(days);

  const rows = await db.execute(sql`
    WITH dates AS (
      SELECT generate_series(
        DATE_TRUNC('day', ${from}::timestamptz),
        DATE_TRUNC('day', NOW()),
        '1 day'::interval
      )::date AS day
    ),
    counts AS (
      SELECT DATE(checked_in_at AT TIME ZONE 'UTC') AS day, COUNT(*) AS cnt
      FROM check_ins WHERE checked_in_at >= ${from}
      GROUP BY DATE(checked_in_at AT TIME ZONE 'UTC')
    )
    SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date, COALESCE(c.cnt, 0)::int AS count
    FROM dates d LEFT JOIN counts c ON d.day = c.day
    ORDER BY d.day ASC
  `);

  res.json((rows.rows ?? rows) as any[]);
});

// ── Monthly chart (last N months) ─────────────────────────────────────────────
router.get("/monthly", async (req: Request, res: Response) => {
  const months = Math.min(24, Math.max(3, parseInt((req.query as any).months ?? "12")));
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  from.setDate(1);
  from.setHours(0, 0, 0, 0);

  const rows = await db.execute(sql`
    WITH months AS (
      SELECT generate_series(
        DATE_TRUNC('month', ${from}::timestamptz),
        DATE_TRUNC('month', NOW()),
        '1 month'::interval
      )::date AS month
    ),
    counts AS (
      SELECT DATE_TRUNC('month', checked_in_at)::date AS month, COUNT(*) AS cnt
      FROM check_ins WHERE checked_in_at >= ${from}
      GROUP BY DATE_TRUNC('month', checked_in_at)::date
    )
    SELECT TO_CHAR(m.month, 'YYYY-MM') AS month, COALESCE(c.cnt, 0)::int AS count
    FROM months m LEFT JOIN counts c ON m.month = c.month
    ORDER BY m.month ASC
  `);

  res.json((rows.rows ?? rows) as any[]);
});

// ── Hourly trend ──────────────────────────────────────────────────────────────
router.get("/hourly", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    WITH hours AS (SELECT generate_series(0, 23) AS hour),
    counts AS (
      SELECT EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'UTC')::int AS hour, COUNT(*) AS cnt
      FROM check_ins GROUP BY EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'UTC')::int
    )
    SELECT h.hour, COALESCE(c.cnt, 0)::int AS count
    FROM hours h LEFT JOIN counts c ON h.hour = c.hour
    ORDER BY h.hour ASC
  `);

  res.json((rows.rows ?? rows) as any[]);
});

// ── Top attending members ─────────────────────────────────────────────────────
router.get("/top-members", async (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(5, parseInt((req.query as any).limit ?? "10")));

  const rows = await db.execute(sql`
    SELECT member_id AS "memberId", member_name AS "memberName", COUNT(*) AS count
    FROM check_ins
    WHERE member_id IS NOT NULL
    GROUP BY member_id, member_name
    ORDER BY count DESC
    LIMIT ${limit}
  `);

  res.json(((rows.rows ?? rows) as any[]).map((r: any) => ({
    memberId: r.memberId,
    memberName: r.memberName,
    count: Number(r.count),
  })));
});

// ── Today's check-ins ─────────────────────────────────────────────────────────
router.get("/today", async (_req: Request, res: Response) => {
  const now = new Date();
  const rows = await db.select().from(checkInsTable)
    .where(and(
      gte(checkInsTable.checkedInAt, startOfDay(now)),
      lte(checkInsTable.checkedInAt, endOfDay(now)),
    ))
    .orderBy(desc(checkInsTable.checkedInAt));

  res.json(rows);
});

// ── This week's check-ins ─────────────────────────────────────────────────────
router.get("/week", async (_req: Request, res: Response) => {
  const rows = await db.select().from(checkInsTable)
    .where(gte(checkInsTable.checkedInAt, startOfWeek()))
    .orderBy(desc(checkInsTable.checkedInAt));

  res.json(rows);
});

// ── Member attendance stats ───────────────────────────────────────────────────
router.get("/member/:id", async (req: Request, res: Response) => {
  const memberId = parseInt(req.params.id as string);
  if (isNaN(memberId)) { res.status(400).json({ error: "Invalid member id" }); return; }

  const now = new Date();
  const monthStart = startOfMonth();

  const [member] = await db.select({ lastCheckIn: membersTable.lastCheckIn })
    .from(membersTable).where(eq(membersTable.id, memberId));

  const [[totalRow], [monthRow]] = await Promise.all([
    db.select({ c: count() }).from(checkInsTable).where(eq(checkInsTable.memberId, memberId)),
    db.select({ c: count() }).from(checkInsTable).where(and(
      eq(checkInsTable.memberId, memberId),
      gte(checkInsTable.checkedInAt, monthStart),
    )),
  ]);

  const recentRows = await db.execute(sql`
    WITH months AS (
      SELECT generate_series(
        DATE_TRUNC('month', NOW() - INTERVAL '11 months'),
        DATE_TRUNC('month', NOW()),
        '1 month'
      )::date AS month
    ),
    counts AS (
      SELECT DATE_TRUNC('month', checked_in_at)::date AS month, COUNT(*) AS cnt
      FROM check_ins WHERE member_id = ${memberId}
      GROUP BY DATE_TRUNC('month', checked_in_at)::date
    )
    SELECT TO_CHAR(m.month, 'YYYY-MM') AS month, COALESCE(c.cnt, 0)::int AS count
    FROM months m LEFT JOIN counts c ON m.month = c.month
    ORDER BY m.month ASC
  `);

  const totalCheckins = Number(totalRow.c);
  const monthlyHistory = (recentRows.rows ?? recentRows) as any[];
  const monthsWithCheckins = monthlyHistory.filter(r => r.count > 0).length;
  const avgPerMonth = monthsWithCheckins > 0
    ? Math.round(totalCheckins / Math.max(1, monthlyHistory.length))
    : 0;

  // Last 30 days calendar data
  const calRows = await db.execute(sql`
    SELECT DATE(checked_in_at AT TIME ZONE 'UTC') AS day, COUNT(*) AS cnt
    FROM check_ins
    WHERE member_id = ${memberId} AND checked_in_at >= ${daysAgo(30)}
    GROUP BY DATE(checked_in_at AT TIME ZONE 'UTC')
    ORDER BY day ASC
  `);

  res.json({
    totalCheckins,
    lastCheckIn: member?.lastCheckIn ?? null,
    thisMonthCheckins: Number(monthRow.c),
    avgPerMonth,
    monthlyHistory,
    calendarDays: ((calRows.rows ?? calRows) as any[]).map((r: any) => r.day),
  });
});

export default router;
