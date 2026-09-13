import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const routesDir = path.join(root, "artifacts/api-server/src/routes");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : entry.name.endsWith(".ts") ? [full] : [];
  });
}

for (const file of files(routesDir)) {
  let text = fs.readFileSync(file, "utf8");
  const before = text;

  // Auth middleware now declaration-merges these properties into Express.Request.
  text = text
    .replaceAll("(req as any).__gymproUser", "req.__gymproUser")
    .replaceAll("(req as any).__gymproUserName", "req.__gymproUserName")
    .replaceAll("(req as any).__gymproUserId", "req.__gymproUserId")
    .replace(/\(req as unknown as \{ __gymproUser\?: [^}]+ \}\)\.__gymproUser/g, "req.__gymproUser")
    .replace(/\(req as unknown as \{ __gymproUserName\?: [^}]+ \}\)\.__gymproUserName/g, "req.__gymproUserName")
    .replace(/\(req as unknown as \{ __gymproUserId\?: [^}]+ \}\)\.__gymproUserId/g, "req.__gymproUserId");

  if (text !== before) fs.writeFileSync(file, text);
}

console.log("Phase 3 request-context codemod complete.");
