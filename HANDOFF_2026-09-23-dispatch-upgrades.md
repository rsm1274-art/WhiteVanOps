# Handoff — 2026-09-23: dispatch usability upgrades

## Where this picks up

Read `HANDOFF_2026-09-13-field-queued-write-overwrite-bug.md` and
`HANDOFF_2026-09-12-v2-merged-installer-blocked.md` too — the installer still hasn't been built,
so nothing below (or the 09-13 fix) has been checked on a real phone + packaged app yet.

The owner asked for a dispatch review (how jobs get assigned to techs/vans/equipment and how techs
receive them), then asked for all its recommendations to be built. Constraints they set: no new
complexity, no new communication channels, LAN-only, no push. The business is mixed — some days a
tech does several short jobs, other days one big job.

Owner decisions on the review's open choices: sort key = `arrivalTime` "HH:MM" (not a sequence
integer); add `Client.contactPhone`; include the job-list overflow menu and Today/This Week filters.

## What shipped

1. **Same-day double-booking is a warning, not a block (techs and vans only).** `checkJobConflicts`
   now returns `{ error, warnings }`. Still blocked: time off, open repairs, equipment already
   booked. `/api/jobs` returns 409 `{ needsConfirmation, warnings }`; the modals ask "Book anyway?"
   (`src/lib/jobSubmit.ts`, plain `window.confirm`). Recurring generation creates these
   occurrences and reports them under `warnings`; the toast says how many dates share a tech/van.
   Live modal notice is now two boxes: red (will be refused) and amber (will ask to confirm) —
   `src/components/shared/ConflictNotice.tsx`.
2. **Within-day order:** `Job.arrivalTime` (nullable "HH:MM") + `Job.arrivalWindow` (nullable free
   text). Migration `20260923120000_dispatch_arrival_and_client_phone`. Input on Add/Edit Job
   (`ArrivalFields.tsx`), carried by Clone. Shown and sorted on field cards, CRM table, Overview,
   Scheduling. Not added to recurring templates (see "Not done").
3. **Field list grouped** into Today / Upcoming / Overdue-or-Earlier, collapsible
   (`src/lib/fieldGroups.ts`).
4. **New/Updated badges** on field cards (`src/lib/jobSeen.ts`). First load after upgrade
   baselines everything (no badge flood). Own writes are tracked as "self-touched" and re-stamped
   once their queued ops are gone from the sync queue.
5. **Scheduling tab** shows "On leave (type)" / "Out of service", hides Retired vans, shows open-job
   and no-van counts, has **+ Schedule Job** (prefills the date — `AddJobModal` got an explicit
   `isClone` prop since `initialValues` no longer implies clone), and job chips open Edit Job.
6. **Maps + phone:** address is a `maps.google.com/?q=` link; `Client.contactPhone` is a `tel:` link.
   Because there was no way to edit an existing client, `AddClientModal` gained an edit mode
   (pencil on the client card) backed by a new `PUT /api/clients`.
7. **CRM job list:** Re-open only on Completed rows; Costs/Clone/Cancel moved into a "⋯" menu; date
   quick filters Any Date / Today / This Week (Mon–Sun). Removed `overflow-hidden` from the table
   wrapper so the menu isn't clipped.
8. **Security side finding fixed:** `GET /api/field` now requires a session and forces a tech to
   their own `personnelId`; the picker list for a tech is only their own record.

Manuals updated: `MANUAL_Administrator.md` (client phone/edit, arrival fields, conflict notices,
row actions/filters, Scheduling Engine rewrite, recurring generation), `MANUAL_Field_Tech.md`
(grouping, badges, maps/phone links, tech-only sees own jobs). `CLAUDE.md` gained a "Dispatch"
section and the new test modules.

## Verified

- `npx tsc --noEmit` clean; `npm test` 583 passing (new: `arrival`, `fieldGroups`, `jobSeen`,
  extended `jobConflicts`); eslint shows no new findings vs. base on touched files.
- Migration applied with `prisma migrate deploy` to a scratch Postgres 16; `prisma migrate diff`
  against `schema.prisma` is empty.
- Against that DB with `next dev` + seed: second same-day booking → 409 with warnings; confirmed →
  created; equipment double-book still 400 even when confirmed; bad arrival time → 400; client PUT
  trims phone; seeded tech `tech.trent` requesting Dave's `personnelId` gets only Trent's jobs and a
  one-name picker.
- Playwright (headless Chromium): Scheduling tab (out-of-service van, chips with times), Add Job
  modal amber notice + "Book anyway?" dialog → job created, CRM overflow menu, `/field` grouping,
  maps/phone links, and a **New** badge after the office added a job. No page errors.

## Not done / follow-ups

- **Pre-existing bug found, not fixed:** jobs store `scheduledDate` as UTC midnight
  (`new Date("2026-10-05")` in `/api/jobs`), the same off-by-one fixed for time entries on 09-12 —
  in US timezones jobs likely display a day early. Queued as a separate task; worth confirming with
  the owner whether they've seen it.
- `arrivalTime`/`arrivalWindow` are not on `RecurringJobTemplate`, so generated jobs have no time.
  One more nullable pair + form fields if the owner wants it.
- `contactPhone` isn't in the onboarding import mapping (`src/lib/import/`).
- Not tested on a real phone over LAN, or in the packaged app (no installer — see 09-12 handoff).
  The manual checklist for next session: book two same-day jobs for one tech in the desktop app;
  confirm time off/equipment still block; on a phone, check grouping, a badge after an office edit,
  no badge after the tech's own note, and that the maps/phone links open the right apps.
