import { type Request, type Response, type NextFunction } from "express";
import jwt, { type JwtPayload as JsonWebTokenPayload } from "jsonwebtoken";
import { db } from "@workspace/db";
import { env } from "../config/env";

export interface GymJwtPayload {
  userId: number;
  role: string;
  username: string;
}

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

function attachUser(req: Request, user: NonNullable<Request["__gymproUser"]>): void {
  req.__gymproUser = user;
  req.__gymproUserId = user.id;
  req.__gymproUserName = user.name;
}

/**
 * Routes mounted behind requireAuth can use this helper to narrow the optional
 * Express request augmentation to the authenticated user invariant.
 */
export function authenticatedUser(req: Request): NonNullable<Request["__gymproUser"]> {
  const user = req.__gymproUser;
  if (!user) {
    throw new Error("Authenticated user context is missing after requireAuth middleware");
  }
  return user;
}

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
      const user = await db.query.usersTable.findFirst({
        where: (u, { and, eq, isNull }) => and(eq(u.id, payload.userId), isNull(u.deletedAt)),
      });

      if (!user || user.status !== "active") {
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
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        try {
          const user = await db.query.usersTable.findFirst({
            where: (u, { and, eq, isNull }) => and(eq(u.id, payload.userId), isNull(u.deletedAt)),
          });
          if (user && user.status === "active") attachUser(req, user);
        } catch {
          // Optional authentication must never block an otherwise public request.
        }
      }
    }
    next();
  };
}
