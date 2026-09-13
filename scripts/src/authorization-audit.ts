import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const routesIndexPath = path.join(repoRoot, "artifacts/api-server/src/routes/index.ts");
const policyPath = path.join(repoRoot, "artifacts/api-server/src/shared/auth/authorization-policy.ts");
const evaluatorPath = path.join(repoRoot, "artifacts/api-server/src/shared/auth/authorization-evaluator.ts");
const permissionSchemaPath = path.join(repoRoot, "lib/db/src/schema/users.ts");
const documentationPath = path.join(repoRoot, "SERVER_AUTHORIZATION.md");

interface EndpointPolicy {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  access: "public" | "authenticated" | "permission" | "admin" | "selfOrAdmin";
  allOf?: readonly string[];
  anyOf?: readonly string[];
  adminOnlyBodyKeys?: readonly string[];
  description: string;
}

interface AuthorizationUser {
  id: number;
  role: string;
  permissions: Record<string, boolean>;
}

interface AuthorizationDecision {
  allowed: boolean;
  status: 200 | 401 | 403;
  reason: string;
  policy?: EndpointPolicy;
}

interface PolicyModule {
  ENDPOINT_POLICIES: readonly EndpointPolicy[];
  FEATURE_PERMISSIONS: readonly string[];
  normalizeApiPath(pathname: string): string;
}

interface EvaluatorModule {
  matchingEndpointPolicies(method: string, pathname: string): EndpointPolicy[];
  evaluateEndpointAccess(method: string, pathname: string, user?: AuthorizationUser | null, body?: unknown): AuthorizationDecision;
}

function fail(message: string): never {
  throw new Error(`Authorization audit failed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function resolveRouterImport(indexDir: string, specifier: string): string {
  const base = path.resolve(indexDir, specifier);
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return fail(`Unable to resolve router import ${specifier}`);
}

function joinRoute(prefix: string, localPath: string, normalizeApiPath: (value: string) => string): string {
  const left = prefix === "/" ? "" : prefix;
  const right = localPath === "/" ? "" : localPath;
  return normalizeApiPath(`${left}/${right}`);
}

function concretePath(template: string, selfId = 7): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => name === "id" ? String(selfId) : "11");
}

function permissionSet(keys: readonly string[], value: boolean): Record<string, boolean> {
  return Object.fromEntries(keys.map((key) => [key, value]));
}

const policy = await import(pathToFileURL(policyPath).href) as PolicyModule;
const evaluator = await import(pathToFileURL(evaluatorPath).href) as EvaluatorModule;
const { ENDPOINT_POLICIES, FEATURE_PERMISSIONS, normalizeApiPath } = policy;
const { evaluateEndpointAccess, matchingEndpointPolicies } = evaluator;

let assertions = 0;
const check = (condition: unknown, message: string): void => {
  assertions += 1;
  assert(condition, message);
};

// The feature-permission vocabulary must stay aligned with the persisted JSON schema.
const permissionSchema = readFileSync(permissionSchemaPath, "utf8");
for (const feature of FEATURE_PERMISSIONS) {
  check(permissionSchema.includes(`${feature}:`), `feature permission ${feature} is not present in the persisted PagePermissions schema`);
}

// Discover every currently mounted application API endpoint from Express router source.
const indexSource = readFileSync(routesIndexPath, "utf8");
const importMap = new Map<string, string>();
for (const match of indexSource.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+["']([^"']+)["'];/g)) {
  importMap.set(match[1]!, match[2]!);
}

const mounts: Array<{ prefix: string; variable: string }> = [];
for (const match of indexSource.matchAll(/router\.use\(\s*["']([^"']+)["']\s*,\s*([A-Za-z0-9_]+)\s*\)/g)) {
  mounts.push({ prefix: match[1]!, variable: match[2]! });
}
for (const match of indexSource.matchAll(/router\.use\(\s*([A-Za-z0-9_]+)\s*\)/g)) {
  const variable = match[1]!;
  if (importMap.has(variable)) mounts.push({ prefix: "", variable });
}

const gatePosition = indexSource.indexOf("router.use(enforceApiAuthorization())");
const firstRouterMount = Math.min(...mounts.map(({ variable }) => indexSource.indexOf(`router.use(${variable})`)).filter((value) => value >= 0));
check(gatePosition >= 0, "global authorization gate is not mounted in routes/index.ts");
check(firstRouterMount === Infinity || gatePosition < firstRouterMount, "authorization gate must run before mounted API routers");

const actualRoutes: Array<{ method: EndpointPolicy["method"]; path: string; source: string }> = [];
const seenMounts = new Set<string>();
for (const mount of mounts) {
  const mountKey = `${mount.prefix}:${mount.variable}`;
  if (seenMounts.has(mountKey)) continue;
  seenMounts.add(mountKey);
  const specifier = importMap.get(mount.variable);
  if (!specifier) fail(`Mounted router ${mount.variable} has no import`);
  const routerPath = resolveRouterImport(path.dirname(routesIndexPath), specifier);
  const routerSource = readFileSync(routerPath, "utf8");
  for (const match of routerSource.matchAll(/router\.(get|post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`]/gi)) {
    const method = match[1]!.toUpperCase() as EndpointPolicy["method"];
    actualRoutes.push({
      method,
      path: joinRoute(mount.prefix, match[2]!, normalizeApiPath),
      source: path.relative(repoRoot, routerPath),
    });
  }
}

