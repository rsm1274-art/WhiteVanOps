# Handoff — 2026-09-09: macOS build status + report builder, both pending on main

## Where this picks up

This note lives on `main` so it isn't missed. The actual work is NOT on `main` yet —
it's on two branches, both pushed to GitHub:

- **`feat/macos-support`** — macOS support (Phases 1-4) plus the report builder merged
  into it. This is the branch to pick up next time.
- **`feature/report-builder-plus`** — the report builder alone, before it was merged
  into `feat/macos-support`. Kept for reference; `feat/macos-support` already has it.

Neither branch is merged into `main`. `main` is currently 15 commits behind
`feat/macos-support`.

## Owner's stated priority: finish the macOS build next

## What's done (on `feat/macos-support`)

- macOS Electron support: Dock behavior, cross-platform binary handling, LAN firewall
  script (`allow-field-access.sh`), admin-password recovery script
  (`reset-admin-password.sh`), CI job (`check-macos`, runs `tsc` + `npm test` on
  `macos-latest`), doc updates (CLAUDE.md, both manuals).
- The report builder (Plus tier): field registry, query engine, drag/drop builder UI,
  saved reports/folders/sharing, CSV/XLSX/PDF export. Fully built, 478 tests passing.
  Plan doc: `docs/superpowers/plans/2026-09-09-report-builder-plus.md`. Full detail:
  `HANDOFF_2026-09-09-report-builder.md`.
- All 4 Windows installers rebuilt today with both of the above included
  (`dist-electron/WhiteVanOps-{Base,Plus}-{,Trial-}Setup.exe`, commit `58a753a`).

## What's NOT done — blocking a real macOS build

- **Two folders of Mac-only binaries are missing: `pgsql-mac/` and `cloudflared-mac/`.**
  Without these, a Mac build cannot be produced at all — this isn't "untested," it's
  "cannot run yet." See `MANUAL_Setup_Installation.md` §1 for how to obtain them
  (Postgres.app for `pgsql-mac/`, the official `cloudflared` release for
  `cloudflared-mac/`).
- **No macOS installer (`.dmg`) has ever been built, by anyone.** `npm run
  electron:build:mac` (and its `:plus`/`:trial`/`:trial:plus` variants) must run ON a
  real Mac — this repo's Windows environment cannot cross-compile it.
- **The two new recovery scripts have never executed on real macOS**
  (`allow-field-access.sh`'s `socketfilterfw` call, `reset-admin-password.sh`'s
  `ELECTRON_RUN_AS_NODE=1` exec) — both are written to match documented/observed
  behavior but unverified for real.
- **`check-macos` CI job has never run** — it fires on the next push of
  `feat/macos-support` to GitHub; watch the first run for anything mac-runner-specific.
- **No cross-machine "client mode" test** (one Mac as host, other machines as clients
  sharing its database) — untested on any real hardware combination.
- **The report builder has never been opened in a live browser against a live
  database, on any platform.** All 478 tests are unit tests; a database-backed
  migration was verified only against a disposable, throwaway Postgres instance, not
  the real app. Build a report, save it, export it, before relying on it.

## Next session should

1. Get on a real Mac.
2. Pull `feat/macos-support` from GitHub, run `git checkout feat/macos-support`.
3. Get `pgsql-mac/` and `cloudflared-mac/` in place per `MANUAL_Setup_Installation.md` §1.
4. `npm run electron:build:mac` (and the 3 variant scripts) — first real Mac builds.
5. Exercise `allow-field-access.sh` and `reset-admin-password.sh` for real.
6. Click through the report builder in the running app — build/save/export a report —
   on whichever platform is convenient first (doesn't have to be the Mac).
7. Once macOS is confirmed working, decide whether to merge `feat/macos-support` into
   `main`, or continue staging further work on it first.
