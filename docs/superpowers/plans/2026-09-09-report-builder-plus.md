# Implementation Plan: Custom Report Builder (Plus tier)

Branch: `feature/report-builder-plus` (off `feat/macos-support`).
Seed note: `HANDOFF_2026-09-07-quoting-and-approval.md`, "Owner note (2026-09-09)".
Owner has explicitly overridden the prior macOS-QA gate on this note — Mac testing and
this feature now proceed in parallel.

## Overview
An ad-hoc report builder for the Plus tier, rooted on `Job`, with a drag/drop field
catalog, live preview, condition builder, saved reports in shareable folders, and
CSV/XLSX/PDF export. The query layer compiles a validated, registry-whitelisted report
definition into SQL via Kysely on the existing `pg.Pool`, aggregating one-to-many
relations with `json_agg` so the root row count always equals the job count — with an
explicit opt-in single-relation expansion mode when fan-out is actually wanted.

Two findings that shaped this plan:
- **`exceljs@^4.4.0` is already a devDependency** (`src/lib/import/readers.ts`, read-only
  today). The XLSX question is mostly already answered — see Open Question 1.
- **`createDocCanvas()` in `src/lib/pdfDoc.ts` is single-page** — a report PDF needs
  pagination, so that module must be extended additively, not rewritten.

## Requirements
- Root entity `Job`; `Client`, `Vehicle`, `Personnel` (via `JobAssignment`),
  `JobLineItem`/`InventoryItem`, `TimeEntry`, `JobEquipment`/`Equipment`, `Invoice`,
  `Quote` hang off it.
- Field catalog is a **whitelist registry**; no user-supplied SQL identifier ever
  reaches the database.
- Conditions support enum, date-range, numeric, text, null/not-null, and
  existence-on-child predicates.
- No row duplication by default; opt-in "expand to line-item rows" mode limited to
  **exactly one** relation.
- Saved reports with folders, public/shared visibility, creator-or-admin edit rights.
- Row hyperlinks into existing dashboard entities; stacking (expand a row to its
  aggregated children).
- CSV / XLSX / PDF export.
- Online-only, dashboard-only. Not reachable from `/field`.
- Every route gated `requireRole(user, "admin", "superuser")` **and**
  `requirePlus(await hasPlusLicense())`.
- Role/sensitivity gating designed in from Phase 0, not retrofitted.

## Architecture Changes

**New pure-logic modules** (all under `src/lib/reports/`, none importing `@/lib/db` so
they unit-test without mocking — the convention `src/lib/import/` already follows):
- `types.ts` — `FieldDef`, `ReportDefinition`, `Condition`, `RelationEdge`, `CompiledReport`.
- `registry.ts` — the field whitelist.
- `graph.ts` — root entity + relation edges (join keys, cardinality, aggregation strategy).
- `definition.ts` — validator/normalizer for a client- or DB-supplied `ReportDefinition`.
- `permissions.ts` — `canViewReport()`, `canEditReport()`, `visibleFieldsFor(role)`.
- `compile.ts` — `ReportDefinition` → Kysely query (`.compile()` yields
  `{ sql, parameters }`, snapshot-testable with no database).
- `csv.ts`, `xlsx.ts`, `pdf.ts` — serializers over a common `ReportResult`.

**New DB-touching modules:**
- `src/lib/reports/kysely.ts` — a `Kysely` instance built on the **same** `pg.Pool` as Prisma.
- `src/lib/db.ts` — one-line change: `export const pool = new pg.Pool(...)`. Do not open
  a second pool; the bundled PostgreSQL's `max_connections` is modest and the Electron
  app already shares one process.
- `src/lib/reports/dbTypes.ts` — hand-written Kysely `Database` interface covering only
  whitelisted tables.

**Schema:** `ReportFolder`, `SavedReport` (Phase 3).

**New routes** under `src/app/api/reports/`. **New tab** `reports` +
`src/components/reports/*`. **Extended** `src/lib/pdfDoc.ts` (pagination, additive).

---

## Phase 0 — Registry, definition schema, permissions (pure logic, no UI, no SQL)

