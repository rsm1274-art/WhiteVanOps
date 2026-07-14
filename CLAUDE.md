# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npm run electron:build   # Build production NSIS installer → dist-electron/

# Database
npx prisma migrate dev --name <name>   # Create and apply a migration (also runs prisma generate)
npx prisma generate                     # Regenerate client after schema changes without migrating
npx prisma db seed                      # Seed with mock data (uses prisma/seed.ts via tsx)
npx prisma studio                       # Visual DB browser
npx tsx prisma/bootstrap.ts            # Create/reset the initial admin superuser (admin/admin, forced password change)

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

### Session cookie requires HTTPS in production — and this app is deployed over plain HTTP by design

All three auth routes (`login`, `change-password`, `logout`) issue the session cookie through shared helpers in `src/lib/auth.ts` (`setSessionCookie`, `signSessionToken`, `clearSessionCookie`, `getSessionCookieOptions`) so the cookie name and options can't drift between routes. `secure` is `true` only when **both** `NODE_ENV === "production"` **and** `REQUIRE_HTTPS === "true"` — it is not on by default in production. This is intentional: the documented field-access architecture (`MANUAL_Setup_Installation.md` §7) is **router port forwarding + Dynamic DNS** (e.g. `http://<client>.duckdns.org:3000/field`), chosen specifically to avoid Tailscale's per-seat subscription cost, and DDNS-over-port-forwarding is plain `http://`, not `https://`. Leave `REQUIRE_HTTPS` unset for this deployment path — setting it to `true` without an actual HTTPS front end (e.g. a reverse proxy) will silently break field-tech logins: the browser will refuse to persist a `Secure` cookie over `http://`, so the login page loads and appears to submit but the user is bounced back to `/login` with no error. The Electron desktop app is unaffected either way (it loads `http://localhost:3000`, which browsers always trust).

**Known accepted tradeoff:** because there is no HTTPS in this architecture, login credentials and the session cookie travel unencrypted once traffic leaves the office LAN (i.e. over the public internet leg of the DDNS/port-forward path). This was a deliberate cost/complexity tradeoff, not an oversight — see `docs/launch-checklist.md` Phase 4 for the history (Tailscale and raw-LAN-IP were tried first and abandoned). If a customer needs this closed, the fix is a free reverse proxy with automatic HTTPS (e.g. Caddy) in front of port 3000, not relaxing anything in this app's cookie logic — that would need its own port-forward rule (80) and is not currently set up for any customer.

### Forced password change flow

`User.mustChangePassword` (Boolean, default false) is embedded in the JWT at login. `src/middleware.ts` redirects any authenticated request to `/change-password` when the flag is set, except for `/change-password` itself and `/api/auth/change-password`. The change-password API (`POST /api/auth/change-password`) validates the new password, updates the hash, sets `mustChangePassword = false`, and re-issues the JWT. The initial superuser created by `prisma/bootstrap.ts` ships with this flag set.

### Electron desktop app

The app is packaged as a Windows desktop application using Electron + electron-builder.

