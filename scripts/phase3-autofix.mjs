import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const routesDir = path.join(root, "artifacts/api-server/src/routes");
const routeIndexPath = path.join(routesDir, "index.ts");
const specPath = path.join(root, "lib/api-spec/openapi.yaml");
const generatedContractsPath = path.join(root, "lib/api-zod/src/generated/api.ts");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : entry.name.endsWith(".ts") ? [full] : [];
  });
}

function normalizeRoutePath(prefix, routePath) {
  const joined = `${prefix}/${routePath}`.replace(/\/{2,}/g, "/");
  const normalized = joined !== "/" && joined.endsWith("/") ? joined.slice(0, -1) : joined;
  return normalized.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function parseRoutePrefixes() {
  const text = fs.readFileSync(routeIndexPath, "utf8");
  const importToFile = new Map();
  for (const match of text.matchAll(/import\s+(\w+)\s+from\s+["']\.\/(.+?)["'];/g)) {
    importToFile.set(match[1], `${match[2]}.ts`);
  }
  const prefixes = new Map();
  for (const match of text.matchAll(/router\.use\(\s*(?:["']([^"']+)["']\s*,\s*)?(\w+)\s*\)/g)) {
    const fileName = importToFile.get(match[2]);
    if (fileName) prefixes.set(fileName, match[1] ?? "");
  }
  return prefixes;
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
    if (opMatch && currentPath && currentMethod) {
      operations.set(`${currentMethod} ${currentPath}`, opMatch[1]);
    }
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

function operationForIndex(routes, index) {
  let selected = null;
  for (const route of routes) {
    if (route.index > index) break;
    selected = route;
  }
  return selected;
}

const prefixes = parseRoutePrefixes();
const operationIds = parseOpenApiOperationIds();
const generatedContracts = fs.readFileSync(generatedContractsPath, "utf8");
const unresolved = [];
let changedFiles = 0;
let changedAssertions = 0;

for (const file of files(routesDir)) {
  const fileName = path.relative(routesDir, file).replaceAll(path.sep, "/");
  if (fileName === "index.ts") continue;

  let text = fs.readFileSync(file, "utf8");
  const before = text;
  const prefix = prefixes.get(fileName);
  if (prefix === undefined) continue;

  const routes = [...text.matchAll(/router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)]
    .map((match) => ({
      index: match.index ?? 0,
      method: match[1],
      path: normalizeRoutePath(prefix, match[2]),
    }));

  const replacements = [];
  const usedHelpers = new Set();
  let searchFrom = 0;
  const assertionPattern = /req\.(body|query|params)\s+as\s+/g;
  assertionPattern.lastIndex = searchFrom;

  for (const match of text.matchAll(assertionPattern)) {
    const index = match.index ?? 0;
    const kind = match[1];
    const route = operationForIndex(routes, index);
    if (!route) {
      unresolved.push(`${fileName}: request assertion outside a recognized route`);
      continue;
    }

    const operationId = operationIds.get(`${route.method} ${route.path}`);
    if (!operationId) {
      unresolved.push(`${fileName}: ${route.method.toUpperCase()} ${route.path} has no OpenAPI operationId`);
      continue;
    }

    const schema = schemaName(operationId, kind);
    if (!generatedContracts.includes(`export const ${schema} `) && !generatedContracts.includes(`export const ${schema}=`)) {
      unresolved.push(`${fileName}: generated schema ${schema} is missing for ${route.method.toUpperCase()} ${route.path}`);
      continue;
    }

    const afterAs = index + match[0].length;
    const assertion = readAssertionType(text, afterAs);
    if (!assertion.type) {
      unresolved.push(`${fileName}: could not read request assertion type for ${route.method.toUpperCase()} ${route.path}`);
      continue;
    }

    let viewType = assertion.type;
    if (viewType === "any") {
      viewType = kind === "body" ? "Record<string, unknown>" : "Record<string, string>";
    }

    const helper = kind === "body" ? "contractBodyAs" : kind === "query" ? "contractQueryAs" : "contractParamsAs";
    usedHelpers.add(helper);
    replacements.push({
      start: index,
      end: assertion.end,
      value: `${helper}<${viewType}>(req, ApiContracts.${schema})`,
    });
  }

  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end);
    changedAssertions += 1;
  }

  if (replacements.length > 0) {
    if (!text.includes('import * as ApiContracts from "@workspace/api-zod";')) {
      text = `import * as ApiContracts from "@workspace/api-zod";\n${text}`;
    }
    const helpers = [...usedHelpers].sort().join(", ");
    if (!text.includes('from "../http/contracts"')) {
      text = `import { ${helpers} } from "../http/contracts";\n${text}`;
    } else {
      unresolved.push(`${fileName}: already imports ../http/contracts; merge imports manually`);
    }
  }

  if (text !== before) {
    fs.writeFileSync(file, text);
    changedFiles += 1;
  }
}

if (unresolved.length > 0) {
  console.error("Phase 3 request-contract codemod found unresolved cases:");
  for (const issue of unresolved) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`Phase 3 request-contract codemod complete: ${changedAssertions} assertions across ${changedFiles} files.`);
