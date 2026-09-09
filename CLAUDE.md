# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Start every session by reading the most recent handoff

Handoff notes live in the project root as `HANDOFF_YYYY-MM-DD-<topic>.md`. **Read the newest one
before doing anything else** — `ls HANDOFF_*.md` and take the latest date. It carries what the
last session shipped, what was deliberately left undone, which installers are stale, and the goal
the owner wants picked up next. That intent is recorded nowhere else: not in the code, not in the
git history, not in this file.

Read the one before it as well when the newest says to — handoffs chain, and an older one's
manual-verification checklist is often still open.

When you finish a session's work, write the next handoff in the same format and commit it.

## Commands

```bash
npm run dev              # Start Next.js dev server (http://localhost:3000)
npm run build            # Production Next.js build
npm run lint             # ESLint
npx tsc --noEmit         # Type check without building
npm test                 # Run the Vitest unit test suite once
npm run test:watch       # Vitest in watch mode

# Electron desktop app
npm run electron:dev     # Start Next.js dev + open Electron window (do this instead of npm run dev for UI work)
npm run electron:build            # Base installer      → dist-electron/WhiteVanOps-Base-Setup.exe
npm run electron:build:plus       # Plus installer      → dist-electron/WhiteVanOps-Plus-Setup.exe (bundles cloudflared)
npm run electron:build:trial      # Base 30-day trial   → dist-electron/WhiteVanOps-Base-Trial-Setup.exe
npm run electron:build:trial:plus # Plus 30-day trial   → dist-electron/WhiteVanOps-Plus-Trial-Setup.exe

# Database
npx prisma migrate dev --name <name>   # Create and apply a migration (also runs prisma generate)
npx prisma generate                     # Regenerate client after schema changes without migrating
npx prisma db seed                      # Seed with mock data (uses prisma/seed.ts via tsx)
npx prisma studio                       # Visual DB browser
npx tsx prisma/bootstrap.ts            # Create/reset the initial admin superuser (admin/admin, forced password change)

# Customer-machine admin recovery (total lockout — no admin/superuser can log in).
# Runs on a PC with no Node and no repo: the .ps1 borrows the Node runtime inside the
# installed Electron binary (ELECTRON_RUN_AS_NODE=1) and resolves pg/bcryptjs from the
# app's own bundled node_modules. Copy BOTH files to the machine; WhiteVanOps must be
# running (its bundled PostgreSQL only runs with the app open). See MANUAL_Troubleshooting.md §3.4.
scripts/recovery/reset-admin-password.ps1 -List     # Show admin/superuser accounts, change nothing
scripts/recovery/reset-admin-password.ps1           # Reset 'admin' to a random temp password
scripts/recovery/reset-admin-password.ps1 -Create   # Recreate the account if it was deleted

# Field-tech LAN access (Base): open the Windows Firewall on the office PC. Admin
# PowerShell; Private profile only. Required post-install — the per-user NSIS
# installer can't create firewall rules. See MANUAL_Setup_Installation.md §7 Step 3.
scripts/recovery/allow-field-access.ps1             # Allow inbound TCP 3000
scripts/recovery/allow-field-access.ps1 -Port 3001  # If the app scanned past a held 3000
scripts/recovery/allow-field-access.ps1 -Remove     # Undo

# Onboarding data import (migrating a customer's existing data — see MANUAL_Setup_Installation.md)
npx tsx scripts/import/analyze.ts <data-dir>   # Propose <data-dir>/mapping.json from customer CSV/Excel files (--force to overwrite an existing one)
npx tsx scripts/import/run.ts <data-dir>       # Validate + dry-run report; add --commit to import (fresh DB only)
```

**Env files — two files serve different consumers:**

| File | Used by |
|---|---|
| `.env` | Prisma CLI — `prisma.config.ts` loads it via `import "dotenv/config"` |
| `.env.local` | Next.js runtime (overrides `.env`) and the Electron installer (bundled by `scripts/electron-build.js`) |

Both files must contain `DATABASE_URL` and `SESSION_SECRET`. `.env.local` is the source of truth for the running app; `.env` is what makes `npx prisma ...` commands work.

```
DATABASE_URL=postgresql://...
SESSION_SECRET=<random-string>
```

The DB is PostgreSQL on port 5433 (non-standard). Prisma CLI configuration lives in `prisma.config.ts` (not `prisma.schema` — Prisma v7 uses a separate config file). The runtime client is instantiated with a `pg.Pool` in `src/lib/db.ts` via `@prisma/adapter-pg`, not the default connection string mechanism.

## Architecture

**Stack:** Next.js 16 App Router · TypeScript · Tailwind v4 · PostgreSQL via Prisma + `@prisma/adapter-pg` · `jose` for JWT · `bcryptjs` for passwords · Electron 42 (desktop shell) · Recharts (Plus analytics) · `pdf-lib` (Plus invoice PDFs)

### Two surfaces

| Route | Audience | Auth |
|---|---|---|
| `/` (dashboard) | Admin, Superuser | admin or superuser role |
| `/field` | Field Techs (also accessible to admin/superuser) | any authenticated user |

Login POSTs to `/api/auth/login`, which returns `{ ok, role, mustChangePassword }`. The client redirects: `mustChangePassword` → `/change-password`, `tech` → `/field`, others → `/`. `src/middleware.ts` enforces route access by role and also intercepts any request from a user whose JWT carries `mustChangePassword: true`, redirecting them to `/change-password` regardless of destination.

### Roles

- **superuser** — full access + user management (`/api/users`, Manage Users modal)
- **admin** — full operational access (all tabs, all write APIs including inventory)
- **tech** — field view only; can only log time for their own linked `personnelId`; can only update status on assigned jobs

### Session cookie `secure` is per-request, never a config flag

