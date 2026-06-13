import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, defaultAdminPermissions, defaultStaffPermissions, defaultManagerPermissions } from "@workspace/db";
import { eq, isNull, sql } from "drizzle-orm";
import { signToken, requireAuth } from "../middlewares/auth";
import { logActivity } from "../lib/activity";

const router = Router();

// ── GET /api/auth/setup — check if first-admin setup is needed ────────────────
router.get("/setup", async (_req: Request, res: Response) => {
  try {
    const adminWithPassword = await db.query.usersTable.findFirst({
      where: (u, { and, eq, isNull, isNotNull }) =>
        and(eq(u.role, "admin"), isNotNull(u.passwordHash), isNull(u.deletedAt)),
    });
    res.json({ needsSetup: !adminWithPassword });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/auth/setup — create/configure first admin ─────────────────────
router.post("/setup", async (req: Request, res: Response) => {
  try {
    const adminWithPassword = await db.query.usersTable.findFirst({
      where: (u, { and, eq, isNull, isNotNull }) =>
        and(eq(u.role, "admin"), isNotNull(u.passwordHash), isNull(u.deletedAt)),
    });
    if (adminWithPassword) {
      res.status(400).json({ error: "Setup already complete" });
      return;
    }

    const { username, password, fullName } = req.body as {
      username: string;
      password: string;
      fullName: string;
    };

    if (!username || !password || !fullName) {
      res.status(400).json({ error: "username, password and fullName are required" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Check if an admin already exists (migrated from Clerk) — update them
    const existingAdmin = await db.query.usersTable.findFirst({
      where: (u, { and, eq, isNull }) => and(eq(u.role, "admin"), isNull(u.deletedAt)),
    });

    let user;
    if (existingAdmin) {
      // Check username isn't taken by someone else
      const taken = await db.query.usersTable.findFirst({
        where: (u) => sql`lower(${u.username}) = lower(${username})`,
      });
      if (taken && taken.id !== existingAdmin.id) {
        res.status(400).json({ error: "Username already taken" });
        return;
      }
      [user] = await db.update(usersTable)
        .set({ username, passwordHash, name: fullName })
        .where(eq(usersTable.id, existingAdmin.id))
        .returning();
    } else {
      // No users at all — create fresh admin
      const taken = await db.query.usersTable.findFirst({ where: () => sql`lower(${usersTable.username}) = lower(${username})` });
      if (taken) {
        res.status(400).json({ error: "Username already taken" });
        return;
      }
      [user] = await db.insert(usersTable).values({
        username,
        passwordHash,
        name: fullName,
        role: "admin",
        status: "active",
        permissions: defaultAdminPermissions,
      }).returning();
    }

    const token = signToken({ userId: user.id, role: user.role, username: user.username });
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  try {
    const user = await db.query.usersTable.findFirst({
      where: (u, { isNull, and }) => and(
        sql`lower(${u.username}) = lower(${username})`,
        isNull(u.deletedAt)
      ),
    });

    if (!user) {
      await logLoginAttempt(username, false, "user_not_found");
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    if (user.status === "inactive") {
      await logLoginAttempt(username, false, "user_inactive");
      res.status(401).json({ error: "Account is inactive. Contact your administrator." });
      return;
    }

    if (user.status === "archived" || user.deletedAt) {
      await logLoginAttempt(username, false, "user_archived");
      res.status(401).json({ error: "Account not found" });
      return;
    }

    if (!user.passwordHash) {
      await logLoginAttempt(username, false, "no_password");
      res.status(401).json({ error: "Password not set. Contact your administrator to reset your password." });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await logLoginAttempt(username, false, "wrong_password");
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    await db.insert((await import("@workspace/db/schema")).activityLogsTable).values({
      userId: user.id,
      userName: user.name,
      action: "user_login",
      entity: "user",
      entityId: user.id,
      details: { username },
    }).catch(() => {});

    const token = signToken({ userId: user.id, role: user.role, username: user.username });
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post("/logout", requireAuth(), async (req: Request, res: Response) => {
  const user = (req as any).__gymproUser;
  await db.insert((await import("@workspace/db/schema")).activityLogsTable).values({
    userId: user?.id,
    userName: user?.name ?? "Unknown",
    action: "user_logout",
    entity: "user",
    entityId: user?.id,
    details: {},
  }).catch(() => {});
  res.json({ ok: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get("/me", requireAuth(), async (req: Request, res: Response) => {
  const user = (req as any).__gymproUser;
  res.json(safeUser(user));
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post("/change-password", requireAuth(), async (req: Request, res: Response) => {
  const user = (req as any).__gymproUser;
  const { currentPassword, newPassword, confirmPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  };

  if (!currentPassword || !newPassword || !confirmPassword) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }
  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: "Passwords do not match" });
    return;
  }
  if (!user.passwordHash) {
    res.status(400).json({ error: "No password set — ask admin to reset" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));

  await logActivity(req, "password_changed", "user", user.id, {});
  res.json({ ok: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    permissions: user.permissions,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

async function logLoginAttempt(username: string, success: boolean, reason: string) {
  try {
    await db.insert((await import("@workspace/db/schema")).activityLogsTable).values({
      userId: null,
      userName: username,
      action: success ? "login_success" : "login_failed",
      entity: "user",
      details: { username, reason },
    });
  } catch { /* never let logging break */ }
}

export default router;
