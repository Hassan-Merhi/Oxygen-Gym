import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db, usersTable, defaultStaffPermissions, defaultAdminPermissions, defaultManagerPermissions } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  CreateUserBody,
  DeleteUserParams,
  GetUserParams,
  GetUserResponse,
  UpdateUserBody,
  UpdateUserParams,
  UpdateUserPermissionsBody,
  UpdateUserPermissionsParams,
  UpdateUserPermissionsResponse,
  UpdateUserResponse,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";
import { parseBody, parseParams, sendContract } from "../http/contracts";

const router = Router();
router.use(requireAuth());

const ResetPasswordBody = CreateUserBody.pick({ password: true }).required({ password: true });

function requireAdmin(req: Request, res: Response): boolean {
  if (req.__gymproUser?.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return false;
  }
  return true;
}

router.get("/", async (req, res) => {
  try {
    const users = await db.select({
      id: usersTable.id,
      username: usersTable.username,
      name: usersTable.name,
      email: usersTable.email,
      phone: usersTable.phone,
      role: usersTable.role,
      status: usersTable.status,
      permissions: usersTable.permissions,
      lastLoginAt: usersTable.lastLoginAt,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
    }).from(usersTable).where(isNull(usersTable.deletedAt));
    res.json(users);
  } catch (err) {
    req.log.error({ err }, "Failed to list users");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const body = parseBody(req, res, CreateUserBody);
  if (!body) return;

  const username = body.username.trim();
  const name = body.name.trim();
  if (!username || !name) {
    res.status(400).json({ error: "username and name are required" });
    return;
  }

  const resolvedRole = body.role ?? "staff";
  const resolvedPermissions = body.permissions ?? (
    resolvedRole === "admin" ? defaultAdminPermissions :
    resolvedRole === "manager" ? defaultManagerPermissions :
    defaultStaffPermissions
  );

  try {
    const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.username, username) });
    if (existing) {
      res.status(400).json({ error: "Username already taken" });
      return;
    }

    let passwordHash: string | undefined;
    if (body.password) {
      if (body.password.length < 6) {
        res.status(400).json({ error: "Password must be at least 6 characters" });
        return;
      }
      passwordHash = await bcrypt.hash(body.password, 12);
    }

    const [user] = await db.insert(usersTable).values({
      username,
      name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      role: resolvedRole,
      status: body.status ?? "active",
      permissions: resolvedPermissions,
      ...(passwordHash ? { passwordHash } : {}),
    }).returning({
      id: usersTable.id, username: usersTable.username, name: usersTable.name,
      email: usersTable.email, phone: usersTable.phone, role: usersTable.role,
      status: usersTable.status, permissions: usersTable.permissions,
      lastLoginAt: usersTable.lastLoginAt, createdAt: usersTable.createdAt,
    });

    await logActivity(req, "create_user", "user", user.id, { username, name, role: resolvedRole });
    res.status(201).json(user);
  } catch (err) {
    req.log.error({ err }, "Failed to create user");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const params = parseParams(req, res, GetUserParams);
  if (!params) return;
  try {
    const user = await db.query.usersTable.findFirst({
      where: (u, { and, eq, isNull }) => and(eq(u.id, params.id), isNull(u.deletedAt)),
      columns: {
        id: true, username: true, name: true, email: true, phone: true,
        role: true, status: true, permissions: true, lastLoginAt: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    sendContract(req, res, GetUserResponse, user);
  } catch (err) {
    req.log.error({ err }, "Failed to get user");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  const params = parseParams(req, res, UpdateUserParams);
  const body = parseBody(req, res, UpdateUserBody);
  if (!params || !body) return;

  const caller = req.__gymproUser;
  const isAdmin = caller?.role === "admin";
  if (!isAdmin && caller?.id !== params.id) {
    res.status(403).json({ error: "Cannot edit other users" });
    return;
  }
  if (!isAdmin && (body.role !== undefined || body.status !== undefined)) {
    res.status(403).json({ error: "Only admin can change role or status" });
    return;
  }

  try {
    if (body.username) {
      const taken = await db.query.usersTable.findFirst({ where: eq(usersTable.username, body.username) });
      if (taken && taken.id !== params.id) {
        res.status(400).json({ error: "Username already taken" });
        return;
      }
    }

    const [updated] = await db.update(usersTable)
      .set({
        ...(body.username !== undefined && { username: body.username }),
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.role !== undefined && { role: body.role }),
        ...(body.status !== undefined && { status: body.status }),
      })
      .where(eq(usersTable.id, params.id))
      .returning({
        id: usersTable.id, username: usersTable.username, name: usersTable.name,
        email: usersTable.email, phone: usersTable.phone, role: usersTable.role,
        status: usersTable.status, permissions: usersTable.permissions,
        lastLoginAt: usersTable.lastLoginAt, createdAt: usersTable.createdAt,
      });

    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    await logActivity(req, "update_user", "user", params.id, body);
    sendContract(req, res, UpdateUserResponse, updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update user");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const params = parseParams(req, res, DeleteUserParams);
  if (!params) return;

  if (req.__gymproUser?.id === params.id) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  try {
    await db.update(usersTable).set({ deletedAt: new Date() }).where(eq(usersTable.id, params.id));
    await logActivity(req, "delete_user", "user", params.id);
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to soft-delete user");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id/permissions", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const params = parseParams(req, res, UpdateUserPermissionsParams);
  const body = parseBody(req, res, UpdateUserPermissionsBody);
  if (!params || !body) return;

  try {
    const [updated] = await db.update(usersTable)
      .set({ permissions: body.permissions })
      .where(eq(usersTable.id, params.id))
      .returning();
    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    await logActivity(req, "update_permissions", "user", params.id);
    sendContract(req, res, UpdateUserPermissionsResponse, updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update permissions");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/reset-password", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const params = parseParams(req, res, GetUserParams);
  const body = parseBody(req, res, ResetPasswordBody);
  if (!params || !body) return;

  const password = body.password;
  if (!password || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, params.id));
    await logActivity(req, "reset_password", "user", params.id);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reset password");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
