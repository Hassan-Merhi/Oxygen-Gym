import { type Request, type Response, type NextFunction } from "express";
import jwt, { type JwtPayload as JsonWebTokenPayload } from "jsonwebtoken";
import { db } from "@workspace/db";
import { env } from "../config/env";

export interface GymJwtPayload {
  userId: number;
  role: string;
  username: string;
}

type GymUser = NonNullable<Request["__gymproUser"]>;

// A page can start several API requests at once. Previously every request repeated
// the exact same users-table lookup. Keep the authenticated row for a very short
// window and collapse concurrent misses into one DB query. The five-second TTL
// keeps permission/status changes effectively immediate while removing the burst.
const AUTH_USER_CACHE_TTL_MS = 5_000;
const authUserCache = new Map<number, { expiresAt: number; user: GymUser }>();
const authUserInflight = new Map<number, Promise<GymUser | null>>();

function isGymJwtPayload(value: string | JsonWebTokenPayload): value is JsonWebTokenPayload & GymJwtPayload {
  return (
    typeof value !== "string" &&
    typeof value.userId === "number" &&
    typeof value.role === "string" &&
    typeof value.username === "string"
  );
}

export function signToken(payload: GymJwtPayload): string {
  return jwt.sign(payload, env.sessionSecret, { expiresIn: "24h" });
}

export function verifyToken(token: string): GymJwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.sessionSecret);
    return isGymJwtPayload(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

async function loadActiveUser(userId: number): Promise<GymUser | null> {
  const now = Date.now();
  const cached = authUserCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.user;
  if (cached) authUserCache.delete(userId);

  const existing = authUserInflight.get(userId);
  if (existing) return existing;

  const lookup = db.query.usersTable.findFirst({
    where: (u, { and, eq, isNull }) => and(eq(u.id, userId), isNull(u.deletedAt)),
  }).then((user) => {
    if (!user || user.status !== "active") {
      authUserCache.delete(userId);
      return null;
    }
    authUserCache.set(userId, { user, expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS });
    return user;
  }).finally(() => {
    authUserInflight.delete(userId);
  });

  authUserInflight.set(userId, lookup);
  return lookup;
}

function attachUser(req: Request, user: GymUser): void {
  req.__gymproUser = user;
  req.__gymproUserId = user.id;
  req.__gymproUserName = user.name;
}

/**
 * Routes mounted behind requireAuth can use this helper to narrow the optional
 * Express request augmentation to the authenticated user invariant.
 */
export function authenticatedUser(req: Request): GymUser {
  const user = req.__gymproUser;
  if (!user) {
    throw new Error("Authenticated user context is missing after requireAuth middleware");
  }
  return user;
}

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // The global authorization gate authenticates protected API requests first.
    // Existing route-level requireAuth calls remain as defense in depth without
    // repeating the database lookup.
    if (req.__gymproUser?.status === "active") {
      next();
      return;
    }

    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    try {
      const user = await loadActiveUser(payload.userId);

      if (!user) {
        res.status(401).json({ error: "User not found or inactive" });
        return;
      }

      attachUser(req, user);
      next();
    } catch (err) {
      req.log.error({ err }, "Authentication lookup failed");
      res.status(500).json({ error: "Auth check failed" });
    }
  };
}

export function optionalAuth() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (req.__gymproUser?.status === "active") {
      next();
      return;
    }

    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        try {
          const user = await loadActiveUser(payload.userId);
          if (user) attachUser(req, user);
        } catch {
          // Optional authentication must never block an otherwise public request.
        }
      }
    }
    next();
  };
}
