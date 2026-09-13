import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "generated", "attached_assets"]);
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

type Violation = { file: string; line?: number; message: string };
type RouteOperation = { method: string; path: string; source: string };

function rel(file: string): string {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const output: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) output.push(full);
  }
  return output;
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
        ) {
          violations.push({ file: relative, message: `frontend boundary leak: ${specifier}` });
        }
      }

      if (relative.startsWith("artifacts/api-server/src/")) {
        if (
          specifier.startsWith("@workspace/api-client-react") ||
          specifier.includes("gym-app") ||
          specifier.includes("mockup-sandbox") ||
          specifier.includes("desktop")
        ) {
          violations.push({ file: relative, message: `API boundary leak: ${specifier}` });
        }
      }

      if (relative.startsWith("lib/db/src/")) {
        if (
          specifier.startsWith("@workspace/api-") ||
          specifier.includes("api-server") ||
          specifier.includes("gym-app") ||
          specifier.includes("desktop")
        ) {
          violations.push({ file: relative, message: `database boundary leak: ${specifier}` });
        }
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
    "artifacts/gym-app/src/config/env.ts",
    "lib/db/src/config/env.ts",
  ]);

  for (const file of files) {
    const relative = rel(file);
    const text = fs.readFileSync(file, "utf8");
    const runtimeSource =
      relative.startsWith("artifacts/api-server/src/") ||
      relative.startsWith("artifacts/gym-app/src/") ||
      relative.startsWith("lib/db/src/");
    if (!runtimeSource || allowed.has(relative)) continue;

    const pattern = /\bprocess\.env\b|\bimport\.meta\.env\b/g;
    for (const match of text.matchAll(pattern)) {
      violations.push({
        file: relative,
        line: lineOf(text, match.index ?? 0),
        message: "runtime environment access must go through the package config/env module",
      });
    }
  }
}

function checkUnsafeApiCasts(files: string[], violations: Violation[]): void {
  for (const file of files) {
    const relative = rel(file);
    if (!relative.startsWith("artifacts/api-server/src/")) continue;
    const text = fs.readFileSync(file, "utf8");
    const patterns: Array<[RegExp, string]> = [
      [/\bas\s+any\b/g, "unsafe `as any` cast"],
      [/\breq\.(?:body|query|params)\s+as\b/g, "manual request input cast; parse through a generated contract instead"],
      [/\(req\s+as\s+unknown\s+as\b/g, "double-cast request escape"],
    ];
    for (const [pattern, message] of patterns) {
      for (const match of text.matchAll(pattern)) {
        violations.push({ file: relative, line: lineOf(text, match.index ?? 0), message });
      }
    }
  }
}

function normalizeRoutePath(prefix: string, routePath: string): string {
  const joined = `${prefix}/${routePath}`.replace(/\/+/, "/").replace(/\/{2,}/g, "/");
  const normalized = joined !== "/" && joined.endsWith("/") ? joined.slice(0, -1) : joined;
  return normalized.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function parseExpressRoutes(): RouteOperation[] {
  const routesDir = path.join(ROOT, "artifacts/api-server/src/routes");
  const indexText = fs.readFileSync(path.join(routesDir, "index.ts"), "utf8");
  const importToFile = new Map<string, string>();
  for (const match of indexText.matchAll(/import\s+(\w+)\s+from\s+["']\.\/(.+?)["'];/g)) {
    importToFile.set(match[1], `${match[2]}.ts`);
  }

  const prefixes = new Map<string, string>();
  for (const match of indexText.matchAll(/router\.use\(\s*(?:["']([^"']+)["']\s*,\s*)?(\w+)\s*\)/g)) {
    prefixes.set(match[2], match[1] ?? "");
  }

  const operations: RouteOperation[] = [];
  for (const [routerName, fileName] of importToFile) {
    const full = path.join(routesDir, fileName);
    if (!fs.existsSync(full)) continue;
    const prefix = prefixes.get(routerName);
    if (prefix === undefined) continue;
    const text = fs.readFileSync(full, "utf8");
    const pattern = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
    for (const match of text.matchAll(pattern)) {
      operations.push({
        method: match[1].toLowerCase(),
        path: normalizeRoutePath(prefix, match[2]),
        source: rel(full),
      });
    }
  }
  return operations;
}

function parseOpenApiOperations(): Set<string> {
  const specPath = path.join(ROOT, "lib/api-spec/openapi.yaml");
  const lines = fs.readFileSync(specPath, "utf8").split(/\r?\n/);
  const operations = new Set<string>();
  let inPaths = false;
  let currentPath: string | null = null;

  for (const line of lines) {
    if (line === "paths:") {
      inPaths = true;
      continue;
    }
    if (inPaths && /^components:\s*$/.test(line)) break;
    if (!inPaths) continue;

    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1].replace(/\/$/, "") || "/";
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (currentPath && methodMatch && HTTP_METHODS.has(methodMatch[1])) {
      operations.add(`${methodMatch[1]} ${currentPath}`);
    }
  }
  return operations;
}

function checkOpenApiCoverage(violations: Violation[]): void {
  const expressOps = parseExpressRoutes();
  const specOps = parseOpenApiOperations();
  const expressKeys = new Set(expressOps.map((op) => `${op.method} ${op.path}`));

  for (const op of expressOps) {
    const key = `${op.method} ${op.path}`;
    if (!specOps.has(key)) {
      violations.push({ file: op.source, message: `route missing from OpenAPI contract: ${key}` });
    }
  }
  for (const key of specOps) {
    if (!expressKeys.has(key)) {
      violations.push({ file: "lib/api-spec/openapi.yaml", message: `OpenAPI operation has no Express route: ${key}` });
    }
  }
}

function checkPackageDependencies(violations: Violation[]): void {
  const packageFiles = walk(ROOT).filter((file) => path.basename(file) === "package.json");
  for (const file of packageFiles) {
    const relative = rel(file);
    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const deps = parsed.dependencies ?? {};
    const devDeps = parsed.devDependencies ?? {};
    for (const name of Object.keys(deps)) {
      if (name in devDeps) violations.push({ file: relative, message: `${name} is duplicated in dependencies and devDependencies` });
    }
  }
}

const files = [
  ...walk(path.join(ROOT, "artifacts")),
  ...walk(path.join(ROOT, "lib")),
  ...walk(path.join(ROOT, "scripts")),
];

const violations: Violation[] = [];
checkBoundaries(files, violations);
checkEnvironmentAccess(files, violations);
checkUnsafeApiCasts(files, violations);
checkOpenApiCoverage(violations);
checkPackageDependencies(violations);

if (violations.length > 0) {
  console.error(`Architecture audit failed with ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(`- ${violation.file}${violation.line ? `:${violation.line}` : ""} — ${violation.message}`);
  }
  process.exit(1);
}

console.log("Architecture audit passed: contracts, boundaries, environment access, and unsafe-cast rules are clean.");
