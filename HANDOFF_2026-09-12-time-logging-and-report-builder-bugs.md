# Handoff — 2026-09-12: fixed two live bugs from the owner's first trial run

## Where this picks up

Read `HANDOFF_2026-09-13-field-queued-write-overwrite-bug.md` first (despite the date on
that file — this session actually followed it chronologically). This session picks up two
new bug reports from the owner after installing and using the app for real:

1. Logging time for an employee on a given date saved it under the **previous day**.
2. The Report Builder lets you pick fields/filters but **fails to run the report** — no
   output, just a failure.

## Bug 1 — time entry date off-by-one

**Root cause:** `POST /api/time` (`src/app/api/time/route.ts`) and the field module's
`logTime` (`src/lib/fieldOps.ts`) both stored the date-only string from the form
(`"2026-07-04"`) with `new Date(date)`. `new Date("2026-07-04")` parses as **UTC midnight**.
Every other date-write path in this codebase (invoices, quotes, payments — see
`src/app/api/invoices/route.ts`, `src/app/api/quotes/route.ts`, etc.) instead does
`parseLocalDate(\`${date}T12:00:00\`)`, which anchors the stored value to **local noon**.
The read side (`dateUtils.ts`'s `parseLocalDate`/`formatDate`/`dateToLocalStr`) reads a
stored UTC timestamp back using **local** getters (`getFullYear`/`getMonth`/`getDate`) — that
contract only round-trips correctly if the write side also stored local noon. Time entries
were the (only) two write paths that skipped this convention, so in any negative-UTC-offset
timezone (all of the US), a UTC-midnight timestamp is the *previous evening* locally, and the
date rolled back a day on display. This is exactly the reported symptom (7/4 entered → shows
as 7/3).

**Fix:** both `src/app/api/time/route.ts` and `logTime` in `src/lib/fieldOps.ts` now do
`parseLocalDate(\`${date}T12:00:00\`)`, matching every other date-write path in the app.
Updated the one test in `src/lib/fieldOps.test.ts` that had hardcoded the old (buggy)
expectation.

**Verified live, not just by reading code:** spun up a throwaway PostgreSQL 16 instance,
ran `prisma migrate deploy` (all 11 migrations apply cleanly) and the seed script against
it, then ran a script under `TZ=America/New_York` that reproduced the exact bug against the
pre-fix code (`new Date("2026-07-04")` → stored `2026-07-04T00:00:00.000Z` → displayed
`2026-07-03`) and confirmed the fix (`parseLocalDate("2026-07-04T12:00:00")` → stored
`2026-07-04T16:00:00.000Z` → displayed `2026-07-04`).

## Bug 2 — Report Builder never runs

**Root cause:** `src/lib/reports/run.ts` set the per-report statement timeout with
`` sql`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}` ``. Kysely's `sql` tag turns
every `${...}` into a **bound query parameter** (`$1`), but PostgreSQL's `SET`/`SET LOCAL`
statements do not accept bound parameters at all — only literal values. Every single report
run (preview, save-and-run, export) hit this on its very first query inside the transaction
and failed with `error: syntax error at or near "$1"` before ever reaching the actual report
query. This matches the previous handoff's admission that **the entire report builder
feature had never been exercised against a live database** — this bug would have failed
100% of the time, in every environment, the moment anyone tried to actually run a report.

**Fix:** `sql.raw(\`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}\`)` — inlines the
constant as a literal instead of a parameter. Safe because `STATEMENT_TIMEOUT_MS` is a
hardcoded `15_000`, never user input.

**Verified live:** against the same throwaway database (seeded, migrated), confirmed the
pre-fix code throws `syntax error at or near "$1"` when running a real report definition
(`job.status` + `job.scheduledDate` columns), and confirmed the post-fix code returns rows
successfully (`rows: 3, totalRows: 3`).

## Testing

`npx tsc --noEmit` clean, `npm test` 563/563 passing, `npm run build` succeeds. Both fixes
additionally verified against a real (throwaway, disposable) PostgreSQL instance as described
above — this is the first time either of these code paths has actually been run against a
database in this repo's history, not just unit-tested with mocks.

**Not done:** did not re-test on a real phone/device or through the actual browser UI — this
session verified at the library/DB level (calling `runReport()` and the time-entry Prisma
write directly), which is sufficient to prove both root causes and both fixes, but the owner
should still click through both flows (Log Time modal on the dashboard, Reports tab →
build → run) in their own installed app to confirm end-to-end.

## Next session should

1. If the owner reports either fix didn't fully resolve their symptom, re-check for a
   second, distinct bug rather than assuming these fixes were incomplete.
2. Report Builder is otherwise still exactly as untested as the 2026-09-09 handoff
   describes beyond this one query bug — CSV/XLSX/PDF export, saved reports, folder
   permissions, and the Base/Plus gate (now moot post-v2.0) have still never been
   clicked through in a live app. Worth a fuller pass now that the basic run path
   actually works.
3. The same `new Date(dateStr)`-instead-of-`parseLocalDate` pattern that caused Bug 1 also
   exists in `src/app/api/jobs/route.ts` (`scheduledDate`) and
   `src/app/api/recurring-jobs/route.ts` (`startDate`/`endDate`) — not reported as broken by
   the owner yet, but the exact same class of bug. Worth fixing proactively or asking the
   owner if they've noticed job/recurring-job dates shifting too.