1. **Core types** — `src/lib/reports/types.ts`.
   `FieldDef = { key, label, group, type: "string"|"number"|"date"|"boolean"|"enum",
   enumValues?, source: { entity, column }, path: RelationPath, operators: Operator[],
   cardinality: "one"|"many", sensitivity: "normal"|"money"|"pii",
   requiresRole: UserRole[], linkTo?: { target, idField } }`.
   `source`/`path` are the only things that ever become SQL identifiers — everything the
   user sends is a `key` looked up in the registry. That is the entire injection defence,
   structural rather than a sanitiser. Risk: Low.

2. **Field registry** — `src/lib/reports/registry.ts`. One entry per exposed column,
   grouped Job / Client / Vehicle / Technicians / Parts & Materials / Time / Equipment /
   Invoicing / Quotes. `getField(key)`, `fieldsForRole(role)`, `allGroups()`.
   Deliberate v1 exclusions: `User.passwordHash`, `User.failedLoginAttempts`/`lockedUntil`,
   `Quote.publicToken`, `AuditLog`, `SyncReviewItem.body`, `License.*`.
   Sensitivity: `JobLineItem.rate`, `InventoryItem.defaultRate`, `MaintenanceLog.cost`,
   invoice/payment amounts → `"money"`; `Client.contactName`/`locationAddress`,
   `RepairRecord.servicePhone`/`serviceProvider` → `"pii"`.
   Honest note: there is no `Personnel.payRate` column today and `tech` cannot reach the
   dashboard at all, so `requiresRole` currently discriminates nothing — its value is
   existing *before* a pay-rate column or read-only office role gets added. Default
   `admin`/`superuser` for everything; the machinery is the deliverable. Risk: Low, but
   this is the security boundary — review carefully.

3. **Relation graph** — `src/lib/reports/graph.ts`. `ROOT = "job"`; edges
   `{ from, to, kind: "one"|"many", localKey, foreignKey, through? }`.
   `job→client`, `job→vehicle` are `one`; `job→assignments→personnel`,
   `job→lineItems→inventoryItem`, `job→timeEntries`, `job→equipment→equipment`,
   `job→invoices`, `job→quotes` are `many`. The compiler decides join vs. lateral
   `json_agg` purely from `kind` — keeping this declarative makes the fan-out fix a
   property of the data model, not something the compiler author has to remember.
   Risk: Medium — a wrong cardinality silently reintroduces duplication.

4. **Definition validator** — `src/lib/reports/definition.ts`.
   `validateDefinition(input: unknown, role): { ok, definition } | { ok: false, errors, unknownFieldKeys }`.
   Checks every column/condition/sort key exists and is permitted for the role; operator
   is legal for that field; values type-check; at most one `expandRelation` and it must
   be a `many` edge; column/condition counts capped. Runs on both the client-supplied
   preview body and the JSON read back out of `SavedReport.definition` — a saved
   definition is untrusted input on read (registry can shrink between releases). Returns
   `unknownFieldKeys` separately so the UI can say "3 columns are no longer available"
   instead of 500ing. Risk: Medium.

5. **Permission predicates** — `src/lib/reports/permissions.ts`.
   `canViewReport(user, report)` = creator, or `isShared`, or folder `isPublic`.
   `canEditReport(user, report)` = creator, or role in `("admin","superuser")`. One gate
   used by every route, mirroring `canRespondToQuote()` in `src/lib/quote.ts`, so sharing
   rules can't drift between list/run/export. Risk: Low.

6. **Tests** — `registry.test.ts`, `definition.test.ts`, `permissions.test.ts`,
   `graph.test.ts` under `src/lib/reports/`. Registry invariants (unique keys, every
   `source.entity` exists in the graph, no excluded column referenced, every `many`
   field declares aggregation). Validator rejection cases incl. unknown key, disallowed
   operator, two expansion relations, a value string containing `'; DROP TABLE`.
   Permission matrix across creator/admin/other-admin/superuser ×
   private/shared/public-folder. Risk: Low.

**Phase 0 boundary:** `npm test` and `npx tsc --noEmit` green. Nothing user-visible;
nothing to QA. Fully mergeable.

