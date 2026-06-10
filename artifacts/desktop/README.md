# GymPro Desktop App

Windows desktop application built with Electron. Packages the GymPro web app and API server into a downloadable `.exe` installer.

---

## Quick Start (Development)

```bash
# 1. Install dependencies
pnpm install

# 2. Make sure the dev servers are running first (in separate terminals):
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/gym-app run dev

# 3. Launch Electron in dev mode (reads from localhost dev servers)
pnpm --filter @workspace/desktop run dev:desktop
```

---

## Build Windows Installer

```bash
# This single command does everything:
# 1. Build the API server bundle
# 2. Build the frontend for production
# 3. Package with electron-builder → creates .exe installer

pnpm --filter @workspace/desktop run dist:windows
```

**Output**: `artifacts/desktop/dist-desktop/`
- `GymPro-Setup-1.0.0.exe` — NSIS installer
- `GymPro-Portable-1.0.0.exe` — Portable (no install needed)

---

## Available Scripts

| Script | What it does |
|--------|-------------|
| `dev:desktop` | Build server bundle + launch Electron in dev mode |
| `build:server` | Build the API server bundle only |
| `build:web` | Build the frontend only |
| `build:desktop` | Build server + frontend (no packaging) |
| `dist:windows` | Full build + create Windows .exe installer |

---

## Environment Variables

The desktop app reads environment variables from a **`GymPro.env`** file.

### On the development machine
The `.env` file at the repo root is used automatically.

### On an installed PC
Create a `GymPro.env` file **next to the `GymPro.exe`** (or in the installation directory):

```env
# GymPro.env — place next to GymPro.exe
DATABASE_URL=postgres://username:password@hostname:5432/dbname

# Optional (defaults shown)
# JWT_SECRET=your-secret-key
# SESSION_SECRET=your-session-secret
```

If `GymPro.env` is not found, GymPro also checks `%APPDATA%\GymPro\GymPro.env`.

### Required variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string — **required** |

### Optional variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret for signing auth tokens (auto-generated if not set) |
| `SESSION_SECRET` | Session secret |

---

## Database Note

The desktop app connects to PostgreSQL via `DATABASE_URL`.

- **Same machine**: Install PostgreSQL locally and use `postgres://user:pass@localhost:5432/gympro`
- **Remote/shared**: Point to your remote PostgreSQL server — all users share the same data
- **Offline**: Full offline mode with local SQLite is not implemented in this phase

---

## Installing on Another PC

1. Copy the `GymPro-Setup-1.0.0.exe` to the target PC
2. Run the installer
3. Create `GymPro.env` in the installation directory with your `DATABASE_URL`
4. Launch GymPro from the Start Menu or Desktop shortcut

---

## App Icon

Place your icon files in `artifacts/desktop/assets/`:
- `icon.ico` — Windows installer + taskbar icon (256×256 recommended)
- `icon.png` — Development / Linux icon (512×512 recommended)

If no icon is provided, Electron's default icon is used.

---

## How It Works

```
GymPro.exe
  └─ Electron main process (electron/main.js)
       ├─ Reads GymPro.env → sets DATABASE_URL, PORT=9999
       ├─ Spawns: node server/index.mjs (bundled Express API)
       │     └─ Also serves frontend/index.html at /
       ├─ Waits for http://localhost:9999/api/healthz to respond
       └─ Opens BrowserWindow → http://localhost:9999
```

The frontend and API share the same port — no proxy needed. All `/api/...` calls are relative and just work.

---

## Security

- `contextIsolation: true` — renderer cannot access Node.js APIs
- `nodeIntegration: false` — no Node in renderer
- `sandbox: true` — renderer runs in OS sandbox
- DevTools disabled in production builds
