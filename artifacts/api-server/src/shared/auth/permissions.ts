import type { NextFunction, Request, Response } from "express";
import {
  defaultAdminPermissions,
  defaultManagerPermissions,
  defaultStaffPermissions,
  type PagePermissions,
} from "@workspace/db/schema";
import { forbidden, unauthorized } from "../http/errors";
import { FEATURE_PERMISSIONS, type AppRole, type FeaturePermission } from "./authorization-policy";

export interface AuthenticatedUser {
  id: number;
  name: string;
  username: string;
  role: string;
  status: string;
  permissions?: Partial<PagePermissions> | Record<string, unknown> | null;
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

export function normalizeRole(role: string): AppRole | null {
  const normalized = role.toLowerCase();
  return normalized === "admin" || normalized === "manager" || normalized === "staff"
    ? normalized
    : null;
}

export function roleDefaultPermissions(role: string): PagePermissions {
  const normalized = normalizeRole(role);
  if (normalized === "admin") return { ...defaultAdminPermissions };
  if (normalized === "manager") return { ...defaultManagerPermissions };
  return { ...defaultStaffPermissions };
}

/**
 * Legacy user rows may contain only part of the JSON permission object.
 * Missing keys inherit the role default, while explicit booleans always win.
 */
export function normalizePermissions(
  role: string,
  stored: AuthenticatedUser["permissions"],
): PagePermissions {
  const normalized = roleDefaultPermissions(role);
  const source = stored && typeof stored === "object" ? stored as Record<string, unknown> : {};

  for (const key of FEATURE_PERMISSIONS) {
    const value = source[key];
    if (typeof value === "boolean") normalized[key] = value;
  }
  return normalized;
}

export function getEffectivePermissions(req: Request): PagePermissions {
  const user = getCurrentUser(req);
  return normalizePermissions(user.role, user.permissions);
}

export function hasRole(req: Request, ...roles: string[]): boolean {
  const role = normalizeRole(getCurrentUser(req).role);
  if (!role) return false;
  return roles.some((allowed) => normalizeRole(allowed) === role);
}

export function hasPermissionForUser(user: AuthenticatedUser, permission: FeaturePermission): boolean {
  const role = normalizeRole(user.role);
  if (!role) return false;
  // Admin is the recovery/superuser role. Feature toggles cannot accidentally lock an admin out.
  if (role === "admin") return true;
  return normalizePermissions(role, user.permissions)[permission] === true;
}

export function hasPermission(req: Request, permission: FeaturePermission): boolean {
  return hasPermissionForUser(getCurrentUser(req), permission);
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

export function requirePermission(permission: FeaturePermission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!hasPermission(req, permission)) throw forbidden(`Missing permission: ${permission}`);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAllPermissions(...permissions: FeaturePermission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!permissions.every((permission) => hasPermission(req, permission))) {
        throw forbidden("You do not have permission to perform this action");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAnyPermission(...permissions: FeaturePermission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!permissions.some((permission) => hasPermission(req, permission))) {
        throw forbidden("You do not have permission to perform this action");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAdmin() {
  return requireRoles("admin");
}
