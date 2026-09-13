import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../../middlewares/auth";
import { evaluateEndpointAccess, matchingEndpointPolicies } from "./authorization-evaluator";
import { getCurrentUser, normalizePermissions } from "./permissions";

const authenticate = requireAuth();

/**
 * Global API authorization gate.
 *
 * Public endpoints are explicitly listed in the canonical matrix. Every other
 * request is authenticated and then evaluated against the matrix. Missing or
 * ambiguous rules are denied with 403, so adding a new backend route without an
 * authorization rule cannot accidentally make it accessible.
 */
export function enforceApiAuthorization() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method.toUpperCase() === "OPTIONS") {
      next();
      return;
    }

    const matches = matchingEndpointPolicies(req.method, req.path);
    if (matches.length === 1 && matches[0]?.access === "public") {
      next();
      return;
    }

    authenticate(req, res, (authError?: unknown) => {
      if (authError) {
        next(authError);
        return;
      }
      if (res.headersSent) return;

      const current = getCurrentUser(req);
      const decision = evaluateEndpointAccess(req.method, req.path, {
        id: current.id,
        role: current.role,
        permissions: normalizePermissions(current.role, current.permissions),
      }, req.body);

      if (!decision.allowed) {
        req.log.warn({
          userId: current.id,
          role: current.role,
          method: req.method,
          path: req.path,
          reason: decision.reason,
        }, "Authorization denied");
        res.status(decision.status).json({ error: "Forbidden" });
        return;
      }

      next();
    });
  };
}
