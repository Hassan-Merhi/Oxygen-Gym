import type { NextFunction, Request, Response } from "express";
import { forbidden, unauthorized } from "../http/errors";

export interface AuthenticatedUser {
  id: number;
  name: string;
  username: string;
  role: string;
  status: string;
}

type AuthenticatedRequest = Request & {
  __gymproUser?: AuthenticatedUser;
  __gymproUserId?: number;
  __gymproUserName?: string;
};

export function getCurrentUser(req: Request): AuthenticatedUser {
  const user = (req as AuthenticatedRequest).__gymproUser;
  if (!user) throw unauthorized();
  return user;
}

export function hasRole(req: Request, ...roles: string[]): boolean {
  const role = getCurrentUser(req).role.toLowerCase();
  return roles.some((allowed) => allowed.toLowerCase() === role);
}

export function requireRoles(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!hasRole(req, ...roles)) throw forbidden("You do not have permission to perform this action");
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAdmin() {
  return requireRoles("admin");
}
