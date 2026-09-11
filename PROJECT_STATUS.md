# WhiteVanOps — Project Status Summary

*As of July 19, 2026, with a v2.0 update appended September 2026 — see Phase 15 and the
"Current State" table, which reflects v2.0. Phases 1–14 below are the historical build log and
are left as originally written even where later superseded (e.g. the Base/Plus tier and the
Cloudflare tunnel, both removed in v2.0) — each such phase is a true account of what shipped at
the time.*

---

## Where We Started

The project began as a concept for a **field operations management tool** for a small business that runs a fleet of service vans. The owner needed a way to manage jobs, clients, crew, fleet, and inventory — and export data to QuickBooks without doing any double-entry.

An initial planning session produced the **`implementation_plan.md`** document, which laid out:

- The "no invoicing/payroll execution" scope (QuickBooks handles that)
- The full entity-relationship schema
- The tech stack: **Next.js App Router · TypeScript · Tailwind CSS · PostgreSQL via Prisma**
- A "Explain Then Code" protocol to keep the build deliberate

---

## Iterations

### Phase 1 — Schema & Data Model
- Defined all core Prisma models: `Client`, `Job`, `Personnel`, `Vehicle`, `MaintenanceLog`, `InventoryItem`, `StockLocation`, `StockLevel`, `JobAssignment`, `JobLineItem`, `TimeEntry`
- Established QB sync status fields (`qbInvoiceSyncStatus`, `qbTimeSyncStatus`) on exportable entities to prevent duplicate exports
- PostgreSQL on port 5433 (non-standard); Prisma v7 config-file pattern (`prisma.config.ts`)

### Phase 2 — Dashboard & Core UI
- Built the **admin dashboard** at `/` with a tabbed layout:
  - **Overview** — summary KPIs and job status snapshot
  - **Scheduling** — calendar/date-filter job view
  - **CRM** — client records
  - **Fleet** — vehicle status and maintenance logs
  - **Personnel** — crew records, qualifications, time-off
  - **Inventory** — stock levels across warehouse and van locations
  - **Accounting** — QB CSV export and sync lock
- All modal state managed as a single `ModalType` string (not 11 booleans)
- Full dashboard refresh on every mutation via `useDashboardData` hook — no per-entity caching
- Confirmation dialogs on destructive/irreversible actions (cancel job, complete job, mark synced)

### Phase 3 — Modals & Write Operations
Built 14 modal components covering the full CRUD surface:

| Modal | Purpose |
|---|---|
| `AddJobModal` | Create a job with crew/equipment/line-item assignment |
| `AllocateResourcesModal` | Assign crew, vehicle, and equipment to an existing job |
| `LogTimeModal` | Log hours + minutes for a technician against a job |
| `JobCostsModal` | View/add line items and job cost breakdown |
| `AddClientModal` | Add a CRM client record |
| `AddPersonnelModal` / `EditPersonnelModal` | Add/edit crew members, qualifications, time-off |
| `AddVehicleModal` | Add a vehicle to the fleet |
| `AddMaintenanceModal` | Log a maintenance event against a vehicle |
| `ReportRepairModal` | File a repair record for a vehicle or piece of equipment |
| `AddEquipmentModal` | Add a tracked equipment asset |
| `AddItemModal` | Add an inventory catalog item |
| `AdjustStockModal` | Adjust quantity at a specific stock location |
| `ManageUsersModal` | Superuser-only user management |

### Phase 4 — Authentication & Role System
Added a full auth layer:

- **Three roles:** `superuser` (full access + user management), `admin` (all ops including inventory), `tech` (field page only)
- `User` model with `bcryptjs` password hashes, optional `personnelId` link to a Personnel record
- JWT sessions via `jose`, stored in an `HttpOnly` cookie
- `src/lib/auth.ts` — `getSessionUser()` / `requireRole()` helpers on all write routes
- `src/lib/audit.ts` — fire-and-forget audit log on every CREATE/UPDATE/DELETE
- `src/middleware.ts` — enforces role-based route access; intercepts `mustChangePassword` flag
- **Forced password change flow** — new accounts (especially the bootstrap superuser) must change password on first login
- Bootstrap script (`prisma/bootstrap.ts`) creates the initial `admin/admin` superuser
- Seed script creates demo users: `dispatcher/dispatch123` (admin), `tech.dave/tech123`, `tech.trent/tech123`
- `ManageUsersModal` — superuser-only panel to create/deactivate user accounts and link them to Personnel records

