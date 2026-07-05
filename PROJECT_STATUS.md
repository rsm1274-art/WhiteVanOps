# WhiteVanOps — Project Status Summary

*As of June 28, 2026*

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

---

## Current State (What Works)

| Area | Status |
|---|---|
| Database schema | Complete — all models, relations, and indexes in place |
| Admin dashboard | Complete — 7 tabs, 14 modals, full CRUD |
| Auth / roles | Complete — login, JWT, role enforcement, forced password change |
| Audit logging | Complete — every write action recorded |
| Field tech module | Complete — mobile-optimized, auto-selects linked tech |
| QuickBooks CSV export | Complete — Invoice and Time exports, sync-lock via `/api/sync` |
| Fleet & equipment | Complete — vehicles, maintenance logs, repair records, equipment assets |
| Personnel | Complete — qualifications, time-off, user account linking |
| Inventory | Complete — multi-location stock levels, low-stock alerts, job deduction on completion |
| Network & Access | Complete — Port Forwarding and Dynamic DNS enabled for direct field device connection, bypassing cloud |
| Backup & Recovery | Complete — Built-in Target Directory Mirror executing nightly automated pg_dump local backups |
| Offline / PWA | Complete — IndexedDB cache and Service Worker sync queue. Field module functions fully offline |
| Electron desktop app | Complete — dev and production build pipelines, NSIS installer |
| End-user manuals | Complete — three manuals covering setup, admin, and field roles |
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

As of 2026-07-02: `npx tsc --noEmit` and `npm run lint` (`eslint .`, project-wide) both pass with zero errors and zero warnings.

Notable fix: `eslint.config.mjs` was missing `dist-electron/**` from its ignore list, so ESLint was linting the compiled/minified Next.js standalone server bundled inside `dist-electron/win-unpacked/resources/nextjs/.next/` as if it were source — this alone produced ~4400 false-positive problems. Real, fixable issues in actual source were a much smaller set (14 errors, 7 warnings): unused imports/vars, `require()` flagged in the plain-CommonJS Electron/build scripts (now allowed via a scoped eslint override, since those files aren't part of the ESM Next.js app), an `<a>` that should have been `next/link`, a raw `<img>` converted to `next/image`, and three `react-hooks/set-state-in-effect` warnings on intentional "fetch on mount, expose reload for later" hooks — suppressed with scoped, justified `eslint-disable-next-line` comments rather than restructured, since the pattern is correct and reused elsewhere.

---

## Key Technical Decisions on Record

- **Date storage:** All dates stored as UTC `DateTime`; parsed as local noon in UI code to avoid timezone display bugs (`src/lib/dateUtils.ts`)
- **No optimistic UI:** Every mutation triggers a full dashboard reload via `useDashboardData.reload()`
- **Single modal state:** `activeModal: ModalType | null` in `page.tsx` — not per-modal booleans
- **Env file split:** `.env` for Prisma CLI, `.env.local` for Next.js runtime and Electron bundler
- **Prisma v7:** Config lives in `prisma.config.ts`, not inlined in `schema.prisma`
- **Runtime DB connection:** `@prisma/adapter-pg` with a `pg.Pool`, not the default connection-string mechanism
