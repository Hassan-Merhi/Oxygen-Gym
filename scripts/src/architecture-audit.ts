import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API_SRC = path.join(ROOT, "artifacts/api-server/src");
const ROUTES_INDEX = path.join(API_SRC, "routes/index.ts");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "generated", "attached_assets"]);
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

type Violation = { file: string; line?: number; message: string };
type MountedRouter = { name: string; file: string; prefix: string; mountCount: number };
type RouteOperation = { method: string; path: string; source: string };
type OpenApiOperation = { method: string; path: string; operationId?: string };

function rel(file: string): string {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function walk(dir: string, predicate: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const output: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full, predicate));
    else if (predicate(full)) output.push(full);
  }
  return output;
}

function sourceFiles(dir: string): string[] {
  return walk(dir, (file) => SOURCE_EXTENSIONS.has(path.extname(file)));
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function importsOf(text: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) imports.push(match[1]);
  }
  return imports;
}

function resolveTsImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function checkBoundaries(files: string[], violations: Violation[]): void {
  const nodeBuiltins = /^(?:node:|fs$|path$|url$|http$|https$|crypto$|stream$|buffer$|os$|child_process$)/;
  for (const file of files) {
    const relative = rel(file);
    const text = fs.readFileSync(file, "utf8");
    for (const specifier of importsOf(text)) {
      if (relative.startsWith("artifacts/gym-app/src/")) {
        if (
          specifier.startsWith("@workspace/db") ||
          specifier.includes("api-server") ||
          specifier.startsWith("@workspace/api-zod") ||
          nodeBuiltins.test(specifier)
        ) violations.push({ file: relative, message: `frontend boundary leak: ${specifier}` });
      }

      if (relative.startsWith("artifacts/api-server/src/")) {
        if (
          specifier.startsWith("@workspace/api-client-react") ||
          specifier.includes("gym-app") ||
          specifier.includes("mockup-sandbox") ||
          specifier.includes("desktop")
        ) violations.push({ file: relative, message: `API boundary leak: ${specifier}` });
      }

      if (relative.startsWith("lib/db/src/")) {
        if (
          specifier.startsWith("@workspace/api-") ||
          specifier.includes("api-server") ||
          specifier.includes("gym-app") ||
          specifier.includes("desktop")
        ) violations.push({ file: relative, message: `database boundary leak: ${specifier}` });
      }

      if (relative.startsWith("lib/api-zod/src/") || relative.startsWith("lib/api-client-react/src/")) {
        if (specifier.startsWith("@workspace/db") || specifier.includes("api-server") || specifier.includes("gym-app")) {
          violations.push({ file: relative, message: `contract/client boundary leak: ${specifier}` });
        }
      }
    }
  }
}

function checkEnvironmentAccess(files: string[], violations: Violation[]): void {
  const allowed = new Set([
    "artifacts/api-server/src/config/env.ts",
    "lib/db/src/config/env.ts",
  ]);

  for (const file of files) {
    const relative = rel(file);
    const text = fs.readFileSync(file, "utf8");
    const serverRuntime = relative.startsWith("artifacts/api-server/src/") || relative.startsWith("lib/db/src/");
    if (!serverRuntime || allowed.has(relative)) continue;

    for (const match of text.matchAll(/\bprocess\.env\b/g)) {
      violations.push({
        file: relative,
        line: lineOf(text, match.index ?? 0),
        message: "server environment access must go through the package config/env module",
      });
    }
  }
}

