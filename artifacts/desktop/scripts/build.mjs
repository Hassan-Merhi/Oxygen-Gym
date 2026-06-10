import { execSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const DESKTOP = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const isDev = args.includes("--dev");
const isDist = args.includes("--dist");
const isWebOnly = args.includes("--web-only");

function run(cmd, opts = {}) {
  console.log(`\n▶ ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

async function buildServer() {
  console.log("\n📦 Building API server...");
  run("pnpm --filter @workspace/api-server run build");
}

async function buildFrontend() {
  console.log("\n🎨 Building frontend...");
  run("pnpm --filter @workspace/gym-app run build", {
    env: {
      ...process.env,
      PORT: "1",
      BASE_PATH: "/",
      NODE_ENV: "production",
    },
  });
}

async function buildDesktopApp() {
  console.log("\n🖥  Packaging Electron app...");
  const builderBin = path.join(DESKTOP, "node_modules", ".bin", "electron-builder");
  run(`node "${builderBin}" --config electron-builder.yml --win`, {
    cwd: DESKTOP,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    },
  });
}

async function devMode() {
  console.log("\n🚀 Starting dev mode...\n");
  console.log("Make sure the dev servers are running:");
  console.log("  pnpm --filter @workspace/api-server run dev");
  console.log("  pnpm --filter @workspace/gym-app run dev\n");

  // Build server bundle first (needed for Electron to spawn it)
  await buildServer();

  const electronBin = path.join(DESKTOP, "node_modules", ".bin", "electron");
  const mainScript = path.join(DESKTOP, "electron", "main.js");

  console.log("▶ Starting Electron in dev mode...\n");
  const child = spawn(electronBin, [mainScript], {
    stdio: "inherit",
    cwd: DESKTOP,
    env: {
      ...process.env,
      ELECTRON_IS_DEV: "1",
      DEV_FRONTEND_URL: process.env.DEV_FRONTEND_URL || "http://localhost:23457",
    },
  });

  child.on("exit", (code) => process.exit(code ?? 0));
}

async function main() {
  if (isDev) {
    await devMode();
    return;
  }

  if (isWebOnly) {
    await buildFrontend();
    console.log("\n✅ Frontend build complete.");
    return;
  }

  await buildServer();
  await buildFrontend();

  if (isDist) {
    await buildDesktopApp();
    console.log("\n✅ Build complete!");
    console.log("📁 Installer → artifacts/desktop/dist-desktop/");
  } else {
    console.log("\n✅ Build artifacts ready.");
    console.log("   Run 'pnpm --filter @workspace/desktop run dist:windows' to create the .exe installer.");
  }
}

main().catch((err) => {
  console.error("\n❌", err.message ?? err);
  process.exit(1);
});
