import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// OpenAPI is the source of truth. Regenerate both consumers, then require the
// committed generated files to be byte-for-byte identical to that output.
run("pnpm", ["--filter", "@workspace/api-spec", "exec", "orval", "--config", "./orval.config.ts"]);
run("git", [
  "diff",
  "--exit-code",
  "--",
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
]);

console.log("Contract drift check passed: generated client and Zod contracts match OpenAPI.");
