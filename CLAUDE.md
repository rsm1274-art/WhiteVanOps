# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Start Next.js dev server (http://localhost:3000)
npm run build            # Production Next.js build
npm run lint             # ESLint
npx tsc --noEmit         # Type check without building

# Electron desktop app
npm run electron:dev     # Start Next.js dev + open Electron window (do this instead of npm run dev for UI work)
npm run electron:build   # Build production NSIS installer → dist-electron/

# Database
npx prisma migrate dev --name <name>   # Create and apply a migration (also runs prisma generate)
npx prisma generate                     # Regenerate client after schema changes without migrating
npx prisma db seed                      # Seed with mock data (uses prisma/seed.ts via tsx)
npx prisma studio                       # Visual DB browser
npx tsx prisma/bootstrap.ts            # Create/reset the initial admin superuser (admin/admin, forced password change)
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

**Stack:** Next.js 16 App Router · TypeScript · Tailwind v4 · PostgreSQL via Prisma + `@prisma/adapter-pg` · `jose` for JWT · `bcryptjs` for passwords · Electron 42 (desktop shell)

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

### Session cookie requires HTTPS in production

All three auth routes (`login`, `change-password`, `logout`) issue the session cookie through shared helpers in `src/lib/auth.ts` (`setSessionCookie`, `signSessionToken`, `clearSessionCookie`, `getSessionCookieOptions`) so the cookie name and options can't drift between routes. `secure` is `true` only when **both** `NODE_ENV === "production"` **and** `REQUIRE_HTTPS === "true"` — it is not on by default in production, so a fresh production deploy still works over plain LAN `http://` until you explicitly opt in. Once you set `REQUIRE_HTTPS=true`, browsers will only persist the cookie over HTTPS or on `localhost` — a client hitting the server over plain `http://<lan-ip>:3000` (or any non-localhost HTTP origin) will see the login page load and appear to submit, but the cookie never gets stored, so the user is silently bounced back to `/login` with no error. The Electron desktop app is unaffected (it loads `http://localhost:3000`, which browsers trust). Field techs and any other browser-based access must go through HTTPS before you set `REQUIRE_HTTPS=true` — the deployed fix is `tailscale serve`, which reverse-proxies the app behind an auto-provisioned trusted cert at `https://<device>.<tailnet>.ts.net`, rather than relaxing the cookie's `Secure` flag.

### Forced password change flow

`User.mustChangePassword` (Boolean, default false) is embedded in the JWT at login. `src/middleware.ts` redirects any authenticated request to `/change-password` when the flag is set, except for `/change-password` itself and `/api/auth/change-password`. The change-password API (`POST /api/auth/change-password`) validates the new password, updates the hash, sets `mustChangePassword = false`, and re-issues the JWT. The initial superuser created by `prisma/bootstrap.ts` ships with this flag set.

### Electron desktop app

The app is packaged as a Windows desktop application using Electron + electron-builder.

