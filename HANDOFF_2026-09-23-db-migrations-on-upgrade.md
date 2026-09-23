# Handoff — 2026-09-23 (2): installed apps now apply database migrations on upgrade

## Where this picks up

Read `HANDOFF_2026-09-23-dispatch-improvements.md` first. It found the gap fixed here and still has an open real-device checklist. The 09-12 installer blocker still stands.

## The problem

`electron/postgres.js` applied `resources/db/schema.sql`, all migrations concatenated, **only on first launch**. An in-place upgrade never got new columns, so every query on a changed model failed. That already covered `InventoryItem.isService` (PR #6) and `Job.arrivalTime`/`Client.contactPhone` (the dispatch work). Nothing built after the customer's first install could safely be shipped to them.

## What shipped

- **`electron/migrate.js`** (new) — the migration runner.
  - Tracks applied migrations in Prisma's own `_prisma_migrations` table, in Prisma's row format and checksum, so `prisma migrate status`/`deploy` agree with it.
  - Handles three states:
    - **empty** — apply everything.
    - **tracked** — apply only the missing migrations.
    - **legacy** — an install made from the old `schema.sql`, with no tracking table. The frozen `LEGACY_PROBES` list identifies which migrations are already present (longest prefix of passing probes); those are recorded without running, and the rest run.
  - Each migration runs in its own transaction.
  - Before changing a non-empty database it takes a `pg_dump` to `<appData>/whitevanops/pre-upgrade-backups/` (newest 3 kept). If that dump fails, nothing is changed.
- **`electron/postgres.js`** runs it on first run (replacing the `schema.sql` read), on every later managed start, and on the "already has our database running" reuse path. If a migration fails, it stops the Postgres it started before rethrowing; `main.js` shows its existing startup-error dialog.
- **`scripts/electron-build.js`**
  - Step 5 now writes `.next/db/migrations.json` (via `buildBundle()`) instead of `schema.sql`.
  - New step 7d fails the build if the packaged bundle's entry count doesn't match the repo's migrations.
- **Tests:** `electron/migrate.test.js` has 13 tests. `vitest.config.ts` now includes `electron/**/*.test.js`, and `package.json` `build.files` excludes test files from `app.asar`.
- **Docs:**
  - `MANUAL_Setup_Installation.md`: §6 "What happens to the database on an upgrade", plus §12 and §13 updates.
  - `docs/MANUAL_Troubleshooting.md`: new §3.2b "Database upgrade failed".
  - `CLAUDE.md`: new migrations bullet and rules.

## Verified

- `npx tsc --noEmit` is clean. `npm test` passes 600/600. `npm run build` passes. ESLint on the changed files shows only 2 warnings that already existed.
- The bundle's checksums match `sha256sum` of each `migration.sql`.
- **End to end with the real `ensurePostgres()`** against the system's PostgreSQL 16 binaries, standing in for the bundled ones:
  1. **Fresh install** — 13 applied, admin bootstrapped, and `prisma migrate status` says "Database schema is up to date!"
  2. **Relaunch** — no-op. The reuse path (Postgres already running) is also a no-op.
  3. **Legacy install** (tracking table dropped, last two migrations reverted, customer rows inserted) — dump written and readable by `pg_restore --list`, 11 recorded as present, 2 applied, data intact, `prisma migrate status` up to date.
  4. **Broken migration** — startup error names it, its partial DDL rolled back, nothing recorded, Postgres stopped.
  5. **`pg_dump` missing** — aborts before any change, Postgres stopped.
  6. **Database created by `prisma migrate deploy`** — the runner is a no-op.

## Not done / needs attention

- **No real installer or real Windows/macOS upgrade was run** (still blocked; no `pgsql/` binaries here). When an installer exists:
  1. Install an **older** build and add data.
  2. Install the new build over it.
  3. Confirm the startup succeeds, the data survives, a `.dump` appears in `pre-upgrade-backups`, and the dispatch features (arrival time, client phone) save.
- Windows line endings: if the build machine checks migrations out with CRLF, the recorded checksums differ from a Unix checkout's. The runner doesn't care, but `prisma migrate status` run elsewhere against that database would report them as modified. Consider a `.gitattributes` `*.sql text eol=lf` rule if that ever shows up.
- The office PM2 database and any external database still need `npx prisma migrate deploy` by hand (documented in §12).

## Next session should

1. Pick up the dispatch handoff's real-device checklist together with the upgrade test above, once an installer can be built.