function checkUnsafeApiCasts(files: string[], violations: Violation[]): void {
  for (const file of files) {
    const relative = rel(file);
    if (!relative.startsWith("artifacts/api-server/src/") || relative.endsWith("/types/express.d.ts")) continue;
    const text = fs.readFileSync(file, "utf8");
    const patterns: Array<[RegExp, string]> = [
      [/\breq\.(?:body|query|params)\s+as\b/g, "manual request input cast; parse through a generated contract instead"],
      [/\(req\s+as\s+any\b/g, "untyped authenticated request context"],
      [/\(req\s+as\s+unknown\s+as\b/g, "double-cast request escape"],
    ];
    for (const [pattern, message] of patterns) {
      for (const match of text.matchAll(pattern)) violations.push({ file: relative, line: lineOf(text, match.index ?? 0), message });
    }
  }
}

function checkExplicitAnyInApi(files: string[], violations: Violation[]): void {
  const patterns: Array<[RegExp, string]> = [
    [/\bas\s+any\b/g, "explicit `as any` escape"],
    [/\bany\s*\[\s*\]/g, "explicit `any[]` escape"],
    [/:\s*any\b/g, "explicit `any` annotation"],
    [/\bRecord<[^>]*,\s*any\s*>/g, "explicit `Record<..., any>` escape"],
    [/\bPromise<\s*any\b/g, "explicit `Promise<any>` escape"],
  ];

  for (const file of files) {
    const relative = rel(file);
    if (!relative.startsWith("artifacts/api-server/src/") || relative.endsWith("/types/express.d.ts")) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const [pattern, message] of patterns) {
      for (const match of text.matchAll(pattern)) {
        violations.push({ file: relative, line: lineOf(text, match.index ?? 0), message });
      }
    }
  }
}

function normalizeRoutePath(prefix: string, routePath: string): string {
  const joined = `${prefix}/${routePath}`.replace(/\/{2,}/g, "/");
  const normalized = joined !== "/" && joined.endsWith("/") ? joined.slice(0, -1) : joined;
  return normalized.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function mountedRouters(): MountedRouter[] {
  const indexText = fs.readFileSync(ROUTES_INDEX, "utf8");
  const importToFile = new Map<string, string>();

  for (const match of indexText.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+)["'];/g)) {
    const resolved = resolveTsImport(ROUTES_INDEX, match[2]);
    if (resolved) importToFile.set(match[1], resolved);
  }

  const mounts = new Map<string, { prefix: string; count: number }>();
  for (const match of indexText.matchAll(/router\.use\(\s*(?:["']([^"']+)["']\s*,\s*)?(\w+)\s*\)/g)) {
    const name = match[2];
    const current = mounts.get(name);
    mounts.set(name, { prefix: match[1] ?? "", count: (current?.count ?? 0) + 1 });
  }

  return [...importToFile.entries()]
    .filter(([name]) => mounts.has(name))
    .map(([name, file]) => ({
      name,
      file,
      prefix: mounts.get(name)!.prefix,
      mountCount: mounts.get(name)!.count,
    }));
}

function parseExpressRoutes(): RouteOperation[] {
  const operations: RouteOperation[] = [];
  for (const mounted of mountedRouters()) {
    const text = fs.readFileSync(mounted.file, "utf8");
    for (const match of text.matchAll(/router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
      operations.push({
        method: match[1].toLowerCase(),
        path: normalizeRoutePath(mounted.prefix, match[2]),
        source: rel(mounted.file),
      });
    }
  }
  return operations;
}

function parseOpenApiOperations(): OpenApiOperation[] {
  const lines = fs.readFileSync(path.join(ROOT, "lib/api-spec/openapi.yaml"), "utf8").split(/\r?\n/);
  const operations: OpenApiOperation[] = [];
  let inPaths = false;
  let currentPath: string | null = null;
  let currentOperation: OpenApiOperation | null = null;

  for (const line of lines) {
    if (line === "paths:") { inPaths = true; continue; }
    if (inPaths && /^components:\s*$/.test(line)) break;
    if (!inPaths) continue;

    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1].replace(/\/$/, "") || "/";
      currentOperation = null;
      continue;
    }

    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (currentPath && methodMatch && HTTP_METHODS.has(methodMatch[1])) {
      currentOperation = { method: methodMatch[1], path: currentPath };
      operations.push(currentOperation);
      continue;
    }

    const operationIdMatch = line.match(/^      operationId:\s*([^\s#]+)\s*$/);
    if (currentOperation && operationIdMatch) currentOperation.operationId = operationIdMatch[1];
  }
  return operations;
}

function checkOpenApiCoverage(violations: Violation[]): void {
  const expressOps = parseExpressRoutes();
  const openApiOps = parseOpenApiOperations();
  const specKeys = new Set(openApiOps.map((op) => `${op.method} ${op.path}`));
  const expressKeys = new Set(expressOps.map((op) => `${op.method} ${op.path}`));

  for (const op of expressOps) {
    const key = `${op.method} ${op.path}`;
    if (!specKeys.has(key)) violations.push({ file: op.source, message: `route missing from OpenAPI contract: ${key}` });
  }
  for (const key of specKeys) {
    if (!expressKeys.has(key)) violations.push({ file: "lib/api-spec/openapi.yaml", message: `OpenAPI operation has no Express route: ${key}` });
  }
}

function checkDuplicateRoutesAndContracts(violations: Violation[]): void {
  const expressCounts = new Map<string, RouteOperation[]>();
  for (const operation of parseExpressRoutes()) {
    const key = `${operation.method} ${operation.path}`;
    const entries = expressCounts.get(key) ?? [];
    entries.push(operation);
    expressCounts.set(key, entries);
  }
  for (const [key, entries] of expressCounts) {
    if (entries.length > 1) violations.push({ file: entries[0].source, message: `duplicate Express route ${key} (${entries.length} registrations)` });
  }

  const contractCounts = new Map<string, number>();
  const operationIds = new Map<string, number>();
  for (const operation of parseOpenApiOperations()) {
    const key = `${operation.method} ${operation.path}`;
    contractCounts.set(key, (contractCounts.get(key) ?? 0) + 1);
    if (operation.operationId) operationIds.set(operation.operationId, (operationIds.get(operation.operationId) ?? 0) + 1);
    else violations.push({ file: "lib/api-spec/openapi.yaml", message: `OpenAPI operation ${key} has no operationId` });
  }
  for (const [key, count] of contractCounts) {
    if (count > 1) violations.push({ file: "lib/api-spec/openapi.yaml", message: `duplicate OpenAPI operation ${key}` });
  }
  for (const [operationId, count] of operationIds) {
    if (count > 1) violations.push({ file: "lib/api-spec/openapi.yaml", message: `duplicate OpenAPI operationId ${operationId}` });
  }
}

function looksLikeRouterModule(file: string): boolean {
  const text = fs.readFileSync(file, "utf8");
  return /\bRouter\s*\(/.test(text) && /export\s+default\s+router\b/.test(text);
}

function checkRouteRegistry(violations: Violation[]): void {
  const mounted = mountedRouters();
  const mountedFiles = new Set(mounted.map((entry) => path.resolve(entry.file)));
  const routerCandidates = [
    ...walk(path.join(API_SRC, "routes"), (file) => file.endsWith(".ts") && path.basename(file) !== "index.ts"),
    ...walk(path.join(API_SRC, "domains"), (file) => file.endsWith(".ts")),
  ].filter(looksLikeRouterModule);

  for (const file of routerCandidates) {
    if (!mountedFiles.has(path.resolve(file))) {
      violations.push({ file: rel(file), message: "dead router module: exported router is not mounted by routes/index.ts" });
    }
  }
  for (const entry of mounted) {
    if (entry.mountCount > 1) {
      violations.push({ file: "artifacts/api-server/src/routes/index.ts", message: `router ${entry.name} is mounted more than once` });
    }
  }
}

function checkMigrationBoundaries(files: string[], violations: Violation[]): void {
  const ddlPattern = /\b(?:ALTER|CREATE|DROP)\s+(?:TABLE|INDEX|SCHEMA|TYPE|EXTENSION)\b/gi;
  for (const file of files) {
    const relative = rel(file);
    if (!relative.startsWith("artifacts/api-server/src/")) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(ddlPattern)) {
      violations.push({
        file: relative,
        line: lineOf(text, match.index ?? 0),
        message: "runtime API code must not own database DDL; use lib/db migrations",
      });
    }
  }
}

function checkPackageDependencies(violations: Violation[]): void {
  const packageFiles = walk(ROOT, (file) => path.basename(file) === "package.json");
  for (const file of packageFiles) {
    const relative = rel(file);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = parsed.dependencies ?? {};
    const devDeps = parsed.devDependencies ?? {};
    for (const name of Object.keys(deps)) {
      if (name in devDeps) violations.push({ file: relative, message: `${name} is duplicated in dependencies and devDependencies` });
    }
  }
}

const files = [
  ...sourceFiles(path.join(ROOT, "artifacts")),
  ...sourceFiles(path.join(ROOT, "lib")),
  ...sourceFiles(path.join(ROOT, "scripts")),
];

const violations: Violation[] = [];
checkBoundaries(files, violations);
checkEnvironmentAccess(files, violations);
checkUnsafeApiCasts(files, violations);
checkExplicitAnyInApi(files, violations);
checkOpenApiCoverage(violations);
checkDuplicateRoutesAndContracts(violations);
checkRouteRegistry(violations);
checkMigrationBoundaries(files, violations);
checkPackageDependencies(violations);

if (violations.length > 0) {
  console.error(`Architecture audit failed with ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`- ${violation.file}${violation.line ? `:${violation.line}` : ""} — ${violation.message}`);
  process.exit(1);
}

console.log("Architecture audit passed: mounted legacy/domain routers, OpenAPI coverage, boundaries, configuration, explicit-any policy, route uniqueness, dead routers, migration ownership, and dependency rules are clean.");