- `electron/main.js` — Electron main process. In **dev** mode (`!app.isPackaged`), it does nothing with the server (Next.js dev is started by `electron-dev.js`) and reads the port from `ELECTRON_DEV_PORT`. In **production**, it first probes port 3000 (`isServerUp()`): **if a server is already answering there it reuses it and does NOT boot its own**, otherwise it `require()`s the Next.js standalone `server.js` inline (Electron's main process IS Node.js). Then it waits for the server to respond on port 3000 and opens the window. This reuse check exists because the always-on PM2 field-tech service (`whitevanops`) already holds port 3000 on the office server — without it, the desktop app tried to bind a second server on the same port and stalled on startup (the window eventually opened only because the health-check saw PM2's server). So on the office machine the desktop app is a thin window onto the PM2 server; on a machine with no PM2 server it self-boots as before.
- `electron/postgres.js` — bundled-PostgreSQL lifecycle. The installer ships portable PostgreSQL 17.6 binaries from the project's `pgsql/` dir (gitignored, ~133 MB — see MANUAL_Setup_Installation.md §1 to recreate) plus `resources/db/schema.sql` (Prisma migrations concatenated by `electron-build.js`). On launch it: generates `resources/nextjs/.env.local` with unique random credentials if missing; skips entirely when the `DATABASE_URL` port already has a listener (office PM2 machine) or the host isn't localhost; otherwise initdb's `%APPDATA%\whitevanops\pgdata` on first run, starts PG via `pg_ctl` (127.0.0.1 only), applies schema, and bootstraps admin/admin. A `bootstrap-complete` sentinel gates first-run; failures wipe pgdata and retry next launch. **Gotcha:** `pg_ctl start`/`stop` must run with `stdio: 'ignore'` — the postgres daemon inherits piped stdio and `execFileSync` hangs forever.
- `electron/loading.html` — Frameless splash screen shown while the server starts (inline copy of the logo SVG).
- `public/logo.svg` is the brand master; `node scripts/generate-icons.js` regenerates `public/logo.png`, PWA icons (`public/icons/`), `apple-touch-icon.png`, and `src/app/favicon.ico` (requires devDeps `sharp` + `png-to-ico`).
- PWA: `src/app/manifest.ts` (start_url `/field`, standalone display). Middleware `PUBLIC_PATHS` whitelists `/logo.png`, `/icons`, `/apple-touch-icon.png`, `/manifest.webmanifest` — brand/PWA assets must be reachable without a session or the login-page logo and phone installs break.
- Dashboard sidebar → **Field Access QR** (`FieldAccessModal.tsx`) renders a QR of the field URL (editable, persisted in localStorage) so techs can scan and install `/field` as a home-screen app.
- `scripts/electron-dev.js` — Spawns `next dev`, detects the actual port from stdout, sets `ELECTRON_DEV_PORT`, then spawns Electron.
- `scripts/electron-build.js` — Runs `next build`, copies `.next/static` and `public/` into the standalone output, copies `.env.local` into the bundle (optional — generated at first launch if absent), generates `.next/db/schema.sql` from the migrations, then calls `electron-builder --win`.
- The `build` key in `package.json` holds the electron-builder config. The standalone Next.js output lands in `resources/nextjs/` inside the installed app. `next.config.ts` sets `output: "standalone"` and pins `outputFileTracingRoot` to the project directory — **do not remove this.** Without it, Next.js can misinfer the workspace root if a stray lockfile exists in a parent directory (e.g. `C:\Users\<name>\package-lock.json`), which nests the real `.next/standalone/server.js` under an extra path segment. `electron-builder` copies the flat `.next/standalone` into `resources/nextjs`, and `electron/main.js` requires `server.js` directly at that flat path, so a misinferred root silently produces an installer that fails to launch. Verify after any `next.config.ts` change: `Test-Path .next\standalone\server.js` should be `True`.
- **extraResources node_modules gotcha:** electron-builder silently skips `node_modules` inside extraResources copies. The `{"from": ".next/standalone", "to": "nextjs"}` entry alone produces a packaged server that dies with `Cannot find module 'next'` — this went unnoticed for a while because the office machine always reuses the PM2 server instead of self-booting. The fix is the second explicit entry `{"from": ".next/standalone/node_modules", "to": "nextjs/node_modules", "filter": ["**/*"]}` in `package.json` — do not remove it. After any build-config change verify `dist-electron/win-unpacked/resources/nextjs/node_modules/next` exists.
- **Installer output:** `dist-electron/WhiteVanOps Setup x.x.x.exe` — NSIS, creates desktop shortcut + Start Menu entry automatically. Bundles portable PostgreSQL (see `electron/postgres.js` above) — fully self-contained on machines with no existing database.
- **Deploying to a new machine:** build the installer with the correct `.env.local` present so credentials are bundled, or have IT place `.env.local` at `<install dir>/resources/nextjs/.env.local` after installation.
- **Distributing to multiple customers:** each customer needs their own unique `SESSION_SECRET` and database credentials — never reuse the same secret across customer installs. `electron-build.js` bundles `.env.local` into the `.exe`, so a shared secret would ship inside a file handed to more than one company, and there's no reason to share it since every customer runs an isolated server/database. Generate a fresh secret per customer (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) and either rebuild the installer per customer or configure `.env.local` on-site after installing a generic build. See `MANUAL_Setup_Installation.md` §3.
- **No Docker deploy path:** an earlier, half-finished Docker deployment scaffold (`docker-compose.yml`, `Dockerfile`, `deploy/`) predated real user auth and was removed — it assumed a hardcoded `APP_USERNAME`/`APP_PASSWORD` login the app hasn't used since auth became the `User` table + JWT session (see Auth helpers below). The Electron installer + native PostgreSQL path documented above is the only deploy path. Automated backups are handled by the built-in Settings → Database Backup & Recovery feature (`electron/backup.js`), not a standalone script.

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
4. After the DB write succeeds, call `audit(user!.userId, "CREATE"|"UPDATE"|"DELETE", "EntityName", entityId)`

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

### Field page

`/app/field/page.tsx` is a standalone mobile-optimized view. It fetches `/api/field` independently (does not use `useDashboardData`). On mount it also fetches `/api/auth/me` — if the session user has a `personnelId`, that tech is auto-selected and the personnel picker is skipped.
