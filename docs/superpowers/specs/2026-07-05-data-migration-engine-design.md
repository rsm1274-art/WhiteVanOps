# Data Migration Engine — Design

**Date:** 2026-07-05
**Status:** Approved (Approach A: two-phase CLI with mapping file as the contract)

## Problem

Onboarding a new WhiteVanOps customer means moving their existing operational
data (from spreadsheets, or from another FSM tool's export converted to
spreadsheets) into a fresh WhiteVanOps database. Each customer's schema is
unknown in advance — column names, sheet layout, status vocabulary, and date
formats all vary. Doing this by hand per customer is slow and error-prone.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Source formats | CSV and Excel only. PDFs / FSM database dumps are converted to spreadsheets first, ad-hoc, outside the engine. |
| Migration scope | Master data (clients, personnel + qualifications, vehicles, equipment, inventory, stock locations/levels) plus open/scheduled jobs (with assignments, equipment links, line items). Completed/cancelled job history stays in the old system. |
| Operator | The developer, via CLI (`npx tsx`), during onboarding. No admin UI. |
| Interpretation | Propose-then-review: heuristics write a proposed `mapping.json`; the operator reviews/edits it; the import executes it deterministically. No AI/API dependency. |
| Run semantics | Fresh (empty) database only; single all-or-nothing transaction. Wipe-and-retry via `prisma migrate reset` + `prisma/bootstrap.ts` + rerun. |

## Architecture

Two thin CLI entry points; all logic in pure, unit-testable modules.

```
scripts/import/analyze.ts        # CLI: sniff data files → write mapping.json
scripts/import/run.ts            # CLI: validate mapping → dry-run report → --commit

src/lib/import/
  readers.ts        # CSV (papaparse) + Excel (exceljs) → uniform rows with provenance (file, sheet, row #)
  detect.ts         # entity detection + column matching (synonym dictionary, value-shape detection)
  mappingSchema.ts  # mapping.json TypeScript types + validator
  transforms.ts     # named transforms: date normalization, HH:MM duration, currency→float, trim, valueMaps
  resolve.ts        # in-memory FK resolution via natural keys
  execute.ts        # dependency-ordered inserts inside one prisma.$transaction (imports @/lib/db)
```

`papaparse` and `exceljs` are **devDependencies** — the engine runs via
`npx tsx` in the project checkout during onboarding and is never bundled into
the shipped app.

### Entity coverage and insert order

1. `Client`
2. `Personnel` (+ optional `PersonnelQualification` sheet)
3. `Vehicle` — auto-creates each vehicle's `StockLocation` (type "Vehicle"), matching app behavior
4. Warehouse `StockLocation`s
5. `Equipment`
6. `InventoryItem`
7. `StockLevel` (join resolved by inventory item name + stock location name)
8. `Job` — **only rows whose post-valueMap status is "Scheduled" or "In Progress"**; other statuses counted as skipped-by-scope in the report
9. `JobAssignment` / `JobEquipment` / `JobLineItem` (child sheets linked via sourceKey)

### Natural keys for FK resolution