### Phase 5 — Field Tech Module
Built a standalone mobile-optimized view at `/field`:

- Separate data fetch from `/api/field` (does not share dashboard state)
- On mount, fetches `/api/auth/me`; if session has a `personnelId`, that tech is auto-selected and the personnel picker is skipped
- Techs can only log time for their own linked personnel record
- Techs can only update status on jobs they are assigned to

### Phase 6 — Extended Fleet & Equipment
- Added `RepairRecord` model — tracks open/resolved repairs for both vehicles and equipment
- Added `Equipment` model — serialized equipment assets assignable to jobs via `JobEquipment`
- `PersonnelQualification` — structured tags (Certification, License, Skill, Other) with issuer, expiry, notes
- `PersonnelTimeOff` — date-range time-off records per crew member

### Phase 7 — Electron Desktop App
Packaged the entire app as a **Windows desktop installer**:

- `electron/main.js` — Electron main process; in production it boots the Next.js standalone server inline then opens the window
- `electron/loading.html` — splash screen while the server starts
- `scripts/electron-dev.js` — dev launcher that spawns `next dev`, detects the port, then spawns Electron
- `scripts/electron-build.js` — production build script: `next build` → copy statics → bundle `.env.local` → `electron-builder --win`
- Output: `dist-electron/WhiteVanOps Setup x.x.x.exe` (NSIS, desktop shortcut + Start Menu)
- Credentials/DB connection string bundled via `.env.local` at build time

### Phase 8 — Manuals
Three end-user manuals maintained alongside the codebase:

- `MANUAL_Setup_Installation.md` — env vars, DB setup, migration steps, Electron build/deploy
- `MANUAL_Administrator.md` — every tab, modal, and workflow available to admin/superuser
- `MANUAL_Field_Tech.md` — field module UI, job status transitions, time logging

### Phase 9 — Security Hardening & Git Hygiene (July 4–5, 2026)

A full-folder security review (`CODE_REVIEW_2026-07-04.md`) turned up a live Firebase admin credential in the repo and several real vulnerabilities; all were fixed and verified end-to-end, not just patched:

