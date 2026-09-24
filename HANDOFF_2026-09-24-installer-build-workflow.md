# Handoff — 2026-09-24: installers built on GitHub Actions

## Where this picks up

Follows `HANDOFF_2026-09-24-single-installer-trial.md` (merged to main with PR #7). That handoff's real-device checklist is still open, and it can now be worked because installers exist.

## Status

Merged to main as [PR #9](https://github.com/rsm1274-art/WhiteVanOps/pull/9). The workflow now lives on the default branch, so **Actions → Build installers → Run workflow** (branch: `main`) works. Installers from the validation run are downloadable until 2026-10-24; for anything after that, run the workflow again.

## What the owner asked for

Build both installers (Windows and Mac) with GitHub Actions, so nobody needs a local build setup.

## What shipped

- **`.github/workflows/build-installers.yml`** runs manually (Actions → **Build installers** → Run workflow) or when a `v*` tag is pushed.
  - `windows` job: downloads the EDB PostgreSQL 17.6 binaries zip into `pgsql/`, prunes it, runs `npm run electron:build`, and uploads the `WhiteVanOps-Windows` artifact (`WhiteVanOps-Setup.exe` + buildinfo).
  - `macos` job: runs `scripts/ci/stage-pgsql-mac.sh`, then `npm run electron:build:mac`, and uploads `WhiteVanOps-macOS` (both `.dmg`s + buildinfo).
  - Artifacts are kept for 30 days.
- **`scripts/ci/stage-pgsql-mac.sh`** (new) automates the manual §1 Mac steps:
  - Takes the latest Postgres.app PG 17 dmg (via `gh`), or a dmg path passed as an argument.
  - Copies the four binaries, the `otool`-computed dylib closure, `plpgsql`/`dict_snowball` and `share/postgresql`.
  - Self-tests the result: initdb, start, pg_dump, stop.
  - It also works on a developer's Mac.
- **`scripts/electron-build.js`** passes `--publish never`. electron-builder auto-publishes when it detects CI and failed with "GitHub Personal Access Token is not set".
- **`package.json`** `build.mac.identity: "-"` makes Mac builds ad-hoc signed. Without it, electron-builder skips signing, and Apple Silicon reports the app as "damaged" instead of offering right-click → Open.
- **Docs:**
  - `MANUAL_Setup_Installation.md` §6: new "build on GitHub" subsection.
  - `CLAUDE.md`: signing bullet and a workflow paragraph under Testing.
  - `docs/BUSINESS_Purchase_to_Install_Playbook.md`: step 4.

## Verified

Validation run [35943854949](https://github.com/rsm1274-art/WhiteVanOps/actions/runs/35943854949), on a temporary branch trigger that has since been removed:
- Both jobs passed, including every `electron-build.js` packaging assertion and the Mac Postgres self-test.
- Artifacts: Windows 186 MB, macOS 484 MB (both dmgs).
- Each job takes about 5 minutes.

## Not done / needs attention

**Next step for the owner:** download the artifacts, install them on a Windows PC and a Mac, and work through the checklist below together with the previous handoff's.

- **Install the built artifacts on real machines.** Run the checklist in the previous handoff: first launch → trial / activation / client mode, the upgrade migration, and field access.
- On a Mac, confirm the ad-hoc-signed app opens after right-click → Open (or System Settings → Privacy & Security → Open Anyway), and that the bundled Postgres starts.
- The Windows installer is unsigned, so SmartScreen shows "More info → Run anyway".
- Windows PostgreSQL is pinned to 17.6-1 in the workflow URL; bump it by hand. The Mac job always takes the newest Postgres.app PG 17 release.
- A per-customer build with a bundled `.env.local` still has to be made by hand. The workflow only makes generic builds.
