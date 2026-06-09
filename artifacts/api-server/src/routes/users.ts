import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { db, usersTable, pagePermissionsSchema, defaultStaffPermissions } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateUserBody, UpdateUserBody, UpdateUserPermissionsBody } from "@workspace/api-zod";

const router = Router();

// Middleware: require auth for all user routes
router.use(requireAuth());

// GET /api/users
router.get("/", async (req, res) => {
  try {
    const users = await db.select().from(usersTable);
    res.json(users);
  } catch (err) {
    req.log.error({ err }, "Failed to list users");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/users
router.post("/", async (req, res) => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }

  const { name, email, phone, role, status, permissions } = parsed.data;

  try {
    const [user] = await db.insert(usersTable).values({
      name,
      email,
      phone: phone ?? null,
      role: role ?? "staff",
      status: status ?? "active",
      permissions: permissions ?? defaultStaffPermissions,
    }).returning();

    res.status(201).json(user);
  } catch (err) {
    req.log.error({ err }, "Failed to create user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:id
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  try {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, id) });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Failed to get user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/users/:id
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }

  const data = parsed.data;

  try {
    const [updated] = await db.update(usersTable)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.status !== undefined && { status: data.status }),
      })
      .where(eq(usersTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/users/:id
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  try {
    await db.delete(usersTable).where(eq(usersTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete user");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/users/:id/permissions
router.patch("/:id/permissions", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = UpdateUserPermissionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }

  const { permissions } = parsed.data;
  const permParsed = pagePermissionsSchema.safeParse(permissions);
  if (!permParsed.success) {
    res.status(400).json({ error: "Invalid permissions" });
    return;
  }

  try {
    const [updated] = await db.update(usersTable)
      .set({ permissions: permParsed.data })
      .where(eq(usersTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update permissions");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
