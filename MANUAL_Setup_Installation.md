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

`npm run electron:build` **fails** if `pgsql/bin/pg_ctl.exe` is missing, and after packaging it re-verifies that `dist-electron/win-unpacked/resources/pgsql/bin/pg_ctl.exe` and `resources/nextjs/node_modules/next` exist. This guard exists because electron-builder silently skips missing `extraResources` sources — a `pgsql`-less build machine used to produce an installer with no database engine at all, which fails on first launch with "Failed to load dashboard data" on any machine without its own PostgreSQL. If a packaged app is ever started without bundled binaries (and nothing already listening on the database port), it now shows a "Database engine missing" startup error instead of opening a broken window.

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

### License tier (Base vs Plus)

Every install starts on the **Base** plan — the `License` table's singleton row is created automatically on first use, with `tier = "base"`. Plus tables exist but stay empty.

To upgrade an installation from Base to Plus:
1. **Retrieve the active Base License Key:** Log in as a superuser, open **Settings → License & Plan**, and locate the active License Key (copied directly from the client's screen).
2. **Generate the Plus Upgrade License:** On the vendor machine, run the license manager script to mint a cryptographically signed Plus upgrade payload for that specific key:
   ```bash
   node scripts/license-manager.js --plus --key <licenseKey> [--expires YYYY-MM-DD] [--notes "Upgrade Notes"]
   ```
   This generates a signed JSON license block bound to their active license key.
3. **Apply the Upgrade:** 
   * **In-App Upload:** Copy the generated JSON block from the console and paste it into the textarea in **Settings → License & Plan**, or save it as a `.json` file and drag and drop it into the upload zone. Click **Apply Plus Upgrade**.
   * **Plus Upgrade Installer (Alternative):** Run a custom patch/installer containing the signed `plus_license.json` file. The file is placed at `%APPDATA%\whitevanops\plus_license.json`.
   On the next refresh, the Plus features (CRM notes, Invoicing, Analytics) will unlock.
4. **Validation & Anti-Tampering:** The app verifies the signature of `plus_license.json` offline at startup and compares it to the active `license.json` key. If the database is manually tampered with (e.g. manually set to `"plus"` without a valid file), the app automatically self-heals/downgrades back to `"base"`.
5. **Downgrade:** To downgrade, click **Downgrade to Base Plan** under **Settings → License & Plan**. This resets the database tier and deletes the local `plus_license.json` file.

---

## 6. Build the Desktop Installers

We support four installer build paths depending on the customer's package:

### 1. Setup Installer (serves BOTH Base and Plus)
Builds the customer installer. There is only one — **the activation key decides the tier**, so the same `.exe` becomes a Base or a Plus install depending on which key you mint for that customer.
```bash
npm run electron:build
```
* **Output:** `dist-electron/WhiteVanOps-Setup.exe`
* **Set the tier when you mint the key, not when you build:**
  ```bash
  node scripts/license-manager.js --tier base     # Base customer
  node scripts/license-manager.js --tier plus     # Plus customer
  ```
  The tier is stamped onto the key's Firestore record, read during activation, and baked into the machine-bound signed licence file on the customer's PC.
* **Changed 2026-07-15 — `npm run electron:build:plus` and `WhiteVanOps-Plus-Setup.exe` no longer exist.** Plus used to be pre-activated by stamping `WVO_DEFAULT_TIER="plus"` into the bundled `.env.local`. That put the paid tier in a plain text file on the customer's disk, where changing one word in Notepad unlocked it. Running the build with `--plus` now fails with an explanatory error rather than producing an installer whose name promises a tier it cannot grant. Do not add a tier env var back.

### 3. Plus Upgrade Installer (Patch Utility)
Generates a lightweight, native Windows executable that installs the signed `plus_license.json` payload directly into the target machine's AppData directory (`%APPDATA%\whitevanops\`).
```bash
npm run electron:build:upgrade -- --key <licenseKey> [--expires YYYY-MM-DD] [--notes "Upgrade Notes"]
```
* **Output:** `dist-electron/WhiteVanOps-Plus-Upgrade.exe`
* **Note:** The double hyphens (`--`) are required to forward the CLI arguments through npm to the underlying build script.

### 4. Trial/Demo Installer (Sales Demos)
Builds a time-limited demo installer for prospect evaluations. Runs on **Plus** tier so the prospect can try every feature, then fully locks the app 30 days after first launch until an activation key is entered.
```bash
npm run electron:build:trial
```
* **Output:** `dist-electron/WhiteVanOps-Trial-Setup.exe`
* **First launch:** a trial install has no activation-key prompt at all — it boots directly to the WhiteVanOps login screen and runs on Plus for 30 days from that first launch. (This differs from a standard Base/Plus customer build, which always requires a `WVO-XXXX-XXXX-XXXX-XXXX` activation key before it will boot.)
* **What the prospect sees:** during the trial, **Settings → License & Plan** shows the Plus plan with license key `TRIAL-ACTIVE`, the note "30-Day Evaluation Period", and the expiry date (30 days after first launch) — so the end of the evaluation window is always visible in-app.
* **At day 30:** the app locks and, after logging in with a password, shows an in-app activation-key screen. A key generated for either `--tier base` or `--tier plus` (see below) unlocks the app running at that tier — a base key drops Plus features, a plus key keeps them.
* **Converting a trial to a paid install:** Have the customer open **Settings → License & Plan** (or, once locked, the lockout screen itself) and copy their Machine ID. Generate their activation key on your machine:
  ```bash
  node scripts/license-manager.js --unlock-trial --machine <theirMachineId> --tier base|plus [--notes "Order #1234"]
  ```
  Use `--tier base` if they purchased Base only (this also correctly drops the Plus features they were trialing), or `--tier plus` if they purchased Base+Plus. Send the printed JSON block back to them to paste into the same screen. This is a one-time, permanent conversion — there's no way to re-trial a machine after this without deleting `%APPDATA%\whitevanops\` entirely, which is a customer-initiated action outside the app's control.

---

### What the build commands do (Full installers):
1. Compile the Next.js production build
2. Copy `.env.local` into the Next.js standalone bundle (adding `WVO_IS_TRIAL="true"` for trial builds only — **no tier is stamped**; the tier comes from the activation key)
3. Concatenate the Prisma migrations into `schema.sql` for the bundled database's first-run initialization
4. Package the server, credentials (if `.env.local` present), portable PostgreSQL (`pgsql/`), and Electron shell into a single NSIS installer
5. Output and rename the resulting executable in `dist-electron/`

Distribute the generated setup `.exe` to office staff. The installers upgrade any existing installation in-place.

---

## 7. Field Tech Browser Access

Field technicians access the app via a Progressive Web App (PWA) on their phones or tablets. The Next.js server runs locally in the customer's office — there is no cloud relay or third-party tunneling service in the middle. To reach it from outside the office WiFi (cellular data, a job site, home), you configure the office router to forward traffic in from the internet, plus a free service that gives the router's changing public IP address a fixed hostname.

**Before you start, understand the tradeoff:** this path uses plain `http://`, not `https://`. That means login credentials and session cookies travel unencrypted once traffic leaves the office LAN. This is a deliberate choice — it avoids per-seat subscription costs (e.g. Tailscale) and keeps setup to "router + free DDNS service," no ongoing account to manage. If a customer specifically needs encrypted transport, that requires an additional reverse-proxy step not covered in this section — ask your agent to help set one up (e.g. Caddy with automatic Let's Encrypt certificates) before committing to this path for that customer.

**Do this first: check for CGNAT.** Some ISPs (common on cable/mobile-carrier home internet, rare on business plans) put customers behind Carrier-Grade NAT, where you don't actually get your own public IP — port forwarding is then *impossible*, no router setting can fix it. Test before doing anything else:
1. On a computer on the office network, visit a site like `whatismyip.com` and note the IP address it shows.
2. Log into the router's admin page (see step 2 below) and find the "WAN IP," "Internet IP," or "Status" page — note the IP address shown there.
3. **If these two IPs match**, you're not behind CGNAT — proceed. **If they don't match** (the router shows something like `100.64.x.x`–`100.127.x.x`, or any address different from what whatismyip.com reports), this ISP is using CGNAT. Call the ISP and ask for a "static IP" or "public IP" add-on (often available on business-tier plans for a small monthly fee) — port forwarding will not work until that's resolved. Do not proceed with the steps below until this is confirmed working.

**Step 1 — Reserve a fixed local IP for the office PC.** If the office PC's local IP changes (routers hand these out dynamically by default), the port-forwarding rule silently stops working. Reserve one so it never changes:
1. Log into the router's admin page — usually `http://192.168.1.1` or `http://192.168.0.1` in a browser (check a label on the router itself, or run `ipconfig` on the office PC and use the "Default Gateway" address).
2. Find the section usually called **DHCP Reservation**, **Address Reservation**, or **Static Lease List** (varies by brand — look under "LAN" or "DHCP" settings).
3. Find the office PC in the list of connected devices (by its name or MAC address — get the MAC address by running `ipconfig /all` on the PC and reading "Physical Address" for the active network adapter) and reserve its current IP address for that MAC address.
4. Reboot the office PC and confirm (`ipconfig`) it comes back with the same IP.

**Step 2 — Forward port 3000 to the office PC.**
1. In the same router admin page, find **Port Forwarding**, **Virtual Server**, or **NAT Forwarding** (all names for the same feature, varies by brand).
2. Add a rule: external/public port `3000` → internal/private IP = the office PC's reserved IP from Step 1 → internal port `3000` → protocol **TCP**.
3. Save and apply — some routers require a reboot for this to take effect.

**Step 3 — Allow the app through Windows Firewall.**
1. On the office PC, open **Windows Defender Firewall with Advanced Security**.
2. Create a new **Inbound Rule** → Rule type: **Port** → **TCP**, specific local port `3000` → **Allow the connection** → apply to all profiles (Domain, Private, Public) → name it something like "WhiteVanOps".
3. (If Windows already showed an "Allow this app through firewall" prompt on first launch and you clicked Allow, this may already be covered — the explicit rule above is a more reliable belt-and-suspenders step that doesn't depend on remembering to click the right button on a popup.)

**Step 4 — Set up free Dynamic DNS (DDNS) so the router's changing public IP has a fixed hostname.**
1. Create a free account at [duckdns.org](https://www.duckdns.org) and add a subdomain (e.g. `your-client-name.duckdns.org`) — it will show you the office's current public IP.
2. Most consumer routers don't support DuckDNS natively (they support other providers like No-IP or DynDNS by name only). The reliable option: install DuckDNS's official Windows updater on the office PC as a **Scheduled Task** that runs every 5 minutes and pings DuckDNS's update URL with your token — this keeps the hostname pointed at the current IP even if the office's public IP changes. Follow the "Windows" install instructions on the DuckDNS install page for your subdomain (it generates a ready-to-use PowerShell script and gives exact Task Scheduler steps).
3. Confirm it's working: wait a few minutes, then check that `your-client-name.duckdns.org` (via `nslookup your-client-name.duckdns.org` or any "DNS lookup" website) resolves to the same IP you found in the CGNAT check above.

**Step 5 — Verify end-to-end, from outside the office network.** This is the step people get wrong most often: testing from a phone still connected to the office WiFi does **not** prove port forwarding works, because that traffic never leaves the LAN. To test for real:
1. On a phone, **turn off WiFi** and switch to cellular data (or use a different network entirely, like a coffee shop).
2. Visit `http://your-client-name.duckdns.org:3000/field` in the phone's browser.
3. You should see the White Van Ops login screen. If it times out, see the Troubleshooting table (§11) — the most common causes are: CGNAT (Step 0 above), the port-forward rule pointing at a stale IP because Step 1 wasn't done, or Windows Firewall blocking the inbound connection.

**Step 6 — Hand out access to field techs.**
1. In the dashboard sidebar, click **Field Access QR** and enter the DDNS address (e.g. `http://your-client-name.duckdns.org:3000/field`).
2. Hand out the URL and let each tech scan the QR code with their phone camera.
3. After signing in, they can use the browser's **Add to Home Screen** feature to install the field module as an app. The app ships a PWA manifest, meaning it will launch full-screen with its own icon and operate natively.
4. **Offline support:** the PWA uses an offline-first architecture via IndexedDB. If a technician loses signal, they can continue logging time, viewing job details, and saving materials — their changes queue locally and automatically flush back to the office server once the connection is restored.

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
| `REQUIRE_HTTPS` | No | Set to `true` only if you've put a real HTTPS front end (e.g. a reverse proxy) in front of the app. Locks the session cookie to HTTPS-only (`Secure` flag). **Leave unset for the standard Port Forwarding + DDNS setup in §7**, which is plain `http://` — setting this without HTTPS in place will silently break field-tech logins. |

---

## 11. Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| App window shows "Startup Error" | DATABASE_URL wrong or DB not reachable | Verify PostgreSQL is running; check the connection string in `resources/nextjs/.env.local` inside the install directory |
| "Invalid credentials" on login | bootstrap not run, or wrong credentials | Run `npx tsx prisma/bootstrap.ts` on the build machine against the target database |
| "Account temporarily locked" on login | 5 consecutive failed attempts trip a 15-minute lockout on that account (brute-force protection) | Wait out the 15-minute window, or confirm the correct password/username. There is no manual unlock — it always clears on its own. |
| "Too many login attempts" (HTTP 429) | More than 20 login attempts from the same IP within 5 minutes | This is a rate limit, not an account lockout — it resets automatically a few minutes after attempts stop. If several techs share one NAT/VPN egress IP, this can trigger from combined traffic; space out retries. |
| Field techs can't reach the server | Firewall, wrong IP, or AP/client isolation on the WiFi network | Check Windows Firewall allows port 3000; confirm techs are using the server machine's IP, not `localhost`. If the phone times out despite a correct IP and open firewall, the WiFi network may isolate devices from each other (common on managed/corporate networks) — use Dynamic DNS and Port Forwarding instead of relying on LAN routing. |
| Field tech field page loads but login doesn't work / bounces back to login screen | `Secure` session cookie requires HTTPS; plain `http://<lan-ip>:3000` can't set it | Use your Dynamic DNS address (e.g. `http://your-client.duckdns.org:3000/field`) — see §7. |
| Port forwarding + DDNS set up correctly, but still times out from cellular data | ISP is using Carrier-Grade NAT (CGNAT) — the office doesn't actually have its own public IP, so no router setting can fix this | Run the CGNAT check in §7 (compare `whatismyip.com` to the router's WAN IP page). If they differ, call the ISP and ask for a static/public IP add-on — this is an ISP-side change, not something fixable from the router or the app. |
| DDNS hostname resolves to the wrong IP, or stopped updating | The DDNS updater (Task Scheduler job on the office PC) isn't running, or the office's public IP changed and hasn't been pushed yet | Check Task Scheduler on the office PC for the DuckDNS update task's last run time/result. Manually re-run it, then re-check with `nslookup your-client.duckdns.org`. |
| Database connection refused | Port mismatch | Verify PostgreSQL is on port 5433 (or update DATABASE_URL to match your actual port) |
| App unreachable from any device (laptop or phone) after a reboot | PM2's login-triggered startup means nothing restarts until someone logs into the server machine | Log into `MearHPLaptop`. PM2 should auto-resurrect both processes. If not, run `pm2 resurrect` manually, then `pm2 list` to confirm `whitevanops` and `whitevanops-db` both show `online`. |
| Prisma errors with `code: 'ECONNREFUSED'` in PM2 logs (`pm2 logs whitevanops`) | The `whitevanops-db` PM2 process (the real Postgres instance) isn't running — do not assume it's the app itself that's broken | Run `pm2 list`. If `whitevanops-db` is missing or stopped, start it: `pm2 start "C:\Program Files\PostgreSQL\9.5\bin\postgres.exe" --name whitevanops-db -- -D "C:\Users\rober\Desktop\WhiteVanOps\pg_data" -p 5433` then `pm2 save`. Do **not** start either of the unrelated Windows PostgreSQL services (`postgresql-x64-9.5` on port 5432 is a separate legacy install) to "fix" this — they use different data directories and will not have the app's tables. |
| App window shows a *different product's* login page (e.g. Open WebUI) — or did, on builds before 2026-07-14 | Another application (commonly a Docker container) is publishing port 3000; older builds treated any listener on 3000 as the WhiteVanOps server and loaded it into the window | Fixed in builds from 2026-07-14 on: the app now verifies the listener via `GET /api/health` and, if 3000 is held by a foreign app, automatically boots its own server on the next free port (3001+). No user action needed — just update to a current installer. Note for the office PM2 machine: after updating the desktop app, redeploy the PM2 `whitevanops` service too, or the desktop app will treat the older PM2 server (which lacks `/api/health`) as foreign and boot a redundant second server on 3001. |
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

## 14. Onboarding Data Import (migrating a customer's existing data)

Imports a new customer's master data (clients, personnel, vehicles, equipment,
inventory, stock) and open/scheduled jobs from CSV/Excel files into a fresh
WhiteVanOps database. Run from a project checkout on the machine that can
reach the customer's database (`DATABASE_URL` in `.env`, same as the Prisma
CLI). Completed/cancelled job history is intentionally not imported.

This section is for importing a brand-new customer's external spreadsheet
data; if you're instead moving an existing WhiteVanOps installation and its
database to new hardware, see §13 (Hardware Upgrades and Transfers).

> **No terminal access needed on site:** the same import engine is also
> available in the app itself under **Settings → Onboarding Data Import**
> (superuser only) — upload the spreadsheets, review the proposed mapping,
> dry-run, and commit from the browser. See the Administrator manual,
> "Settings: Onboarding Data Import". The CLI flow below remains the
> reference for scripted/off-machine onboarding.

1. **Collect the data** into one folder as `.csv`/`.xlsx`. Convert PDFs or
   other FSM exports to spreadsheets first.
2. **Analyze:** `npx tsx scripts/import/analyze.ts <folder>` — writes
   `<folder>/mapping.json` (which file feeds which entity, column mappings,
   date formats, status translations). Re-running this after adding new
   source files requires `--force` to overwrite an existing `mapping.json`.
3. **Review `mapping.json`.** The import refuses to run while any
   `"unresolved"` entries or `"UNRESOLVED"` valueMap values remain — map a
   column, add a `"defaults"` entry, or translate the value. Low-confidence
   guesses are marked `"confidence": "low"`; verify them.
4. **Dry-run:** `npx tsx scripts/import/run.ts <folder>` — writes
   `<folder>/import-report.json` listing what would be imported, every
   rejected row with its file:row and reason, and out-of-scope skips
   (completed/cancelled jobs). No database access needed for a dry run.
5. **Commit:** `npx tsx scripts/import/run.ts <folder> --commit` — refuses if
   the database is not empty or if any rows were rejected (pass
   `--skip-rejected` to import only the clean rows). Runs as a single
   all-or-nothing transaction.
6. **If a run goes wrong:** `npx prisma migrate reset`, then
   `npx tsx prisma/bootstrap.ts`, fix the data or mapping, and rerun.

Keep `mapping.json` and `import-report.json` with the customer's onboarding
records — they are the audit trail of what was imported. Design details:
`docs/superpowers/specs/2026-07-05-data-migration-engine-design.md`.

---

*End of Setup & Installation Manual*