---

## Phase 1 — Query compiler + preview API (no UI)

7. **Pool export + Kysely instance** — `src/lib/db.ts`, `src/lib/reports/dbTypes.ts`,
   `src/lib/reports/kysely.ts`. Export `pool` from `db.ts`; hand-write the `Database`
   interface for the ~14 whitelisted tables; `new Kysely<Database>({ dialect: new
   PostgresDialect({ pool }) })` with the same `globalThis` singleton guard `db.ts` uses
   in dev. One pool, one credential set, one lifecycle — no second code generator added
   to an already-documented-fragile build pipeline. Risk: Medium (packaging) — verify
   `.next/standalone/node_modules/kysely` exists after `npm run build`; keep `kysely` in
   `devDependencies`.

8. **Compiler** — `src/lib/reports/compile.ts`. `compileReport(def, opts) → { query, columns }`.
   - `FROM job` always.
   - `one` edges → `LEFT JOIN`.
   - `many` edges → `LEFT JOIN LATERAL (SELECT json_agg(...) FROM child WHERE fk = job.id) alias ON true`.
     **Root row count == job count, unconditionally.**
   - Conditions on a `many` field compile to `WHERE EXISTS (SELECT 1 FROM child WHERE fk
     = job.id AND <pred>)` — never a predicate on the joined child directly (a `WHERE` on
     a fanned-out join silently filters which children appear in the aggregate rather
     than filtering jobs — subtle, load-bearing, needs its own test).
   - `expandRelation` (opt-in, at most one) becomes a plain `LEFT JOIN`, one row per
     child; every other `many` relation stays aggregated. A second expansion is the
     cartesian product this design exists to prevent — validator and compiler both
     reject it.
   - All literal values parameter-bound via Kysely. Every identifier from
     `registry`/`graph`.
   Risk: **High** — this is the correctness core.

9. **Executor** — `src/lib/reports/run.ts`. `runReport(def, { limit, offset, role })` →
   `{ columns, rows, totalRows, truncated }`. Transaction with `SET LOCAL
   statement_timeout` so a pathological definition can't pin the bundled PostgreSQL that
   also serves the field techs' PWA. Separate `count` query for `totalRows`. Risk: Medium.

10. **`GET /api/reports/fields`** — `requireRole` → `requirePlus` → return
    `fieldsForRole(user.role)` + group ordering + relation cardinalities. Served, never
    bundled, so the role filter can't be bypassed by reading the JS bundle. Risk: Low.

11. **`POST /api/reports/preview`** — same two gates; `validateDefinition`; 400 with
    errors on failure; else `runReport` at the preview cap. No `audit()` call — read, not
    write (see Open Question 9). POST because a definition is too large for a query
    string. Risk: Medium.

12. **Compiler tests** — `src/lib/reports/compile.test.ts`. Assert on `.compile()`
    output, no database (matches "never import `@/lib/db` for real in unit tests").
    Cases: job+client-only emits no LATERAL; adding a technician column emits a LATERAL
    `json_agg` and no join to `job_assignment` in FROM; a condition on technician name
    emits `EXISTS`; `expandRelation: "lineItems"` emits one plain join, keeps time
    entries aggregated; every user value appears in `parameters`, never inlined; a
    report whose only column is a `many` field still returns one row per job. Risk: Low.

**Phase 1 boundary:** A Plus admin can `curl` `/api/reports/fields` and
`/api/reports/preview` and get correct, non-duplicated rows. No UI. Mergeable and
independently valuable — it's the whole engine.

---

## Phase 2 — Builder tab and live preview (ad-hoc only, no saving)

