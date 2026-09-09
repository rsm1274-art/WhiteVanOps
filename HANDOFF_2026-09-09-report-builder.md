# Handoff — 2026-09-09: Plus-tier Custom Report Builder — built, unit-tested, NOT yet run end-to-end

## Where this picks up

Same day as [`HANDOFF_2026-09-09-phase4-scripts-docs-ci.md`](HANDOFF_2026-09-09-phase4-scripts-docs-ci.md)
(macOS Phase 4) and the owner's report-builder request logged in
[`HANDOFF_2026-09-07-quoting-and-approval.md`](HANDOFF_2026-09-07-quoting-and-approval.md)'s
"Owner note (2026-09-09)". That note said to wait for macOS QA before starting this — the
owner explicitly overrode that gate this session and asked for the report builder to
proceed in parallel with (not blocked by) Mac testing. Branch: `feature/report-builder-plus`,
off `feat/macos-support`.

The full design lives in
[`docs/superpowers/plans/2026-09-09-report-builder-plus.md`](docs/superpowers/plans/2026-09-09-report-builder-plus.md) —
read that first if picking this up. This handoff covers what actually landed across all
five of its phases plus the sixth (documentation/polish) not numbered separately in the
plan.

## What's done

All five phases from the plan doc were built and committed this session, each as its own
commit on `feature/report-builder-plus`:

- **Phase 0** (`378a0e8`) — the field registry (33 whitelisted fields across Job and its
  relations), the Job-rooted relation graph, definition validation, and view/edit
  permission predicates. Pure logic, `src/lib/reports/{types,registry,graph,definition,permissions}.ts`.
- **Phase 1** (`bc291b0`) — the Kysely query compiler and executor
  (`src/lib/reports/{compile,run}.ts`), sharing the existing `pg.Pool` (`src/lib/db.ts`
  now exports `pool`). `GET /api/reports/fields` and `POST /api/reports/preview`. Two real
  bugs found and fixed during the build: an alias-quoting bug (`sql.ref` vs `sql.id` for
  dotted keys) and an `ORDER BY` referencing an alias that doesn't always exist.
- **Phase 2** (`b1192f7`) — the ad-hoc builder UI: the Reports tab (Plus-only, gated in
  `page.tsx`'s `NAV`/`effectiveTab`), field catalog, column canvas, condition builder, and
  a debounced live preview table. `src/lib/reports/definitionEdit.ts` carries the real test
  coverage for this UI (component files have none — see "Not done" below).
- **Phase 3** (`af4f4c2`) — saved reports, folders, sharing. New `ReportFolder`/
  `SavedReport` Prisma models and migration (`prisma/migrations/20260909160000_report_builder/`),
  CRUD routes, run-by-id (which only ever executes the *stored* definition, never a
  client-supplied one), and definition-drift handling for a saved report referencing a
  field the registry no longer has.
- **Phase 4** (`43b3012`) — CSV (papaparse, formula-injection-safe), XLSX (exceljs, already
  a devDependency — no new dependency added), and PDF export. `pdfDoc.ts` gained an
  additive `createPaginatedCanvas` function; `createDocCanvas` (used by the existing,
  working invoice/quote PDFs) was verified untouched — a throwaway script rendered a real
  invoice PDF through the unmodified path, and `git diff` confirms zero lines removed from
  that function.
- **Phase 5 / polish** (this session, not yet committed as of writing this handoff — will
  be committed alongside it) —
  - **Stacking/drill-down**: `PreviewTable.tsx` can expand a row to show its aggregated
    (many-valued) children as a nested sub-table, via new pure helpers in
    `src/lib/reports/stacking.ts` (12 tests) that zip same-relation list-aggregated array
    cells back into child-row objects. No new API call — this reuses data already in the
    preview/export response.
  - **Performance guards reviewed**: all caps match the plan's suggested defaults exactly
    (preview 200 rows, export 50,000 rows, `statement_timeout` 15,000ms, 40 columns, 25
    conditions, PDF 8 columns) — nothing needed changing.
  - **New index**: `Job` had no indexes at all before this. Added
    `@@index([status, scheduledDate])` — those are the two columns a report filter is most
    likely to use — in its own migration
    (`prisma/migrations/20260909170000_report_builder_job_index/`).
  - **Documentation**: `MANUAL_Administrator.md` gained "Module 11: Custom Reports (Plus
    only)" plus an overview-section mention and an FAQ entry.
    `MANUAL_Setup_Installation.md` and `MANUAL_Field_Tech.md` were checked and need no
    changes (existing generic upgrade instructions already cover the new migration/build
    dependency; the report builder is dashboard-only, unreachable from `/field`).

**Migration verification, both migrations**: neither could be run through
`prisma migrate dev` against the real dev database, because there is no live Postgres
listening on port 5433 in this environment. Both were instead verified by standing up a
**throwaway** Postgres instance from the project's own bundled binaries
(`pgsql/bin/initdb.exe`/`pg_ctl.exe`) in the scratchpad directory, on a private test port
(5544 for Phase 3's migration, 5545 for Phase 5's), running `prisma migrate deploy` with
**all** project migrations against it in order, confirming success, and then tearing the
throwaway instance down. This is real verification that the SQL is syntactically valid and
applies cleanly in the correct order — it is not the same as running it against your actual
data, which has never happened.

**Testing**: `npx tsc --noEmit` clean, `npm run build` succeeds, full `npm test` suite at
**478/478 passing** (up from a 312 baseline at the start of this branch — 166 new tests,
all in `src/lib/reports/*.test.ts` plus a few additions to `src/lib/definitionEdit.test.ts`-
adjacent files). Every dollar of that coverage is in pure logic; no route-level tests exist
anywhere in this repo (matches the existing convention) and no React component tests exist
either (see below).

