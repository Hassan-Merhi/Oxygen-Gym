import {
  ENDPOINT_POLICIES,
  extractPathParams,
  isKnownRole,
  pathTemplateMatches,
  type AuthorizationDecision,
  type AuthorizationUser,
  type EndpointPolicy,
} from "./authorization-policy";

function specificity(policy: EndpointPolicy): number {
  return policy.path
    .split("/")
    .filter(Boolean)
    .reduce((score, segment) => score + (segment.startsWith(":") ? 0 : 1), 0);
}

/**
 * Express prefers the concrete route declared before a dynamic `/:id` route.
 * Mirror that intent centrally by selecting the most-specific matching policy.
 * Same-specificity overlaps remain ambiguous and are denied.
 */
export function matchingEndpointPolicies(method: string, path: string): EndpointPolicy[] {
  const normalizedMethod = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  const matches = ENDPOINT_POLICIES.filter((policy) =>
    policy.method === normalizedMethod && pathTemplateMatches(policy.path, path),
  );
  if (matches.length <= 1) return matches;

  const highest = Math.max(...matches.map(specificity));
  return matches.filter((policy) => specificity(policy) === highest);
}

function hasOwn(body: unknown, key: string): boolean {
  return Boolean(body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, key));
}

export function evaluateEndpointAccess(
  method: string,
  path: string,
  user?: AuthorizationUser | null,
  body?: unknown,
): AuthorizationDecision {
  const matches = matchingEndpointPolicies(method, path);
  if (matches.length !== 1) {
    return {
      allowed: false,
      status: 403,
      reason: matches.length === 0
        ? "Endpoint is not classified in the authorization matrix"
        : "Endpoint has ambiguous authorization rules",
    };
  }

  const policy = matches[0]!;
  if (policy.access === "public") return { allowed: true, status: 200, reason: "Public endpoint", policy };
  if (!user) return { allowed: false, status: 401, reason: "Authentication required", policy };
  if (!isKnownRole(user.role)) return { allowed: false, status: 403, reason: "Unknown role is denied by default", policy };

  if (user.role !== "admin" && policy.adminOnlyBodyKeys?.some((key) => hasOwn(body, key))) {
    return { allowed: false, status: 403, reason: "Request attempts to modify an admin-only field", policy };
  }

  if (user.role === "admin") return { allowed: true, status: 200, reason: "Administrator", policy };
  if (policy.access === "authenticated") return { allowed: true, status: 200, reason: "Authenticated role", policy };
  if (policy.access === "admin") return { allowed: false, status: 403, reason: "Administrator role required", policy };

  if (policy.access === "selfOrAdmin") {
    const params = extractPathParams(policy.path, path);
    return Number(params.id) === user.id
      ? { allowed: true, status: 200, reason: "Self-service endpoint", policy }
      : { allowed: false, status: 403, reason: "May only access own user record", policy };
  }

  const allOf = policy.allOf ?? [];
  const anyOf = policy.anyOf ?? [];
  const hasAll = allOf.every((permission) => user.permissions[permission] === true);
  const hasAny = anyOf.length === 0 || anyOf.some((permission) => user.permissions[permission] === true);
  return hasAll && hasAny
    ? { allowed: true, status: 200, reason: "Required feature permissions granted", policy }
    : { allowed: false, status: 403, reason: "Required feature permission missing", policy };
}