- `electron/main.js` — Electron main process. In **dev** mode (`!app.isPackaged`), it does nothing with the server (Next.js dev is started by `electron-dev.js`) and reads the port from `ELECTRON_DEV_PORT`. In **production**, it first probes port 3000 (`isServerUp()`): **if a server is already answering there it reuses it and does NOT boot its own**, otherwise it `require()`s the Next.js standalone `server.js` inline (Electron's main process IS Node.js). Then it waits for the server to respond on port 3000 and opens the window. This reuse check exists because the always-on PM2 field-tech service (`whitevanops`) already holds port 3000 on the office server — without it, the desktop app tried to bind a second server on the same port and stalled on startup (the window eventually opened only because the health-check saw PM2's server). So on the office machine the desktop app is a thin window onto the PM2 server; on a machine with no PM2 server it self-boots as before. Packaged builds also call `app.setPath('userData', %APPDATA%\whitevanops\profile)` before ready so they never share the dev Chromium profile (`%APPDATA%\white-van-ops`) — shared-profile leakage (stale service workers/cookies from dev) caused the 2026-07-10 "not valid JSON" packaged-install bug.
- `electron/postgres.js` — bundled-PostgreSQL lifecycle. The installer ships portable PostgreSQL 17.6 binaries from the project's `pgsql/` dir (gitignored, ~133 MB — see MANUAL_Setup_Installation.md §1 to recreate) plus `resources/db/schema.sql` (Prisma migrations concatenated by `electron-build.js`). On launch it: generates `resources/nextjs/.env.local` with unique random credentials if missing; skips entirely when the `DATABASE_URL` port already has a listener (office PM2 machine) or the host isn't localhost; **throws** (surfaced by `main.js` as a startup-error dialog) when the URL is localhost, the port is free, and the bundled binaries are missing — booting the web server anyway would just 500 every query ("Failed to load dashboard data", 2026-07-12); otherwise initdb's `%APPDATA%\whitevanops\pgdata` on first run, starts PG via `pg_ctl` (127.0.0.1 only), applies schema, and bootstraps admin/admin. A `bootstrap-complete` sentinel gates first-run; failures wipe pgdata and retry next launch. **Gotcha:** `pg_ctl start`/`stop` must run with `stdio: 'ignore'` — the postgres daemon inherits piped stdio and `execFileSync` hangs forever.
- `electron/loading.html` — Frameless splash screen shown while the server starts (inline copy of the logo SVG).
- `public/logo.svg` is the brand master; `node scripts/generate-icons.js` regenerates `public/logo.png`, PWA icons (`public/icons/`), `apple-touch-icon.png`, and `src/app/favicon.ico` (requires devDeps `sharp` + `png-to-ico`).
- PWA: `src/app/manifest.ts` (start_url `/field`, standalone display). Middleware `PUBLIC_PATHS` whitelists `/logo.png`, `/icons`, `/apple-touch-icon.png`, `/manifest.webmanifest` — brand/PWA assets must be reachable without a session or the login-page logo and phone installs break.
- Dashboard sidebar → **Field Access QR** (`FieldAccessModal.tsx`) renders a QR of the field URL (editable, persisted in localStorage) so techs can scan and install `/field` as a home-screen app.
- `scripts/electron-dev.js` — Spawns `next dev`, detects the actual port from stdout, sets `ELECTRON_DEV_PORT`, then spawns Electron.
- `scripts/electron-build.js` — Runs `next build`, copies `.next/static` and `public/` into the standalone output, copies `.env.local` into the bundle (optional — generated at first launch if absent), generates `.next/db/schema.sql` from the migrations, then calls `electron-builder --win`. It **hard-fails** if `pgsql/bin/pg_ctl.exe` is missing before packaging, and after packaging asserts that `win-unpacked/resources/pgsql/bin/pg_ctl.exe` and `resources/nextjs/node_modules/next` exist — electron-builder silently skips missing extraResources sources, which once shipped a DB-less installer.
- The `build` key in `package.json` holds the electron-builder config. The standalone Next.js output lands in `resources/nextjs/` inside the installed app. `next.config.ts` sets `output: "standalone"` and pins `outputFileTracingRoot` to the project directory — **do not remove this.** Without it, Next.js can misinfer the workspace root if a stray lockfile exists in a parent directory (e.g. `C:\Users\<name>\package-lock.json`), which nests the real `.next/standalone/server.js` under an extra path segment. `electron-builder` copies the flat `.next/standalone` into `resources/nextjs`, and `electron/main.js` requires `server.js` directly at that flat path, so a misinferred root silently produces an installer that fails to launch. Verify after any `next.config.ts` change: `Test-Path .next\standalone\server.js` should be `True`.
- **extraResources node_modules gotcha:** electron-builder silently skips `node_modules` inside extraResources copies. The `{"from": ".next/standalone", "to": "nextjs"}` entry alone produces a packaged server that dies with `Cannot find module 'next'` — this went unnoticed for a while because the office machine always reuses the PM2 server instead of self-booting. The fix is the second explicit entry `{"from": ".next/standalone/node_modules", "to": "nextjs/node_modules", "filter": ["**/*"]}` in `package.json` — do not remove it. After any build-config change verify `dist-electron/win-unpacked/resources/nextjs/node_modules/next` exists.
- **Installer output:** `dist-electron/WhiteVanOps Setup x.x.x.exe` — NSIS, creates desktop shortcut + Start Menu entry automatically. Bundles portable PostgreSQL (see `electron/postgres.js` above) — fully self-contained on machines with no existing database.
- **Deploying to a new machine:** build the installer with the correct `.env.local` present so credentials are bundled, or have IT place `.env.local` at `<install dir>/resources/nextjs/.env.local` after installation.
- **Distributing to multiple customers:** each customer needs their own unique `SESSION_SECRET` and database credentials — never reuse the same secret across customer installs. `electron-build.js` bundles `.env.local` into the `.exe`, so a shared secret would ship inside a file handed to more than one company, and there's no reason to share it since every customer runs an isolated server/database. Generate a fresh secret per customer (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) and either rebuild the installer per customer or configure `.env.local` on-site after installing a generic build. See `MANUAL_Setup_Installation.md` §3.
- **No Docker deploy path:** an earlier, half-finished Docker deployment scaffold (`docker-compose.yml`, `Dockerfile`, `deploy/`) predated real user auth and was removed — it assumed a hardcoded `APP_USERNAME`/`APP_PASSWORD` login the app hasn't used since auth became the `User` table + JWT session (see Auth helpers below). The Electron installer + native PostgreSQL path documented above is the only deploy path. Automated backups are handled by the built-in Settings → Database Backup & Recovery feature (`electron/backup.js`), not a standalone script.

