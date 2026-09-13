# The Chekata — System Architecture & Operations Guide

**Application:** The Chekata Hotel Management System
**Prepared for:** Sami Chalwa
**Last updated:** September 13, 2026 (DigitalOcean migration — app server and database)

This guide explains how the application is built, where everything lives, and how to run it day to day — updates, backups, monitoring, and recovery. It supersedes all earlier versions of this document (the Render/Supabase-only setup).

---

## 1. What This Application Is

A full-CRUD hotel management web application covering:

- Accommodation (rooms, bookings)
- Conference & Movie Room facilities (bookings)
- Bar & Restaurant (menu, orders)
- Staff records
- Expenses
- Reports (Excel exports)
- Invoices & Receipts (PDF, emailed — invoice on booking/order creation, receipt on payment)
- Settings (tax configuration, users, module access)

All monetary figures are in **KES**. Tax is calculated **inclusive**, per revenue stream, and is configurable in Settings. Access to each module is controlled per-user via checkboxes (no roles baked into code — it's all data-driven).

---

## 2. Architecture Overview

```
┌─────────────────────────┐        ┌───────────────────────────┐        ┌───────────────────────────┐
│   Browser (any device)  │  HTTPS │  DigitalOcean Droplet      │  TCP   │  DigitalOcean Managed DB   │
│  React app (client/)    ├───────►│  Nginx → PM2 → Node/Express├───────►│  PostgreSQL 17 (blr1)      │
│  hms.thechekata.com     │        │  chekata-hotel-app (blr1)  │        │  Private network + firewall│
└─────────────────────────┘        └──────────────────────────┬─┘        └───────────────────────────┘
                                                                │
                                                                │ git pull + rebuild (manual/on request)
                                                                ▼
                                                     ┌──────────────────────────┐
                                                     │  GitHub repository        │
                                                     │  github.com/samichalwa/   │
                                                     │  chekata-hotel (public)   │
                                                     └──────────┬───────────────┘
                                                                │ auto-deploy on push to main (secondary)
                                                                ▼
                                                     ┌──────────────────────────┐
                                                     │  Render Web Service       │
                                                     │  (kept as warm backup —   │
                                                     │  not the live DNS target) │
                                                     └──────────────────────────┘
```

**In plain terms:** the live site (`hms.thechekata.com`) is served entirely from a DigitalOcean droplet you own outright (root/SSH access), talking to a DigitalOcean-managed Postgres database in the same region and private network — so there's no cross-provider latency and no data-transfer charges between them. Code changes are committed to GitHub, then pulled and rebuilt on the droplet. Render still exists as a secondary copy that auto-deploys from the same GitHub repo whenever code is pushed, as a warm standby — but DNS does not point to it, so it isn't part of the normal request path.

### Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, built with Vite, Tailwind CSS |
| Backend | Node.js 20 + Express, TypeScript |
| Database | PostgreSQL 17 (DigitalOcean Managed Database) |
| ORM / query layer | Drizzle ORM + `postgres.js` |
| Sessions | Postgres-backed sessions (survive restarts/redeploys), cookie-based with a header-token fallback |
| PDF generation | Server-side (`pdfkit`) — invoices/receipts |
| Excel generation | Server-side (`exceljs`) — reports |
| Process manager | PM2 (auto-restart on crash, survives SSH disconnects and droplet reboots via `pm2 startup`) |
| Reverse proxy / SSL | Nginx + Let's Encrypt (Certbot, auto-renewing) |
| Build tool | esbuild (bundles server to `dist/index.cjs`), Vite (bundles client to `dist/public`) |
| Hosting (primary) | DigitalOcean Droplet, Bangalore (`blr1`) region |
| Hosting (secondary/backup) | Render (free web service, auto-deploys from GitHub, not DNS-facing) |
| Source control | GitHub (public repo, no secrets committed) |

### Repository structure

```
chekata-hotel/
├── client/                  React frontend
│   ├── index.html
│   └── src/
│       ├── App.tsx          Route table + auth gate (redirects to login when not signed in)
│       ├── pages/            One file per module (dashboard, accommodation, facilities,
│       │                     bar-restaurant, staff, expenses, reports, documents, settings)
│       ├── components/       Shared UI (sidebar/app-sidebar.tsx, shadcn/ui primitives, tables, forms)
│       ├── hooks/            use-auth.ts (login/logout/session), use-setup-status.ts, etc.
│       ├── lib/               whatsapp.ts (buildWhatsAppLink — free wa.me click-to-send), query client
│       └── assets/           Hotel logo and bundled images
├── server/                  Express backend
│   ├── index.ts             App entrypoint — binds to 0.0.0.0 on process.env.PORT (5000)
│   ├── routes.ts            All /api/* endpoints (see §3 below for the full list)
│   ├── auth.ts               Login, session middleware, requireAuth/requireModule/requireAdmin guards
│   ├── session-store.ts     Postgres-backed session store (table: sessions)
│   ├── storage.ts           Database access layer; idempotent schema bootstrap
│   │                        (CREATE TABLE IF NOT EXISTS + ensureColumn() helper), default seed data
│   ├── documents.ts         Invoice/receipt document generation + numbering (table: documents)
│   ├── pdf.ts                PDF rendering for invoices/receipts (embeds the hotel logo)
│   ├── reports-excel.ts     Excel report generation (all report types, menu-item aware)
│   ├── email.ts              Transactional email sending (invoices/receipts, configurable provider)
│   ├── tax.ts                Tax calculation — inclusive, per revenue stream, driven by the taxes table
│   └── static.ts            Serves the built client (dist/public) in production
├── shared/schema.ts         Drizzle table definitions — single source of truth for the DB schema
├── script/build.ts          Build script (bundles client + server into dist/)
├── script/migrate-data.ts   One-off helper used during the original SQLite → Postgres move
├── package.json             Scripts: dev, build, start, check, db:push
└── drizzle.config.ts        Drizzle Kit configuration (used for schema migrations)
```

**Nothing is hardcoded.** Every module — rooms, facilities, menu items, staff, taxes, settings, users and their per-module permissions — is a row in a table, editable from the app itself. Adding a genuinely new field means editing `shared/schema.ts` once, then pushing that schema to the database (§5).

### API surface (`server/routes.ts`)

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/setup-status`, `POST /api/auth/setup` |
| Accommodation | `GET/POST /api/rooms`, `PATCH/DELETE /api/rooms/:id`, `GET/POST /api/accommodation-bookings`, `PATCH/DELETE /api/accommodation-bookings/:id` |
| Facilities | `GET/POST /api/facilities`, `PATCH/DELETE /api/facilities/:id`, `GET/POST /api/facility-bookings`, `PATCH/DELETE /api/facility-bookings/:id` |
| Bar & Restaurant | `GET/POST /api/menu-items`, `PATCH/DELETE /api/menu-items/:id`, `GET/POST /api/orders`, `PATCH/DELETE /api/orders/:id`, `GET /api/orders/:orderId/items`, `POST /api/order-items`, `DELETE /api/order-items/:id` |
| Staff | `GET/POST /api/staff`, `PATCH/DELETE /api/staff/:id` |
| Expenses | `GET/POST /api/expenses`, `PATCH/DELETE /api/expenses/:id` |
| Documents (invoices/receipts) | `GET /api/documents`, `GET /api/documents/:id/pdf`, `POST /api/documents/:id/resend` |
| Reports | `GET /api/reports/export` |
| Taxes | `GET/POST /api/taxes`, `PATCH/DELETE /api/taxes/:id` |
| Users | `GET/POST /api/users`, `PATCH/DELETE /api/users/:id` |
| Settings | `GET /api/settings`, `PUT /api/settings`, `POST /api/settings/test-email` |

Every mutating route runs through `requireAuth` plus either `requireModule("<key>")` (checked against that user's permissions array) or `requireAdmin` for admin-only actions (e.g. user management, closing certain records) — enforced in `server/auth.ts`, not just hidden in the UI.

### Database tables

`rooms`, `accommodation_bookings`, `facilities`, `facility_bookings`, `menu_items`, `orders`, `order_items`, `staff`, `expenses`, `settings`, `documents`, `users`, `taxes`, plus `sessions` (login sessions only — safe to truncate; it just signs everyone out). 13 data tables + 1 session table, 14 total.

---

## 3. Hosting Setup

### 3.1 DigitalOcean Droplet (primary application server)

| Setting | Value |
|---|---|
| Droplet name | `chekata-hotel-app` |
| Droplet ID | `600057435` |
| Region | Bangalore (`blr1`) |
| Public IP | `139.59.61.104` |
| OS | Ubuntu 24.04 LTS |
| Size | 1 vCPU / 1 GB RAM / 25 GB disk |
| App directory | `/var/www/app` (a full git clone of the GitHub repo) |
| Process manager | PM2, process name `chekata-hotel`, running `dist/index.cjs` on port 5000 |
| Reverse proxy | Nginx → proxies `hms.thechekata.com` (ports 80/443) to `localhost:5000` |
| SSL | Let's Encrypt via Certbot, auto-renewing (current cert expires 2026-12-12) |
| SSH access | Key-based only (`~/.ssh/chekata_do_key`), root user |
| Automatic droplet backups | **Not currently enabled** — see §6.4 for the recommendation |

**Environment variables** live in `/var/www/app/.env` on the droplet (never committed to GitHub):
- `DATABASE_URL` — DigitalOcean Managed Database connection string (§3.2)
- `SESSION_SECRET` — random string used to sign session cookies
- `NODE_ENV=production`
- `PORT=5000`

### 3.2 DigitalOcean Managed Database (primary data store)

| Setting | Value |
|---|---|
| Cluster name | `chekata-hotel-db` |
| Cluster ID | `3fb3bdc0-c4fd-4b4d-913f-df29969e4887` |
| Engine | PostgreSQL 17 |
| Region | Bangalore (`blr1`) — same region as the droplet, on the same private network |
| Plan | Basic, 1 vCPU / 1 GB RAM / 10 GB storage — **$15/month** |
| Database name | `chekata` |
| App user | `chekata_app` (owns all application tables) |
| Firewall | Restricted to the `chekata-hotel-app` droplet only — no other IP can connect |
| Automatic backups | Daily, included free with the plan (see §6.1) |

Connection string used by the app (in `.env` on the droplet):
```
postgresql://chekata_app:<password>@chekata-hotel-db-do-user-44176901-0.j.db.ondigitalocean.com:25060/chekata?sslmode=require
```
The real password is stored only in the droplet's `.env` file — never written into this document or committed to GitHub, since this repository is public. Ask me for it (or retrieve it from the DigitalOcean dashboard → `chekata-hotel-db` → **Users & Databases**) whenever you need it for a manual connection.

An admin-level connection (`doadmin`) also exists for maintenance tasks (schema fixes, ownership grants) — ask me when you need it rather than using it for routine app traffic.

Manage this database at [cloud.digitalocean.com/databases](https://cloud.digitalocean.com/databases) → `chekata-hotel-db`.

### 3.3 GitHub (source code)

Public repository: [github.com/samichalwa/chekata-hotel](https://github.com/samichalwa/chekata-hotel), branch `main`. Public means the *code* is visible to anyone who looks it up — no secrets, credentials, or guest data are in it (`.env*` is git-ignored). Latest commit as of this guide: `da08f03` ("Fix sidebar collapse hiding sign-out: switch to icon-rail collapse mode").

### 3.4 Render (secondary / backup — not DNS-facing)

| Setting | Value |
|---|---|
| Service name | `chekata-hotel` |
| Service ID | `srv-dain70u7bikc739blfl0` |
| Plan | Free web service |
| Auto-deploy | Yes, on every push to `main` on GitHub |
| Default URL | `https://chekata-hotel.onrender.com` (still works, but is not what guests/staff use) |
| Database | Currently still pointed at the old Supabase database, **not** the new DigitalOcean one — kept separate on purpose so it isn't a live mirror of production writes |

This is kept purely as a warm, independent copy of the *code* (not data) in case the droplet is ever unreachable. It is optional — see §12 for the decision on whether to keep it at all.

---

## 4. How to Update the Application

**Easiest path — ask me.** Describe the change you want (a new field, a new report, a bug fix). I'll edit the code, test it, and deploy it to the droplet. The steps below are what happens either way, for your own reference.

**What happens under the hood on every update (primary path — DigitalOcean):**
1. Code is changed and committed in this workspace, then pushed to `github.com/samichalwa/chekata-hotel` on branch `main`.
2. On the droplet: `cd /var/www/app && git pull && npm install && npm run build`.
3. PM2 is restarted: `pm2 restart chekata-hotel`.
4. The app is verified (`curl localhost:5000`, then a real login check) before considering the update complete.

Unlike the old Render-only setup, **DigitalOcean does not auto-deploy on push** — step 2-3 are a deliberate action (by me, on request, or by you via SSH) rather than automatic. This is intentional: it avoids an untested change going live the instant it's pushed.

**If you want Render's copy updated too** (optional, since it's just a backup): pushing to `main` on GitHub is enough — Render picks it up and rebuilds automatically within a few minutes. Its data source is still the old Supabase database though, so it will not reflect new production bookings/orders — see §12 before relying on it for anything beyond "the code still runs."

