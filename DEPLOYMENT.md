# Deploying GymPro to Render + Neon (Free)

This guide deploys GymPro as a single always-free web service on Render, backed by a free-forever PostgreSQL database on Neon.

---

## What you'll need
- A free [Neon](https://neon.tech) account
- A free [Render](https://render.com) account
- A [GitHub](https://github.com) account (Render deploys from GitHub)
- Your Clerk keys (already in your Replit environment secrets)

---

## Step 1 — Create the database on Neon

1. Go to [neon.tech](https://neon.tech) and sign up for free.
2. Click **New Project**, give it a name (e.g. `gympro`), choose the region closest to your users.
3. Once created, go to the **Connection Details** tab.
4. Copy the **connection string** — it looks like:
   ```
   postgres://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   Save this — you'll need it in Step 3.

---

## Step 2 — Push the code to GitHub

1. In Replit, click the **Git** icon in the left sidebar (or go to **Tools → Git**).
2. Connect your GitHub account if you haven't already.
3. Push the repo to a new GitHub repository (public or private, either works).

---

## Step 3 — Deploy on Render

1. Go to [render.com](https://render.com) and sign up / log in.
2. Click **New → Blueprint**.
3. Connect your GitHub account and select the GymPro repo.
4. Render will auto-detect the `render.yaml` file and show you the service.
5. Click **Apply** — Render will pause and ask for the secret env vars:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | The Neon connection string from Step 1 |
| `CLERK_SECRET_KEY` | Your Replit environment secrets |
| `CLERK_PUBLISHABLE_KEY` | Your Replit environment secrets |
| `VITE_CLERK_PUBLISHABLE_KEY` | Same value as `CLERK_PUBLISHABLE_KEY` |

6. Fill in all four values and click **Apply**.
7. Render will start building — this takes about 3–5 minutes on the first deploy.

---

## Step 4 — Set up the database schema

Once the first deploy finishes, you need to push the database schema to Neon **once**:

1. In your Replit project, open the Shell.
2. Set your Neon DATABASE_URL temporarily:
   ```bash
   export DATABASE_URL="postgres://your-neon-connection-string"
   ```
3. Run:
   ```bash
   pnpm --filter @workspace/db run push
   ```
4. Type `yes` to confirm. This creates all the tables in your Neon database.

---

## Step 5 — Open your live app

1. Back on Render, go to your service dashboard.
2. Click the URL at the top (something like `https://gympro.onrender.com`).
3. Your GymPro app is live — open it from any computer or phone.

---

## Important notes

- **Free tier sleep**: The Render free tier sleeps after 15 minutes of inactivity. The first visitor after a quiet period waits ~30 seconds for the app to wake up. It stays fast for the rest of the day.
- **Clerk domains**: After deploying, go to your Clerk dashboard and add your Render URL (`https://gympro.onrender.com`) to the list of allowed origins/domains.
- **Future deploys**: Every time you push code to GitHub, Render automatically rebuilds and redeploys. No manual steps needed.
- **Database**: Neon's free tier gives you 0.5 GB of storage and never expires. Your gym data is safe.

---

## Upgrading to always-on (no sleep)

If the 30-second wake-up delay becomes annoying, upgrading Render's web service to the **Starter** plan ($7/month) removes the sleep entirely. Everything else stays the same.
