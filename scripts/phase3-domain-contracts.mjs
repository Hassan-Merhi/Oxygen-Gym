import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "artifacts/api-server/src");
const routeIndexPath = path.join(sourceRoot, "routes/index.ts");
const specPath = path.join(root, "lib/api-spec/openapi.yaml");
const generatedContractsPath = path.join(root, "lib/api-zod/src/generated/api.ts");
const contractsModulePath = path.join(sourceRoot, "http/contracts");

function normalizeRoutePath(prefix, routePath) {
  const joined = `${prefix}/${routePath}`.replace(/\/{2,}/g, "/");
  const normalized = joined !== "/" && joined.endsWith("/") ? joined.slice(0, -1) : joined;
  return normalized.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function parseRegistry() {
  const text = fs.readFileSync(routeIndexPath, "utf8");
  const importToFile = new Map();
  for (const match of text.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+)["'];/g)) {
    const specifier = match[2];
    if (!specifier.startsWith(".")) continue;
    importToFile.set(match[1], path.resolve(path.dirname(routeIndexPath), `${specifier}.ts`));
  }

  const mounted = new Map();
  for (const match of text.matchAll(/router\.use\(\s*(?:["']([^"']+)["']\s*,\s*)?(\w+)\s*\)/g)) {
    const file = importToFile.get(match[2]);
    if (file) mounted.set(file, match[1] ?? "");
  }
  return mounted;
}

function parseOpenApiOperationIds() {
  const lines = fs.readFileSync(specPath, "utf8").split(/\r?\n/);
  const operations = new Map();
  let inPaths = false;
  let currentPath = null;
  let currentMethod = null;

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
      currentMethod = null;
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (methodMatch) {
      currentMethod = methodMatch[1];
      continue;
    }
    const opMatch = line.match(/^      operationId:\s*([^\s#]+)\s*$/);
    if (opMatch && currentPath && currentMethod) operations.set(`${currentMethod} ${currentPath}`, opMatch[1]);
  }
  return operations;
}

function schemaName(operationId, kind) {
  const name = operationId.charAt(0).toUpperCase() + operationId.slice(1);
  if (kind === "body") return `${name}Body`;
  if (kind === "query") return `${name}QueryParams`;
  return `${name}Params`;
}

function readAssertionType(text, start) {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  const typeStart = i;
  let braces = 0;
  let brackets = 0;
  let angles = 0;
  let parens = 0;
  let quote = null;

  for (; i < text.length; i += 1) {
    const ch = text[i];
    const prev = text[i - 1];
    if (quote) {
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") braces += 1;
    else if (ch === "}") braces -= 1;
    else if (ch === "[") brackets += 1;
    else if (ch === "]") brackets -= 1;
    else if (ch === "<") angles += 1;
    else if (ch === ">") angles = Math.max(0, angles - 1);
    else if (ch === "(") parens += 1;
    else if (ch === ")") {
      if (parens === 0 && braces === 0 && brackets === 0 && angles === 0) break;
      parens = Math.max(0, parens - 1);
    }
    if (braces === 0 && brackets === 0 && angles === 0 && parens === 0) {
      if (ch === ";" || ch === "," || ch === "\n" || ch === "\r") break;
      if (ch === "." && i > typeStart) break;
    }
  }
  return { type: text.slice(typeStart, i).trim(), end: i };
}

function routesIn(text, prefix) {
  return [...text.matchAll(/router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)]
    .map((match) => ({ index: match.index ?? 0, method: match[1], path: normalizeRoutePath(prefix, match[2]) }));
}

function operationForIndex(routes, index) {
  let selected = null;
  for (const route of routes) {
    if (route.index > index) break;
    selected = route;
  }
  return selected;
}

function contractsImportFor(file) {
  let relative = path.relative(path.dirname(file), contractsModulePath).replaceAll(path.sep, "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function ensureContractImports(text, file, helpers) {
  if (helpers.size === 0) return text;
  if (!text.includes('import * as ApiContracts from "@workspace/api-zod";')) {
    text = `import * as ApiContracts from "@workspace/api-zod";\n${text}`;
  }

  const modulePath = contractsImportFor(file);
  const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(`import\\s*{([^}]*)}\\s*from\\s*["']${escaped}["'];`);
  const match = text.match(importPattern);
  if (match) {
    const names = new Set(match[1].split(",").map((name) => name.trim()).filter(Boolean));
    for (const helper of helpers) names.add(helper);
    return text.replace(importPattern, `import { ${[...names].sort().join(", ")} } from "${modulePath}";`);
  }
  return `import { ${[...helpers].sort().join(", ")} } from "${modulePath}";\n${text}`;
}

function splitCashCleanup(text) {
  const block = `router.all("/admin/cash-cleanup", requireAdmin(), async (_req, res) => {\n  res.status(410).json({\n    error: "Cash cleanup is an offline admin operation. Run the guarded repair:legacy-financials database script explicitly.",\n  });\n});`;
  if (!text.includes(block)) return text;
  const handler = `async (_req, res) => {\n  res.status(410).json({\n    error: "Cash cleanup is an offline admin operation. Run the guarded repair:legacy-financials database script explicitly.",\n  });\n}`;
  return text.replace(block, `router.get("/admin/cash-cleanup", requireAdmin(), ${handler});\nrouter.post("/admin/cash-cleanup", requireAdmin(), ${handler});`);
}

const mounted = parseRegistry();
const operationIds = parseOpenApiOperationIds();
const generatedContracts = fs.readFileSync(generatedContractsPath, "utf8");
const unresolved = [];
let changedFiles = 0;
let changedAssertions = 0;
let changedRawInputs = 0;
let splitCleanup = false;

for (const [file, prefix] of mounted) {
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, "utf8");
  const before = text;
  const usedHelpers = new Set();

  if (text.includes('router.all("/admin/cash-cleanup"')) {
    text = splitCashCleanup(text);
    splitCleanup = text !== before;
  }

  let routes = routesIn(text, prefix);
  const assertionReplacements = [];
  const assertionPattern = /req\.(body|query|params)\s+as\s+/g;
  for (const match of text.matchAll(assertionPattern)) {
    const index = match.index ?? 0;
    const kind = match[1];
    const route = operationForIndex(routes, index);
    if (!route) {
      unresolved.push(`${path.relative(root, file)}: request assertion outside a recognized route`);
      continue;
    }
    const operationId = operationIds.get(`${route.method} ${route.path}`);
    if (!operationId) {
      unresolved.push(`${path.relative(root, file)}: ${route.method.toUpperCase()} ${route.path} has no OpenAPI operationId`);
      continue;
    }
    const schema = schemaName(operationId, kind);
    if (!generatedContracts.includes(`export const ${schema} `) && !generatedContracts.includes(`export const ${schema}=`)) {
      unresolved.push(`${path.relative(root, file)}: generated schema ${schema} is missing for ${route.method.toUpperCase()} ${route.path}`);
      continue;
    }
    const afterAs = index + match[0].length;
    const assertion = readAssertionType(text, afterAs);
    if (!assertion.type) {
      unresolved.push(`${path.relative(root, file)}: could not read assertion type for ${route.method.toUpperCase()} ${route.path}`);
      continue;
    }
    const helper = kind === "body" ? "contractBodyAs" : kind === "query" ? "contractQueryAs" : "contractParamsAs";
    usedHelpers.add(helper);
    assertionReplacements.push({ start: index, end: assertion.end, value: `${helper}<${assertion.type}>(req, ApiContracts.${schema})` });
  }

  for (const replacement of assertionReplacements.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end);
    changedAssertions += 1;
  }

  routes = routesIn(text, prefix);
  const rawReplacements = [];
  for (const match of text.matchAll(/\breq\.(body|query|params)\b/g)) {
    const index = match.index ?? 0;
    const kind = match[1];
    const route = operationForIndex(routes, index);
    if (!route) {
      unresolved.push(`${path.relative(root, file)}: raw req.${kind} outside a recognized route`);
      continue;
    }
    const operationId = operationIds.get(`${route.method} ${route.path}`);
    if (!operationId) {
      unresolved.push(`${path.relative(root, file)}: ${route.method.toUpperCase()} ${route.path} has no OpenAPI operationId for raw req.${kind}`);
      continue;
    }
    const schema = schemaName(operationId, kind);
    if (!generatedContracts.includes(`export const ${schema} `) && !generatedContracts.includes(`export const ${schema}=`)) {
      unresolved.push(`${path.relative(root, file)}: generated schema ${schema} is missing for ${route.method.toUpperCase()} ${route.path}`);
      continue;
    }
    const helper = kind === "body" ? "contractBody" : kind === "query" ? "contractQuery" : "contractParams";
    usedHelpers.add(helper);
    rawReplacements.push({ start: index, end: index + match[0].length, value: `${helper}(req, ApiContracts.${schema})` });
  }

  for (const replacement of rawReplacements.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end);
    changedRawInputs += 1;
  }

  text = ensureContractImports(text, file, usedHelpers);
  if (text !== before) {
    fs.writeFileSync(file, text);
    changedFiles += 1;
  }
}

if (unresolved.length > 0) {
  console.error("Phase 3 domain contract migration found unresolved cases:");
  for (const issue of unresolved) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`Phase 3 domain contract migration complete: ${changedAssertions} assertions, ${changedRawInputs} raw inputs across ${changedFiles} files${splitCleanup ? "; cash-cleanup split into explicit GET/POST" : ""}.`);
