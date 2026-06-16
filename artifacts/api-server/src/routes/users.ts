import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db, usersTable, pagePermissionsSchema, defaultStaffPermissions, defaultAdminPermissions, defaultManagerPermissions, activityLogsTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { UpdateUserPermissionsBody } from "@workspace/api-zod";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth());

function requireAdmin(req: Request, res: Response): boolean {
  const caller = (req as any).__gymproUser;
  if (caller?.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return false;
  }
  return true;
}

// ── GET /api/users ─────────────────────────────────────────────────────────────
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

// ── POST /api/users ────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { username, name, email, phone, role, status, permissions, password } = req.body as {
    username: string;
    name: string;
    email?: string;
    phone?: string;
    role?: string;
    status?: string;
    permissions?: Record<string, boolean>;
    password?: string;
  };

  if (!username || !name) {
    res.status(400).json({ error: "username and name are required" });
    return;
  }

  const resolvedRole = role ?? "staff";
  const resolvedPermissions = (permissions as any) ?? (
    resolvedRole === "admin" ? defaultAdminPermissions :
    resolvedRole === "manager" ? defaultManagerPermissions :
    defaultStaffPermissions
  );

  try {
    // Check username uniqueness
    const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.username, username) });
    if (existing) {
      res.status(400).json({ error: "Username already taken" });
      return;
    }

    let passwordHash: string | undefined;
    if (password) {
      if (password.length < 6) {
        res.status(400).json({ error: "Password must be at least 6 characters" });
        return;
      }
      passwordHash = await bcrypt.hash(password, 12);
    }

    const [user] = await db.insert(usersTable).values({
      username,
      name,
      email: email ?? null,
      phone: phone ?? null,
      role: resolvedRole,
      status: status ?? "active",
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

// ── GET /api/users/:id ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const user = await db.query.usersTable.findFirst({
      where: (u, { and, eq, isNull }) => and(eq(u.id, id), isNull(u.deletedAt)),
      columns: {
        id: true, username: true, name: true, email: true, phone: true,
        role: true, status: true, permissions: true, lastLoginAt: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Failed to get user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/users/:id ───────────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const caller = (req as any).__gymproUser;
  const isAdmin = caller?.role === "admin";

  const { username, name, email, phone, role, status } = req.body as {
    username?: string;
    name?: string;
    email?: string;
    phone?: string;
    role?: string;
    status?: string;
  };

  // Only admin can update other users or change role/status
  if (!isAdmin && caller?.id !== id) {
    res.status(403).json({ error: "Cannot edit other users" });
    return;
  }
  if (!isAdmin && (role !== undefined || status !== undefined)) {
    res.status(403).json({ error: "Only admin can change role or status" });
    return;
  }

  try {
    if (username) {
      const taken = await db.query.usersTable.findFirst({
        where: (u, { and, eq }) => and(eq(u.username, username)),
      });
      if (taken && taken.id !== id) {
        res.status(400).json({ error: "Username already taken" });
        return;
      }
    }

    const [updated] = await db.update(usersTable)
      .set({
        ...(username !== undefined && { username }),
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(role !== undefined && { role }),
        ...(status !== undefined && { status }),
      })
      .where(eq(usersTable.id, id))
      .returning({
        id: usersTable.id, username: usersTable.username, name: usersTable.name,
        email: usersTable.email, phone: usersTable.phone, role: usersTable.role,
        status: usersTable.status, permissions: usersTable.permissions,
        lastLoginAt: usersTable.lastLoginAt, createdAt: usersTable.createdAt,
      });

    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    await logActivity(req, "update_user", "user", id, req.body);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/users/:id ──────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const caller = (req as any).__gymproUser;
  if (caller?.id === id) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  try {
    await db.update(usersTable).set({ deletedAt: new Date() }).where(eq(usersTable.id, id));
    await logActivity(req, "delete_user", "user", id);
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to soft-delete user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/users/:id/permissions ──────────────────────────────────────────
router.patch("/:id/permissions", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateUserPermissionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const permParsed = pagePermissionsSchema.safeParse(parsed.data.permissions);
  if (!permParsed.success) { res.status(400).json({ error: "Invalid permissions" }); return; }

  try {
    const [updated] = await db.update(usersTable)
      .set({ permissions: permParsed.data })
      .where(eq(usersTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    await logActivity(req, "update_permissions", "user", id);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update permissions");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/users/:id/reset-password — admin sets a user's password ─────────
router.post("/:id/reset-password", async (req, res) => {
  const caller = (req as any).__gymproUser;
  if (caller?.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { password } = req.body as { password: string };
  if (!password || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, id));
    await logActivity(req, "reset_password", "user", id);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reset password");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