**Rolling back a bad deploy on the droplet:**
1. SSH in, `cd /var/www/app`.
2. `git log --oneline -5` to find the last known-good commit.
3. `git checkout <commit-hash> -- .` (or `git reset --hard <commit-hash>` if you want to fully rewind).
4. `npm install && npm run build && pm2 restart chekata-hotel`.

---

## 5. Database Schema Changes

If a change adds/removes a database column or table (rather than just app logic), the schema needs to be pushed to Postgres too:

```
npm run db:push
```

This uses Drizzle Kit to compare `shared/schema.ts` against the live database and applies the difference. Run it from the droplet (or ask me to). `server/storage.ts` also runs an idempotent `CREATE TABLE IF NOT EXISTS` + `ensureColumn()` bootstrap on every app startup as a safety net, so most additive changes (new nullable columns) apply themselves the moment the app restarts — `db:push` is for anything more structural.

---

## 6. Backing Up the Database

Your data (rooms, bookings, staff, expenses, invoices, users) lives entirely in the DigitalOcean Managed Database. Three layers of protection, from automatic to manual:

### 6.1 DigitalOcean's automatic backups (already on, no action needed)

DigitalOcean Managed Databases include **daily automatic backups** at no extra cost, using continuous WAL archiving — meaning you can restore to any point in time within the retention window, not just to the exact moment of a nightly snapshot.