All auth routes that touch the cookie (`login`, `change-password`, `logout`, plus the `unlock-trial` branch of `/api/license`) go through the shared helpers in `src/lib/auth.ts` (`setSessionCookie`, `clearSessionCookie`, `getSessionCookieOptions`, `isSecureRequest`) so the name and options can't drift between routes. **All of them take the `Request` as an argument** — `secure` is derived per request from `X-Forwarded-Proto` (first hop), not from any env var.

This is load-bearing: **one server answers both `http://localhost:3000` (the Electron window) and the `https://` front end the field techs come in on.** A single global flag is therefore guaranteed to be wrong for one of them, and being wrong fails *silently* — the browser refuses to persist a `Secure` cookie over `http://`, so login appears to submit and then bounces back to `/login` with no error. `REQUIRE_HTTPS` was removed on 2026-07-20 for exactly this reason; **do not reintroduce a global HTTPS flag.** `src/lib/auth.test.ts` carries a regression test (`"ignores REQUIRE_HTTPS, which no longer exists"`).

**`clearSessionCookie` derives its attributes from `getSessionCookieOptions(req)`**, overriding only `maxAge: 0` — don't hand-roll the option object, so set and clear can't drift. Be accurate about why: a browser identifies a cookie by **(name, domain, path)** only. `secure`/`httpOnly`/`sameSite` are *not* part of that identity, so a clear that omits them still deletes the cookie — the pre-2026-07-20 `{ maxAge: 0, path: "/" }` clear worked. `path` is the attribute that actually has to match. (Verified empirically: `NextResponse.cookies.delete(name)` emits `Path=/; Expires=…1970`, so the `catch` branch in `src/middleware.ts` is fine as written.) The one genuinely scheme-dependent case is the reverse direction: a request over plain `http://` cannot overwrite a cookie that carries `Secure`.

**Transport is per-plan** (2026-07-24, `docs/superpowers/specs/2026-07-24-wifi-sync-base-tier-design.md`).
**Base** serves the field module over the office LAN only: techs load
`http://<office-lan-ip>:3000/field`, the existing IndexedDB queue holds writes made away from the
building, and they drain when the phone rejoins the office WiFi. Base requires a DHCP reservation or
static IP for the office PC — the saved PWA URL is a bare address, so a router reboot that moves it
breaks every tech at once. **Plus** adds the Cloudflare tunnel (still provisioned by runbook, not
code) for access from anywhere. `src/lib/fieldAccessUrl.ts`'s `fieldUrlVerdict()` encodes which
address shape is correct on which plan; a private-LAN plain-http URL is **correct** on both and must
never raise the plaintext warning. The per-request cookie `secure` logic above is correct for both
and needs no change.

### Login rate limiting is layered — no shared buckets

`src/lib/rateLimit.ts` holds the whole policy; `/api/auth/login` just calls `checkLoginRateLimit(getClientIp(req), username)`. Three layers, in order of authority:

1. **Per-account DB lockout** (in the login route: 5 attempts → 15 min, persisted on the `User` row) — the real brute-force control, since it survives restarts.
2. **Per-`(ip, username)`** in-memory bucket (`LOGIN_IDENTITY_MAX_ATTEMPTS`, 5 min) — one source hammering one account.
3. **Per-IP ceiling** (`LOGIN_IP_CEILING_MAX_ATTEMPTS`, 5 min), deliberately generous — credential stuffing across many usernames.

