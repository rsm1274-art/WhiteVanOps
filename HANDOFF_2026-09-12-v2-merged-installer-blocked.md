# Handoff — 2026-09-12: v2.0 merged to main — installer not yet built

## Where this picks up

Yesterday's handoff (`HANDOFF_2026-09-11-v2-wifi-sync-and-export-recovery.md`) covers the full
v2.0 build in detail — read it first if you haven't. This note is short: it records what happened
since (the PR, the merge) and the one concrete blocker discovered this morning — **there is no
installer for v2.0 yet, and this environment cannot build one.**

## What happened since yesterday

- Opened [PR #3](https://github.com/rsm1274-art/WhiteVanOps/pull/3),
  `claude/wonderful-ramanujan-jknayi` → `main`, carrying all 7 v2.0 phases as separate commits.
- Both CI checks (`check`, `check-macos`) passed on the first run. No merge conflicts, no review
  comments were ever posted.
- **Merged into `main`.** v2.0 is now the head of `main` as of commit `8b7c2b1` and everything
  after it.

## No installer exists for this version

Checked this morning: no `dist-electron/` output anywhere, and — critically — the binaries
`scripts/electron-build.js` hard-fails without are **not present in this environment**:

- `pgsql/bin/pg_ctl.exe` (Windows bundled PostgreSQL, ~133 MB, gitignored)
- `pgsql-mac/bin/pg_ctl` (macOS bundled PostgreSQL via Postgres.app, ~160 MB, gitignored)

Neither has ever been staged here. `MANUAL_Setup_Installation.md` §1 documents how to source both.

This is a **sandbox/environment limitation, not a code problem** — the electron-build pipeline
itself is unchanged and was working before v2.0 (Phase 1 only removed the `--base`/`--plus` axis
and cloudflared bundling from it; the core packaging logic is untouched). Separately, per
CLAUDE.md: the macOS `.dmg` build **must run on a real Mac** — this repo's environment cannot
cross-compile it regardless of binary availability.

## Next session should

1. **Get onto a machine that actually has the pgsql binaries staged**, or source them fresh per
   `MANUAL_Setup_Installation.md` §1 (Windows: portable PostgreSQL 17.6; macOS: extracted from a
   Postgres.app install).
2. Confirm `.env.local` exists with `DATABASE_URL`/`SESSION_SECRET` at the repo root.
3. Build the Windows installer: `npm run electron:build` → expect
   `dist-electron/WhiteVanOps-Setup.exe`. Verify step 7 of yesterday's checklist while you're
   there: exactly one artifact, no `cloudflared` anywhere in `win-unpacked/resources/`.
4. For macOS, this needs an actual Mac with `pgsql-mac/` staged: `npm run electron:build:mac` →
   expect both `WhiteVanOps-Setup-arm64.dmg` and `WhiteVanOps-Setup-x64.dmg`.
5. Once a Windows build exists, this is also the point to work through the rest of yesterday's
   manual-verification checklist (items 1–6) — none of that has been done yet either, and building
   the installer is a prerequisite for testing on a real phone against a packaged app rather than
   `next dev`.

## Still true from yesterday

Nothing in the v2.0 effort has been run in a live app or on a real phone. That has not changed —
today only added "and there is no installer to run it from yet" on top of that. Don't ship until
both are resolved.