- **Firebase service-account key rotated and relocated** out of the project folder (`%APPDATA%\whitevanops-secrets\`), referenced via `WVO_FIREBASE_SERVICE_ACCOUNT`; `scripts/license-manager.js` now loads it via `dotenv`
- **App is now a private git repository** (`github.com/rsm1274-art/whitevanops-app`) — separate from the public marketing-site repo — with a `husky` + `scripts/scan-secrets.js` pre-commit hook as a secret-scanning backstop
- **Session cookie `Secure` flag divergence fixed**: `login`, `change-password`, and `logout` now issue the cookie through shared helpers in `src/lib/auth.ts` so the three routes can't drift out of sync again
- **Backup route command injection fixed**: `src/app/api/settings/backup/route.ts` switched from `exec()` with a shell string to `execFile()` with an argument array; also fixed a separate bug (unrelated to the injection issue) where `pg_dump` rejected Prisma's `?schema=` query parameter, which had made the backup feature non-functional
- **Login brute-force protection added**: per-account lockout (5 failed attempts → 15-minute lock, persisted on `User.failedLoginAttempts`/`lockedUntil`) plus a per-IP rate limit (`src/lib/rateLimit.ts`)
- **Authorization bug fixed**: a tech account with no linked `personnelId` could previously update the status of *any* job, not just their own assignments (`src/app/api/jobs/route.ts`)
- **Password validation centralized**: `src/lib/password.ts` now enforces a minimum-strength rule on self-service password changes *and* admin-created/reset user passwords (previously the admin path had no validation at all)
- **Removed the FRP (Fast Reverse Proxy) tunnel feature entirely** — it auto-started on every launch with a hardcoded secret, was never actually wired into the production build (no `extraResources` entry shipped it into the installer), and had drifted out of sync with the manuals, which already documented Port Forwarding + Dynamic DNS as the real field-access path. `MANUAL_Setup_Installation.md` §7 was rewritten as a complete, step-by-step per-customer guide (CGNAT detection, DHCP reservation, port forwarding, Windows Firewall, DuckDNS with a Scheduled Task updater, and the correct off-LAN verification method) — the plain-HTTP tradeoff this implies is documented explicitly, not left implicit
- **Removed the stale Docker deployment scaffold** (`docker-compose.yml`, `Dockerfile`, `deploy/`) — a half-finished path from before real user auth existed, fully superseded by the Electron installer + native PostgreSQL path and the built-in backup feature

### Phase 10 — Automated Test Coverage (July 5, 2026)

Added Vitest (`vitest.config.ts`) with 36 tests across the pure-logic `src/lib/` modules: `dateUtils` (local-noon date parsing), `recurrence` (weekly/biweekly/monthly cadence advancement), `jobConflicts` (all six conflict branches plus edit-exclusion scoping, with `@/lib/db` mocked), and `auth` (cookie security options, JWT sign/verify round trip, role enforcement, with `next/headers` mocked). This is a starting baseline, not comprehensive coverage — there is still no coverage of the API routes themselves, no component tests, and no end-to-end tests. Run via `npm test`.

### Phase 11 — Cryptographic Offline Licensing (July 9, 2026)

Implemented a secure, offline cryptographic licensing model for the Plus tier upgrade:
- **Offline Signature Validation**: Added platform-specific AppData directory resolution and HMAC-SHA256 signature verification in `src/lib/license.ts` bound to the machine-locked base activation key.
- **Auto-Upgrade & Self-Healing**: Database auto-upgrades when `plus_license.json` is detected locally, and automatically self-heals (downgrades) back to Base if the database is tampered with without a valid license file.
- **Reworked UI**: Replaced Settings tab Plan dropdown with active License Key display, Copy button, upload zone, text area for JSON payload, and confirmable downgrade controls.
- **CLI Minting Script**: Added `--plus` offline mode to `scripts/license-manager.js` to mint signed Plus upgrade payloads for any base key.
- **Multi-Target Installer builds**: Upgraded the pipeline (`scripts/electron-build.js`) to clean build-only artifacts and compile:
  - `WhiteVanOps-Setup.exe` (customer installer — serves **both** Base and Plus; the activation key's tier decides which, so there is no separate Plus build)
  - `WhiteVanOps-Plus-Upgrade.exe` (lightweight, native upgrade patch executable compiled via `csc.exe` on the fly)
  - **Superseded 2026-07-24:** Base and Plus are now separate installers (`WhiteVanOps-Base-Setup.exe` / `WhiteVanOps-Plus-Setup.exe`; trials `WhiteVanOps-{Base,Plus}-Trial-Setup.exe`); the in-place Plus upgrade patch above is gone — see `MANUAL_Setup_Installation.md` §6.

### Phase 12 — Field Sync Stuck-Record Resolution (July 15, 2026)

Offline field techs can produce sync ops that permanently fail (deleted parent record, stale reference, etc.) and previously stalled the entire IndexedDB sync queue forever. Added a `stuckOps` quarantine store (IDB v2) that classifies rejections as permanent/auth/transient and drains the queue past permanent failures instead of blocking on them; techs get a client-side resolution panel (discard/retarget/handoff) gated by an acknowledgement invariant, and unresolved handoffs surface to admins as a `SyncReviewItem` with a dashboard review card/modal (`POST /api/field/sync-resolution`, `/api/sync-review/[id]`). Also fixed a duplicate-submission bug from concurrent `drainSyncQueue` runs and deleted a divergent, never-fired background-sync copy of the drain logic in `public/sw.js`.

### Phase 13 — License Tier Bound to Signed Key; Trial/Demo Installer (July 15–16, 2026)

- **Tier now lives inside the signed activation key**, not a plaintext env var: `WVO_DEFAULT_TIER` (which let anyone edit `.env.local` in Notepad to unlock Plus) was removed entirely. `scripts/license-manager.js` mints `tier` into the key at vendor-side mint time; `electron/main.js` bakes it into the machine-bound, HMAC-signed `license.json` at activation. Legacy pre-tier license files still verify and read back as Base. See `CLAUDE.md` "License / Plus tier" for the full precedence chain.
- **Trial/Demo installer** (`npm run electron:build:trial` → `WhiteVanOps-Trial-Setup.exe`): pre-activated on Plus for sales demos, locked 30 days from first launch via a separate signed `trial.json` anchor (`src/lib/trial.ts`), independent of the License/Plus gate above. Skips native activation entirely — boots straight to login. Conversion (`POST /api/license` `unlock-trial`) verifies against the machine's real ID and sets `License.tier` to whatever the purchased key grants (Base or Plus), not the trial's pre-activated Plus default. **Superseded 2026-07-24:** trial installers are now split by tier (`WhiteVanOps-Base-Trial-Setup.exe` / `WhiteVanOps-Plus-Trial-Setup.exe`) rather than one Plus-preactivated build — see `MANUAL_Setup_Installation.md` §6.
- **In-app data import**: the existing CLI onboarding-import engine (`src/lib/import/`) is now also reachable from Settings → Onboarding Data Import (superuser-only), sharing validation/dry-run/commit logic with `scripts/import/analyze.ts` and `run.ts`.
- **Server-identity health probe**: `GET /api/health` returns `{ app: "whitevanops" }` so `electron/main.js` can tell a real WhiteVanOps server apart from a foreign listener on port 3000 (e.g. a Docker container) before deciding to reuse it or self-boot on a free port.
- **Admin recovery tooling**: `scripts/recovery/reset-admin-password.ps1`/`.js` reset or recreate the admin/superuser account on a customer machine with no Node/repo installed, by borrowing the Node runtime bundled inside the installed Electron binary (`ELECTRON_RUN_AS_NODE=1`).

### Phase 14 — Installer Size & Packaging Hardening (July 15–19, 2026)

- **Base installer halved**: 274 MB → 156 MB (`app.asar` 477 MB/242 modules → 123 MB/51). electron-builder bundles everything left in `package.json` `dependencies` into `app.asar` regardless of `files` globs, duplicating what Next.js file tracing already ships in `resources/nextjs/node_modules`; only the five packages `electron/*.js` bare-requires (`bcryptjs`, `firebase`, `node-cron`, `node-machine-id`, `pg`) now stay in `dependencies`. `electron-build.js` step 7c hard-fails the build if a required module is missing from the packaged asar.
- **Linux build target removed** — it had never produced a shipped artifact.
- **Fixed a packaged-installer login 500**: Next 16 defaulted to Turbopack, which emitted an unresolvable external require for the Prisma client, and the standalone output trace didn't copy Prisma 7's runtime packages either way. `npm run build` now runs `prisma generate && next build --webpack`, and `next.config.ts`'s `outputFileTracingIncludes` explicitly lists the Prisma runtime closure; `electron-build.js` step 7b asserts those directories landed in the packaged output. See `CLAUDE.md` for the full writeup.

### Phase 15 — v2.0: One Product, WiFi-Only Sync, Idempotent Field Writes, Export/Import Recovery (September 2026)

A seven-phase, documentation-included effort that removed the Base/Plus tier and the Cloudflare
tunnel, and replaced the field module's write path with an idempotent, authorization-explicit
architecture. See `HANDOFF_2026-09-11-v2-wifi-sync-and-export-recovery.md` for the full writeup,
including what's still unverified by hand.

- **One product.** No more Base/Plus split — every activated install runs the full feature set
  (CRM notes/follow-ups, Analytics, Invoicing, Quoting, and the Report Builder that landed
  alongside macOS support). `License.tier` is gone from the schema; `hasPlusLicense()`/
  `requirePlus()` are gone from the code. One installer per platform, not two.
- **WiFi-only transport, permanently.** The Cloudflare tunnel is fully removed — no `cloudflared`
  binary, no tunnel runbook, no remote/cellular access story at all. The field module is reachable
  only on the office LAN or via `localhost`. `fieldUrlVerdict()` now returns `"localhost"` /
  `"ok-lan"` / `"not-lan"`, with no tier-aware branch.
- **Quotes are PDF-only.** The public customer-facing approval link (`/quote/[token]`,
  `/api/public/quotes/[token]`, `Quote.publicToken`) is removed — it depended on the tunnel to be
  reachable off-LAN. The operator now marks a Sent quote Accepted/Declined by hand as the only
  path; `canRespondToQuote()` still gates it. This also removed the app's only unauthenticated
  data surface.
- **New field-write architecture.** `POST /api/field/ops` replaces the old split across
  `POST /api/time` and `PUT /api/jobs`; every write carries a client-generated `opId`
  (`src/lib/opId.ts`) and is applied idempotently by `src/lib/fieldOps.ts` against a new
  `AppliedOp` table, with an ordering guard (`src/lib/opOrdering.ts`) for replace-semantics writes.
  This also fixed a real, previously-live bug: techs could not actually save job notes or
  materials before v2.0 (the old route 403'd those fields for tech role, and that 403 was
  misclassified as an auth failure that halted the entire offline sync queue). IndexedDB moved to
  schema v4, adding a 30-day `history` store of synced ops.
- **Export/import recovery**, a new feature: a tech can export a JSON snapshot of their queued,
  stuck, and recently-synced work from `/field` at any time (`src/lib/fieldExport.ts`); an
  admin/superuser can import it back in from **Settings → Recover Field Work**
  (`POST /api/field/import`). Re-importing the same file twice is a guaranteed no-op, since every
  op's own `AppliedOp` row makes a repeat apply do nothing.
- **All three manuals plus `CLAUDE.md` and this file updated** to match — a documentation-only
  final phase, since no source code changed in it.
- **Nothing in this phase has been manually verified in a running app or on a real phone** —
  every phase was checked via `tsc`/`lint`/`npm test`/`npm run build` only. See the handoff for
  the manual-verification checklist before shipping.

---

## Current State (What Works)

| Area | Status |
|---|---|
| Database schema | Complete — all models, relations, and indexes in place |
| Admin dashboard | Complete — 7 tabs, 14 modals, full CRUD |
| Auth / roles | Complete — login, JWT, role enforcement, forced password change, per-account lockout + per-IP rate limiting, centralized password validation |
| License / activation | Complete — one product as of v2.0 (Phase 15), no Base/Plus tier. Offline cryptographically signed license verification bound to machine ID; one installer per platform (`WhiteVanOps-Setup.exe` on Windows, `WhiteVanOps-Setup-{arm64,x64}.dmg` on macOS) |
| Trial/Demo installer | Complete — `WhiteVanOps-Trial-Setup.exe` / `WhiteVanOps-Trial-Setup-{arm64,x64}.dmg`, 30-day machine-locked timer, runs the full (only) feature set during the trial; see Phase 13 for its original design, Phase 15 for the tier removal |
| Field sync stuck-record resolution | Complete — offline sync queue quarantines permanently-failed ops instead of stalling, with a tech-facing resolution panel and an admin sync-review dashboard card; see Phase 12 |
| Field write idempotency (`opId`/`AppliedOp`) | Complete (Phase 15) — every field write is safely replayable; fixed a real bug where techs could not save notes/materials at all before v2.0 |
| Field export/import recovery | Complete (Phase 15) — tech-side export of queued/stuck/recent work, admin-side re-import via Settings → Recover Field Work, re-import of the same file is a guaranteed no-op |
| Audit logging | Complete — every write action recorded |
| Field tech module | Complete — mobile-optimized, auto-selects linked tech |
| QuickBooks CSV export | Complete — Invoice and Time exports, sync-lock via `/api/sync` |
| Fleet & equipment | Complete — vehicles, maintenance logs, repair records, equipment assets |
| Personnel | Complete — qualifications, time-off, user account linking |
| Inventory | Complete — multi-location stock levels, low-stock alerts, job deduction on completion |
| Network & Access | Complete — WiFi-only transport, permanently, as of v2.0 (Phase 15): field devices sync over the office LAN only (plain `http://` on a private address — traffic never leaves the building; DHCP reservation/static IP required). There is no remote/tunnel access at all — the earlier Cloudflare tunnel (added 2026-07-24) and, before that, Port Forwarding + Dynamic DNS, are both retired; see `MANUAL_Setup_Installation.md` |
| Backup & Recovery | Complete — Built-in Target Directory Mirror executing nightly automated `pg_dump` local backups; verified end-to-end producing a valid, restorable archive |
| Security & Git | Complete — private git repo with pre-commit secret scanning; command injection, cookie-flag, and job-authorization bugs fixed; see Phase 9 |
| Automated tests | Started — 36 Vitest tests on pure-logic modules; see Phase 10. Not comprehensive (no API route, component, or e2e tests yet) |
| Offline / PWA | Complete — IndexedDB cache and sync queue. Field module functions fully offline once loaded. Note: the Service Worker registration is a no-op in production because it runs on a plain-http LAN origin (a secure context is required) — the page cannot be reloaded from scratch while off the office WiFi; see `CLAUDE.md`'s Field page section |
| Electron desktop app | Complete — dev and production build pipelines, NSIS installer |
| End-user/internal manuals | Complete — `MANUAL_Setup_Installation.md`, `MANUAL_Administrator.md`, `MANUAL_Field_Tech.md`, plus `docs/MANUAL_Troubleshooting.md`, `docs/MANUAL_White_Glove_Installation.md`, `docs/MANUAL_Golden_State_Demo.md`, `docs/MANUAL_Live_Demo.md`, and `docs/BUSINESS_Purchase_to_Install_Playbook.md` |
| Job editing | Complete — `EditJobModal` updates client/vehicle/date/notes on Scheduled/In Progress jobs; `PUT /api/jobs` re-runs the same double-booking, repair, and time-off checks used at creation (shared via `src/lib/jobConflicts.ts`), and blocks edits once a job is Completed |
| Scheduling conflict warnings | Complete — server-side checks now also cover job edits and Resources-panel equipment changes, not just creation; Add/Edit Job and Allocate Resources modals show a live amber warning (`src/lib/clientJobConflicts.ts`) as soon as a conflicting date/vehicle/crew/equipment combination is picked, before the form is even submitted |
| In-app notifications | Complete — a bell icon in the dashboard header (`NotificationBell`) surfaces overdue jobs and low-stock items in one place with a count badge; clicking an alert jumps to the relevant tab. Alert logic lives in `src/lib/alerts.ts`, shared with the Overview tab's scorecards so the two never disagree on what counts as "overdue" or "low stock." In-app only — still no push/email/SMS delivery (that remains future scope) |
| Recurring jobs | Complete — `RecurringJobTemplate` schema model (+ `RecurringJobPersonnel`/`RecurringJobEquipment` join tables) with a client/vehicle/crew/equipment/notes/cadence template. **Requires a migration** (`npx prisma migrate dev --name add_recurring_jobs`) before use — could not be generated in the build environment (no network access to Prisma's engine binaries); `npx tsc --noEmit` currently shows 14 expected errors referencing `prisma.recurringJobTemplate` etc. that resolve as soon as the migration regenerates the client. Generation is manual (click **Generate** on a template) in batches of 4 occurrences — there's no background scheduler in this Electron app — and reuses `checkJobConflicts` so a generated occurrence that would double-book a van/tech is skipped and reported, never silently created |

---

## What Needs Further Development

The items below are either known gaps, enhancements discussed but not yet built, or natural next steps based on current usage patterns.

### High Priority

1. ~~**Notifications / alerts**~~ — In-app version done, see Current State above. Push/email/SMS delivery remains a future step.

2. ~~**Scheduling conflicts**~~ — Done, see Current State above.

3. ~~**Job editing**~~ — Done, see Current State above.

4. ~~**Recurring jobs**~~ — Done, see Current State above. Needs a local migration run before first use.

### Medium Priority

5. **Reporting / analytics** — The Overview tab has KPI cards but there are no trend charts, revenue-over-time graphs, or exportable management reports.

6. **Document attachments** — No file upload capability. Jobs, repair records, and personnel records cannot have photos or PDFs attached (e.g., repair invoices, certifications).

7. **Client portal / read-only share** — No way to share a job summary or invoice preview with a client without giving them a login.

8. **Audit log viewer** — The `AuditLog` table is populated on every write but there is no UI to view the audit trail. An admin-only Audit Log tab would surface who changed what and when.

### Low Priority / Nice to Have

10. **Dark mode** — Tailwind dark mode classes are not wired up. The app is light-only.

11. **Keyboard shortcuts** — No keyboard navigation or shortcut system for power users.

12. **Bulk operations** — No way to bulk-assign, bulk-cancel, or bulk-export multiple jobs at once.

13. **QuickBooks OAuth / direct sync** — Current QB integration is CSV-only (manual import). A direct API connection via QB OAuth would eliminate the import step.

14. **Mobile native app** — The `/field` page is mobile-optimized but runs in a browser. A React Native or Capacitor wrapper was not in scope but would improve the field tech experience.

15. **Multi-tenant / multi-company** — The schema is single-tenant. If the owner ever wants to manage multiple business entities, a tenant model would need to be added.

---

## Lint / Type-Check Status

As of 2026-07-02: `npx tsc --noEmit` and `npm run lint` (`eslint .`, project-wide) both passed with zero errors and zero warnings.

Notable fix at that time: `eslint.config.mjs` was missing `dist-electron/**` from its ignore list, so ESLint was linting the compiled/minified Next.js standalone server bundled inside `dist-electron/win-unpacked/resources/nextjs/.next/` as if it were source — this alone produced ~4400 false-positive problems. Real, fixable issues in actual source were a much smaller set (14 errors, 7 warnings): unused imports/vars, `require()` flagged in the plain-CommonJS Electron/build scripts (now allowed via a scoped eslint override, since those files aren't part of the ESM Next.js app), an `<a>` that should have been `next/link`, a raw `<img>` converted to `next/image`, and three `react-hooks/set-state-in-effect` warnings on intentional "fetch on mount, expose reload for later" hooks — suppressed with scoped, justified `eslint-disable-next-line` comments rather than restructured, since the pattern is correct and reused elsewhere.

**As of 2026-07-05:** `npx tsc --noEmit` is still clean. `npm run lint` is **not** currently clean project-wide — the offline-PWA/backup-feature work added between 2026-07-02 and 2026-07-04 (`src/components/tabs/SettingsTab.tsx`, `src/lib/idb.ts`, `src/app/field/page.tsx`) introduced 9 errors (mostly `@typescript-eslint/no-explicit-any`) and a few warnings (a `react-hooks/set-state-in-effect` violation and a missing `useEffect` dependency) that were never linted project-wide until this pass. None of these were touched during the July 4–5 security/testing work — flagged here as a known, not-yet-fixed gap rather than fixed opportunistically, since they weren't part of that work's scope.

---

## Key Technical Decisions on Record

- **Date storage:** All dates stored as UTC `DateTime`; parsed as local noon in UI code to avoid timezone display bugs (`src/lib/dateUtils.ts`)
- **No optimistic UI:** Every mutation triggers a full dashboard reload via `useDashboardData.reload()`
- **Single modal state:** `activeModal: ModalType | null` in `page.tsx` — not per-modal booleans
- **Env file split:** `.env` for Prisma CLI, `.env.local` for Next.js runtime and Electron bundler
- **Prisma v7:** Config lives in `prisma.config.ts`, not inlined in `schema.prisma`
- **Runtime DB connection:** `@prisma/adapter-pg` with a `pg.Pool`, not the default connection-string mechanism
