import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET || "gympro-dev-secret-change-in-prod";

export interface JwtPayload {
  userId: number;
  role: string;
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
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

      (req as any).__gymproUser = user;
      (req as any).__gymproUserId = user.id;
      (req as any).__gymproUserName = user.name;
      next();
    } catch (err) {
      res.status(500).json({ error: "Auth check failed" });
    }
  };
}

export function optionalAuth() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        try {
          const user = await db.query.usersTable.findFirst({
            where: (u, { and, eq, isNull }) => and(eq(u.id, payload.userId), isNull(u.deletedAt)),
          });
          if (user && user.status === "active") {
            (req as any).__gymproUser = user;
            (req as any).__gymproUserId = user.id;
            (req as any).__gymproUserName = user.name;
          }
        } catch { /* ignore */ }
      }
    }
    next();
  };
}