check(actualRoutes.length > 0, "no API routes were discovered");

const actualKeys = new Set<string>();
for (const route of actualRoutes) {
  const key = `${route.method} ${route.path}`;
  check(!actualKeys.has(key), `duplicate mounted route ${key}`);
  actualKeys.add(key);
  const matches = matchingEndpointPolicies(route.method, route.path);
  check(matches.length === 1, `${key} from ${route.source} must have exactly one effective authorization rule; found ${matches.length}`);
}

// No stale matrix entries: the matrix and mounted Express surface are one-to-one.
const policyKeys = new Set<string>();
for (const entry of ENDPOINT_POLICIES) {
  const key = `${entry.method} ${normalizeApiPath(entry.path)}`;
  check(!policyKeys.has(key), `duplicate authorization matrix entry ${key}`);
  policyKeys.add(key);
  check(actualKeys.has(key), `authorization matrix entry ${key} does not correspond to a mounted API endpoint`);
}
check(policyKeys.size === actualKeys.size, `matrix size ${policyKeys.size} differs from mounted route count ${actualKeys.size}`);

// Documentation is not allowed to drift from runtime policy.
const documentation = readFileSync(documentationPath, "utf8");
for (const entry of ENDPOINT_POLICIES) {
  const marker = `| ${entry.method} | \`${entry.path}\` |`;
  check(documentation.includes(marker), `SERVER_AUTHORIZATION.md is missing ${entry.method} ${entry.path}`);
}
check(documentation.includes("default-deny") || documentation.includes("Default-deny"), "authorization documentation must describe default-deny behavior");

const allFalse = permissionSet(FEATURE_PERMISSIONS, false);
const allTrue = permissionSet(FEATURE_PERMISSIONS, true);
const admin: AuthorizationUser = { id: 1, role: "admin", permissions: allFalse };

for (const entry of ENDPOINT_POLICIES) {
  const requestPath = concretePath(entry.path, 7);
  const noUser = evaluateEndpointAccess(entry.method, requestPath, null);
  if (entry.access === "public") {
    check(noUser.allowed && noUser.status === 200, `${entry.method} ${entry.path} should be public`);
    continue;
  }

  check(!noUser.allowed && noUser.status === 401, `${entry.method} ${entry.path} should require authentication`);
  const adminDecision = evaluateEndpointAccess(entry.method, requestPath, admin);
  check(adminDecision.allowed, `admin must be allowed on ${entry.method} ${entry.path}`);

  for (const role of ["manager", "staff"] as const) {
    const deniedUser: AuthorizationUser = { id: 7, role, permissions: { ...allFalse } };
    const fullUser: AuthorizationUser = { id: 7, role, permissions: { ...allTrue } };

    if (entry.access === "admin") {
      const decision = evaluateEndpointAccess(entry.method, requestPath, fullUser);
      check(!decision.allowed && decision.status === 403, `${role} must not bypass admin-only ${entry.method} ${entry.path} even with every feature permission`);
      continue;
    }

    if (entry.access === "authenticated") {
      check(evaluateEndpointAccess(entry.method, requestPath, deniedUser).allowed, `${role} should reach authenticated endpoint ${entry.method} ${entry.path}`);
      continue;
    }

    if (entry.access === "selfOrAdmin") {
      check(evaluateEndpointAccess(entry.method, concretePath(entry.path, 7), deniedUser).allowed, `${role} should reach own ${entry.method} ${entry.path}`);
      const other = evaluateEndpointAccess(entry.method, concretePath(entry.path, 8), deniedUser);
      check(!other.allowed && other.status === 403, `${role} must not reach another user's ${entry.method} ${entry.path}`);
      continue;
    }

    const without = evaluateEndpointAccess(entry.method, requestPath, deniedUser);
    check(!without.allowed && without.status === 403, `${role} without grants must be denied ${entry.method} ${entry.path}`);

    const granted = { ...allFalse };
    for (const required of entry.allOf ?? []) granted[required] = true;
    if ((entry.anyOf?.length ?? 0) > 0) granted[entry.anyOf![0]!] = true;
    const allowed = evaluateEndpointAccess(entry.method, requestPath, { id: 7, role, permissions: granted });
    check(allowed.allowed, `${role} with the required grants should reach ${entry.method} ${entry.path}`);

    for (const required of entry.allOf ?? []) {
      const missingOne = { ...granted, [required]: false };
      const decision = evaluateEndpointAccess(entry.method, requestPath, { id: 7, role, permissions: missingOne });
      check(!decision.allowed && decision.status === 403, `${role} missing ${required} must be denied ${entry.method} ${entry.path}`);
    }

    if ((entry.anyOf?.length ?? 0) > 0) {
      const noAlternative = { ...allFalse };
      for (const required of entry.allOf ?? []) noAlternative[required] = true;
      const noAlternativeDecision = evaluateEndpointAccess(entry.method, requestPath, { id: 7, role, permissions: noAlternative });
      check(!noAlternativeDecision.allowed && noAlternativeDecision.status === 403, `${role} needs at least one alternative permission for ${entry.method} ${entry.path}`);
      for (const alternative of entry.anyOf ?? []) {
        const oneAlternative = { ...noAlternative, [alternative]: true };
        check(
          evaluateEndpointAccess(entry.method, requestPath, { id: 7, role, permissions: oneAlternative }).allowed,
          `${role} should satisfy ${entry.method} ${entry.path} with alternative ${alternative}`,
        );
      }
    }
  }
}

