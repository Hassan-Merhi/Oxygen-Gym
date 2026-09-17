export const FEATURE_PERMISSIONS = [
  "dashboard",
  "members",
  "plans",
  "staff",
  "payroll",
  "payments",
  "vouchers",
  "accounts",
  "stock",
  "sales",
  "settings",
  "viewCost",
  "viewProfit",
  "viewAccounting",
  "manageStaff",
  "manageSettings",
  "managePayroll",
  "manageInventory",
  "manageMembers",
  "managePlans",
] as const;

export type FeaturePermission = (typeof FEATURE_PERMISSIONS)[number];
export type AppRole = "admin" | "manager" | "staff";
export type PolicyAccess = "public" | "authenticated" | "permission" | "admin" | "selfOrAdmin";

export interface EndpointPolicy {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  access: PolicyAccess;
  allOf?: readonly FeaturePermission[];
  anyOf?: readonly FeaturePermission[];
  adminOnlyBodyKeys?: readonly string[];
  description: string;
}

export interface AuthorizationUser {
  id: number;
  role: string;
  permissions: Partial<Record<FeaturePermission, boolean>>;
}

export interface AuthorizationDecision {
  allowed: boolean;
  status: 200 | 401 | 403;
  reason: string;
  policy?: EndpointPolicy;
}

const p = (
  method: EndpointPolicy["method"],
  path: string,
  access: PolicyAccess,
  description: string,
  options: Pick<EndpointPolicy, "allOf" | "anyOf" | "adminOnlyBodyKeys"> = {},
): EndpointPolicy => ({ method, path, access, description, ...options });

/**
 * Canonical endpoint -> authorization matrix.
 *
 * Runtime enforcement and the CI authorization audit both consume this list.
 * Any API route that is not represented here is denied by default.
 */
