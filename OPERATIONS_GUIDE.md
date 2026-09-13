# The Chekata — System Architecture & Operations Guide

**Application:** The Chekata Hotel Management System
**Prepared for:** Sami Chalwa
**Date:** September 13, 2026

This guide explains how the application is built, where everything lives, and how to run it day to day — updates, backups, monitoring, and recovery.

---

## 1. What This Application Is

A full-CRUD hotel management web application covering:

- Accommodation (rooms, bookings)
- Conference & Movie Room facilities (bookings)
- Bar & Restaurant (menu, orders)
- Staff records
- Expenses
- Reports (Excel exports)
- Invoices & Receipts (PDF, emailed)
- Settings (tax configuration, users, module access)

All monetary figures are in **KES**, tax is calculated **inclusive** per revenue stream (configurable in Settings), and access to each module is controlled per-user via checkboxes.

---

## 2. Architecture Overview

```
┌─────────────────────────┐        ┌──────────────────────────┐        ┌─────────────────────────┐
│   Browser (any device)  │  HTTPS │   Render Web Service      │  TCP   │   Supabase (Postgres)   │
│  React app (client/)    ├───────►│  Node/Express server      ├───────►│  Database + backups     │
│  hms.thechekata.com     │        │  chekata-hotel.onrender.com│        │  gefxszgpgkvnmgmrnlvv   │
└─────────────────────────┘        └──────────────────────────┘        └─────────────────────────┘
                                              │
                                              │ auto-deploys on push
                                              ▼
                                    ┌──────────────────────────┐
                                    │  GitHub repository        │
                                    │  github.com/samichalwa/   │
                                    │  chekata-hotel (public)   │
                                    └──────────────────────────┘
```

**In plain terms:** you (or I, on your behalf) push code changes to GitHub. Render watches that repository and automatically rebuilds and redeploys the app every time `main` changes. The running app talks to your Supabase Postgres database over the network for all data. Nothing is stored locally on Render's server — if the server restarts, your data is untouched because it all lives in Supabase.

### Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, built with Vite, Tailwind CSS |
| Backend | Node.js + Express, TypeScript |
| Database | PostgreSQL (hosted on Supabase) |
| ORM / query layer | Drizzle ORM + `postgres.js` |
| Sessions | Postgres-backed sessions (survive restarts/redeploys), cookie-based with a header-token fallback |
| PDF generation | Server-side PDF library (invoices/receipts) |
| Excel generation | Server-side Excel export (reports) |
| Build tool | esbuild (bundles server to `dist/index.cjs`), Vite (bundles client to `dist/public`) |
| Hosting | Render (web service, Singapore region) |
| Source control | GitHub (public repo, no secrets committed) |

### Repository structure

```
chekata-hotel/
├── client/                  React frontend
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── pages/           One file per module (dashboard, accommodation, staff, reports, settings, ...)
│       ├── components/
│       ├── hooks/
│       ├── lib/
│       └── assets/          Logo and other bundled images
├── server/                  Express backend
│   ├── index.ts             App entrypoint — binds to 0.0.0.0 on process.env.PORT
│   ├── routes.ts            All /api/* endpoints
│   ├── auth.ts              Login, session middleware, permission checks
│   ├── session-store.ts     Postgres-backed session store
│   ├── storage.ts           Database access layer, schema bootstrap
│   ├── documents.ts         Invoice/receipt document generation
│   ├── pdf.ts                PDF rendering
│   ├── reports-excel.ts     Excel report generation
│   ├── email.ts             Email sending for invoices/receipts
│   ├── tax.ts                Tax calculation per revenue stream
│   └── static.ts            Serves the built client in production
├── shared/schema.ts         Drizzle table definitions (single source of truth for the DB schema)
├── script/build.ts          Build script (bundles client + server into dist/)
├── script/migrate-data.ts   One-off data migration helper used during the SQLite → Postgres move
├── package.json             Scripts: dev, build, start, check, db:push
└── drizzle.config.ts        Drizzle Kit configuration (used for schema migrations)
```

### Database tables

`rooms`, `accommodation_bookings`, `facilities`, `facility_bookings`, `menu_items`, `orders`, `order_items`, `staff`, `expenses`, `settings`, `documents`, `users`, `taxes`, plus a `sessions` table used only for login sessions.

Everything is driven by `shared/schema.ts` — nothing is hardcoded. Adding a field means editing that one file, then pushing the schema to the database (see §6).

---

## 3. Hosting Setup

### 3.1 Render (application server)

