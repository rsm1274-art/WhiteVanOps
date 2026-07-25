# Handoff — Bulk Inventory Adjustment + Import Refresh + Field-Access LAN Bind (2026-07-25)

**Branch:** `feat/wifi-sync-base-tier` (still not merged to `main` — the 2026-07-24 handoff's merge path is unchanged and still open).
**Previous handoff:** `HANDOFF_2026-07-24-wifi-sync-base-tier.md` — read it too; its manual-verification checklist and marketing-repo note are still outstanding.

---

## ▶ NEXT SESSION STARTS HERE — Tech-to-Job Assignment

**Nothing below this heading has been built. This is the goal to pick up.**

The owner's statement of the goal, verbatim:

> the user needs to be able to assign techs to jobs. that will assist with scheduling and
> billing/logging hours. The admin should be able to adjust hours for any tech and any job.
> the techs should only be able to log hours, materials, equipment, etc for the jobs to which
> they are assigned.

Three requirements, stated separately because they land in different layers:

1. **Assign techs to jobs** — an admin-facing assignment surface, feeding scheduling and billing.
2. **Admin can adjust hours for any tech on any job** — unrestricted edit of time entries.
3. **Techs are confined to their assigned jobs** — a tech may log hours, materials, and
   equipment *only* against jobs they are assigned to.

**Do not treat this as greenfield.** Substantial parts already exist and the first task is to
survey what is there before designing anything:

- `JobAssignment` is already a model in `prisma/schema.prisma` (`Job` ↔ `Personnel`), and
  `AllocateResourcesModal.tsx` already writes assignments. Establish what it does and does not
  cover before adding a second mechanism.
- `TimeEntry` already links a `Job` and a `Personnel`; `LogTimeModal.tsx` is the admin path and
  `/field` is the tech path.
- Requirement 3 is **partly implemented already**: per `CLAUDE.md`, a tech "can only log time for
  their own linked `personnelId`" and "can only update status on assigned jobs". Verify how far
  that enforcement actually reaches — in particular whether *materials and equipment* are
  gated the same way as time, or only time is. That gap, if it exists, is the real work.
- Enforcement must be **server-side in the API routes**, not just hidden UI. `src/middleware.ts`
  has `TECH_ALLOWED_PREFIXES` for route-level access; per-record ownership checks belong in the
  route handlers next to `requireRole`.

Suggested opening move: `superpowers:brainstorming` to pin the design, since "assign techs to
jobs" touches scheduling, billing, and the tech permission boundary at once and the existing
partial implementation needs auditing first.

---

## What shipped today (3 commits on the branch)

### 1. Bulk inventory adjustment — `3790227`

Adjusting stock previously meant scrolling to the *By Location* cards and opening a
single item-location modal; saving reloaded the dashboard and threw you back to the top of the
page, so a stocktake meant re-scrolling for every item.

- **New:** `Inventory Adjustment` button in the Inventory tab header →
  `src/components/modals/BulkAdjustStockModal.tsx`. One item (filterable dropdown), every
  location in one grid (warehouse first, then vans), Qty + Min per row. Save keeps the modal
  open, confirms inline, clears the picker for the next item. Dashboard reloads only on close.
- **New:** `adjust_stock_bulk` action in `src/app/api/inventory/route.ts` — all locations in one
  `$transaction`. The single-location `adjust_stock` action and the per-card **Adjust** buttons
  are deliberately unchanged.
- **New:** `src/lib/stockAdjust.ts` (+ 12 tests) — pure validation/diff, used by both the modal
  and the route. Only rows whose values actually changed are written.
- Documented in `MANUAL_Administrator.md` under Stock Levels.

### 2. Import refresh fix — this commit

**Symptom reported:** on a fresh install, the onboarding import let you upload and map, but
committing appeared to do nothing — no feedback, no data in the tabs — and returning to the
import screen showed it cleared.

**The import was working the whole time.** Three separate defects stacked into one silent
failure, all now fixed:

1. **The dashboard never refetched.** `DataImportSection` had no reload callback at all
   (its whole props contract was `{ onShowToast }`), while `SettingsTab` had `onLicenseChanged`
   for exactly this purpose. `/api/dashboard` is fetched once on mount and tab switches are pure
   client state, so imported rows sat in Postgres while every tab rendered the app-start
   snapshot. Fixed by threading `onImported` → `SettingsTab.onDataImported` → `page.tsx`.
2. **The success panel was structurally unreachable.** It rendered inside the
   `{proposedMapping && (…)}` block, and `handleExecute` sets `proposedMapping` to `null` on
   success — so the panel unmounted at the exact moment it had something to show. Moved out to
   a sibling position.
3. **`reload()` blanks the whole app.** `page.tsx:680` returns a full-screen splash whenever
   `loading` is true, which unmounts the entire tab tree and all component state. Added
   **`refresh()`** to `useDashboardData` — same fetch, never touches `loading` — and wired the
   import to that. `reload()` is unchanged and all existing callers keep their behavior.

Also added: an inline **error** panel for a failed commit. Execute failures previously went only
to `onShowToast`, which renders at the top of `<main>` — off-screen from the import controls at
the bottom of a long Settings page, which is why a failure would also read as "nothing happened".

**Verified end to end in the browser**, not by inference: real CSV upload → analyze → map →
wipe + commit → success panel appears and persists → imported clients visible in the Clients tab
with no manual refresh and no loading splash. Dev seed data was wiped for the test and restored
with `npx prisma db seed`.

### 3. Field access from phones was completely broken — `62878fe`

**Symptom reported:** none of the addresses offered by the Field Access QR modal worked. Each
gave "a white screen that never finishes loading" on the phone. The dashboard on the office PC
worked perfectly.

**Root cause: the packaged server was bound to IPv6 loopback only.** `electron/main.js` set
`process.env.HOSTNAME = 'localhost'` before `require()`ing the standalone Next server, which
passes it straight to `server.listen(port, hostname)`. Windows resolves `localhost` to `::1`
first, so `netstat` on the customer machine showed a lone `TCP [::1]:3000 LISTENING` — no
`0.0.0.0`, not even `127.0.0.1`. **Nothing was listening on any LAN address**, so every phone got
a dropped SYN (dropped, not refused — hence a hang rather than an error). The dashboard was
unaffected because it dials itself, which made a dead transport look like a healthy install.

This silently broke the entire premise of Base tier. Fixed to `0.0.0.0` at
`electron/main.js:145`. The standalone server already defaults to `0.0.0.0` when `HOSTNAME` is
unset, so the override was pure harm. Loopback callers are unaffected — Node `autoSelectFamily`
(default since Node 20; Electron 42 ships Node 22) and Chromium both fall back to `127.0.0.1`,
verified empirically, so the existing `http://localhost:${PORT}` probes and `loadURL` still work.

Two contributing defects fixed alongside it, because either alone reproduces the same symptom:

1. **The modal offered addresses no phone can reach.** Hyper-V/WSL (`172.23.x`) and VirtualBox
   host-only (`192.168.56.x`) pass every RFC1918 check but exist only inside the host PC. New
   `src/lib/lanAddresses.ts` (+12 tests) filters by adapter name *and* MAC OUI, with a deliberate
   fallback to the unfiltered list so the modal is never left empty.
   `src/app/api/field-access/lan-address/route.ts` is now a thin wrapper over it.
2. **Windows Firewall is the second gate** — it drops inbound TCP rather than refusing it,
   reproducing the identical hang. The per-user NSIS installer cannot create firewall rules, and
   the 2026-07-24 WiFi-sync rewrite had **dropped the firewall step from `MANUAL_Setup_Installation.md`
   §7**, so the documented setup path never opened the port. Added
   `scripts/recovery/allow-field-access.ps1` (admin, Private profile only, idempotent) and
   restored the manual step as §7 Step 3.

`CLAUDE.md` records the bind invariant ("don't tidy this back to `localhost`") and the
**bind → firewall → AP isolation** diagnostic order.

**Verification status — read this before assuming it works.** Verified here: the fix is present in
the packaged `app.asar` (`HOSTNAME = '0.0.0.0'` appears once, the old `localhost` value zero
times), 287 tests, `tsc` clean. **Not verified: the end-to-end phone connection**, which is only
provable on the customer machine. The confirming check there is `netstat -ano | findstr :3000`
returning `0.0.0.0:3000` rather than `[::1]:3000`. If that shows `0.0.0.0`, the firewall rule is
in, and a phone still hangs, the remaining suspect is AP/client isolation on the router —
`192.168.68.x` is the Google/Nest WiFi default range, whose guest network isolates clients by
design.

---

## State at end of session

- **Tests:** 287/287 vitest, `tsc --noEmit` clean. Lint at its pre-existing baseline — the
  `any` findings in `DataImportSection.tsx` predate this work.
- **Installers:** `dist-electron/WhiteVanOps-Base-Trial-Setup.exe` was rebuilt at **17:47** and
  is current — it contains all three of today's changes. **Every other artifact in
  `dist-electron/` is stale and ships the broken `[::1]`-only bind.** See the rebuild note below.
- **Dev database:** restored to seed fixture. The bundled PostgreSQL is **stopped**; start it
  with `./pgsql/bin/pg_ctl.exe -D "$APPDATA/whitevanops/pgdata" start` before dev work.
- **`sample-import-data/`** is still untracked, carried over from an earlier session. It holds
  six CSVs and **no `mapping.json`** — fine for the in-app importer, which proposes one, but the
  CLI (`scripts/import/run.ts`) requires `analyze.ts` to be run first.

## ⚠ Three installers still ship the broken bind — rebuild before shipping to anyone

The Base trial (17:47) is current. These three are from 08:26–08:32, **predate `62878fe`, and
therefore still bind `[::1]` only** — field access is non-functional in any install made from
them, on any network:

| Artifact | Built | Rebuild with |
|---|---|---|
| `WhiteVanOps-Base-Setup.exe` | 08:26 | `npm run electron:build` |
| `WhiteVanOps-Plus-Setup.exe` | 08:29 | `npm run electron:build:plus` |
| `WhiteVanOps-Plus-Trial-Setup.exe` | 08:32 | `npm run electron:build:trial:plus` |

This is not a "nice to refresh" — it is a shipping blocker. **Any customer already installed from
one of these has broken field access right now**, and the fix reaches them only through a
reinstall, since the bind is set in `main.js` after `.env.local` loads and no configuration can
override it.

After rebuilding, confirm the fix landed rather than trusting the build log:

```
grep -c "HOSTNAME = '0.0.0.0'" dist-electron/win-unpacked/resources/app.asar   # expect 1
grep -c "HOSTNAME = 'localhost'" dist-electron/win-unpacked/resources/app.asar # expect 0
```

## Note on testing installs on the dev machine

An install on this machine shares `%APPDATA%\whitevanops\pgdata` with the dev database, and the
credentials generated by the installer differ from the dev `.env.local`. Test installers on a
clean machine or VM to avoid chasing a credential mismatch that looks like a product bug.