To view or restore a backup:
1. Go to [cloud.digitalocean.com/databases](https://cloud.digitalocean.com/databases) and open `chekata-hotel-db`.
2. Click the **Backups** tab.
3. Pick a restore point and click **Restore** — this creates a **new** database cluster with that data (it does not overwrite the live one), which you then point the app at if you decide to use it.

### 6.2 Manual backup (recommended periodically, and always before a risky change)

This produces a `.sql` file you can store anywhere (a shared drive, email to yourself) as a portable point-in-time copy.

**From this workspace, I can run this for you on request** — just ask me to "back up the database" and I'll generate and share the file. If you want to do it yourself with `psql`/`pg_dump` installed:

```bash
pg_dump "postgresql://doadmin:<password>@chekata-hotel-db-do-user-44176901-0.j.db.ondigitalocean.com:25060/chekata?sslmode=require" \
  --no-owner --no-privileges --schema=public \
  > chekata-backup-$(date +%Y-%m-%d).sql
```
(Ask me for the current `doadmin` password when you need it — it isn't reprinted here beyond §3.2's app-user string, to reduce how many places the admin credential is written down.)

**Recommended cadence:** weekly, or before any major change (schema change, bulk data edit, staff restructuring).

### 6.3 Restoring from a manual backup

```bash
psql "<connection-string>" < chekata-backup-2026-09-13.sql
```

**Important:** this replays every statement in the file — only run it against an empty database or one you intend to overwrite. Ask me to do this for you if you're not comfortable running it yourself; I'll confirm with you before touching the live database.

### 6.4 Recommendation: also enable droplet backups

The droplet itself (application code + OS + Nginx/Certbot config) is **not currently on an automatic backup schedule** — only the database is. Since the code also lives safely in GitHub, the practical risk is low, but DigitalOcean offers weekly droplet snapshots for **20% of the droplet's monthly cost** (a few dollars/month here) if you want a one-click way to recreate the exact server, Nginx config and SSL setup included, without redoing that setup from scratch. Let me know if you'd like this turned on.

---

## 7. Monitoring & Logs

**On the droplet (SSH in, or ask me to check):**
- `pm2 logs chekata-hotel` — live application output (errors, requests, startup messages)
- `pm2 list` / `pm2 show chekata-hotel` — process status, uptime, restart count, memory
- `/root/.pm2/logs/chekata-hotel-error.log` and `-out.log` — raw log files
- `df -h /` — disk space (25 GB total; check occasionally, especially if PDF/Excel exports accumulate)

**DigitalOcean dashboard:**
- Droplet → **Graphs** tab — CPU, memory, disk, bandwidth
- Database (`chekata-hotel-db`) → **Insights**/**Metrics** — connections, CPU, disk usage on the DB side
- Database → **Logs** — query-level Postgres logs

If the site seems down, check `pm2 list` on the droplet first (is the process actually running?), then Nginx (`systemctl status nginx`), before assuming a database issue.

---

## 8. User & Access Management

Handled entirely inside the app — no code changes needed:

1. Log in as an admin (e.g., `admin`).
2. Go to **Settings → Users**.
3. Add/edit a user, and tick the modules they should access (Dashboard, Accommodation, Facilities, Bar & Restaurant, Staff, Expenses, Reports, Documents, Settings).

**Demo accounts currently in the system** (starter data, kept per your instruction not to wipe test data):

| Username | Password | Access |
|---|---|---|
| `admin` | `admin123` | Full admin |
| `frontdesk` | `frontdesk123` | Limited permissions |

**Recommended before real guest data goes in at scale:** change these passwords, or create your real staff accounts and deactivate the demo ones, via **Settings → Users**.

*(Note: employee-linked user accounts — where a user is selected from the staff list and their company email becomes their username — is a designed-but-not-yet-built feature, tracked separately from this infrastructure guide.)*

---

## 9. Security Notes

- All traffic to `hms.thechekata.com` is served over HTTPS (Let's Encrypt certificate via Certbot on the droplet, auto-renewing; current cert good until 2026-12-12).
- Session cookies are signed with `SESSION_SECRET` (in the droplet's `.env`). If you ever suspect it's been exposed, generate a new random string, update `.env`, and restart PM2 — this immediately invalidates all existing logged-in sessions.
- The database firewall only accepts connections from the app droplet — not from the open internet, and not even from other DigitalOcean resources on your account unless explicitly added.
- Database credentials live only in the droplet's `.env` file — never in GitHub.
- The GitHub repository is public (code only, by your explicit choice) — no guest data, passwords, or connection strings are in it.
- SSH access to the droplet is key-based only (no password login).

---

## 10. Costs & Plan Limits

| Service | Current plan | Cost |
|---|---|---|
| DigitalOcean Droplet | 1 vCPU / 1 GB / 25 GB, `blr1` | ~$6/month |
| DigitalOcean Managed Database | Basic, 1 vCPU / 1 GB / 10 GB, `blr1` | $15/month |
| Render (secondary/backup, optional) | Free web service | $0/month |
| GitHub | Free public repo | $0/month |
| Namecheap | Existing domain registration | Your existing renewal |
| Supabase (legacy — pending decision, §12) | Free project | $0/month, no longer used by production |

**Total current infrastructure spend: roughly $21/month**, versus $0/month on the old Render-free + Supabase-free setup — the trade-off is a real production-grade server you fully control (root access, no cold starts, no free-tier throttling) and a database with real automatic backups and point-in-time recovery, on infrastructure that doesn't depend on a third party's free-tier policies changing.

---

## 11. Common Issues & Fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Site doesn't load at all | Nginx or the Node process is down | SSH in: `pm2 list` (restart if stopped: `pm2 restart chekata-hotel`), `systemctl status nginx` (restart if needed: `systemctl restart nginx`) |
| "Failed to fetch" errors intermittently | App mid-restart, or a brief network blip | Refresh after a few seconds; check `pm2 logs chekata-hotel` for a crash loop |
| Login stops working after a code update | Deploy was mid-way, or `SESSION_SECRET` changed | Wait for the deploy to finish, then retry; confirm `.env` wasn't accidentally altered |
| Numbers on Dashboard don't reflect a change just made | Browser cache | Hard-refresh (Ctrl/Cmd+Shift+R) |
| Certificate warning on the domain | Certbot renewal failed (rare — it's automatic) | SSH in, run `certbot renew --dry-run` to test, then `certbot renew` if needed, `systemctl restart nginx` |
| Database connection errors in `pm2 logs` | DB firewall rule changed, or credentials rotated | Confirm the droplet is still listed in the database's **Firewall** tab (`cloud.digitalocean.com/databases` → `chekata-hotel-db` → Settings); confirm `.env` `DATABASE_URL` matches |

For anything not on this list, describe what you're seeing (or just ask me to check the logs directly).

---

## 12. Open Decision: What To Do With Render and Supabase

Now that DigitalOcean hosts both the app and the database, Render and Supabase are no longer part of the live request path. Two independent decisions, whenever you're ready:

- **Render:** keep as a free warm-standby (currently one commit behind sometimes if a deploy isn't manually triggered — see §4), or delete it entirely via Settings → Delete Web Service. No data loss either way, since it never held your real production data after this migration.
- **Supabase:** the old data now lives only as a read-only snapshot there (production no longer writes to it). Options: keep it untouched for a while as an extra historical copy at $0/month, export a final backup and delete the project, or keep it indefinitely as a free secondary archive. Let me know which you'd prefer and I'll action it.

---

## 13. Disaster Recovery Checklist

Everything needed to rebuild this system lives in three independent places — the **droplet** (running app), the **managed database** (data), and **GitHub** (code) — so losing any one of them individually is recoverable without losing data.

### 13.1 App is down or won't load

- [ ] SSH in and check `pm2 list` — is the process `online`? If not, `pm2 restart chekata-hotel` and check `pm2 logs chekata-hotel` for the crash reason
- [ ] `systemctl status nginx` — restart if it's not active
- [ ] `curl localhost:5000` from the droplet to isolate app-vs-Nginx-vs-DNS issues
- [ ] If a recent code update caused it, roll back to the last working commit (§4)
- [ ] Still stuck? Send me the exact error text or a screenshot and I'll check the logs directly

### 13.2 Database unreachable or data looks missing

- [ ] Check [cloud.digitalocean.com/databases](https://cloud.digitalocean.com/databases) → `chekata-hotel-db` — is the cluster status "Online"?
- [ ] Confirm the droplet is still listed in the database's **Firewall** settings
- [ ] Confirm `.env` on the droplet still has the correct `DATABASE_URL`
- [ ] Check the **Backups** tab for a restore point (§6.1)
- [ ] If you have a manual `.sql` backup, restore it (§6.3)

### 13.3 Data was accidentally deleted inside the app (not a system failure)

- [ ] Stop making further changes in the app immediately
- [ ] Check the database's **Backups** tab for a point-in-time snapshot from just before the deletion
- [ ] If a manual backup exists from around that time, restore from that instead
- [ ] Ask me to check whether the specific deleted records can be recovered without a full restore

### 13.4 The droplet itself is lost, or SSH access is lost

- [ ] Create a new droplet on DigitalOcean (Ubuntu 24.04), install Node.js 20, PM2, Nginx, Certbot
- [ ] `git clone https://github.com/samichalwa/chekata-hotel.git /var/www/app`
- [ ] Recreate `.env` with `DATABASE_URL` (the database itself is untouched — only the app server was lost), a fresh `SESSION_SECRET`, `NODE_ENV=production`, `PORT=5000`
- [ ] `npm install && npm run build`, then `pm2 start dist/index.cjs --name chekata-hotel` and `pm2 save`
- [ ] Reconfigure Nginx to proxy to `localhost:5000`, then `certbot --nginx -d hms.thechekata.com`
- [ ] Update the DNS A record at Namecheap to the new droplet's IP
- [ ] Update the database firewall to allow the new droplet instead of the old one

### 13.5 GitHub repository is lost or deleted

- [ ] The live app keeps running on the droplet even without the repo — it only needs GitHub to pull *new* updates, not to keep serving the current one
- [ ] Ask me to recreate the repo and push the working code again (a full copy exists in this workspace)

### 13.6 Suspected credential exposure (session secret or database password)

- [ ] Rotate `SESSION_SECRET` in the droplet's `.env`, then `pm2 restart chekata-hotel` — this instantly logs out every active session
- [ ] If the database password may be exposed, reset it from the DigitalOcean dashboard (database → **Users & Databases** → reset password for `chekata_app`), update `.env`, and restart PM2
- [ ] Change the `admin` and `frontdesk` passwords inside the app (**Settings → Users**)
- [ ] Review recent access in the DigitalOcean **Activity** log for anything unfamiliar

### 13.7 Total rebuild from scratch (worst case — droplet and database both lost)

- [ ] Create a new DigitalOcean Managed Database, note its connection string
- [ ] Follow §13.4 to stand up a new droplet
- [ ] Run `npm run db:push` against the new database to recreate every table from `shared/schema.ts`
- [ ] Restore your data from the most recent manual `.sql` backup (§6.2) — this is exactly why periodic manual backups matter even though DigitalOcean keeps its own
- [ ] Full end-to-end check: login, dashboard data, one test entry in each module

### Standing habits that make recovery painless

- [ ] Take a manual database backup at least weekly (§6.2) — ask me to run it any time
- [ ] Keep this guide somewhere outside the app itself — you already have it as a shared file; consider also saving a copy to your own drive
- [ ] Before changing DNS, droplet settings, database firewall rules, or `.env` values, note down the current value first, in case you need to revert

---

## 14. Quick Reference

| What | Where |
|---|---|
| Live app | [hms.thechekata.com](https://hms.thechekata.com) (primary, DigitalOcean, HTTPS) |
| Backup copy (code only, stale data) | [chekata-hotel.onrender.com](https://chekata-hotel.onrender.com) |
| Source code | [github.com/samichalwa/chekata-hotel](https://github.com/samichalwa/chekata-hotel) |
| App server dashboard | [cloud.digitalocean.com/droplets](https://cloud.digitalocean.com/droplets) → `chekata-hotel-app` |
| Database dashboard | [cloud.digitalocean.com/databases](https://cloud.digitalocean.com/databases) → `chekata-hotel-db` |
| Domain registrar | Namecheap ([ap.www.namecheap.com](https://ap.www.namecheap.com)) |
| Legacy database (read-only reference) | [supabase.com/dashboard](https://supabase.com/dashboard), project `gefxszgpgkvnmgmrnlvv` |