| Entity | Key |
|---|---|
| Client | `name` |
| Personnel | `firstName` + `lastName` |
| Vehicle | `vin` |
| Equipment | `serialNumber` |
| InventoryItem | `name` |
| StockLocation | `name` |
| Job (in-memory only) | operator-designated `sourceKey` column (e.g. the customer's job number) |

`sourceKey` exists only during the import run — jobs get fresh cuids. The
original source reference is recorded in the import report, not the database.

## The mapping file

`analyze` writes `mapping.json` into the customer's data folder. It is the
entire contract between fuzzy interpretation and deterministic import, and it
is kept with the customer's onboarding records as the audit artifact of what
was mapped.

```jsonc
{
  "version": 1,
  "files": [{
    "file": "customers.xlsx",
    "sheet": "Sheet1",
    "entity": "Client",
    "headerRow": 1,
    "columns": {
      "Customer":  { "field": "name" },
      "Terms":     { "field": "paymentTerms" },
      "Contact":   { "field": "contactName", "confidence": "low" }
    },
    "defaults":   { "paymentTerms": "Net 30" },
    "unmapped":   ["Fax"],
    "unresolved": ["locationAddress"]
  }, {
    "file": "jobs.csv",
    "entity": "Job",
    "headerRow": 1,
    "columns": {
      "Job #":     { "role": "sourceKey" },
      "Customer":  { "field": "clientId", "resolveBy": "Client.name" },
      "Date":      { "field": "scheduledDate", "transform": "date" },
      "Status":    { "field": "status" }
    },
    "unmapped":   [],
    "unresolved": []
  }],
  "valueMaps": { "Job.status": { "Open": "Scheduled", "WIP": "In Progress" } }
}
```

Semantics:

- **`columns`** — source header → target field, with optional named `transform`.
- **`resolveBy`** — marks an FK field whose source values are natural keys
  (e.g. a customer name column feeding `Job.clientId`); `resolve.ts` looks the
  value up in the named entity's natural-key index at import time.
- **`confidence: "low"`** — heuristic guess flagged for human review; informational only (does not block).
- **`defaults`** — fills a required target field that has no source column (e.g. `paymentTerms`, personnel `role`).
- **`unmapped`** — source columns seen and deliberately ignored.
- **`unresolved`** — required target fields the heuristics could not cover.
  **`run.ts` hard-fails while any `unresolved` entry exists** — the operator
  must map a column or add a default. Heuristics never silently guess.
- **`valueMaps`** — per-field vocabulary translation applied before enum validation (e.g. the customer's job statuses onto "Scheduled" / "In Progress" / "Completed" / "Cancelled").

## Heuristics (`detect.ts`)

- **Entity detection:** score every sheet against every entity using header
  matches (per-field synonym dictionaries, e.g. `Client.name` ↔ customer /
  client / company / account) plus value shapes (a column of 17-char
  alphanumerics → `Vehicle.vin`; `HH:MM` values → `TimeEntry.duration`-style
  durations; date-shaped values; currency-shaped values).
- **Column mapping:** normalized header comparison (lowercase, strip
  non-alphanumerics), then synonym dictionary, then value-shape tiebreak.
- **Confidence:** strong match → mapped; weak match → mapped with
  `confidence: "low"`; no match → `unmapped`; required field with no candidate
  → `unresolved`.

## Data flow (`run.ts`)

Dry-run by default; writes are opt-in.

1. **Load + validate mapping** — schema-validate `mapping.json`; hard-fail on
   any `unresolved` entry, missing file/sheet/column, unknown transform or
   field name, or a required target field covered by neither a column nor a
   default.
2. **Extract** — read all mapped rows with provenance (file, sheet, row number).
3. **Transform** — apply named transforms and valueMaps; collect per-row errors.
4. **Resolve** — build in-memory natural-key indexes; resolve every FK
   reference; unresolvable references reject the row.
5. **Validate** — enum vocabulary (e.g. `Job.status`), unique constraints
   (VIN, serialNumber, item+location), required fields present after defaults.
6. **Report** — write `import-report.json` + console summary: per entity,
   counts of importable / rejected (with reason and `file:row`) / skipped-by-scope.
7. **Commit** (only with `--commit`) — single `prisma.$transaction`, inserts in
   dependency order.

### Date handling

The app's write APIs store dates as `new Date("YYYY-MM-DD")` (UTC midnight);
local-noon parsing happens on the display side (`src/lib/dateUtils.ts`).
The import does the same: `transforms.ts` normalizes source dates (multiple
input formats, explicit format detection — ambiguous formats like `MM/DD/YYYY`
vs `DD/MM/YYYY` are an analyze-time flag for the operator to confirm) to a
`YYYY-MM-DD` string, and `execute.ts` stores `new Date(ymd)` exactly as the
API routes do.

## Error handling

- Row-level problems are **collected, never thrown** — analysis and dry runs
  always complete and report everything found.
- `--commit` **aborts if any rows were rejected**, unless `--skip-rejected` is
  passed, which imports only the clean rows (still one transaction). Either
  way the report lists exactly what was and wasn't imported.
- `--commit` **refuses to run against a non-empty database** (any rows in the
  imported entities' tables). Retry path: `npx prisma migrate reset` →
  `npx tsx prisma/bootstrap.ts` → rerun.
- **No `AuditLog` rows are written** — the CLI runs with no session user. The
  mapping file plus `import-report.json` are the durable audit artifacts.

## Testing

Vitest, following the existing `src/lib/` conventions:

- `readers`, `detect`, `transforms`, `mappingSchema`, `resolve` — pure modules
  tested directly with fixture CSV/Excel files and inline row data.
- `execute` — `@/lib/db` mocked with `vi.mock` (never imported for real),
  per the `jobConflicts.ts` convention; assert insert order, transaction
  boundaries, empty-DB guard, and `--skip-rejected` behavior.
- Fixture files live under `src/lib/import/__fixtures__/`. Keep fixture
  values short / non-secret-shaped to stay clear of `scripts/scan-secrets.js`.

## Documentation

`MANUAL_Setup_Installation.md` gains an "Onboarding data import" section
covering the two commands, the mapping-file review step, and the
wipe-and-retry procedure. `MANUAL_Administrator.md` and `MANUAL_Field_Tech.md`
are unaffected (no UI change).

## Out of scope

- PDF/table extraction, FSM-specific export readers, pre-baked source profiles
- Admin UI / self-service import
- Idempotent upsert, merging into a live database, deduplication
- Historical (completed/cancelled) jobs, time entries, maintenance logs
- `TimeEntry`, `PersonnelTimeOff`, `RecurringJobTemplate`, `User` import