export const ENDPOINT_POLICIES: readonly EndpointPolicy[] = [
  // Public bootstrap / health.
  p("GET", "/healthz", "public", "Health check"),
  p("GET", "/auth/setup", "public", "Initial setup status"),
  p("POST", "/auth/setup", "public", "One-time initial administrator setup"),
  p("POST", "/auth/login", "public", "Login"),

  // Authenticated self-service.
  p("POST", "/auth/logout", "authenticated", "Logout"),
  p("GET", "/auth/me", "authenticated", "Current user profile"),
  p("POST", "/auth/change-password", "authenticated", "Change own password"),

  // User accounts. Account / permission administration is admin-only; users can read/edit only themselves.
  p("GET", "/users", "admin", "List application users"),
  p("POST", "/users", "admin", "Create application user"),
  p("GET", "/users/:id", "selfOrAdmin", "Read own user profile or admin read any user"),
  p("PATCH", "/users/:id", "selfOrAdmin", "Edit own basic profile or admin edit any user", {
    adminOnlyBodyKeys: ["role", "status", "permissions"],
  }),
  p("DELETE", "/users/:id", "admin", "Delete user"),
  p("PATCH", "/users/:id/permissions", "admin", "Change user permissions"),
  p("POST", "/users/:id/reset-password", "admin", "Reset another user's password"),

  // Settings. Backup / integration credentials remain admin-only even when manageSettings is delegated.
  p("GET", "/settings", "permission", "Read application settings", { allOf: ["manageSettings"] }),
  p("PATCH", "/settings", "permission", "Update non-administrative settings", {
    allOf: ["manageSettings"],
    adminOnlyBodyKeys: ["backupEnabled", "backupTime", "greenApiInstanceId", "greenApiToken"],
  }),

  // Audit / administrative observability.
  p("GET", "/activity-logs", "admin", "Read activity logs"),
  p("GET", "/audit/run", "admin", "Run system audit"),
  p("POST", "/audit/fix/inventory", "admin", "Inventory repair compatibility endpoint"),
  p("POST", "/audit/fix/dashboard", "admin", "Dashboard repair compatibility endpoint"),
  p("POST", "/audit/fix/accounts", "admin", "Accounts repair compatibility endpoint"),

  // File upload can only be initiated by users already allowed to manage a feature that accepts images.
  p("POST", "/upload", "permission", "Upload application image", {
    anyOf: ["manageMembers", "manageStaff", "manageInventory", "manageSettings"],
  }),

  // Dashboard / reports.
  p("GET", "/dashboard/kpis", "permission", "Dashboard financial KPIs", { allOf: ["dashboard", "viewProfit"] }),

  // Plans.
  p("GET", "/plans", "permission", "List plans", { allOf: ["plans"] }),
  p("POST", "/plans", "permission", "Create plan", { allOf: ["managePlans"] }),
  p("PATCH", "/plans/:id", "permission", "Update plan", { allOf: ["managePlans"] }),
  p("DELETE", "/plans/:id", "permission", "Archive plan", { allOf: ["managePlans"] }),

  // Members.
  p("GET", "/members", "permission", "List members", { allOf: ["members"] }),
  p("POST", "/members", "permission", "Create member", { allOf: ["manageMembers"] }),
  p("GET", "/members/:id", "permission", "Read member", { allOf: ["members"] }),
  p("PATCH", "/members/:id", "permission", "Update member", { allOf: ["manageMembers"] }),
  p("DELETE", "/members/:id", "permission", "Archive member", { allOf: ["manageMembers"] }),
  p("POST", "/members/:id/checkin", "permission", "Check in member", { allOf: ["members"] }),
  p("POST", "/members/:id/renew", "permission", "Renew member", { allOf: ["manageMembers"] }),
  p("POST", "/members/:id/freeze", "permission", "Freeze member", { allOf: ["manageMembers"] }),
  p("POST", "/members/:id/reactivate", "permission", "Reactivate member", { allOf: ["manageMembers"] }),
  p("PATCH", "/members/:id/status", "permission", "Change member status", { allOf: ["manageMembers"] }),
  p("GET", "/members/:id/payments", "permission", "Read member payments", { allOf: ["members", "payments"] }),
  p("GET", "/members/:id/checkins", "permission", "Read member attendance", { allOf: ["members"] }),

  // Payments.
  p("GET", "/payments/summary", "permission", "Payment summary", { allOf: ["payments"] }),
  p("GET", "/payments", "permission", "List payments", { allOf: ["payments"] }),
  p("POST", "/payments", "permission", "Record payment", { allOf: ["payments"] }),
  p("GET", "/payments/admin/cash-cleanup", "admin", "Offline cash-cleanup compatibility endpoint"),
  p("POST", "/payments/admin/cash-cleanup", "admin", "Offline cash-cleanup compatibility endpoint"),
  p("POST", "/payments/:id/send-receipt", "permission", "Send payment receipt", { allOf: ["payments"] }),
  p("PATCH", "/payments/:id", "permission", "Edit payment", { allOf: ["payments"] }),
  p("DELETE", "/payments/:id", "permission", "Cancel payment", { allOf: ["payments"] }),

  // Vouchers.
  p("GET", "/vouchers", "permission", "List vouchers", { allOf: ["vouchers"] }),
  p("POST", "/vouchers", "permission", "Create voucher", { allOf: ["vouchers"] }),
  p("GET", "/vouchers/:id", "permission", "Read voucher", { allOf: ["vouchers"] }),
  p("PATCH", "/vouchers/:id", "permission", "Edit voucher", { allOf: ["vouchers"] }),
  p("DELETE", "/vouchers/:id", "permission", "Cancel voucher", { allOf: ["vouchers"] }),

  // Ledger / accounting.
  p("GET", "/ledger/balance", "permission", "Read cash balance", { allOf: ["viewAccounting"] }),
  p("GET", "/ledger/movements", "permission", "Read current cash movements", { anyOf: ["payments", "viewAccounting"] }),
  p("POST", "/ledger/opening-balance", "admin", "Set opening cash balance"),
  p("GET", "/ledger", "permission", "Read cash ledger", { allOf: ["viewAccounting"] }),
  p("GET", "/accounts/summary", "permission", "Accounts summary", { allOf: ["viewAccounting"] }),
  p("GET", "/accounts/sales", "permission", "Accounts sales ledger", { allOf: ["viewAccounting"] }),
  p("GET", "/accounts/expenses", "permission", "Accounts expense ledger", { allOf: ["viewAccounting"] }),
  p("GET", "/accounts/profit-loss", "permission", "Profit and loss", { allOf: ["viewAccounting", "viewProfit"] }),
  p("GET", "/accounts/chart", "permission", "Read chart of accounts", { allOf: ["viewAccounting"] }),
  p("POST", "/accounts/chart", "admin", "Create chart account"),
  p("PUT", "/accounts/chart/:id", "admin", "Update chart account"),
  p("DELETE", "/accounts/chart/:id", "admin", "Deactivate chart account"),
  p("GET", "/accounts/chart/:id/statement", "permission", "Read account statement", { allOf: ["viewAccounting"] }),
  p("GET", "/financials", "permission", "Detailed financial report", { allOf: ["viewAccounting", "viewProfit", "viewCost"] }),

  // Inventory / stock. Route responses redact cost fields when viewCost is absent.
  p("GET", "/stock/summary", "permission", "Inventory summary", { allOf: ["stock"] }),
  p("GET", "/stock", "permission", "List inventory", { allOf: ["stock"] }),
  p("POST", "/stock", "permission", "Create product", { allOf: ["manageInventory"] }),
  p("GET", "/stock/:id", "permission", "Read product", { allOf: ["stock"] }),
  p("PATCH", "/stock/:id", "permission", "Update product", { allOf: ["manageInventory"] }),
  p("GET", "/stock/:id/purchases", "permission", "Read product purchases", { allOf: ["stock"] }),
  p("POST", "/stock/:id/purchases", "permission", "Add stock purchase", { allOf: ["manageInventory"] }),
  p("GET", "/stock/:id/history", "permission", "Read product history", { allOf: ["stock"] }),

  // Supplier credits / liabilities.
  p("GET", "/supplier-credits/summary", "permission", "Supplier credit summary", { allOf: ["stock", "viewCost"] }),
  p("GET", "/supplier-credits/products", "permission", "Supplier product profitability", { allOf: ["stock", "viewCost", "viewProfit"] }),
  p("GET", "/supplier-credits", "permission", "List supplier credits", { allOf: ["stock", "viewCost"] }),
  p("POST", "/supplier-credits", "permission", "Create supplier credit", { allOf: ["manageInventory"] }),
  p("PATCH", "/supplier-credits/:id", "permission", "Update supplier credit", { allOf: ["manageInventory"] }),
  p("DELETE", "/supplier-credits/:id", "permission", "Delete supplier credit", { allOf: ["manageInventory"] }),
  p("GET", "/supplier-credits/:id/payments", "permission", "Read supplier settlements", { allOf: ["stock", "viewCost"] }),
  p("POST", "/supplier-credits/:id/payments", "permission", "Record supplier settlement", { allOf: ["manageInventory"] }),
  p("DELETE", "/supplier-credits/:id/payments/:paymentId", "permission", "Reverse supplier settlement", { allOf: ["manageInventory"] }),

  // Sales / POS. Route responses redact cost/profit fields unless their dedicated permissions are present.
  p("GET", "/sales/lookup-barcode", "permission", "POS barcode lookup", { allOf: ["sales"] }),
  p("GET", "/sales", "permission", "List sales", { allOf: ["sales"] }),
  p("GET", "/sales/:id", "permission", "Read sale", { allOf: ["sales"] }),
  p("POST", "/sales", "permission", "Complete sale", { allOf: ["sales"] }),
  p("PATCH", "/sales/:id", "admin", "Correct completed sale"),
  p("PATCH", "/sales/:id/void", "permission", "Void sale", { allOf: ["sales"] }),

  // Staff / payroll.
  p("GET", "/staff-employees", "permission", "List staff compensation records", { allOf: ["staff", "payroll"] }),
  p("GET", "/staff-employees/:id", "permission", "Read staff compensation record", { allOf: ["staff", "payroll"] }),
  p("POST", "/staff-employees", "permission", "Create staff employee", { allOf: ["manageStaff"] }),
  p("PATCH", "/staff-employees/:id", "permission", "Update staff employee", { allOf: ["manageStaff"] }),
  p("PATCH", "/staff-employees/:id/archive", "permission", "Archive staff employee", { allOf: ["manageStaff"] }),
  p("GET", "/payroll", "permission", "List payroll", { allOf: ["payroll"] }),
  p("GET", "/payroll/:id", "permission", "Read payroll", { allOf: ["payroll"] }),
  p("POST", "/payroll", "permission", "Create payroll", { allOf: ["managePayroll"] }),
  p("PATCH", "/payroll/:id/pay", "permission", "Pay payroll", { allOf: ["managePayroll"] }),
  p("PATCH", "/payroll/:id/cancel", "permission", "Cancel payroll", { allOf: ["managePayroll"] }),
  p("GET", "/commissions/summary", "permission", "Pending commission summary", { allOf: ["payroll"] }),

  // Attendance is member operational data.
  p("GET", "/attendance/summary", "permission", "Attendance summary", { allOf: ["members"] }),
  p("GET", "/attendance/daily", "permission", "Daily attendance trend", { allOf: ["members"] }),
  p("GET", "/attendance/monthly", "permission", "Monthly attendance trend", { allOf: ["members"] }),
  p("GET", "/attendance/hourly", "permission", "Hourly attendance trend", { allOf: ["members"] }),
  p("GET", "/attendance/top-members", "permission", "Top attending members", { allOf: ["members"] }),
  p("GET", "/attendance/today", "permission", "Today's attendance", { allOf: ["members"] }),
  p("GET", "/attendance/week", "permission", "Weekly attendance", { allOf: ["members"] }),
  p("GET", "/attendance/list", "permission", "Filtered attendance", { allOf: ["members"] }),
  p("GET", "/attendance/plans", "permission", "Attendance plan filters", { allOf: ["members"] }),
  p("GET", "/attendance/member/:id", "permission", "Member attendance statistics", { allOf: ["members"] }),

  // Notifications are user-specific; source categories are filtered by the user's effective feature permissions.
  p("GET", "/notifications", "authenticated", "List own notifications"),
  p("GET", "/notifications/count", "authenticated", "Own unread notification count"),
  p("PATCH", "/notifications/:key/read", "authenticated", "Mark own notification read"),
  p("PATCH", "/notifications/read-all", "authenticated", "Mark all own notifications read"),

  // WhatsApp configuration and broadcasts expose integration credentials / mass messaging and are admin-only.
  p("GET", "/whatsapp/chats", "admin", "List WhatsApp broadcast chats"),
  p("POST", "/whatsapp/chats", "admin", "Create WhatsApp broadcast chat"),
  p("PATCH", "/whatsapp/chats/:id", "admin", "Update WhatsApp broadcast chat"),
  p("DELETE", "/whatsapp/chats/:id", "admin", "Delete WhatsApp broadcast chat"),
  p("GET", "/whatsapp/contacts", "admin", "Read Green API contacts"),
  p("GET", "/whatsapp/state", "admin", "Read Green API connection state"),
  p("POST", "/whatsapp/test", "admin", "Send WhatsApp test message"),
  p("POST", "/whatsapp/send-member/:id", "admin", "Send member WhatsApp message"),
  p("POST", "/whatsapp/broadcast", "admin", "Broadcast WhatsApp message"),
  p("POST", "/whatsapp/send-daily-summary", "admin", "Trigger WhatsApp daily summary"),
] as const;