### License / Plus tier

The app runs as one codebase in two plans, gated at runtime by a DB flag (not separate builds): **Base** and **Plus** (CRM notes/follow-ups, Analytics tab, Invoicing tab). Key pieces:

- `License` model in `prisma/schema.prisma` — singleton row with fixed id `"singleton"`, **upserted on read** by `src/lib/license.ts` (`getLicense()`), so every install path self-heals without a seed step. Fields: `tier` ("base"|"plus"), `licenseKey`, `notes`, `activatedAt`, `expiresAt` (null = perpetual).
- `src/lib/license.ts` mirrors `auth.ts`'s shape: `hasPlusLicense()` (tier is plus **and** unexpired), `requirePlus(licensed)` returns a `403 NextResponse` or `null`. It is called explicitly alongside `requireRole` in every Plus route — deliberately not folded into `requireRole`, so `requirePlus` stays greppable as the complete list of Plus-gated routes.
- **Every Plus API route gates server-side** (`/api/clients/[id]/notes`, `/api/clients/[id]/follow-ups`, `/api/follow-ups/[id]`, `/api/analytics`, `/api/invoices/**`, and the Plus-data branches of `/api/dashboard`). The UI hiding tabs is convenience only, not security.
- `/api/dashboard` returns `license: { tier, expiresAt, plus }` in `DashboardData` and only populates Plus data (client `notes`/`followUps` includes, `invoices`) when licensed — a downgraded install doesn't leak Plus data through the full-reload pattern.
- `GET/POST /api/license` — GET is admin/superuser; POST (plan change) is **superuser-only** + audited. UI: Settings → License & Plan (`SettingsTab.tsx`). Cryptographically validated offline signature, bound to the machine-locked base activation key.
- Downgrade/expiry hides tabs and 403s the APIs but never deletes Plus data. All Plus tables ship in the normal migration set to every install and stay empty until licensed. If database is tampered (manually set to plus), `getLicense` self-heals by reverting to base.
- Invoicing: statuses Draft → Sent (manual) → PartiallyPaid/Paid (derived from payments in `src/lib/invoice.ts`, never set by hand) or Void; numbering via a `SystemSetting` counter (`invoice_next_number`) incremented in the same transaction as the create; PDF via `pdf-lib` (pure JS — chosen over puppeteer for Electron installer size). Charts: Recharts.

### Trial/Demo installer (separate mechanism from the License/Plus tier above)

`npm run electron:build:trial` builds a fourth installer variant (`WhiteVanOps-Trial-Setup.exe`) for sales demos — pre-activated on Plus so a prospect can evaluate everything, but locked to 30 days from first launch regardless of `License.tier`. This is orthogonal to the Base/Plus gate: a normal customer install never has a trial lock at all.

- `src/lib/trial.ts` — `getTrialStatus()` reads/lazily-creates a signed, machine-bound anchor file (`%APPDATA%\whitevanops\trial.json`, HMAC'd with the same `LICENSE_SIGNING_SECRET`) and computes `isLocked`. No-op (zero file I/O) unless the build was stamped with `WVO_IS_TRIAL=true`. The shared HMAC signing/verification helpers (`LICENSE_SIGNING_SECRET`, `getAppDataWvoDir`, `signTrialUnlock`, `verifyTrialUnlock`, `timingSafeEqualStrings`) live in the leaf module `src/lib/licenseCrypto.ts` — imported by both `license.ts` and `trial.ts` to avoid a would-be import cycle.
- Trial builds skip the native Electron base-activation window entirely (`electron/main.js`'s `isTrialBuild()` reads `WVO_IS_TRIAL="true"` from the bundled `.env.local` and bypasses `verifyLicenseSilent()`/`showActivationWindow()`) — a fresh trial install boots straight to password login, no `WVO-XXXX-XXXX-XXXX-XXXX` key or Firestore lookup required. Base/Plus customer builds are unaffected; they still require the native activation key.
- After a day-30 unlock, the key's own tier — base or plus — determines which features run, not the trial's pre-activated-Plus default: `getLicense()` treats a signature- and machine-verified `trial-unlock.json` as the highest-precedence tier source (see `src/lib/license.ts`'s `getVerifiedTrialUnlock()`). A base-tier unlock key correctly drops Plus features; a plus-tier key keeps them.
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

### Field page

`/app/field/page.tsx` is a standalone mobile-optimized view. It fetches `/api/field` independently (does not use `useDashboardData`). On mount it also fetches `/api/auth/me` — if the session user has a `personnelId`, that tech is auto-selected and the personnel picker is skipped.