13. **Register the tab** — `src/app/page.tsx`. Add `"reports"` to `TabId`,
    `TAB_LABELS`, `NAV` with `plusOnly: true`, **and to the `effectiveTab` downgrade
    guard** (currently lists analytics/invoicing/quotes around line 165). That guard is
    hand-maintained — omitting the new tab leaves it selectable after a licence
    downgrade (cosmetic only, routes still 403, but exactly the drift the "UI hiding
    tabs is convenience only" note anticipates). Risk: Low.

14. **Container** — `src/components/tabs/ReportsTab.tsx`. Owns `definition` state,
    fetches `/api/reports/fields` on mount, runs a debounced (~300ms) +
    `AbortController`-cancelled preview fetch on every definition change. Does not use
    `useDashboardData` — the full-reload pattern is wrong at this payload size/frequency.
    Risk: Medium (stale-response races; cancel every in-flight request).

15. **Field catalog** — `src/components/reports/FieldCatalog.tsx`. Collapsible groups,
    text filter, `draggable` items, plus a click-to-add affordance — not a nicety: HTML5
    drag-and-drop is effectively unusable by keyboard, so click-to-add is the accessible
    route and the fallback if native DnD proves fiddly. `many`-cardinality fields carry a
    badge. Risk: Medium.

16. **Column canvas** — `src/components/reports/ColumnCanvas.tsx`. Drop target,
    reorder, per-column label override, aggregation selector for `many` fields
    (list/count/sum/min/max), "Expand to one row per …" toggle that disables itself once
    one relation is expanded and explains why. Risk: Medium.

17. **Condition builder** — `src/components/reports/ConditionBuilder.tsx`. Rows of
    field → operator (from that field's `operators`) → value editor typed by
    `FieldDef.type`: enum → select of `enumValues`; date → range picker built on
    `src/lib/dateUtils.ts` (never `new Date(str)` directly); number → min/max; string →
    contains/equals. AND/OR group toggle. Risk: Medium.

18. **Preview table** — `src/components/reports/PreviewTable.tsx`. Simple table capped
    at the preview limit, "showing N of M" banner. Aggregated cells render as a
    comma-joined summary. Row click uses `linkTo` to open the existing entity UI (job row
    → `activeModal="editJob"` — no new navigation concept). Risk: Low.

19. **Testability** — no React test infra exists (Vitest is `node`-only). Extract
    definition mutation helpers into `src/lib/reports/definitionEdit.ts` (add/remove/
    reorder column, add/update condition — immutable, returns new definitions) and unit
    test those; leave components to a manual click-through, unless the owner wants
    jsdom + Testing Library added (Open Question 10). Risk: Low.

**Phase 2 boundary:** A Plus admin can build an ad-hoc report and see live results.
Nothing persists. Genuinely shippable on its own.

---

## Phase 3 — Saved reports, folders, sharing

20. **Schema migration** — `prisma/schema.prisma`,
    `npx prisma migrate dev --name report_builder`.
    ```
    model ReportFolder {
      id, name, isPublic Boolean @default(false),
      createdById String? -> User onDelete: SetNull,
      reports SavedReport[], createdAt, updatedAt
    }
    model SavedReport {
      id, name, description String?,
      rootEntity String @default("job"),
      definition Json,
      folderId String? -> ReportFolder onDelete: SetNull,
      isShared Boolean @default(false),
      createdById String? -> User onDelete: SetNull,
      createdAt, updatedAt
    }
    ```
    Plus back-relations on `User`. `cuid()` ids, matching existing conventions.
    `SetNull` on both `createdById`s: deleting a user must not delete other people's
    shared reports (orphaned report falls back to admin-only edit under
    `canEditReport`). `SetNull` on `folderId`: deleting a folder must not cascade-delete
    its reports. `definition Json` because the shape is user-composed and versionless —
    `SyncReviewItem.body` is the existing precedent — and is re-validated on every read
    (Step 4). Ships to every install, stays empty until licensed, like every other Plus
    table. Risk: Medium (migrations are the one irreversible step).

21. **CRUD routes** — `src/app/api/reports/route.ts`, `.../[id]/route.ts`,
    `.../folders/route.ts`, `.../folders/[id]/route.ts`. `requireRole` + `requirePlus`
    on every method. `GET /api/reports` filters by `canViewReport`. `POST` validates
    before writing. `PATCH`/`DELETE` check `canEditReport` and return **404, not 403**
    for a report the caller can't even view — consistent with the public quote route's
    uniform-404 discipline. Every write calls `audit(user!.userId, "CREATE"|"UPDATE"|"DELETE",
    "SavedReport"|"ReportFolder", id)`. Risk: Medium — the authorization surface.

22. **`POST /api/reports/[id]/run`** — loads the stored definition, re-validates,
    runs it. Body carries only paging/sort overrides. A saved run must never execute a
    client-supplied definition against a saved report's identity, or the share/edit
    model means nothing. Risk: Medium.

23. **Saved reports panel + save dialog** — `src/components/reports/SavedReportsPanel.tsx`,
    `src/components/modals/SaveReportModal.tsx`. Folder list with public/private
    markers, report list with edit affordance only when `canEditReport` (client mirror
    for convenience; server decides). Save dialog uses `Modal`/`ModalHeader`/`Field`/
    `SubmitButton` from `src/components/shared/Modal.tsx`; add `"saveReport"` and
    `"reportFolder"` to `ModalType` in `src/types.ts`; wire in `page.tsx` per the
    "Adding a new modal" checklist. Add report/folder interfaces to `src/types.ts`.
    Note: `Modal`'s `widthClass` caps at `xl` (576px) — fine for these dialogs, since the
    builder itself is a tab, not a modal, precisely because it can't fit. Risk: Low.

24. **Definition-drift handling** — when `validateDefinition` on a loaded report
    returns `unknownFieldKeys`, the panel opens it with those columns dropped and a
    visible banner. Add a validator test. Risk: Low.

**Phase 3 boundary:** Reports persist, live in folders, honour creator-or-admin edit
rights. Requires running the migration. Mergeable.

---

## Phase 4 — Export (CSV → XLSX → PDF, in that order)

25. **Shared export route** — `src/app/api/reports/export/route.ts`. `POST` with
    `{ definition | savedReportId, format }`. Same two gates. Re-validates, runs at the
    **export** cap (higher than preview), dispatches to serializer, returns bytes with
    `Content-Disposition: attachment`. **Sanitize the filename** — report name is
    user-supplied and goes into a response header: strip CR/LF, quotes, path separators;
    fall back to a generic name if empty after stripping. Unit test a name containing
    `\r\n`. Consider `audit(..., "EXPORT", "SavedReport", id)` — real data-egress
    significance (Open Question 9). Risk: Medium.

26. **CSV** — `src/lib/reports/csv.ts`. Pure `toCsv(result) → string` via `papaparse`
    (`Papa.unparse`, already a dependency) rather than hand-rolled quoting. Server-side,
    so not limited to the preview row cap unlike `AccountingTab`'s client-side buttons.
    Prefix cells starting with `= + - @` with `'` to defuse spreadsheet formula
    injection — real risk given free-text `Job.notes`. Risk: Low.

27. **XLSX** — `src/lib/reports/xlsx.ts`. `exceljs` `Workbook`, one sheet, bold header
    row, column widths from content, real date cells, currency format for money. No new
    dependency — already traced into the standalone build via
    `src/lib/import/readers.ts`. Risk: Low.

28. **Extend `pdfDoc` with pagination** — `src/lib/pdfDoc.ts`. Add
    `createPaginatedCanvas({ landscape })` returning `text`/`hr` rebound to a mutable
    current page, plus `ensureSpace(h)` that starts a new page and redraws the header
    row. **Do not change `createDocCanvas`'s signature or output** — invoice and quote
    PDFs both depend on it; the current helper closes over a single `page` and would
    silently draw every row at negative `y` on a multi-page report. Risk: Medium —
    regression surface is customer-facing invoices/quotes; visually diff one invoice PDF
    before/after.

29. **Report PDF** — `src/lib/reports/pdf.ts`. Landscape Letter, company header via
    `readCompanyDetails()`, report name + generated-on line, repeating column headers,
    per-cell truncation, page numbers, hard column-count cap with a "narrow the report
    for PDF" message beyond it. Risk: Medium.

30. **Export menu** — `src/components/reports/ExportMenu.tsx`. Risk: Low.

**Phase 4 boundary:** All three formats download. CSV alone is a shippable slice if
XLSX/PDF slip.

---

## Phase 5 — Polish, guards, docs

31. **Stacking / drill-down** — `PreviewTable.tsx`. Expand a row to show aggregated
    children as a nested sub-table — near-free with the `json_agg` model since the child
    rows are already in the cell payload (the structural payoff over IAPro's fan-out).
    Risk: Low.

32. **Performance guards** — tune `statement_timeout`, preview/export caps,
    column/condition caps. Index review: `Job.scheduledDate` and `Job.status` are likely
    filter columns and neither is indexed today — `@@index([status, scheduledDate])` on
    `Job`, in its own migration. Risk: Medium.

33. **Manual + handoff** — `MANUAL_Administrator.md` "Module 11: Custom Reports (Plus
    only)" after Module 10 (currently ends at line 477): catalog, conditions,
    expand-mode tradeoff, folders/sharing, edit rights, exports.
    `MANUAL_Setup_Installation.md` needs the new dependency + migration step.
    `MANUAL_Field_Tech.md` needs nothing (dashboard-only). Then write
    `HANDOFF_2026-09-09-report-builder.md` per the standing rule. Risk: Low, but
    non-optional — the manual-update policy treats this as part of the task.

---

## Testing Strategy
- **Unit (Vitest, `src/lib/reports/*.test.ts`)** — registry invariants, definition
  validation/rejection, permission matrix, compiler SQL shape via `.compile()`,
  definition-edit helpers, CSV/filename escaping. No database, no `@/lib/db` import.
  `vi.resetAllMocks()` in `beforeEach`. Short fixture secret-shaped strings.
- **Integration (manual, dev DB)** — run each `many` relation against seeded data,
  assert row count == job count; flip expand-mode on, assert row count == child count.
- **E2E (manual click-through)** — build → preview → save → reopen as another admin →
  export all three formats → downgrade to Base, confirm tab hides and every route 403s.
- **CI** — `check` (ubuntu) and `check-macos` both run `tsc` + `npm test`, so the pure
  modules are covered on both platforms for free.
- **Packaging** — after `npm run build`, confirm `.next/standalone/node_modules/kysely`
  exists; after `npm run electron:build`, confirm it reached
  `resources/nextjs/node_modules`.

## Risks & Mitigations
- **Row duplication regression.** Cardinality lives in `graph.ts`, not compiler
  branches; compiler tests assert row-count invariants per relation; validator and
  compiler both reject a second expansion relation.
- **Silent filter bug on aggregated relations.** A `WHERE` on a fanned-out child filters
  the aggregate's contents, not the job set. Mitigation: conditions on `many` fields
  compile to `EXISTS`, with a dedicated test.
- **SQL injection.** Identifiers exclusively from registry/graph; values exclusively
  parameter-bound; test asserting an unknown key is rejected and a hostile value string
  lands in `parameters`, never in `sql`.
- **Resource exhaustion** on the bundled PostgreSQL the field techs' PWA also depends
  on. Mitigation: `SET LOCAL statement_timeout`, row/column/condition caps.
- **New dependency breaks the Electron build.** `kysely` stays in `devDependencies`;
  the two packaging assertions above catch a miss early.
- **`pdfDoc` change regresses invoice/quote PDFs.** Purely additive new function;
  visual diff one invoice before/after.
- **Saved definition drift.** Re-validate on read, degrade with a banner, never 500.
- **Downgrade leak.** `effectiveTab` guard updated; server gates are the real control.

## Success Criteria
- [ ] Every `/api/reports/**` route calls both `requireRole` and `requirePlus`;
      `requirePlus` stays greppable as the complete Plus route list.
- [ ] No `/api/reports` prefix in `TECH_ALLOWED_PREFIXES`.
- [ ] A report with technician, part and time-entry columns returns exactly one row
      per job.
- [ ] Expand mode produces one row per child of the chosen relation; a second
      expansion is rejected.
- [ ] A definition with an unregistered field key is rejected with 400, never executed.
- [ ] Saved reports honour creator-or-admin edit rights and public-folder visibility;
      a non-viewable report returns 404.
- [ ] CSV, XLSX and PDF all download with matching row counts.
- [ ] `npm test` ≥80% coverage on `src/lib/reports/`; `tsc --noEmit` and
      `npm run build` clean.
- [ ] `MANUAL_Administrator.md` Module 11 written; handoff committed.

---

## Open technical questions for the owner

1. **XLSX library.** `exceljs@^4.4.0` is already a devDependency (read-only, in the
   data-import engine). Reusing it for writing means zero new dependencies and zero new
   packaging risk. Recommendation: use it — accept that a very large export is a memory
   spike (`exceljs`'s streaming `WorkbookWriter` is available if that becomes a problem).
   The alternative, SheetJS/`xlsx`, has ongoing registry/licensing friction and would be
   a new dep. **Confirm exceljs.**
2. **Kysely vs. raw parameterized SQL.** Kysely gives an identifier-safe builder, typed
   results, and `.compile()` (what makes the compiler unit-testable with no database).
   Cost: one more dependency in a build pipeline CLAUDE.md documents as brittle.
   Alternative: `prisma.$queryRawUnsafe` with hand-assembled SQL and `$1`-style params —
   no new dep, but the safety property becomes a code-review discipline instead of a
   type. **Recommendation: Kysely. Confirm.**
3. **Kysely table types.** Hand-written minimal interface (~14 tables, no build step)
   vs. `kysely-codegen` (auto-sync, but a second generator alongside `prisma generate`).
   Recommendation: hand-written for v1.
4. **Drag/drop implementation.** Native HTML5 DnD (no dependency, poor keyboard/touch
   story, hence the mandatory click-to-add fallback) vs. `@dnd-kit/core` (~15kb, proper
   keyboard sensors, another dep). Recommendation: native for v1, revisit if it feels bad.
5. **Definition validation.** Hand-rolled validator matching
   `src/lib/import/mappingSchema.ts`'s existing precedent, vs. adding `zod` (not used
   anywhere in this codebase today). Recommendation: hand-roll for consistency.
6. **Roles.** `requiresRole` on registry fields currently discriminates nothing — only
   admin/superuser reach the dashboard, no pay-rate column exists. Options: (a) build
   the machinery now, mark money/PII fields for later — recommended; (b) introduce a
   read-only "office" role now; (c) drop `requiresRole`, keep only `sensitivity`.
   **Owner decision.**
7. **Root entities.** Is Job-only correct for v1? Client-rooted ("all clients including
   those with no jobs") and Personnel-rooted ("utilisation by tech") are genuinely
   different questions a Job root can't answer. Worth confirming this is an accepted v1
   limitation.
8. **Limits.** Suggested defaults (owner's numbers, not fixed): preview 200 rows,
   export 50,000 rows, `statement_timeout` 15s, 40 columns, 25 conditions.
9. **Auditing.** Should report *exports* get a new `"EXPORT"` audit action (real
   data-egress significance), or is that scope creep? Saved-report CRUD is audited
   either way.
10. **React component tests.** No jsdom/Testing Library today (Vitest is `node`-only).
    Add the frontend test stack now, or keep logic in testable `src/lib` helpers and
    click-test components? Recommendation: the latter for v1.
11. **Explicitly out of scope unless told otherwise:** scheduled/emailed reports (no
    mail infrastructure exists at all in this repo), charts on report output (Recharts
    is present, would be cheap, but is a distinct feature), cross-install report sharing.
12. **Manual placement.** New "Module 11: Custom Reports (Plus only)" after Module 10
    in `MANUAL_Administrator.md` — confirm.

## Relevant files
`CLAUDE.md`, `HANDOFF_2026-09-07-quoting-and-approval.md` (lines 293-316),
`prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/license.ts`, `src/lib/pdfDoc.ts`,
`src/lib/quote.ts`, `src/lib/import/mappingSchema.ts`, `src/lib/import/readers.ts`,
`src/app/api/analytics/route.ts`, `src/app/api/invoices/[id]/pdf/route.ts`,
`src/app/page.tsx`, `src/types.ts`, `src/components/shared/Modal.tsx`, `package.json`,
`MANUAL_Administrator.md`.