// Explicit escalation and fail-closed regression tests.
const managerAll: AuthorizationUser = { id: 7, role: "manager", permissions: { ...allTrue } };
const staffAll: AuthorizationUser = { id: 7, role: "staff", permissions: { ...allTrue } };
const staffNone: AuthorizationUser = { id: 7, role: "staff", permissions: { ...allFalse } };

for (const [method, pathname, user, body] of [
  ["PATCH", "/users/7/permissions", managerAll, { permissions: allTrue }],
  ["POST", "/users/7/reset-password", managerAll, { password: "changed" }],
  ["POST", "/ledger/opening-balance", managerAll, { targetAmountUsd: 100 }],
  ["GET", "/audit/run", managerAll, undefined],
  ["POST", "/whatsapp/broadcast", managerAll, { message: "x" }],
  ["POST", "/payments/admin/cash-cleanup", managerAll, undefined],
  ["PATCH", "/settings", managerAll, { greenApiToken: "secret" }],
  ["PATCH", "/settings", managerAll, { backupEnabled: "true" }],
  ["PATCH", "/users/7", staffAll, { role: "admin" }],
] as const) {
  const decision = evaluateEndpointAccess(method, pathname, user, body);
  check(!decision.allowed && decision.status === 403, `privilege escalation must return 403 for ${method} ${pathname}`);
}

const unknownRole = evaluateEndpointAccess("GET", "/members", { id: 9, role: "developer", permissions: allTrue });
check(!unknownRole.allowed && unknownRole.status === 403, "unknown roles must be denied");
const unclassified = evaluateEndpointAccess("POST", "/future-sensitive-route", staffAll, { dangerous: true });
check(!unclassified.allowed && unclassified.status === 403, "new unclassified routes must fail closed with 403");
const staffDirectAccounting = evaluateEndpointAccess("GET", "/accounts/summary", staffNone);
check(!staffDirectAccounting.allowed && staffDirectAccounting.status === 403, "staff direct API calls must not bypass viewAccounting");
const managerSettings = evaluateEndpointAccess("PATCH", "/settings", { id: 7, role: "manager", permissions: { ...allFalse, manageSettings: true } }, { gymName: "Allowed" });
check(managerSettings.allowed, "manager with manageSettings should be able to edit non-admin settings");
const staticRoute = evaluateEndpointAccess("GET", "/stock/summary", { id: 7, role: "manager", permissions: { ...allFalse, stock: true } });
check(staticRoute.allowed, "static /stock/summary policy must win over dynamic /stock/:id policy");
const salesLookup = evaluateEndpointAccess("GET", "/sales/lookup-barcode", { id: 7, role: "manager", permissions: { ...allFalse, sales: true } });
check(salesLookup.allowed, "static /sales/lookup-barcode policy must win over dynamic /sales/:id policy");

console.log(`Authorization audit passed: ${actualRoutes.length} endpoints, ${ENDPOINT_POLICIES.length} matrix rules, ${assertions} role/permission assertions.`);