export function normalizeApiPath(path: string): string {
  const withoutQuery = path.split("?", 1)[0] || "/";
  if (withoutQuery === "/") return "/";
  const normalized = `/${withoutQuery.split("/").filter(Boolean).join("/")}`;
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function pathTemplateMatches(template: string, actualPath: string): boolean {
  const expected = normalizeApiPath(template).split("/").filter(Boolean);
  const actual = normalizeApiPath(actualPath).split("/").filter(Boolean);
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) => segment.startsWith(":") || segment === actual[index]);
}

export function extractPathParams(template: string, actualPath: string): Record<string, string> {
  const expected = normalizeApiPath(template).split("/").filter(Boolean);
  const actual = normalizeApiPath(actualPath).split("/").filter(Boolean);
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index]!;
    if (segment.startsWith(":")) params[segment.slice(1)] = actual[index] ?? "";
  }
  return params;
}

export function matchingEndpointPolicies(method: string, path: string): EndpointPolicy[] {
  const normalizedMethod = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return ENDPOINT_POLICIES.filter((policy) =>
    policy.method === normalizedMethod && pathTemplateMatches(policy.path, path),
  );
}

export function findEndpointPolicy(method: string, path: string): EndpointPolicy | undefined {
  const matches = matchingEndpointPolicies(method, path);
  return matches.length === 1 ? matches[0] : undefined;
}

export function isKnownRole(role: string): role is AppRole {
  return role === "admin" || role === "manager" || role === "staff";
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
      reason: matches.length === 0 ? "Endpoint is not classified in the authorization matrix" : "Endpoint has ambiguous authorization rules",
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

  if (policy.access === "authenticated") {
    return { allowed: true, status: 200, reason: "Authenticated role", policy };
  }
  if (policy.access === "admin") {
    return { allowed: false, status: 403, reason: "Administrator role required", policy };
  }
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
  if (hasAll && hasAny) return { allowed: true, status: 200, reason: "Required feature permissions granted", policy };

  return { allowed: false, status: 403, reason: "Required feature permission missing", policy };
}
