import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROUTE_INDEX = path.join(ROOT, "artifacts/api-server/src/routes/index.ts");

type Violation = { file: string; line: number; message: string };

function rel(file: string): string {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function mountedRouterFiles(): string[] {
  const indexText = fs.readFileSync(ROUTE_INDEX, "utf8");
  const imports = new Map<string, string>();

  for (const match of indexText.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+)["'];/g)) {
    const specifier = match[2];
    if (!specifier.startsWith(".")) continue;
    const candidate = path.resolve(path.dirname(ROUTE_INDEX), specifier);
    const file = fs.existsSync(`${candidate}.ts`)
      ? `${candidate}.ts`
      : fs.existsSync(path.join(candidate, "index.ts"))
        ? path.join(candidate, "index.ts")
        : null;
    if (file) imports.set(match[1], file);
  }

  const mounted = new Set<string>();
  for (const match of indexText.matchAll(/router\.use\(\s*(?:["'][^"']+["']\s*,\s*)?(\w+)\s*\)/g)) {
    const file = imports.get(match[1]);
    if (file) mounted.add(file);
  }

  return [...mounted].sort();
}

const violations: Violation[] = [];
const mountedFiles = mountedRouterFiles();

for (const file of mountedFiles) {
  const text = fs.readFileSync(file, "utf8");
  const relative = rel(file);

  for (const match of text.matchAll(/\breq\.(body|query|params)\b/g)) {
    violations.push({
      file: relative,
      line: lineOf(text, match.index ?? 0),
      message: `raw req.${match[1]} access bypasses the generated OpenAPI/Zod contract boundary`,
    });
  }

  for (const match of text.matchAll(/\brouter\.all\s*\(/g)) {
    violations.push({
      file: relative,
      line: lineOf(text, match.index ?? 0),
      message: "router.all is prohibited; declare each HTTP method explicitly so OpenAPI coverage is exact",
    });
  }
}

if (violations.length > 0) {
  console.error(`Request-boundary audit failed with ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} — ${violation.message}`);
  }
  process.exit(1);
}

console.log(
  `Request-boundary audit passed across ${mountedFiles.length} mounted routers: every request body/query/params access uses generated OpenAPI/Zod contracts and no router.all registrations remain.`,
);