**`getClientIp` returns `string | null`, never a placeholder.** It prefers `CF-Connecting-IP` (a client can't prepend a spoofed entry to it the way it can to `X-Forwarded-For`). The old code fell back to the constant `"unknown"`, which collapsed every unidentifiable caller into one bucket — the whole company sharing 20 attempts / 5 min. When the IP is null the limiter falls back to a per-username bucket, never a shared one. **Never reintroduce a constant IP fallback.** The ceiling must also stay well above normal traffic: the office LAN and mobile-carrier CGNAT both put every tech behind a single address.

### Forced password change flow

`User.mustChangePassword` (Boolean, default false) is embedded in the JWT at login. `src/middleware.ts` redirects any authenticated request to `/change-password` when the flag is set, except for `/change-password` itself and `/api/auth/change-password`. The change-password API (`POST /api/auth/change-password`) validates the new password, updates the hash, sets `mustChangePassword = false`, and re-issues the JWT. The initial superuser created by `prisma/bootstrap.ts` ships with this flag set.

### Electron desktop app

The app is packaged as a Windows desktop application using Electron + electron-builder.

- `electron/main.js` — Electron main process. In **dev** mode (`!app.isPackaged`), it does nothing with the server (Next.js dev is started by `electron-dev.js`) and reads the port from `ELECTRON_DEV_PORT`. In **production**, it first probes port 3000 with an identity check (`isWvoServer()` → `GET /api/health`, expecting `{ app: "whitevanops" }`): **only if a WhiteVanOps server is already answering there does it reuse it and NOT boot its own**, otherwise it `require()`s the Next.js standalone `server.js` inline (Electron's main process IS Node.js). If 3000 is held by a *foreign* app (2026-07-14: an Open WebUI Docker container published on 3000 got loaded into the app window by the old any-listener `isServerUp()` check), it scans for the next free port (`findFreePort`, up to 3099) and boots there instead. Then it waits for the server to respond on the chosen port and opens the window. `/api/health` (`src/app/api/health/route.ts`) is in the middleware `PUBLIC_PATHS` — it must answer 200 without a session or the probe can't distinguish our server from a foreign one; note an out-of-date PM2 deployment without that route will be treated as foreign (desktop app boots its own server on 3001) until the PM2 app is redeployed. The reuse check exists because the always-on PM2 field-tech service (`whitevanops`) already holds port 3000 on the office server — without it, the desktop app tried to bind a second server on the same port and stalled on startup. So on the office machine the desktop app is a thin window onto the PM2 server; on a machine with no PM2 server it self-boots as before. Packaged builds also call `app.setPath('userData', %APPDATA%\whitevanops\profile)` before ready so they never share the dev Chromium profile (`%APPDATA%\white-van-ops`) — shared-profile leakage (stale service workers/cookies from dev) caused the 2026-07-10 "not valid JSON" packaged-install bug.
- **The self-booted server must bind `0.0.0.0`, never `localhost`** (fixed 2026-07-25). `main.js` sets `process.env.HOSTNAME` right before `require()`ing the standalone `server.js`, which passes it straight to `server.listen(port, hostname)`. It used to set `'localhost'`, and on Windows Node resolves that to `::1` first — so the packaged app bound **IPv6 loopback only** (`netstat` showed a lone `[::1]:3000`, no `0.0.0.0`, not even `127.0.0.1`). The dashboard worked perfectly because it dials itself, but every phone on the office WiFi got a dropped SYN and a white screen that never finished loading, whichever address the Field Access QR offered — i.e. it silently broke Base's entire transport (LAN field sync) while looking healthy on the office PC. The standalone server already defaults to `'0.0.0.0'` when `HOSTNAME` is unset, so the override was pure harm. Loopback callers are unaffected: Node's `autoSelectFamily` (default true since Node 20; Electron 42 ships Node 22) and Chromium both fall back to `127.0.0.1`, so `http://localhost:${PORT}` in `waitForServer`/`isWvoServer`/`loadURL` still connects — verified empirically. **Don't "tidy" this back to `localhost`.**
- **Binding the LAN is necessary but not sufficient — Windows Firewall is the second gate.** It drops inbound TCP rather than refusing it, producing the identical never-finishes-loading symptom, and the NSIS installer is per-user so it cannot create the rule. `scripts/recovery/allow-field-access.ps1` (admin, Private profile only) is the documented post-install step; see `MANUAL_Setup_Installation.md` §7 Step 3. When diagnosing "techs can't reach the server", check the bind first (`netstat -ano | findstr :3000` — look for `0.0.0.0`, not `[::1]`), then the firewall, then AP/client isolation on the router.
- `electron/postgres.js` — bundled-PostgreSQL lifecycle. The installer ships portable PostgreSQL 17.6 binaries from the project's `pgsql/` dir (gitignored, ~133 MB — see MANUAL_Setup_Installation.md §1 to recreate) plus `resources/db/schema.sql` (Prisma migrations concatenated by `electron-build.js`). On launch it: generates `resources/nextjs/.env.local` with unique random credentials if missing; skips entirely when the `DATABASE_URL` port already has a listener (office PM2 machine) or the host isn't localhost; **throws** (surfaced by `main.js` as a startup-error dialog) when the URL is localhost, the port is free, and the bundled binaries are missing — booting the web server anyway would just 500 every query ("Failed to load dashboard data", 2026-07-12); otherwise initdb's `%APPDATA%\whitevanops\pgdata` on first run, starts PG via `pg_ctl` (127.0.0.1 only), applies schema, and bootstraps admin/admin. A `bootstrap-complete` sentinel gates first-run; failures wipe pgdata and retry next launch. **Gotcha:** `pg_ctl start`/`stop` must run with `stdio: 'ignore'` — the postgres daemon inherits piped stdio and `execFileSync` hangs forever.
- `electron/loading.html` — Frameless splash screen shown while the server starts (inline copy of the logo SVG).
- `scripts/assets/logo-icon.png` (van artwork only, no wordmark — square, transparent background) is the brand master; `node scripts/generate-icons.js` regenerates `public/logo.png`, PWA icons (`public/icons/`), `apple-touch-icon.png`, and `src/app/favicon.ico` (requires devDeps `sharp` + `png-to-ico`). `scripts/assets/logo-full.png` keeps the original artwork (van + "WHITEVANOPS" wordmark + tagline) for any future large-format use — every current usage (sidebar, login, PWA icons, splash screen, marketing nav) renders too small for the wordmark to be legible, so the icon-only crop is what ships everywhere today. The marketing site (`marketing/index.html`) and the Electron splash screen (`electron/loading.html`) are static HTML with no build step, so they each embed a base64 copy of `logo-icon.png` inline rather than referencing a file path — regenerate those inline copies by hand (resize `scripts/assets/logo-icon.png`, base64-encode, swap the `data:image/png;base64,...` string) if the logo changes again.
- PWA: `src/app/manifest.ts` (start_url `/field`, standalone display). Middleware `PUBLIC_PATHS` whitelists `/logo.png`, `/icons`, `/apple-touch-icon.png`, `/manifest.webmanifest` — brand/PWA assets must be reachable without a session or the login-page logo and phone installs break.
- Dashboard sidebar → **Field Access QR** (`FieldAccessModal.tsx`) renders a QR of the field URL (editable, persisted in localStorage) so techs can scan and install `/field` as a home-screen app.
- `scripts/electron-dev.js` — Spawns `next dev`, detects the actual port from stdout, sets `ELECTRON_DEV_PORT`, then spawns Electron.
- `scripts/electron-build.js` — Runs `npm run build` (`prisma generate && next build --webpack`), copies `.next/static` and `public/` into the standalone output, copies `.env.local` into the bundle (optional — generated at first launch if absent), generates `.next/db/schema.sql` from the migrations, then calls `electron-builder --win`. It **hard-fails** if `pgsql/bin/pg_ctl.exe` is missing before packaging, and after packaging asserts that `win-unpacked/resources/pgsql/bin/pg_ctl.exe`, `resources/nextjs/node_modules/next`, and the Prisma runtime dirs below exist — electron-builder silently skips missing extraResources sources, which once shipped a DB-less installer.
- **Must build with `--webpack`, not Turbopack (Next 16's default).** Fixed 2026-07-19 — every DB route 500'd in the packaged (self-booting) installer, e.g. login: "Failed to load resource: 500". Two stacked bugs, both invisible except in an isolated packaged run (the office PM2 box runs against the full project `node_modules`, and even a dev running `.next/standalone/server.js` directly is masked because Node walks up to the project `node_modules`): (1) Turbopack emitted a broken external require `require("@prisma/client-<hash>")` that never resolves → `Cannot find module`; `next build --webpack` externalizes Prisma correctly. (2) The standalone trace doesn't copy Prisma 7's runtime packages, and `outputFileTracingIncludes` (`next.config.ts`) is a plain file-copy that doesn't follow the deps of what it includes — it now lists the exact `@prisma/client` runtime closure (`client`, `client-runtime-utils`, `debug`, `driver-adapter-utils`, `adapter-pg`, `.prisma/client`), deliberately not `@prisma/**` (that drags in ~95 MB of engines/studio/dev the driver-adapter path never loads). `npm run build` now runs `prisma generate` first so those dirs exist to trace, and `electron-build.js` step 7b asserts `resources/nextjs/node_modules/@prisma/client`, `@prisma/client-runtime-utils`, and `.prisma/client` all landed in the packaged output.
- The `build` key in `package.json` holds the electron-builder config. The standalone Next.js output lands in `resources/nextjs/` inside the installed app. `next.config.ts` sets `output: "standalone"` and pins `outputFileTracingRoot` to the project directory — **do not remove this.** Without it, Next.js can misinfer the workspace root if a stray lockfile exists in a parent directory (e.g. `C:\Users\<name>\package-lock.json`), which nests the real `.next/standalone/server.js` under an extra path segment. `electron-builder` copies the flat `.next/standalone` into `resources/nextjs`, and `electron/main.js` requires `server.js` directly at that flat path, so a misinferred root silently produces an installer that fails to launch. Verify after any `next.config.ts` change: `Test-Path .next\standalone\server.js` should be `True`.
- **extraResources node_modules gotcha:** electron-builder silently skips `node_modules` inside extraResources copies. The `{"from": ".next/standalone", "to": "nextjs"}` entry alone produces a packaged server that dies with `Cannot find module 'next'` — this went unnoticed for a while because the office machine always reuses the PM2 server instead of self-booting. The fix is the second explicit entry `{"from": ".next/standalone/node_modules", "to": "nextjs/node_modules", "filter": ["**/*"]}` in `package.json` — do not remove it. After any build-config change verify `dist-electron/win-unpacked/resources/nextjs/node_modules/next` exists.
- **`dependencies` in `package.json` is the Electron main process's dependency list — not the app's.** electron-builder copies production dependencies into `app.asar` regardless of the `files` globs, so anything left in `dependencies` is bundled a *second* time (the Next.js side already ships its own traced copy in `resources/nextjs/node_modules`). Only the five modules `electron/*.js` bare-requires stay in `dependencies`: **`bcryptjs`** (postgres.js), **`firebase`** (main.js), **`node-cron`** (backup.js), **`node-machine-id`** (main.js), **`pg`** (postgres.js). Everything else — `next`, `react`, `react-dom`, `@prisma/client`, `@prisma/adapter-pg`, `recharts`, `pdf-lib`, `lucide-react`, `jose`, `qrcode` — lives in `devDependencies` and still reaches the installer via Next.js file tracing, which reads the import graph and ignores the `dependencies`/`devDependencies` split. This cut `app.asar` from 477 MB (242 modules) to 123 MB (51) and the Base installer from 274 MB to 156 MB. **Adding a new `require()` to `electron/*.js` means moving that package into `dependencies`**, or the packaged app dies with `Cannot find module` on the customer's first launch — step 7c of `electron-build.js` parses the asar header and hard-fails the build if a keeper is missing. `firebase-admin` is a devDependency: it is used only by `scripts/license-manager.js` (vendor-side key minting), never at runtime. Consequence of the split: `npm ci --omit=dev` cannot run `next build`.
- **Windows is the only build target.** Linux support (the `build.linux` tar.gz target, the `--linux` flag in `electron-build.js`, the `pgsql-linux/` binaries and the `Linux builds/` output dir) was removed on 2026-07-15 — it had never produced a shipped artifact and its `pgsql-linux/` binaries were already missing, so every `--linux` run hard-failed. Don't reintroduce a target without also extending the step 6/7b/7c assertions to cover it.
- **Build output must stay out of the compile set.** `tsconfig.json` excludes `dist-electron` and `.next/standalone`. Its `include` is `**/*.ts`/`**/*.tsx`, so without those excludes the *copies* of `src/` that the file tracer leaves inside packaged output get type-checked alongside the real ones — a stale copy from an earlier build then fails `next build` with errors pointing at paths under `dist-electron/`, blocking every subsequent build until the directory is cleared. `storefront/` is excluded for a related but distinct reason (added 2026-09-07): it is a **separate deployable Next.js app** with its own `tsconfig.json`, `package.json` and its own `@/*` → `./src/*` alias. Without the exclude, the root `include` glob pulls its source into this program and resolves its `@/lib/...` imports against the *root* `src/`, where those modules don't exist — which fails `next build` for the whole app even though nothing is wrong with either project. Exclude `.next/standalone`, not all of `.next`: `include` explicitly globs `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`, and `exclude` overrides `include`, so excluding `.next` drops Next's generated route types from the program.
- **Installer output:** `dist-electron/WhiteVanOps-Base-Setup.exe` / `WhiteVanOps-Plus-Setup.exe` (customer installers) and `WhiteVanOps-Base-Trial-Setup.exe` / `WhiteVanOps-Plus-Trial-Setup.exe` (30-day demo builds) — NSIS, creates desktop shortcut + Start Menu entry automatically. Bundles portable PostgreSQL (see `electron/postgres.js` above) — fully self-contained on machines with no existing database.
- **Deploying to a new machine:** build the installer with the correct `.env.local` present so credentials are bundled, or have IT place `.env.local` at `<install dir>/resources/nextjs/.env.local` after installation.
- **Distributing to multiple customers:** each customer needs their own unique `SESSION_SECRET` and database credentials — never reuse the same secret across customer installs. `electron-build.js` bundles `.env.local` into the `.exe`, so a shared secret would ship inside a file handed to more than one company, and there's no reason to share it since every customer runs an isolated server/database. Generate a fresh secret per customer (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) and either rebuild the installer per customer or configure `.env.local` on-site after installing a generic build. See `MANUAL_Setup_Installation.md` §3.
- **No Docker deploy path:** an earlier, half-finished Docker deployment scaffold (`docker-compose.yml`, `Dockerfile`, `deploy/`) predated real user auth and was removed — it assumed a hardcoded `APP_USERNAME`/`APP_PASSWORD` login the app hasn't used since auth became the `User` table + JWT session (see Auth helpers below). The Electron installer + native PostgreSQL path documented above is the only deploy path. Automated backups are handled by the built-in Settings → Database Backup & Recovery feature (`electron/backup.js`), not a standalone script.

#### Shared-database mode ("client mode")

An office with more than one machine (e.g. a Mac and a Windows PC) does **not** get two
databases — WhiteVanOps has no merge path (no `version`/`deletedAt`/origin columns, hard
cascading deletes, `@unique` invoice/quote numbering, absolute `StockLevel.quantity` —
two machines minting `INV-0001` or racing a stock edit would silently corrupt data). One
machine is the **host** and runs the database and server exactly as a single-machine
install always has. Every other machine is a **client**: it starts no database, boots no
server, and simply opens the host's address in its window — the same relationship a field
tech's phone already has with the office PC, just in a desktop window instead of a browser
tab.

- **Config file:** `<appData>/whitevanops/host.json` (`getHostConfigPath()` in
  `electron/main.js`, mirroring `getLicensePath()`'s directory). Shape is
  `{ "mode": "host" }` or `{ "mode": "client", "host": "...", "port": 3000 }`.
  **Absence of the file means host mode.** This is deliberate: it is what makes client
  mode invisible to the entire pre-existing single-machine install base — a machine that
  has never heard of `host.json` behaves byte-for-byte as it always has.
- **Where the choice happens:** the existing first-run activation window
  (`showActivationWindow()`), shown only when `verifyLicenseSilent()` fails — i.e. never on
  an already-activated machine. It gained one link, "Connecting to an existing office
  server instead?", that hands off to a new `showClientSetupWindow()` (same
  `ipcMain.on`/`event.reply` IPC pattern as everywhere else in this file — no
  `ipcMain.handle` anywhere in the codebase). That window verifies the address via
  `isWvoServer(host, port)` — generalized from its original localhost-only signature —
  before writing `host.json`, so a client machine can never save an address that isn't
  actually running WhiteVanOps.
- **`startServer()` early-returns** for `mode: "client"`, before `ensurePostgres`,
  `require(server.js)`, or `startBackupScheduler` — a client never boots a local database,
  never runs a server, and never backs itself up (the host does).
- **Never falls back to self-booting.** If a saved host doesn't answer at startup,
  `handleUnreachableHost()` shows Retry / Reconfigure / Quit — it does not silently start a
  local database instead. That fallback is exactly the divergent-copy failure mode
  shared-database mode exists to prevent.
- **Licensing:** a client-mode install skips activation entirely. Entitlement comes from
  the host's own server-side `requirePlus` checks — the same as a plain browser hitting
  that host directly, which already works today.
- **Honest limitation:** if the host machine is off or asleep, clients cannot work. That is
  the trade for never losing or duplicating a record. Document this in
  `MANUAL_Setup_Installation.md` wherever client mode is described.

### License / Plus tier

The app runs as one codebase in two plans, gated at runtime by a DB flag (not separate builds): **Base** and **Plus** (CRM notes/follow-ups, Analytics tab, Invoicing tab). Key pieces:

- `License` model in `prisma/schema.prisma` — singleton row with fixed id `"singleton"`, **upserted on read** by `src/lib/license.ts` (`getLicense()`), so every install path self-heals without a seed step. Fields: `tier` ("base"|"plus"), `licenseKey`, `notes`, `activatedAt`, `expiresAt` (null = perpetual).
- `src/lib/license.ts` mirrors `auth.ts`'s shape: `hasPlusLicense()` (tier is plus **and** unexpired), `requirePlus(licensed)` returns a `403 NextResponse` or `null`. It is called explicitly alongside `requireRole` in every Plus route — deliberately not folded into `requireRole`, so `requirePlus` stays greppable as the complete list of Plus-gated routes.
- **The tier travels inside the activation key — never in configuration.** `scripts/license-manager.js --tier base|plus` stamps `tier` onto the Firestore `licenses/<key>` record at mint time; `electron/main.js` reads it during activation and bakes it into the machine-bound, HMAC-signed `%APPDATA%\whitevanops\license.json`; `getBaseLicense()` returns it as the authoritative plan for an activated install. Because the tier is inside the signed payload, hand-editing it invalidates the signature and the file is rejected outright.
- **Base and Plus are separate installers, but the key still decides entitlement** (changed
  2026-07-24). The tier still travels only inside the signed activation key — no build flag grants
  a feature. What differs between the artifacts is *payload*: `WhiteVanOps-Plus-Setup.exe` bundles
  `cloudflared` via `extraResources`, `WhiteVanOps-Base-Setup.exe` does not. So a Base install
  cannot open a tunnel for two independent reasons — no entitlement and no binary — and
  `scripts/electron-build.js` asserts the binary's presence on Plus **and its absence on Base**.
- **There is no in-place Plus upgrade.** `--upgrade`, `upgrade_installer.cs` and
  `electron:build:upgrade` were removed 2026-07-24: a licence patch would unlock Plus features on
  an install with no `cloudflared`. A Base customer moving to Plus buys Plus (25% off) and installs
  the Plus artifact. `verifyPlusLicense` and the `plus_license.json` reader stay as **read-only
  legacy** so an install already patched in the field keeps working.
- **Do not reintroduce a tier env var.** `WVO_DEFAULT_TIER` was removed on 2026-07-15 because it granted Plus outright from a plain-text line in `resources/nextjs/.env.local`: changing `"base"` to `"plus"` in Notepad unlocked the paid tier, and the anti-tamper self-heal never fired because the env var satisfied the very check meant to catch tampering (it made `verifiedPlus` true). `src/lib/license.test.ts` carries a regression test — `"ignores WVO_DEFAULT_TIER=plus and self-heals a plus DB row back to base"` — specifically to stop this coming back.
- **Legacy `license.json` compatibility:** installs activated before the tiered format have no `tier` field and a signature over `key:machineId` only. `getBaseLicense()` accepts that shape via `signLegacyBaseLicense()` and reads it as tier "base" — all such installs ever were — so nobody is forced through re-activation. Remove once no legacy installs remain in the field.
- **`electron/main.js` duplicates the signing functions in plain JS** (`signLicense`/`signLegacyLicense`) because it runs before the Next.js bundle loads and cannot import TypeScript. They must stay byte-identical to `signBaseLicense`/`signLegacyBaseLicense` in `src/lib/licenseCrypto.ts`, or activation writes a file the running app then rejects. `scripts/activate-dev.js` mirrors them a third time.
- **Every Plus API route gates server-side** (`/api/clients/[id]/notes`, `/api/clients/[id]/follow-ups`, `/api/follow-ups/[id]`, `/api/analytics`, `/api/invoices/**`, and the Plus-data branches of `/api/dashboard`). The UI hiding tabs is convenience only, not security.
- `/api/dashboard` returns `license: { tier, expiresAt, plus }` in `DashboardData` and only populates Plus data (client `notes`/`followUps` includes, `invoices`) when licensed — a downgraded install doesn't leak Plus data through the full-reload pattern.
- `GET/POST /api/license` — GET is admin/superuser; POST (plan change) is **superuser-only** + audited. UI: Settings → License & Plan (`SettingsTab.tsx`). Cryptographically validated offline signature, bound to the machine-locked base activation key.
- Downgrade/expiry hides tabs and 403s the APIs but never deletes Plus data. All Plus tables ship in the normal migration set to every install and stay empty until licensed. If the database is tampered with (`License.tier` set to plus by hand), `getLicense` self-heals by reverting to base — **but note the self-heal only catches what it can't verify.** It fires when `verifiedPlus` is false, so anything that makes `verifiedPlus` true bypasses it entirely rather than being caught by it; that is exactly how `WVO_DEFAULT_TIER` defeated it. Every branch that can set `verifiedPlus` must therefore be gated on a signature, which is the invariant `getLicense()`'s tier-precedence chain now maintains.
- Invoicing: statuses Draft → Sent (manual) → PartiallyPaid/Paid (derived from payments in `src/lib/invoice.ts`, never set by hand) or Void; numbering via a `SystemSetting` counter (`invoice_next_number`) incremented in the same transaction as the create; PDF via `pdf-lib` (pure JS — chosen over puppeteer for Electron installer size). Charts: Recharts.
- Quoting (added 2026-09-07): statuses Draft → Sent → Approved/Declined → Converted, plus Expired. Numbering mirrors invoicing (`quote_next_number`). Pure logic in `src/lib/quote.ts`; PDF layout primitives shared with the invoice PDF via `src/lib/pdfDoc.ts`. Three rules that are load-bearing:
  - **Expired is derived, never stored.** `deriveQuoteStatus()` computes it from `expiryDate` at read time and only ever promotes a `Sent` quote — a decision already taken (Approved/Declined/Converted) must never be rewritten by the clock. Don't add a cron that writes `status = "Expired"`.
  - **`canRespondToQuote()` is the single gate on accepting.** Both the customer's public POST and the operator's manual "Accepted"/"Declined" button go through it, so the expiry and already-decided rules cannot drift between the two paths.
  - **`Quote.convertedInvoiceId` is `@unique` and set in the same transaction as the invoice create**, so a double-click can't raise two invoices from one quote.

### The public quote-approval route

`GET`/`POST /api/public/quotes/[token]` (+ the `/quote/[token]` page) is the **only unauthenticated data surface in the app** — a customer reaches it with no session and no account. Both prefixes are in `src/middleware.ts`'s `PUBLIC_PATHS`, written with a trailing separator (`"/quote/"`, `"/api/public/quotes/"`) because that list is matched with `startsWith` and a bare `"/quote"` would also open a future `/quotes` dashboard page.

The 256-bit `publicToken` is the entire credential, so: it is minted only when a quote is actually sent (`POST /api/quotes/[id]/send`) — an unsent draft has no live link at all; it is never logged, never echoed, and never written into `AuditLog`; and every failure returns the same 404 so a wrong token can't reveal whether a quote exists. `publicQuoteView()` in that route is a **whitelist** — the `Quote` row also carries the internal id, `jobId` and the token itself, and the `Client` row carries the full customer record, none of which the recipient may see. Reads and writes are both rate limited (`src/lib/rateLimit.ts`), falling back to a per-token bucket when the IP is unknown rather than a shared constant, for the same reason the login limiter does.

Token minting lives in the server-only `src/lib/quoteToken.ts`, **not** in `src/lib/quote.ts` — the client-side `QuotesTab.tsx` imports the latter, and a bare `crypto` import there breaks the browser bundle. Keep `quote.ts` free of Node built-ins.

The customer-facing link is built by `buildQuoteApprovalUrl()`, which borrows the origin of the `field_access_url` SystemSetting (the address the operator already configured for field techs) and falls back to the request origin. That is deliberate: the dashboard is normally opened on `localhost`, which is useless in a customer email. A Base-tier LAN address therefore produces a link only reachable on the office WiFi — correct and expected, since quoting is Plus-only and Plus is where the tunnel lives.

### Trial/Demo installer (separate mechanism from the License/Plus tier above)

`npm run electron:build:trial` and `npm run electron:build:trial:plus` build the two trial installer variants (`WhiteVanOps-Base-Trial-Setup.exe`, `WhiteVanOps-Plus-Trial-Setup.exe`) for sales demos — locked to 30 days from first launch regardless of `License.tier`. This is orthogonal to the Base/Plus gate: a normal customer install never has a trial lock at all.

- `src/lib/trial.ts` — `getTrialStatus()` reads/lazily-creates a signed, machine-bound anchor file (`%APPDATA%\whitevanops\trial.json`, HMAC'd with the same `LICENSE_SIGNING_SECRET`) and computes `isLocked`. No-op (zero file I/O) unless the build was stamped with `WVO_IS_TRIAL=true`. The shared HMAC signing/verification helpers (`LICENSE_SIGNING_SECRET`, `getAppDataWvoDir`, `signTrialUnlock`, `verifyTrialUnlock`, `timingSafeEqualStrings`) live in the leaf module `src/lib/licenseCrypto.ts` — imported by both `license.ts` and `trial.ts` to avoid a would-be import cycle.
- Trial builds skip the native Electron base-activation window entirely (`electron/main.js`'s `isTrialBuild()` reads `WVO_IS_TRIAL="true"` from the bundled `.env.local` and bypasses `verifyLicenseSilent()`/`showActivationWindow()`) — a fresh trial install boots straight to password login, no `WVO-XXXX-XXXX-XXXX-XXXX` key or Firestore lookup required. Base/Plus customer builds are unaffected; they still require the native activation key.
- After a day-30 unlock, the key's own tier — base or plus — determines which features run, not the trial build's stamped plan: `getLicense()` treats a signature- and machine-verified `trial-unlock.json` as the highest-precedence tier source (see `src/lib/license.ts`'s `getVerifiedTrialUnlock()`). A base-tier unlock key correctly drops Plus features; a plus-tier key keeps them.
- **A trial build's plan comes from a signed stamp** (2026-07-24). `electron-build.js --trial --plan
  base|plus` writes `WVO_TRIAL_PLAN` plus an HMAC `WVO_TRIAL_PLAN_SIG` into the bundled `.env.local`;
  `verifyTrialPlan()` in `src/lib/licenseCrypto.ts` returns the tier and **fails closed to `base`**
  for anything absent or edited. This is the one plan input that genuinely has to come from the build
  (trial installs skip activation entirely), which is exactly why it is signed — an unsigned one
  would be `WVO_DEFAULT_TIER` again. `src/lib/license.test.ts` carries the regression test
  *"ignores an unsigned WVO_TRIAL_PLAN=plus and falls back to base"*. A Base trial demos WiFi sync
  only and ships no `cloudflared`.
- Enforcement mirrors the existing `mustChangePassword` forced-redirect pattern rather than adding filesystem/DB access to the edge-safe `src/middleware.ts`: `isLocked` is stamped into the session JWT at login (`src/app/api/auth/login/route.ts`) and the middleware redirects everywhere except `/trial-expired` + `/api/license` when the claim is set.
- Conversion: `POST /api/license` with `{ action: "unlock-trial", licenseKey }` (superuser-only) verifies a signed payload against **this machine's real `machineIdSync()`** (never the payload's claimed value) and, if valid, writes `trial-unlock.json` (its presence permanently defeats the lock) and sets `License.tier` to whatever the key grants — `base` or `plus`, so a Base-only purchase correctly drops the Plus features being trialed. Keys are minted vendor-side via `node scripts/license-manager.js --unlock-trial --machine <id> --tier base|plus`.
- Full design/build history: `docs/superpowers/specs/2026-07-13-trial-demo-installer-design.md` and `docs/superpowers/plans/2026-07-13-trial-demo-installer.md`. Customer-facing build/conversion steps: `MANUAL_Setup_Installation.md` §6.4.

### Data flow (dashboard)

`/api/dashboard` fetches all entities in a single parallel `Promise.all` and returns them as `DashboardData`. The `useDashboardData` hook in `src/hooks/useDashboardData.ts` fetches this on mount and exposes a `reload()` callback. After any mutation, components call `onSuccess()` which calls `reload()` to refresh everything. **There is no per-entity caching or optimistic UI** — every action does a full dashboard refresh.

### Auth helpers

- `src/lib/auth.ts` — `getSessionUser()` reads the `session` cookie via `next/headers` and verifies the JWT. `requireRole(user, ...roles)` returns a `403 NextResponse` or `null`. Call these at the top of every write API route.
- `src/lib/audit.ts` — `audit(userId, action, entity, entityId, details?)` writes an `AuditLog` row. Fire-and-forget; failures are console-logged only, never propagated to the caller.
- `src/middleware.ts` — guards all non-public routes. `TECH_ALLOWED_PREFIXES` is the allowlist for tech-role API access; add any new API routes techs need to call. **Known:** Next.js 16 renamed `middleware.ts` → `proxy.ts`; a deprecation warning appears on every build but is non-breaking.

### Adding a new write API route

1. Import `getSessionUser` and `requireRole` from `@/lib/auth`
2. Import `audit` from `@/lib/audit`
3. Call `requireRole(user, "admin", "superuser")` at the top (adjust roles as needed)
4. If the route is Plus-only, also call `requirePlus(await hasPlusLicense())` from `@/lib/license` right after `requireRole` (see "License / Plus tier" above)
5. After the DB write succeeds, call `audit(user!.userId, "CREATE"|"UPDATE"|"DELETE", "EntityName", entityId)`

### Adding a new modal

1. Add the modal type string to `ModalType` in `src/types.ts`
2. Create the component in `src/components/modals/` using `Modal` + `ModalHeader` from `src/components/shared/Modal.tsx`
3. Wire state in `src/app/page.tsx`: set `activeModal` to open, render conditionally at the bottom of the modal block

### Schema

`prisma/schema.prisma` defines all models. Key relationships:
- `Job` → `Client`, `Vehicle`, `JobAssignment[]`, `JobLineItem[]`, `JobEquipment[]`, `TimeEntry[]`
- `Personnel` → `JobAssignment[]`, `TimeEntry[]`, `PersonnelQualification[]`, `PersonnelTimeOff[]`, `User?`
- `User.personnelId` links a login account to a Personnel record (required for tech role for auto-select on `/field`)
- `User.mustChangePassword` — when true, all routes redirect to `/change-password` until resolved
- `AuditLog.userId` → `User`
- `StockLevel` is the join between `InventoryItem` and `StockLocation` (includes `quantity` and `minThreshold`)
- Completing a job deducts `JobLineItem` quantities from the assigned vehicle's `StockLocation`

## Testing

Vitest covers pure-logic modules in `src/lib/`: `dateUtils`, `recurrence`, `jobConflicts`, `auth`, `license`, `invoice`. `vitest.config.ts` resolves the `@/` alias to `src/` and runs in the `node` environment. Conventions used across these tests:

- **`src/lib/db.ts` opens a real `pg.Pool` at import time and throws without `DATABASE_URL`** — any module that imports it (like `jobConflicts.ts`) needs `@/lib/db` mocked with `vi.mock`, never imported for real, in unit tests.
- **`next/headers`'s `cookies()` is request-scoped** and throws outside a real request — mock it (see `auth.test.ts`) when testing code that calls `getSessionUser()`. `NextResponse` itself (from `next/server`) works fine unmocked — it's just a `Response` subclass.
- **Use `vi.resetAllMocks()` in `beforeEach`, not `vi.clearAllMocks()`**, when a mock is shared across multiple check branches (e.g. `repairRecord.findFirst` is called by both the vehicle-repair and equipment-repair checks in `jobConflicts.ts`). `clearAllMocks` only wipes call history — queued `mockResolvedValueOnce` values and default `mockResolvedValue` implementations survive into the next test and can silently leak between cases.
- **Use `vi.stubEnv`/`vi.unstubAllEnvs`, not direct `process.env.X =` assignment**, for env vars used in conditionals (e.g. `REQUIRE_HTTPS`) — `NODE_ENV` is typed read-only and direct assignment fails `tsc`.
- **Keep fake secret-shaped fixture values short** (under ~20 chars) or avoid the words secret/password/token immediately before them — the `scripts/scan-secrets.js` pre-commit hook's generic pattern doesn't know the difference between a real leaked credential and a test fixture with a matching shape.

## Manual update policy

After any change that affects user-facing behavior, update the relevant manual(s) in the project root:

- `MANUAL_Setup_Installation.md` — env vars, dependencies, migration steps, server config
- `MANUAL_Administrator.md` — dashboard features, tabs, modals, workflows, data fields
- `MANUAL_Field_Tech.md` — field module (`/field`) UI, actions, panels

Treat manual updates as part of completing a task, not an optional follow-up.

### Date handling

All dates are stored as UTC `DateTime` in Postgres. The app parses them as **local noon** to avoid UTC offset display bugs. Use `src/lib/dateUtils.ts` (`formatDate`, `todayLocalStr`, `dateToLocalStr`) — never parse date strings directly with `new Date(dateStr)` in UI code.

### QuickBooks sync

`/api/sync` (POST) is the bulk lock route — it marks completed jobs and time entries as `"Exported"` (`qbInvoiceSyncStatus` / `qbTimeSyncStatus`). This is a one-way, irreversible operation. The Accounting tab in the dashboard exposes CSV export buttons (client-side only, no API call) followed by a "Mark Synced" confirmation that calls this route. Requires `admin` or `superuser` role.

### Onboarding data import

`scripts/import/analyze.ts` + `scripts/import/run.ts` (both `npx tsx`) migrate a new
customer's spreadsheets into a fresh database. All logic is in pure modules under
`src/lib/import/` (relative imports only — no `@/` alias, so tsx resolves them; nothing
there imports `src/lib/db.ts` — the executor takes the DB as a parameter). The
`mapping.json` proposed by analyze and reviewed by hand is the contract; `run.ts` is
dry-run by default, all-or-nothing on `--commit`, and refuses a non-empty database.
Spec: `docs/superpowers/specs/2026-07-05-data-migration-engine-design.md`.
The same engine also has an in-app surface: **Settings → Onboarding Data Import**
(`src/components/settings/DataImportSection.tsx` + `POST /api/settings/import`,
superuser-only) — upload files, edit the mapping in the browser, validate (dry-run),
then execute; unlike the CLI it can optionally wipe transactional data first and
skip rejected rows instead of refusing the run. Any change to `src/lib/import/`
now has two consumers: the CLI scripts and this route.

### Field page

`/app/field/page.tsx` is a standalone mobile-optimized view. It fetches `/api/field` independently (does not use `useDashboardData`). On mount it also fetches `/api/auth/me` — if the session user has a `personnelId`, that tech is auto-selected and the personnel picker is skipped.
