# WhiteVanOps — Setup & Installation Manual

**Audience:** System administrator / owner performing first-time setup
**Last updated:** July 2026

---

## Overview

WhiteVanOps ships as two deployables:

1. **Desktop installer** (`WhiteVanOps-Base-Setup.exe` or `WhiteVanOps-Plus-Setup.exe`, renamed 2026-07-24 from the earlier single `WhiteVanOps Setup x.x.x.exe`) — for office staff (admin, superuser). Bundles the full application server **and a portable PostgreSQL 17 server**; no browser, Node.js, or separate database install required. Creates a desktop shortcut and Start Menu entry.
2. **Browser access** — for field technicians on phones/tablets, who connect to the same server via a URL (scan the **Field Access QR** code from the dashboard sidebar) and can install the field module as a home-screen app (PWA). **Base** reaches the office over the office WiFi only; **Plus** adds a secure tunnel for access from anywhere (§7).

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

### PostgreSQL binaries for the macOS build (`pgsql-mac/` directory)

The mac build bundles portable PostgreSQL binaries from `pgsql-mac/` (~160 MB, gitignored exactly like `pgsql/`). The zonky embedded-postgres darwin-arm64 archive (the plan's first-preference source) ships **no `pg_dump`, `psql`, or any other client tool** — only `postgres`/`initdb`/`pg_ctl`, which is enough to start a database but not to back one up. Sourced from Postgres.app instead, since its binaries are universal (arm64 + x86_64, no Rosetta) and include the full toolset. To (re)create it:

1. Download the single-major-version dmg from the latest [Postgres.app release](https://github.com/PostgresApp/PostgresApp/releases/latest), e.g. `Postgres-2.9.6-17.dmg` (~120 MB — much smaller than the all-versions dmg).
2. Mount it (`hdiutil attach`) and locate `Postgres.app/Contents/Versions/17/`.
3. Copy only what this app actually invokes into a new `pgsql-mac/` at the project root:
   - `bin/`: `postgres`, `initdb`, `pg_ctl`, `pg_dump` — the four binaries `electron/postgres.js` and `electron/backup.js`/`src/app/api/settings/backup/route.ts` call. Postgres.app's `bin/` also ships PostGIS/GDAL/PROJ tools (`gdal*`, `ogr*`, `proj*`, `postgis*`, etc.) and other core client tools (`psql`, `pg_restore`, ...) — none of these are used by the app, so leave them out.
   - `lib/`: only the dylibs those four binaries actually load — run `otool -L` on each (and recursively on their own dependencies) to get the exact closure; do **not** copy `lib/` wholesale, since Postgres.app's PostGIS bundle drags in ~150 MB of unrelated GDAL/PROJ/GEOS libraries. As of PostgreSQL 17.11 the closure is: `libcrypto.3.dylib`, `libicudata.75.dylib`, `libicui18n.75.dylib`, `libicuuc.75.dylib`, `liblz4.1.dylib`, `libpq.5.dylib`, `libssl.3.dylib`, `libxml2.2.dylib`, `libzstd.1.dylib`.
   - `lib/postgresql/`: `plpgsql.dylib` (Postgres registers the PL/pgSQL language by default on every `initdb`) and `dict_snowball.dylib` (the default text-search configuration's stemmer — `initdb`'s post-bootstrap step hard-fails without it, even though the app never calls it directly). No other extension module is needed; nothing in `prisma/migrations/` runs `CREATE EXTENSION`.
   - `share/postgresql/`: copy the whole directory (timezone data, config templates, `information_schema.sql`, `tsearch_data/`, etc. — all required by `initdb`). Do not copy `share/gdal`, `share/proj`, `share/doc`, `share/man`, or the other Postgres.app extras.
4. Preserve the executable bit on everything under `bin/` (`chmod +x pgsql-mac/bin/*`).

Verify the payload works in isolation before trusting it in a full build — from the project root: `pgsql-mac/bin/initdb -D /tmp/pgtest -U wvo_user -E UTF8 --locale=C -A scram-sha-256 --pwfile=<(echo somepassword)`, then `pgsql-mac/bin/pg_ctl -D /tmp/pgtest -l /tmp/pg.log -o "-p 5544" start`, then `pgsql-mac/bin/pg_dump -h 127.0.0.1 -p 5544 -U wvo_user postgres > /dev/null` should all succeed, followed by `pgsql-mac/bin/pg_ctl -D /tmp/pgtest -m fast stop` and `rm -rf /tmp/pgtest`.

`npm run electron:build:mac` fails the same way `electron:build` does if `pgsql-mac/bin/pg_ctl` is missing, and re-verifies both the `mac-arm64` and `mac` (x64) packaged outputs after building — mac produces two separate installers (`WhiteVanOps-Base-Setup-arm64.dmg` and `WhiteVanOps-Base-Setup-x64.dmg`) from one electron-builder invocation, and both are checked independently.

### `cloudflared` binary for the build (`cloudflared/` directory)

Required only for the two **Plus** artifacts (`electron:build:plus`, `electron:build:trial:plus`) — Base builds don't need it and must not have it. Gitignored, not committed to git, exactly like `pgsql/`. To (re)create it:

1. Download `cloudflared.exe` (Windows amd64) from the official releases: `https://github.com/cloudflare/cloudflared/releases/latest`.
2. Place it at `cloudflared/cloudflared.exe` in the project root.

A Plus build **fails** before packaging if `cloudflared/cloudflared.exe` is missing, mirroring the `pgsql/bin/pg_ctl.exe` check. After packaging, step 7b also asserts the reverse: `win-unpacked/resources/cloudflared/cloudflared.exe` must **not** exist in a Base artifact — a Base install that quietly shipped the tunnel binary would erase the product boundary being sold.

### `cloudflared` binary for the macOS build (`cloudflared-mac/` directory)

Required only for the two mac Plus artifacts (`electron:build:mac:plus`, `electron:build:mac:trial:plus`). Gitignored, not committed to git, exactly like `pgsql-mac/`. Cloudflare does not publish a universal darwin binary — arm64 and amd64 ship as separate archives — so this one is assembled with `lipo` into a single universal binary that serves both the arm64 and x64 `.dmg` targets `electron:build:mac` already produces from one electron-builder invocation, the same way `pgsql-mac/` is one payload for both arches. To (re)create it:

1. Download both darwin archives from the official releases (`https://github.com/cloudflare/cloudflared/releases/latest`):
   - `cloudflared-darwin-arm64.tgz`
   - `cloudflared-darwin-amd64.tgz`
2. Extract each (`tar -xzf`) — both contain a single `cloudflared` binary.
3. Merge them into one universal binary:
   ```bash
   lipo -create cloudflared-arm64/cloudflared cloudflared-amd64/cloudflared -output cloudflared-mac/cloudflared
   chmod +x cloudflared-mac/cloudflared
   ```
4. Verify it's genuinely fat and runs: `file cloudflared-mac/cloudflared` should report both `arm64` and `x86_64`, and `cloudflared-mac/cloudflared --version` should run without needing Rosetta on an Apple Silicon Mac.

`npm run electron:build:mac:plus` fails before packaging if `cloudflared-mac/cloudflared` is missing, and after packaging step 7b asserts it exists (and actually executes) inside both the `mac-arm64` and `mac` (x64) packaged `.app` bundles — mirroring the Windows Plus/Base present/absent checks above.

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

Every install starts on its purchased plan — the `License` table's singleton row is created automatically on first use, with `tier` matching the activation key. Plus tables exist on both plans but stay empty until licensed.

**There is no in-place Plus upgrade** (changed 2026-07-24 — the `--upgrade` patch installer, `upgrade_installer.cs`, and the `electron:build:upgrade` script are gone). Base and Plus are separate installers with different bundled payloads (Plus ships `cloudflared`, Base does not), so a licence-only patch can no longer grant a feature the binary isn't there to support. **Moving a customer from Base to Plus means purchasing Plus (25% off for an existing Base customer) and installing `WhiteVanOps-Plus-Setup.exe`.** The database in `%APPDATA%\whitevanops\` is untouched by installing a different WhiteVanOps installer over an existing one — reinstalling only replaces the application, never the customer's data.

**Legacy patched installs keep working.** `verifyPlusLicense()` and the `plus_license.json` reader in `src/lib/license.ts` are kept as read-only legacy — an install that was patched to Plus before 2026-07-24 continues to read as Plus. No new `plus_license.json` files are minted going forward.

**Downgrade:** click **Downgrade to Base Plan** under **Settings → License & Plan**. This resets the database tier; it does not remove `cloudflared` from a Plus install, since the binary's presence is a build-time property, not a runtime one.

---

## 6. Build the Desktop Installers

Four installer variants, one per plan × trial-or-not (changed 2026-07-24 — Base and Plus are separate artifacts now, not one installer decided by the key alone):

```bash
npm run electron:build            # Base installer      → dist-electron/WhiteVanOps-Base-Setup.exe
npm run electron:build:plus       # Plus installer      → dist-electron/WhiteVanOps-Plus-Setup.exe (bundles cloudflared)
npm run electron:build:trial      # Base 30-day trial   → dist-electron/WhiteVanOps-Base-Trial-Setup.exe
npm run electron:build:trial:plus # Plus 30-day trial   → dist-electron/WhiteVanOps-Plus-Trial-Setup.exe
```

**The activation key still decides entitlement — the build only decides payload.** No build flag grants a feature; `node scripts/license-manager.js --tier base|plus` is still how keys are minted, unchanged:
```bash
node scripts/license-manager.js --tier base     # Base customer
node scripts/license-manager.js --tier plus     # Plus customer
```
The tier is stamped onto the key's Firestore record, read during activation, and baked into the machine-bound signed licence file on the customer's PC. What differs between `electron:build` and `electron:build:plus` is that the Plus artifact also bundles `cloudflared/cloudflared.exe` via `extraResources` (see §1) — a Base install cannot open a tunnel for two independent reasons, no entitlement and no binary. `scripts/electron-build.js` step 7b asserts the binary's presence in Plus artifacts **and its absence in Base artifacts**.

### Trial/Demo Installers (Sales Demos)

`electron:build:trial` and `electron:build:trial:plus` build time-limited demo installers for prospect evaluations, locked to 30 days after first launch regardless of `License.tier`.

* **First launch:** a trial install has no activation-key prompt at all — it boots directly to the WhiteVanOps login screen and runs on its stamped plan for 30 days. (This differs from a standard Base/Plus customer build, which always requires a `WVO-XXXX-XXXX-XXXX-XXXX` activation key before it will boot.)
* **Plan comes from a signed build-time stamp, not the installer name alone.** `electron-build.js --trial --plan base|plus` writes `WVO_TRIAL_PLAN` plus an HMAC `WVO_TRIAL_PLAN_SIG` into the bundled `.env.local`; the app fails closed to Base if that stamp is missing or edited. A Base trial demos WiFi sync only and ships no `cloudflared`; a Plus trial demos the tunnel too.
* **What the prospect sees:** during the trial, **Settings → License & Plan** shows the stamped plan with license key `TRIAL-ACTIVE`, the note "30-Day Evaluation Period", and the expiry date (30 days after first launch) — so the end of the evaluation window is always visible in-app.
* **At day 30:** the app locks and, after logging in with a password, shows an in-app activation-key screen. A key generated for either `--tier base` or `--tier plus` unlocks the app running at that tier — a base key drops Plus features, a plus key keeps them.
* **Converting a trial to a paid install:** Have the customer open **Settings → License & Plan** (or, once locked, the lockout screen itself) and copy their Machine ID. Generate their activation key on your machine:
  ```bash
  node scripts/license-manager.js --unlock-trial --machine <theirMachineId> --tier base|plus [--notes "Order #1234"]
  ```
  Use `--tier base` if they purchased Base only (this also correctly drops the Plus features they were trialing), or `--tier plus` if they purchased Base+Plus. Send the printed JSON block back to them to paste into the same screen. This is a one-time, permanent conversion — there's no way to re-trial a machine after this without deleting `%APPDATA%\whitevanops\` entirely, which is a customer-initiated action outside the app's control. If the trial was a Base trial and the customer instead wants Plus, they need the Plus artifact — the unlock key does not add the `cloudflared` binary to an already-installed Base trial.

---

### What the build commands do

1. Compile the Next.js production build
2. Copy `.env.local` into the Next.js standalone bundle (adding `WVO_IS_TRIAL="true"`, `WVO_TRIAL_PLAN`, and `WVO_TRIAL_PLAN_SIG` for trial builds only — the trial plan is signed; a normal customer build's tier still comes only from the activation key)
3. Concatenate the Prisma migrations into `schema.sql` for the bundled database's first-run initialization
4. Package the server, credentials (if `.env.local` present), portable PostgreSQL (`pgsql/`), `cloudflared/` (Plus variants only), and Electron shell into a single NSIS installer
5. Output the resulting executable, named per the table above, in `dist-electron/`
6. Write a build stamp so a leftover file from a previous run can't be mistaken for the one you just built (see below)

Distribute the generated setup `.exe` matching the customer's plan to office staff. The installers upgrade any existing installation of the **same plan** in-place; moving plans means installing the other plan's artifact (see §5).

### Telling a current build apart from a stale one

The four artifact names above are fixed — rebuilding never renames the file, so an old `WhiteVanOps-Plus-Setup.exe` left over from a month ago looks identical to one built five minutes ago. Every successful build now writes:

- **`<artifact-name>.buildinfo.txt`** next to that installer — its app version, git commit, build timestamp, and whether it was built with uncommitted changes (never ship one that says so).
- **`dist-electron/BUILD-MANIFEST.txt`** — the same information for all four variants side by side, so you can tell at a glance if one of the other three is from an older commit and needs rebuilding before you ship a matched set.

Before handing an installer to a customer, open its `.buildinfo.txt` and confirm the commit matches what you expect to be shipping.

---

## 7. Field Tech Browser Access

Field technicians access the app via a Progressive Web App (PWA) on their phones or tablets. Transport is per-plan (2026-07-24): **Base** reaches the office over the office WiFi only; **Plus** adds a Cloudflare tunnel for access from anywhere. A Base install has no way to open a tunnel — it ships without the `cloudflared` binary and the activation key doesn't license it.

### Base: office WiFi only

The Next.js server runs locally in the customer's office; nothing about field access on Base ever leaves the building. There is no port forwarding, no DDNS, and no public-internet exposure to configure or worry about — the traffic never reaches the internet at all.

**Step 1 — Set a DHCP reservation or static IP for the office PC. This is required, not advisory.** The field module's URL is a bare LAN address (e.g. `http://192.168.1.20:3000/field`), and every tech's phone saves it as a home-screen app. If the router hands the office PC a different address after a reboot, every tech's saved URL breaks silently, at once — a symptom that reads to a customer as "the app just stopped working."
1. Log into the router's admin page — usually `http://192.168.1.1` or `http://192.168.0.1` in a browser (check a label on the router itself, or run `ipconfig` on the office PC and use the "Default Gateway" address).
2. Find the section usually called **DHCP Reservation**, **Address Reservation**, or **Static Lease List** (varies by brand — look under "LAN" or "DHCP" settings).
3. Find the office PC in the list of connected devices (by its name or MAC address — get the MAC address by running `ipconfig /all` on the PC and reading "Physical Address" for the active network adapter) and reserve its current IP address for that MAC address.
4. Reboot the office PC and confirm (`ipconfig`) it comes back with the same IP.

**Step 2 — Find the office PC's LAN address and generate the QR.**
1. In the dashboard sidebar, click **Field Access QR**.
2. Click **Use detected address** — this calls `GET /api/field-access/lan-address` and fills in the office PC's actual LAN IP, so nobody has to type it (and can't typo it). A private address (`192.168.x`, `10.x`, `172.16–31.x`) is the correct, expected shape on Base and shows a green confirmation, not a warning.
3. The modal generates a QR code for that address's `/field` path.

**Step 3 — Allow the app through Windows Firewall. This is required, not advisory.** Windows blocks inbound connections by default, and it blocks them by *dropping* the packet rather than refusing it — so a tech's phone shows a white screen that never finishes loading instead of an error message. Meanwhile the dashboard on the office PC keeps working perfectly (it only ever talks to itself), which makes a closed port look like a broken app. The installer runs per-user and cannot create firewall rules, so this step is manual.

1. On the office PC, open PowerShell **as Administrator** (right-click → Run as administrator).
2. Run the helper script:
   ```powershell
   .\scripts\recovery\allow-field-access.ps1
   ```
   Add `-Port 3001` (etc.) if the app is not on 3000 — it scans upward when 3000 is already held. To undo, run it with `-Remove`.
3. **Confirm the office WiFi is classified "Private", not "Public".** The rule is deliberately scoped to Private profiles so the app is never exposed on, say, a hotel network. The script warns you if any active network is Public; if the office WiFi is one of them, fix it under Settings → Network & Internet → WiFi → *(your network)* → Network profile type → **Private**.

To do it by hand instead: Windows Defender Firewall with Advanced Security → Inbound Rules → New Rule → Port → TCP → 3000 → Allow → Private only. Don't rely on the one-time "Allow this app through the firewall" popup — it's easy to dismiss, and dismissing it creates a *block* rule that then has to be found and deleted.

**Step 3 (macOS) — Allow the app through the macOS Application Firewall.** Same requirement, different mechanism: macOS's firewall is per-app rather than per-port, so there's no port number to configure — just the app itself.

1. On the Mac, open Terminal and run:
   ```bash
   sudo scripts/recovery/allow-field-access.sh
   ```
   To undo, run it with `--remove`. Pass `--app-path` if WhiteVanOps isn't installed at the default `/Applications/WhiteVanOps.app`.
2. The first time WhiteVanOps runs, macOS may separately prompt "Accept incoming network connections?" — click **Allow**. If it was dismissed or answered Deny, remove WhiteVanOps from System Settings → Network → Firewall → Options and re-run the script so it prompts again.
3. **On macOS 15 and later, also grant the Local Network permission**: System Settings → Privacy & Security → Local Network → WhiteVanOps. Without it, the app never accepts LAN connections at all, firewall rule or not — this is the macOS 15 case the `NSLocalNetworkUsageDescription` in the app's Info.plist exists to explain to the user when the OS itself prompts for it.

**Step 4 — Hand out access to field techs.**
1. Have each tech, **while connected to the office WiFi**, scan the QR code with their phone camera and sign in.
2. After signing in, they can use the browser's **Add to Home Screen** feature to install the field module as an app. The app ships a PWA manifest, meaning it will launch full-screen with its own icon and operate natively.
3. **Offline support:** the PWA uses an offline-first architecture via IndexedDB. If a technician leaves the building or loses signal, they can continue logging time, viewing job details, and saving materials — their changes queue locally, the status strip shows how many entries are waiting, and everything flushes back to the office server automatically once the phone rejoins the office WiFi. Closing the app does not lose queued work. See `MANUAL_Field_Tech.md` for what the status strip tells a tech, and `MANUAL_Troubleshooting.md` if work isn't reaching the office.

### Plus: the secure tunnel

Plus installs bundle `cloudflared` and can open a Cloudflare tunnel so techs reach the field module from anywhere — cellular data, a job site, home — over `https://`, not the office WiFi. This is still provisioned by a manual runbook, not an in-app wizard: see `docs/superpowers/plans/2026-07-20-phase-1-tunnel-runbook.md` for the setup steps. Once the tunnel is up, generate the Field Access QR the same way as Base (§ above) but pointed at the tunnel's `https://` hostname — the modal recognizes a public host as the correct shape when the install is licensed for Plus and generates the QR without a warning. Offline queueing and **Add to Home Screen** work identically to Base.

### The Field Access address also drives customer quote links (Plus)

The **Quotes** tab (Plus) sends customers a link to accept a quote online. That link is built from the **same address you saved in Field Access QR**, because it is the one address you have already told the app is reachable from outside. There is no separate setting and no extra port — the quote page is served by the same server on the same port as the field module, so anything that already lets a tech's phone in also lets the customer's browser in.

The practical consequence is the plan difference:

- **Plus with the tunnel up** — the address is a public `https://` hostname, so a customer can open the quote from anywhere. This is the intended setup.
- **A bare office-LAN address** — only someone on the office WiFi can open the link. Customers will see nothing. Quotes still work; the operator just records the acceptance by hand from the Quotes tab instead.

**Set the Field Access address before issuing the first quote.** With none saved, the app falls back to whatever address the dashboard itself was opened on — normally `localhost` — and the generated link works only on the office PC. Fixing it later means re-sending the link to any customer who already had one.

---

## 7A. Connecting a Second Machine (Client Mode)

If your office has more than one computer running WhiteVanOps (for example a Windows PC and
a Mac), they do **not** each get their own database. One machine is the **host** — it runs
the database and the server, exactly as a single-machine install always has, and it is the
machine that gets backed up (§8). Every other machine runs in **client mode**: it opens no
database, runs no server, and simply displays the host's dashboard in its own window — the
same relationship a field tech's phone already has with the office PC (§7), just in a
desktop app instead of a browser tab.

**Why not two databases?** WhiteVanOps has no way to merge two independently-edited copies
of the data back together without risking silent data loss or corruption (duplicate invoice
numbers, resurrected deleted records, conflicting stock counts). One shared database, always
reachable over the office network, avoids that entirely.

**Setting up the host.** Install and activate WhiteVanOps on the host machine exactly as
described in §1-6 above. Nothing about that process changes.

**Setting up a client.** On the second machine, install WhiteVanOps as usual but do **not**
enter a license key when the activation window appears. Instead, click **"Connecting to an
existing office server instead?"** and enter the host machine's LAN address (the same
address shown in the host's Field Access QR modal, §7) and its port (`3000` unless the host
had to fall back to a different one). The app verifies a real WhiteVanOps server answers at
that address before accepting it — a typo or an unrelated server will be rejected with an
error rather than silently saved.

**What a client cannot do:**
- **The host machine must be on.** If it's off, asleep, or disconnected from the network,
  every client shows "Cannot reach the office server" and will not fall back to running its
  own local copy — that is deliberate, so two machines never silently diverge. Retry once
  the host is back, or use **Reconfigure** to point at a different address.
- A client install never asks for its own license key — its Base/Plus features follow
  whatever the host is licensed for, the same as anyone opening the dashboard in a plain
  browser.
- A client is not backed up separately (§8) — only the host holds the data, so only the host
  needs a backup destination configured.

**Reconfiguring or switching a machine back to host mode.** There is currently no in-app
toggle for this after initial setup; contact support if a client machine needs to be
repointed at a different host or converted back to standalone.

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

> **`REQUIRE_HTTPS` was removed.** The session cookie's `Secure` flag is now decided per
> request from the `X-Forwarded-Proto` header, so one server can serve the desktop app over
> `http://localhost:3000` and field techs over `https://` at the same time. There is nothing
> to configure — delete the line from `.env.local` if you still have it.

---

## 11. Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| App window shows "Startup Error" | DATABASE_URL wrong or DB not reachable | Verify PostgreSQL is running; check the connection string in `resources/nextjs/.env.local` inside the install directory |
| "Invalid credentials" on login | bootstrap not run, or wrong credentials | Run `npx tsx prisma/bootstrap.ts` on the build machine against the target database |
| "Account temporarily locked" on login | 5 consecutive failed attempts trip a 15-minute lockout on that account (brute-force protection) | Wait out the 15-minute window, or confirm the correct password/username. There is no manual unlock — it always clears on its own. |
| "Too many login attempts" (HTTP 429) | More than 20 login attempts from the same IP within 5 minutes | This is a rate limit, not an account lockout — it resets automatically a few minutes after attempts stop. If several techs share one NAT/VPN egress IP, this can trigger from combined traffic; space out retries. |
| Field techs can't reach the server (Base) | Firewall, wrong LAN IP, phone not on office WiFi, or AP/client isolation on the WiFi network | Check Windows Firewall allows port 3000; confirm techs are using **Field Access QR → Use detected address**, not a typed/stale IP; confirm the phone is on the office WiFi. If the WiFi network isolates devices from each other (common on managed/corporate networks), Base field access cannot work around that — remote access requires Plus (§7). See also `MANUAL_Troubleshooting.md`, "A tech's work isn't reaching the office (Base)". |
| A tech's saved home-screen URL stopped working, for every tech at once (Base) | The router rebooted and handed the office PC a different LAN IP | Set a DHCP reservation or static IP for the office PC (§7, Step 1) if this wasn't already done, then re-issue the QR from **Use detected address** and have techs re-scan. |
| Field techs on Plus can't reach the tunnel hostname | Tunnel not running, or `cloudflared` misconfigured | See the tunnel runbook (`docs/superpowers/plans/2026-07-20-phase-1-tunnel-runbook.md`) — this is a manual-provisioning concern, not an in-app setting. |
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
1. Run the `WhiteVanOps-Base-Setup.exe` or `WhiteVanOps-Plus-Setup.exe` installer (whichever matches the customer's plan) on the new machine.
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
