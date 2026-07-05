# WhiteVanOps — Setup & Installation Manual

**Audience:** System administrator / owner performing first-time setup
**Last updated:** July 2026

---

## Overview

WhiteVanOps ships as two deployables:

1. **Desktop installer** (`WhiteVanOps Setup x.x.x.exe`) — for office staff (admin, superuser). Bundles the full application server **and a portable PostgreSQL 17 server**; no browser, Node.js, or separate database install required. Creates a desktop shortcut and Start Menu entry.
2. **Browser access** — for field technicians on phones/tablets, who connect to the same server via a URL (scan the **Field Access QR** code from the dashboard sidebar) and can install the field module as a home-screen app (PWA).

Both surfaces share one PostgreSQL database.

### Zero-config install (bundled PostgreSQL)

On a machine with no existing database, the desktop app is fully self-contained. On first launch it automatically:

1. Generates `resources/nextjs/.env.local` with a **unique random `SESSION_SECRET` and database password** (if one wasn't baked into the build) — this also satisfies the one-secret-per-customer rule with a generic installer.
2. Runs `initdb` to create a private PostgreSQL data directory at `%APPDATA%\whitevanops\pgdata`.
3. Starts the bundled PostgreSQL on the port in `DATABASE_URL` (default 5433, listening on `127.0.0.1` only).
4. Applies the full schema (concatenated Prisma migrations bundled as `resources/db/schema.sql`).
5. Creates the initial superuser (**admin / admin**, forced password change on first login).

The database is stopped cleanly when the app quits and restarted on the next launch. Server log: `%APPDATA%\whitevanops\postgres.log`.

**When the bundled database is NOT used** (the app detects these automatically and just connects):
- Something is already listening on the `DATABASE_URL` port — e.g. the office server where PM2 runs its own PostgreSQL (§7).
- `DATABASE_URL` points at a non-localhost host (external/shared database).
- The build was produced without the `pgsql/` binaries (see §6).

---

## 1. Prerequisites

### On the build machine (where you produce the installer)

| Requirement | Minimum Version | Notes |
|---|---|---|
| Node.js | 18.x LTS or higher | nodejs.org |
| npm | 9.x or higher | Included with Node.js |
| PostgreSQL client | Any | For running `psql` or pgAdmin |

### On officer machines (where the installer runs)

Nothing extra is required. The installer is self-contained, including the database.

### Database server

**Not required for standalone installs** — the installer bundles PostgreSQL 17 (see Overview). For multi-machine deployments sharing one database (like the office server setup in §7), PostgreSQL 14+ must be running and reachable, and `DATABASE_URL` must point at it.

### PostgreSQL binaries for the build (`pgsql/` directory)

The build bundles portable PostgreSQL binaries from the project's `pgsql/` directory (~130 MB, not committed to git). To (re)create it:

1. Download the official EDB "binaries only" zip: `https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip`
2. Extract the `pgsql/` folder into the project root.
3. Delete the unneeded subfolders: `pgsql/pgAdmin 4`, `pgsql/StackBuilder`, `pgsql/doc`, `pgsql/include`, `pgsql/lib/pgxs`.

`npm run electron:build` warns (but still builds) if `pgsql/bin/pg_ctl.exe` is missing — the resulting installer then requires a pre-existing database server, as before.

---

## 2. Database Setup

**Skip this section for standalone desktop installs** — the bundled PostgreSQL creates the database, user, and schema automatically on first launch. The steps below are only for setting up a shared/external database server.

### 2a. Create the Database

```sql
CREATE DATABASE white_van_ops;
CREATE USER wvo_user WITH PASSWORD 'your_strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE white_van_ops TO wvo_user;
```

### 2b. Note Your Connection String

```
postgresql://wvo_user:your_strong_password_here@<host>:<port>/white_van_ops
```

Replace `<host>` with the PostgreSQL server's IP or hostname (not `localhost` unless the database is on the same machine as every client). The non-standard port in this project is **5433** — adjust if your PostgreSQL is on the default 5432.

---

## 3. Configure Environment Variables

**Optional for standalone desktop installs** — if no `.env.local` is bundled, the app generates one with unique random credentials on first launch (see Overview). Create one explicitly only when the install must connect to a specific existing database.

In the project root, create `.env.local`:

```
DATABASE_URL="postgresql://wvo_user:your_strong_password@<host>:5433/white_van_ops?schema=public"
SESSION_SECRET="paste_a_long_random_string_here"
```

**Generate a SESSION_SECRET:**

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Keep `.env.local` private. It is bundled into the installer at build time, so the connection credentials travel with the `.exe`.

**If you are distributing this app to multiple customers/companies:** each customer needs their own unique `SESSION_SECRET` and their own database credentials — never reuse the same secret across installs. Sharing a secret means one customer's bundled `.exe` contains a value that could forge session tokens for another customer's app, and there's no upside to reuse since every customer runs an isolated server/database. Generate a fresh secret with the `node -e` command above for each customer, and either (a) rebuild the installer per customer with that customer's `.env.local` baked in, or (b) ship one generic installer and place a customer-specific `.env.local` at `<install dir>/resources/nextjs/.env.local` on their machine after install (see §10 Troubleshooting for the path).

---

## 4. Apply Database Schema

**Skip for standalone desktop installs** (handled automatically on first launch). For a shared/external database, install dependencies, then run migrations to create all tables:

```bash
npm install
npx prisma migrate deploy
```

---

## 5. Create the Initial Superuser

**Skip for standalone desktop installs** (the bundled database is bootstrapped with admin/admin automatically). For a shared/external database, run the bootstrap script to create the first admin account:

```bash
npx tsx prisma/bootstrap.ts
```

This creates a superuser with username **admin** and password **admin**, flagged to require a password change on first login. All other accounts are created from within the app by a superuser after first login.

---

## 6. Build the Desktop Installer

```bash
npm run electron:build
```

This command:
1. Compiles the Next.js production build
2. Concatenates the Prisma migrations into `schema.sql` for the bundled database's first-run initialization
3. Packages the server, credentials (if `.env.local` present), portable PostgreSQL (`pgsql/`), and Electron shell into a single NSIS installer
4. Outputs to `dist-electron/WhiteVanOps Setup x.x.x.exe`

Distribute this `.exe` to office staff. The installer creates a desktop shortcut and Start Menu entry automatically. No browser or Node.js installation is needed on officer machines.

---

## 7. Field Tech Browser Access

Field technicians access the app via a Progressive Web App (PWA) on their phones or tablets. The Next.js server runs locally in your office. We use Port Forwarding and Dynamic DNS to allow field devices to securely reach your local server without passing traffic through a central cloud server.

**Recommended path — Port Forwarding & Dynamic DNS (works from any network)**

1. Assign a Static IP to the office server running the app.
2. Log into the office internet router and forward Port 3000 to that Static IP.
3. Set up a free Dynamic DNS (like DuckDNS) so the router's external IP has a constant hostname.
4. In the dashboard sidebar, click **Field Access QR** and enter your DDNS address (e.g. `http://your-client.duckdns.org:3000/field`).
5. Hand out the URL and let each tech scan the QR code with their phone camera. 
6. After signing in, they can use the browser's **Add to Home Screen** feature to install the field module as an app. The app ships a PWA manifest, meaning it will launch full-screen with its own icon and operate natively.
7. **Offline Support**: The PWA uses an offline-first architecture via IndexedDB. If a technician loses signal, they can continue logging time, viewing job details, and saving materials. Their modifications will be queued locally and automatically flush back to the office server once the connection is restored.

---

## 8. Ironclad Data Backup

WhiteVanOps doesn't rely on third-party cloud backups. 

To configure backups:
1. Navigate to the **Settings** tab in the Admin Dashboard.
2. Provide a **Target Directory Mirror** path (e.g., `D:\Backups`, `Z:\NAS\WhiteVanOps`, or `C:\Users\rober\OneDrive\Backups`).
3. The system will run a nightly `pg_dump` cron job every day at **2:00 AM**.
4. These `.sql.gz` backups guarantee that physical failure or data loss is fully localized and completely under your control.

## 9. Creating User Accounts

After your first login (see Administrator Manual), create accounts for each user from the Manage Users modal (superuser only). Roles:

| Role | Access |
|---|---|
| superuser | Full dashboard + user management |
| admin | Full dashboard, no user management |
| tech | Field module only |

Field technicians need a **tech** account linked to their Personnel record so the app can auto-select their name on the Field Module.

---

## 10. Environment Variable Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Random string for signing session JWTs — keep secret and consistent across restarts |
| `WVO_FIREBASE_SERVICE_ACCOUNT` | Vendor only | Absolute path to the Firebase service-account key used by `scripts/license-manager.js` to mint license keys. **Store this file OUTSIDE the repository** (e.g. `%APPDATA%\whitevanops-secrets\`) — it is a highly privileged credential and is now gitignored so it can never be committed. `GOOGLE_APPLICATION_CREDENTIALS` is accepted as an alias. Not needed on customer machines. |
| `REQUIRE_HTTPS` | No | Set to `true` once the app is reachable over HTTPS (e.g. via `tailscale serve`, see §7). Locks the session cookie to HTTPS-only (`Secure` flag) in production. Leave unset for LAN-only/Electron-only deployments — otherwise browser-based access over plain `http://` will silently fail to log in. |

---

## 11. Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| App window shows "Startup Error" | DATABASE_URL wrong or DB not reachable | Verify PostgreSQL is running; check the connection string in `resources/nextjs/.env.local` inside the install directory |
| "Invalid credentials" on login | bootstrap not run, or wrong credentials | Run `npx tsx prisma/bootstrap.ts` on the build machine against the target database |
| Field techs can't reach the server | Firewall, wrong IP, or AP/client isolation on the WiFi network | Check Windows Firewall allows port 3000; confirm techs are using the server machine's IP, not `localhost`. If the phone times out despite a correct IP and open firewall, the WiFi network may isolate devices from each other (common on managed/corporate networks) — use Dynamic DNS and Port Forwarding instead of relying on LAN routing. |
| Field tech field page loads but login doesn't work / bounces back to login screen | `Secure` session cookie requires HTTPS; plain `http://<lan-ip>:3000` can't set it | Use your Dynamic DNS address (e.g. `http://your-client.duckdns.org:3000/field`) — see §7. |
| Database connection refused | Port mismatch | Verify PostgreSQL is on port 5433 (or update DATABASE_URL to match your actual port) |
| App unreachable from any device (laptop or phone) after a reboot | PM2's login-triggered startup means nothing restarts until someone logs into the server machine | Log into `MearHPLaptop`. PM2 should auto-resurrect both processes. If not, run `pm2 resurrect` manually, then `pm2 list` to confirm `whitevanops` and `whitevanops-db` both show `online`. |
| Prisma errors with `code: 'ECONNREFUSED'` in PM2 logs (`pm2 logs whitevanops`) | The `whitevanops-db` PM2 process (the real Postgres instance) isn't running — do not assume it's the app itself that's broken | Run `pm2 list`. If `whitevanops-db` is missing or stopped, start it: `pm2 start "C:\Program Files\PostgreSQL\9.5\bin\postgres.exe" --name whitevanops-db -- -D "C:\Users\rober\Desktop\WhiteVanOps\pg_data" -p 5433` then `pm2 save`. Do **not** start either of the unrelated Windows PostgreSQL services (`postgresql-x64-9.5` on port 5432 is a separate legacy install) to "fix" this — they use different data directories and will not have the app's tables. |
| "Unknown Publisher" warning on install | No code signing certificate | Safe to proceed for internal use — click "More info → Run anyway" |
| Bundled database won't start / first launch fails repeatedly | Corrupted first-run initialization | A failed first run is wiped and retried automatically on next launch. Check `%APPDATA%\whitevanops\postgres.log`. To force a completely fresh database (destroys data!), delete `%APPDATA%\whitevanops\` and relaunch. |
| Want to inspect the bundled database | — | Connect with any PostgreSQL client using the credentials in `<install dir>\resources\nextjs\.env.local` (port 5433 on 127.0.0.1, only while the app is running) |

---

## 12. Updating the Application

1. Pull the latest code.
2. Install any new dependencies: `npm install`
3. Apply schema changes: `npx prisma migrate deploy`
4. Rebuild the installer: `npm run electron:build`
5. Distribute the new `.exe` to office staff. The installer upgrades in-place.

> **One-time re-activation after this update:** the desktop app now stores its license file (`%APPDATA%\whitevanops\license.json`) with a tamper-evident signature. Installs made before this change hold an unsigned license file, so on the first launch after updating, the app will show the activation screen once. Users simply re-enter their existing license key (the same one they were issued) — because the key is already tied to that machine in Firestore, activation completes immediately and won't be asked again. Keep customers' license keys on hand for this transition.

---

## 13. Hardware Upgrades and Transfers

**Audience:** Users migrating to a new host machine or recovering from a hardware failure.

This section covers how to move your WhiteVanOps instance to a new machine. It is critical that you transfer your existing encryption key. **Do not simply run a fresh installer and try to import data.** Your encryption key is unique to your business; keeping it consistent ensures that your application remains securely tied to your business identity and prevents unauthorized installations on other machines.

### Step 1: Secure Your Encryption Key
Your application uses a unique encryption key (`SESSION_SECRET`) generated during your original installation. 
1. Locate the `.env.local` file on your old machine (or your backup of this file). For standard installations, this is found at `<install dir>\resources\nextjs\.env.local`.
2. Copy this `.env.local` file to a USB drive or secure location. 

### Step 2: Retrieve Your Data
Choose the option that fits your situation:
* **Option A: From a Live Instance (Working Old Machine):**
  1. Completely quit the WhiteVanOps application on the old machine.
  2. Press `Win + R`, type `%APPDATA%\whitevanops\`, and press Enter.
  3. Copy the entire `pgdata` folder to your USB drive.
* **Option B: From a Backup (Hardware Failure):**
  1. Locate your most recent `.sql.gz` backup file from your configured backup drive (see Section 8).
  2. Copy this file to your USB drive.

### Step 3: Install on the New Machine
1. Run the `WhiteVanOps Setup x.x.x.exe` installer on the new machine.
2. **IMPORTANT:** Do NOT launch the application yet. If it launches automatically, completely quit the application before proceeding.

### Step 4: Restore Key and Data
1. **Restore Encryption Key:** Navigate to `<install dir>\resources\nextjs\` on the new machine. Replace the newly generated `.env.local` file with the `.env.local` file you saved in Step 1.
2. **Restore Data (Option A - pgdata):** 
   * Press `Win + R`, type `%APPDATA%\whitevanops\`, and press Enter. (Create the `whitevanops` folder if it doesn't exist yet).
   * Paste your saved `pgdata` folder here. 
3. **Restore Data (Option B - sql.gz Backup):** 
   * Start the application once to let it create a blank database, then quit it.
   * Extract your `.sql.gz` backup using a tool like 7-Zip to get the `.sql` file.
   * Start the application again so the database is running.
   * Open Command Prompt, navigate to the bundled `pgsql\bin` directory within your installation folder.
   * Run the import command using the credentials found in your `.env.local` file:
     `psql -U wvo_user -h 127.0.0.1 -p 5433 -d white_van_ops -f "C:\path\to\your\extracted_backup.sql"`
     *(Enter the database password from your `.env.local` when prompted).*

### Step 5: Verify
Launch WhiteVanOps on the new machine. Your accounts, historical data, and configurations will be fully restored.

---

*End of Setup & Installation Manual*