| Setting | Value |
|---|---|
| Service name | `chekata-hotel` |
| Service ID | `srv-dain70u7bikc739blfl0` |
| Type | Web Service (Node) |
| Region | Singapore |
| Plan | Free |
| Repo | `https://github.com/samichalwa/chekata-hotel`, branch `main` |
| Auto-deploy | Yes — triggers on every push to `main` |
| Build command | `npm install --include=dev && npm run build` |
| Start command | `npm start` (runs `node dist/index.cjs`) |
| Default URL | `https://chekata-hotel.onrender.com` |
| Custom domain | `hms.thechekata.com` — verified, HTTPS certificate issued (CNAME → `chekata-hotel.onrender.com`) |

**Environment variables set on Render** (Dashboard → your service → **Environment**):

- `DATABASE_URL` — Supabase connection string (see §3.2)
- `SESSION_SECRET` — random string used to sign session cookies
- `NODE_ENV` — `production`

These are **not** in the GitHub repo. `.env*` files are git-ignored — secrets only ever live in Render's environment variable settings.

**Free-plan behavior to know:** Render's free web services spin down after roughly 15 minutes without traffic and take 30-60 seconds to "wake up" on the next request. This means the very first visit after a quiet period will feel slow — that's normal, not a bug. If this becomes a problem for guests/staff checking the system regularly, upgrading to a paid instance (from ~$7/month) removes the spin-down entirely.

### 3.2 Supabase (database)

| Setting | Value |
|---|---|
| Project reference | `gefxszgpgkvnmgmrnlvv` |
| Connection used by the app | Transaction pooler, port `6543` |
| Connection string | `postgresql://postgres.gefxszgpgkvnmgmrnlvv:M4YmdtGAPHFWUhxT@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres` |

