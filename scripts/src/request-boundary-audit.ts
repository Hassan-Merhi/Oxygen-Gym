import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROUTES = path.join(ROOT, "artifacts/api-server/src/routes");

type Violation = { file: string; line: number; message: string };

function rel(file: string): string {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") && entry.name !== "index.ts" ? [full] : [];
  });
}

const violations: Violation[] = [];
for (const file of walk(ROUTES)) {
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

console.log("Request-boundary audit passed: every route consumes body/query/params through generated OpenAPI/Zod contracts and no router.all registrations remain.");
