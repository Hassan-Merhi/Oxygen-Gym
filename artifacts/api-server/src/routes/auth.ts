import { Router } from "express";
import { requireAuth, getAuth } from "@clerk/express";
import { db, usersTable, defaultAdminPermissions, defaultStaffPermissions } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /api/auth/me — get or JIT-provision the current user
router.get("/me", requireAuth(), async (req, res) => {
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    let user = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkUserId, userId),
    });

    if (!user) {
      // JIT provisioning: check if any admin exists
      const existingAdmin = await db.query.usersTable.findFirst({
        where: eq(usersTable.role, "admin"),
      });

      const isFirstUser = !existingAdmin;
      const role = isFirstUser ? "admin" : "staff";
      const permissions = isFirstUser ? defaultAdminPermissions : defaultStaffPermissions;

      const email = (sessionClaims?.email as string) ?? `user-${userId}@gym.local`;
      const name = (sessionClaims?.name as string) ?? "New User";

      const [created] = await db.insert(usersTable).values({
        clerkUserId: userId,
        name,
        email,
        role,
        status: "active",
        permissions,
      }).returning();

      user = created;
    }

    res.json({
      id: user.id,
      clerkUserId: user.clerkUserId,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get current user");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