Log in at [supabase.com](https://supabase.com/dashboard) to view/query data directly, check usage, or manage backups.

### 3.3 GitHub (source code)

Public repository: [github.com/samichalwa/chekata-hotel](https://github.com/samichalwa/chekata-hotel). Public just means the *code* is visible to anyone who looks it up — no secrets, credentials, or guest data are in it. Your data lives only in Supabase, and login credentials only in Render's environment settings.

---

## 4. How to Update the Application

**Easiest path — ask me.** Describe the change you want (a new field, a new report, a bug fix). I'll edit the code, test it, commit it, and push to GitHub. Render picks up the push automatically and redeploys — typically live within 2-3 minutes, with zero action needed from you.

**What happens under the hood on every update:**
1. Code is changed and committed in this workspace.
2. Changes are pushed to `github.com/samichalwa/chekata-hotel` on branch `main`.
3. Render detects the push and starts a new build (`npm install --include=dev && npm run build`).
4. If the build succeeds, Render swaps traffic to the new version with no downtime.
5. If the build fails, the previous working version keeps running — your app never goes down from a bad deploy.

**If you ever want to trigger a rebuild manually** (e.g., after changing an environment variable), in the Render Dashboard:
1. Open your service (`chekata-hotel`).
2. Click **Manual Deploy** (top right).
3. Choose **Deploy latest commit**.

**Rolling back a bad deploy:**
1. In the Render Dashboard, open your service and click the **Events** or **Deploys** tab.
2. Find the last deploy that was working correctly.
3. Click it, then click **Redeploy** (or **Rollback to this deploy**, wording may vary).

---

## 5. Database Schema Changes

If a change adds/removes a database column or table (rather than just app logic), the schema needs to be pushed to Postgres too:

```
npm run db:push
```

This uses Drizzle Kit to compare `shared/schema.ts` against the live database and applies the difference. I run this for you whenever a change requires it — you don't need to run it yourself unless you want to.

---

## 6. Backing Up the Database

Your data (rooms, bookings, staff, expenses, invoices, users) lives entirely in Supabase. Two backup approaches, from easiest to most robust:

### 6.1 Supabase's built-in backups (check first)

1. Log in to [supabase.com/dashboard](https://supabase.com/dashboard) and open your project (`gefxszgpgkvnmgmrnlvv`).
2. Go to **Database → Backups** in the left sidebar.
3. Free-tier Supabase projects typically get automatic daily backups with a short retention window (a few days). Paid plans (Pro and above) extend retention and add point-in-time recovery. Check what your current plan shows here — it changes from time to time.

### 6.2 Manual backup (recommended — do this periodically regardless of plan)

This produces a `.sql` file you can store anywhere (a shared drive, email to yourself, etc.) as a point-in-time copy of the whole database.

**From this workspace, I can run this for you on request** — just ask me to "back up the database" and I'll generate and share the file. If you want to do it yourself from your own computer, with `psql` or `pg_dump` installed:

```bash
pg_dump "postgresql://postgres.gefxszgpgkvnmgmrnlvv:M4YmdtGAPHFWUhxT@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres" > chekata-backup-2026-09-13.sql
```

**Recommended cadence:** weekly, or before any major change (e.g., before a schema change, before onboarding a new staff structure).

### 6.3 Restoring from a backup

If you ever need to restore:

```bash
psql "postgresql://postgres.gefxszgpgkvnmgmrnlvv:M4YmdtGAPHFWUhxT@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres" < chekata-backup-2026-09-13.sql
```

**Important:** this replays every statement in the file — only run it against an empty database or one you intend to overwrite. Ask me to do this for you if you're not comfortable running it yourself; I'll confirm with you before touching the live database.

---

## 7. Monitoring & Logs

**Render Dashboard → your service:**
- **Logs** tab — live application output (errors, requests, startup messages).
- **Metrics** tab — CPU, memory, request volume.
- **Events** tab — deploy history, restarts, suspensions.

**Supabase Dashboard → your project:**
- **Database → Logs** — query-level logs.
- **Reports** — usage against your plan's limits (storage, bandwidth, connections).

If the site seems down, check Render's **Events** tab first (failed deploy, spin-down/cold-start) before assuming a database issue.

---

## 8. User & Access Management

Handled entirely inside the app — no code changes needed:

1. Log in as an admin (e.g., `admin`).
2. Go to **Settings → Users** (or the equivalent section).
3. Add/edit a user, and tick the modules they should access (Dashboard, Accommodation, Facilities, Bar & Restaurant, Staff, Expenses, Reports, Documents, Settings).

**Demo accounts currently in the system** (from the starter data you asked me to keep):

| Username | Password | Access |
|---|---|---|
| `admin` | `admin123` | Full admin |
| `frontdesk` | `frontdesk123` | Limited permissions |

**Recommended before real guest data goes in:** change these passwords (or create your real staff accounts and deactivate/delete the demo ones) via **Settings → Users**.

---

## 9. Security Notes

- All traffic to `chekata-hotel.onrender.com` and `hms.thechekata.com` is served over HTTPS (Render issues and renews the TLS certificate automatically).
- Session cookies are signed with `SESSION_SECRET`. If you ever suspect it's been exposed, generate a new random string and update it in Render's environment variables, then redeploy — this immediately invalidates all existing logged-in sessions.
- Database credentials live only in Render's environment variables — never in GitHub.
- The GitHub repository is public (code only), which was an explicit, confirmed choice — no guest data, passwords, or connection strings are stored there.

---

## 10. Costs & Plan Limits

| Service | Current plan | Cost | Key limit to watch |
|---|---|---|---|
| Render | Free web service | $0/month | Spins down after ~15 min idle; cold start ~30-60s |
| Supabase | Free project | $0/month | Storage, bandwidth, and connection caps reset monthly — check Supabase's Reports page if the app slows down |
| GitHub | Free public repo | $0/month | None relevant here |
| Namecheap | Existing domain registration | Your existing renewal | N/A |

If the app becomes central to daily operations (real guests, real payments), the main upgrade worth considering first is Render's paid instance tier, which removes the cold-start delay.

---

## 11. Common Issues & Fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| First page load after a while is slow | Render free-tier cold start | Normal — reload after ~30-60 seconds. Upgrade Render plan to remove this. |
| "Failed to fetch" errors | Server temporarily redeploying, or a network blip | Refresh the page after a minute; check Render's Events tab for an in-progress deploy |
| Login stops working after a code update | Session secret changed, or a deploy is mid-way | Wait for the deploy to finish (Render Events tab), then try again |
| Numbers on Dashboard don't reflect a change just made | Browser cache | Hard-refresh (Ctrl/Cmd+Shift+R) |
| New custom domain shows a certificate warning | DNS not fully propagated yet | Wait up to an hour after adding the DNS record, then re-verify in Render |

For anything not on this list, describe what you're seeing and I'll investigate the logs directly.

---

## 12. Disaster Recovery Checklist

Everything needed to rebuild this system lives in three independent places — Render (app), Supabase (data), and GitHub (code) — so losing any one of them individually is recoverable without losing data. Work through the checklist that matches what's happened.

### 12.1 App is down or won't load

- [ ] Try both URLs to isolate the problem: [hms.thechekata.com](https://hms.thechekata.com) and [chekata-hotel.onrender.com](https://chekata-hotel.onrender.com)
- [ ] Render Dashboard → **Events** tab — check for a failed deploy or a suspended service
- [ ] Render Dashboard → **Logs** tab — look for a crash error near the time it went down
- [ ] If it's just been quiet for a while, wait ~60 seconds and retry (free-tier cold start, see §3.1) before assuming something is broken
- [ ] If a recent deploy caused it, roll back to the last working deploy (§4)
- [ ] Still stuck? Send me the exact error text or a screenshot and I'll check the logs directly

### 12.2 Database unreachable or data looks missing

- [ ] Check the Supabase Dashboard — is the project paused, or has it hit a free-tier limit?
- [ ] Confirm `DATABASE_URL` in Render's environment variables hasn't changed or been accidentally edited
- [ ] Check Supabase **Database → Backups** for a recovery point to restore
- [ ] If you have a manual `.sql` backup, restore it (§6.3)
- [ ] If the Supabase project itself won't load, contact Supabase support

### 12.3 Data was accidentally deleted inside the app (not a system failure)

- [ ] Stop making further changes in the app immediately — every extra action makes recovery harder
- [ ] Check Supabase **Database → Backups** for a point-in-time snapshot from just before the deletion
- [ ] If you took a manual backup recently, restore from that instead (§6.3)
- [ ] Ask me to check whether the specific deleted records can be recovered without a full restore

### 12.4 Render service is lost, suspended, or deleted

- [ ] Recreate the web service in the Render Dashboard, or ask me to do it via the API
- [ ] Point it at the same GitHub repo: `github.com/samichalwa/chekata-hotel`, branch `main`
- [ ] Re-enter the build and start commands from §3.1 exactly
- [ ] Re-add environment variables: `DATABASE_URL` (from Supabase → Project Settings → Database, or §3.2 if unchanged), `SESSION_SECRET` (generate a new random string if the old one may be compromised), `NODE_ENV=production`
- [ ] Re-add and re-verify the custom domain `hms.thechekata.com` (§3.1)
- [ ] Full re-check: setup-status endpoint responds, admin login works, dashboard shows real data

### 12.5 GitHub repository is lost or deleted

- [ ] The live app keeps running on Render even without the repo — it only needs GitHub to build *new* deploys, not to keep serving the current one
- [ ] To restore auto-deploy, ask me to recreate the repo and push the working code again (a full copy always exists in this workspace)
- [ ] Point Render's Auto-Deploy setting at the new repo URL

### 12.6 Custom domain stops resolving, or shows a certificate warning

- [ ] In Namecheap → Advanced DNS, confirm the CNAME record for `hms` still points to `chekata-hotel.onrender.com` and wasn't edited or removed
- [ ] Remove any stray `AAAA` record for `hms` if one appears
- [ ] Re-verify the domain in Render (Settings → Custom Domains → **Verify**)
- [ ] While DNS is being fixed, use [chekata-hotel.onrender.com](https://chekata-hotel.onrender.com) directly — it always works regardless of the custom domain's status

### 12.7 Suspected credential exposure (session secret or database password)

- [ ] Rotate `SESSION_SECRET` in Render's environment variables to a new random string and redeploy — this instantly logs out every active session
- [ ] If the database password may be exposed, reset it in Supabase (Project Settings → Database → **Reset Database Password**), then update `DATABASE_URL` in Render and redeploy
- [ ] Change the `admin` and `frontdesk` passwords inside the app (Settings → Users)
- [ ] Review recent access/activity in both the Render and Supabase dashboards for anything unfamiliar

### 12.8 Total rebuild from scratch (worst case — all three services lost)

Highly unlikely, since Render, Supabase, and GitHub failing simultaneously is independent — but if it ever happens:

- [ ] Create a new Supabase project and note its new connection string
- [ ] Push the application code to a new GitHub repo (a full working copy is kept in this workspace)
- [ ] Run `npm run db:push` against the new database to recreate every table from `shared/schema.ts`
- [ ] Restore your data from the most recent manual `.sql` backup (§6.2-6.3) — this is exactly why periodic manual backups matter even though Supabase keeps its own
- [ ] Create a new Render web service pointed at the new repo, with fresh environment variables
- [ ] Re-add and verify the custom domain
- [ ] Full end-to-end check: login, dashboard data, one test entry in each module

### Standing habits that make recovery painless

- [ ] Take a manual database backup at least weekly (§6.2) — ask me to run it any time
- [ ] Keep this guide somewhere outside the app itself (you already have it as a shared file — consider also saving a copy to your own drive)
- [ ] Before changing DNS, Render settings, or environment variables, note down the current value first, in case you need to revert

---

## 13. Quick Reference

| What | Where |
|---|---|
| Live app | [hms.thechekata.com](https://hms.thechekata.com) (primary, verified with HTTPS) / [chekata-hotel.onrender.com](https://chekata-hotel.onrender.com) |
| Source code | [github.com/samichalwa/chekata-hotel](https://github.com/samichalwa/chekata-hotel) |
| App hosting dashboard | [dashboard.render.com](https://dashboard.render.com) |
| Database dashboard | [supabase.com/dashboard](https://supabase.com/dashboard) (project `gefxszgpgkvnmgmrnlvv`) |
| Domain registrar | Namecheap ([ap.www.namecheap.com](https://ap.www.namecheap.com)) |
