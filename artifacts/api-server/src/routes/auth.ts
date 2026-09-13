import { authenticatedUser } from "../middlewares/auth";
import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, defaultAdminPermissions, activityLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  ChangePasswordBody,
  GetMeResponse,
  GetSetupStatusResponse,
  LoginBody,
  LoginResponse,
  RunSetupBody,
  RunSetupResponse,
} from "@workspace/api-zod";
import { signToken, requireAuth } from "../middlewares/auth";
import { logActivity } from "../lib/activity";
import { parseBody, sendContract } from "../http/contracts";

const router = Router();
type UserRecord = typeof usersTable.$inferSelect;

router.get("/setup", async (req: Request, res: Response) => {
  try {
    const adminWithPassword = await db.query.usersTable.findFirst({
      where: (u, { and, eq, isNull, isNotNull }) =>
        and(eq(u.role, "admin"), isNotNull(u.passwordHash), isNull(u.deletedAt)),
    });
    sendContract(req, res, GetSetupStatusResponse, { needsSetup: !adminWithPassword });
  } catch (err) {
    req.log.error({ err }, "Setup-status lookup failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/setup", async (req: Request, res: Response) => {
  const body = parseBody(req, res, RunSetupBody);
  if (!body) return;

  try {
    const adminWithPassword = await db.query.usersTable.findFirst({
      where: (u, { and, eq, isNull, isNotNull }) =>
        and(eq(u.role, "admin"), isNotNull(u.passwordHash), isNull(u.deletedAt)),
    });
    if (adminWithPassword) {
      res.status(400).json({ error: "Setup already complete" });
      return;
    }

    const username = body.username.trim();
    const fullName = body.fullName.trim();
    if (!username || !fullName) {
      res.status(400).json({ error: "username and fullName are required" });
      return;
    }
    if (body.password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const existingAdmin = await db.query.usersTable.findFirst({
      where: (u, { and, eq, isNull }) => and(eq(u.role, "admin"), isNull(u.deletedAt)),
    });

    let user: UserRecord;
    if (existingAdmin) {
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
      const taken = await db.query.usersTable.findFirst({
        where: (u) => sql`lower(${u.username}) = lower(${username})`,
      });
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
    sendContract(req, res, RunSetupResponse, { token, user: safeUser(user) });
  } catch (err) {
    req.log.error({ err }, "Initial admin setup failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  const body = parseBody(req, res, LoginBody);
  if (!body) return;
  const username = body.username.trim();
  if (!username || !body.password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  try {
    const user = await db.query.usersTable.findFirst({
      where: (u, { isNull, and }) => and(
        sql`lower(${u.username}) = lower(${username})`,
        isNull(u.deletedAt),
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

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      await logLoginAttempt(username, false, "wrong_password");
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const [updatedUser] = await db.update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .returning();

    await db.insert(activityLogsTable).values({
      userId: user.id,
      userName: user.name,
      action: "user_login",
      entity: "user",
      entityId: user.id,
      details: { username },
    }).catch(() => undefined);

    const token = signToken({ userId: updatedUser.id, role: updatedUser.role, username: updatedUser.username });
    sendContract(req, res, LoginResponse, { token, user: safeUser(updatedUser) });
  } catch (err) {
    req.log.error({ err }, "Login failed unexpectedly");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/logout", requireAuth(), async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  await db.insert(activityLogsTable).values({
    userId: user?.id,
    userName: user?.name ?? "Unknown",
    action: "user_logout",
    entity: "user",
    entityId: user?.id,
    details: {},
  }).catch(() => undefined);
  res.json({ ok: true });
});

router.get("/me", requireAuth(), async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  sendContract(req, res, GetMeResponse, safeUser(user));
});

router.post("/change-password", requireAuth(), async (req: Request, res: Response) => {
  const user = authenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = parseBody(req, res, ChangePasswordBody);
  if (!body) return;

  if (body.newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }
  if (body.newPassword !== body.confirmPassword) {
    res.status(400).json({ error: "Passwords do not match" });
    return;
  }
  if (!user.passwordHash) {
    res.status(400).json({ error: "No password set — ask admin to reset" });
    return;
  }

  const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(body.newPassword, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));
  await logActivity(req, "password_changed", "user", user.id, {});
  res.json({ ok: true });
});

function safeUser(user: UserRecord) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    permissions: user.permissions,
    lastLoginAt: user.lastLoginAt,
  };
}

async function logLoginAttempt(username: string, success: boolean, reason: string) {
  try {
    await db.insert(activityLogsTable).values({
      userId: null,
      userName: username,
      action: success ? "login_success" : "login_failed",
      entity: "user",
      details: { username, reason },
    });
  } catch {
    // Authentication logging is best-effort and must not block login.
  }
}

export default router;