## What's NOT done

**This is the one thing that matters most: the entire feature, all five phases, has never
been exercised in a live browser against a live database.** Every verification this
session was either a unit test (pure logic, no DB) or — for the two schema migrations — a
throwaway, empty, disposable Postgres instance. Nobody has:
- Logged into the dashboard and clicked the Reports tab
- Dragged or clicked a field into the column canvas and watched a live preview populate
  from real data
- Saved a report, reopened it, confirmed sharing/folder visibility actually works as
  designed
- Downloaded a CSV, XLSX, or PDF and opened it
- Confirmed the "one row per job" guarantee against real multi-technician, multi-part jobs
- Confirmed the Reports tab actually disappears on a Base-licensed or downgraded account
  (server-side gates are unit-tested indirectly via `requirePlus`/`requireRole` reuse, but
  never observed in a running app)

**This must happen before anyone relies on this feature.** Start the app
(`npm run electron:dev` or point a running dev server + `.env.local` at a real database),
log in as an admin/superuser on a Plus-licensed install, and click through the whole flow:
build → preview → save → reload → export all three formats → downgrade to Base and confirm
the tab and every `/api/reports/**` route actually lock out.

Other known gaps, all flagged during the build rather than silently skipped:

- **Row-click-to-open-the-record is stubbed** (`PreviewTable.tsx`, `onLinkClick`) — clicking
  a linked cell shows a toast, not the actual job/client/invoice/quote modal. Every
  dashboard modal today opens from a full domain object already in memory; a report row
  only carries the columns the user selected. Wiring this for real needs either a by-id
  fetch-and-open path or a lookup added to each modal — deliberately out of scope for the
  ad-hoc builder itself.
- **No React component tests.** This repo has no jsdom/Testing Library setup (Vitest runs
  `node`-only). Rather than add one, all component logic that could reasonably be pure was
  pushed into tested `src/lib/reports/` helpers (`definitionEdit.ts`, `stacking.ts`); the
  components themselves (`FieldCatalog`, `ColumnCanvas`, `ConditionBuilder`, `PreviewTable`,
  `SavedReportsPanel`, `ExportMenu`) are untested and have only had a code-level self-review,
  never a manual click-through (see above).
- **Drag-to-reorder columns uses up/down buttons, not native HTML5 drag-and-drop** — a
  deliberate simplification; buttons are fully keyboard-accessible for free and native
  reorder DnD (drop-position math, auto-scroll) was judged not worth the complexity for v1.
- **Filters are a single implicit AND list**, not the full `AND`/`OR` nested
  `ConditionGroup[]` the type technically allows. `definitionEdit.ts` normalizes this at
  the edit-helper level; the underlying type/validator/compiler all still support full
  nesting if a future session wants to expose it in the UI.
- **`requiresRole` on registry fields currently discriminates nothing** — only
  admin/superuser can reach the dashboard at all today, and there's no `Personnel.payRate`
  column in the schema yet. The machinery (the whitelist, the sensitivity tags) is built and
  correct; it just has nothing to bite on until a narrower role or a sensitive new column
  exists. Documented inline in `registry.ts`.
- **Folder/report edit permission has no per-creator restriction beyond the role check** —
  every admin/superuser can edit or delete any report/folder, since the current role model
  has no narrower "office" role for `canEditReport`'s non-creator branch to actually
  exclude. `permissions.ts`'s logic is correct and ready for a narrower role if one is
  added later.

## Open questions — resolved vs. still open

The plan doc's "Open technical questions" section (12 items) has been updated in place to
mark which were decided during the build and which the owner still needs to weigh in on.
Resolved during the build: #1 (exceljs, no new dependency), #2 (Kysely), #3 (hand-written
Kysely types), #4 (native DnD + click-to-add, simplified reorder to buttons), #5
(hand-rolled validator, no zod), #9 (EXPORT audit action added), #10 (skip React component
tests, push logic into `src/lib` instead). **Still genuinely open, needs the owner:** #6
(whether/when to introduce role-based field restrictions beyond admin/superuser), #7
(whether Job-only root scope is an accepted permanent limitation or should eventually grow
Client-rooted/Personnel-rooted reports), #8 (the row/column/condition limit *numbers* — this
session kept the plan's suggested defaults rather than picking new ones), #11 (scheduled/
emailed reports and charts on report output remain explicitly out of scope), #12
(confirmed — Module 11 placement in the admin manual).

## Next session should

1. **Run the whole thing end-to-end against a real, running app and a real database.**
   This is the actual next step, not optional polish — nothing in this feature has been
   seen working outside of unit tests and a disposable test database.
2. If step 1 surfaces bugs (likely, for a feature this size that's never run live), fix
   them before considering this mergeable into `feat/macos-support` or `main`.
3. Decide the still-open questions above (#6, #7, #8) if they matter for the first real
   release of this feature, or explicitly defer them.
4. Consider wiring row-click-to-open-record for real, and/or adding AND/OR condition
   grouping to the UI, as natural v2 follow-ups — neither blocks the v1 feature working.
5. Per the macOS branch's own still-open items (`HANDOFF_2026-09-09-phase4-scripts-docs-ci.md`):
   the two new `.sh` recovery scripts still need a real Mac, and `check-macos` CI still
   needs to be watched on its first real run. Unrelated to this feature, but still open on
   the base branch this one is built from.
