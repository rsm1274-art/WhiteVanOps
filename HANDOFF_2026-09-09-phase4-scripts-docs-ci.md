# Handoff — 2026-09-09: Phase 4 (macOS scripts, docs, CI) — done

## Where this picks up

Same day as [`HANDOFF_2026-09-09-client-mode.md`](HANDOFF_2026-09-09-client-mode.md) (Phase 3,
shared-database/client mode — committed as `4976c2a`) and the follow-up doc fix (`2e13804`,
the mac `cloudflared` lipo step Phase 2 had left undocumented). This session closes out
Phase 4 of [`PLAN_2026-09-08-macos-support.md`](PLAN_2026-09-08-macos-support.md): the
macOS-parity recovery scripts, doc updates, and CI job. Branch: `feat/macos-support`.

## What's done

- **`scripts/recovery/allow-field-access.sh`** (new) — macOS counterpart to
  `allow-field-access.ps1`. Uses `socketfilterfw --add`/`--unblockapp` on
  `/Applications/WhiteVanOps.app` (default; `--app-path` overrides). Unlike Windows, macOS's
  Application Firewall is per-app, not per-port, so there's no port argument. Prints the two
  other things that produce the identical "white screen that never loads" symptom if
  missed: the one-time "Accept incoming network connections?" system prompt, and — new on
  macOS 15+ — the Local Network permission toggle. `--remove` undoes it. Requires root
  (checked, with a clear re-run-with-sudo message).
- **`scripts/recovery/reset-admin-password.sh`** (new) — macOS counterpart to
  `reset-admin-password.ps1`, calling the *same* `reset-admin-password.js` both wrappers
  already shared. Simpler than the Windows version: no `Start-Process`/exit-code workaround
  needed, since WhiteVanOps's macOS binary is a normal foreground executable. Same
  `ELECTRON_RUN_AS_NODE=1` trick to borrow the packaged Electron binary as a Node
  interpreter. `--list`/`--create`/`--username`/`--install-dir` flags mirror the `.ps1`'s
  parameters.
- **`scripts/recovery/reset-admin-password.js`** — added an `.app/Contents/Resources/nextjs`
  candidate to `resolveNextjsDir()` (both the explicit `--install-dir` branch and the
  walk-up-from-script branch), so passing a `WhiteVanOps.app` path or running the script from
  inside an installed bundle finds `.env.local` in the macOS layout, not just the Windows
  `resources/nextjs` one. Updated the `--help` text to show both wrapper invocations.
- **`CLAUDE.md`** — the Electron desktop app section had never been updated for the mac work
  landed in the earlier two sessions (Phase 1/2's commit never touched it), so this pass
  corrected several now-false statements ("packaged as a Windows desktop application",
  "Windows is the only build target", installer-output list missing `.dmg`s) and added:
  - A new "cross-platform-binary pattern" bullet generalizing the `isWin`/`bin()` idiom
    used in `postgres.js`/`backup.js`/the backup API route.
  - A new bullet on why generated per-install config (`.env.local`, `host.json`,
    `license.json`, `pgdata`) must live under `app.getPath('appData')` and never under
    `resourcesPath`/`Contents/Resources` — ties together facts that were previously only
    in scattered code comments.
  - macOS Dock behavior (`window-all-closed`/`activate`), `lanAddresses.ts`'s mac virtual
    adapter markers, the mac `package.json` build block
    (`hardenedRuntime`/entitlements/`NSLocalNetworkUsageDescription`, deferred signing),
    the per-arch `${arch}` artifact-naming fix from the mac packaging session, and the new
    `check-macos` CI job (below).
  - Updated the "Customer-machine admin recovery" and "Field-tech LAN access" command
    blocks near the top of the file to list both the `.ps1` and new `.sh` invocations.
- **`MANUAL_Setup_Installation.md`** §7 — added "Step 3 (macOS)": the
  `allow-field-access.sh` walkthrough, the incoming-connections prompt, and the macOS 15
  Local Network permission — parallel to the existing Windows Step 3.
- **`docs/MANUAL_Troubleshooting.md`** §3.4 — added the macOS `reset-admin-password.sh`
  walkthrough alongside the existing Windows one (same numbered command list shape, same
  "how it works" framing), and a one-line pointer to `allow-field-access.sh` in §2.3's
  "firewall reset" bullet.
- **`.github/workflows/ci.yml`** — new `check-macos` job (`runs-on: macos-latest`),
  deliberately narrower than the existing `check` job: install, `prisma generate`, `tsc`,
  `npm test` only — no `next build`, no storefront check, no electron packaging. It exists
  to catch a shared-code-path regression that only breaks on macOS (an unguarded
  `process.platform` branch, a Windows-only path assumption) before it reaches a Mac build,
  not to build or package anything — the real `.dmg` build needs the gitignored,
  machine-local `pgsql-mac/`/`cloudflared-mac/` binaries and can only run by hand on an
  actual Mac.

**Verified:** `npx tsc --noEmit` clean, `npm test` → 312/312 pass (same baseline as every
prior session on this branch), `bash -n` on both new shell scripts, `node --check` on the
edited `.js`, and the CI YAML parses (`python3 -c "import yaml; ..."`) with both `check` and
`check-macos` jobs present. **Not verified:** the shell scripts have not actually run on a
Mac (this container is Linux and has no `socketfilterfw`, no `WhiteVanOps.app`, no packaged
Electron binary to exec) — that's the next-session Mac task, listed below.

## What's NOT done

- **The two new `.sh` scripts have never executed on real macOS.** `allow-field-access.sh`'s
  `socketfilterfw` invocation and `reset-admin-password.sh`'s `ELECTRON_RUN_AS_NODE=1` exec
  of `Contents/MacOS/WhiteVanOps` are both written to match documented/observed behavior
  (the latter mirrors a working `.ps1`/`.js` pair, the former follows Apple's documented
  `socketfilterfw` flags) but neither has been run for real. First real Mac session should
  exercise both against an actual install.
- **`check-macos` CI job has not run yet** — it goes live on the next push to this branch
  (or any branch) once this commit reaches GitHub Actions. Watch the first run for anything
  macOS-runner-specific that doesn't show up on `ubuntu-latest` (npm/node quirks, path
  separators in test fixtures, etc.).
- Phase 3's still-open items are unchanged by this session: no cross-machine client-mode
  test, no `npm run electron:build` regression run (this container still has no `pgsql/`
  binaries). See `HANDOFF_2026-09-09-client-mode.md` for the full list.
- **Not attempted, deliberately:** a full audit of `docs/MANUAL_Troubleshooting.md` for
  macOS parity in every section (e.g. §2.3's Windows-Task-Scheduler-specific DDNS material
  has no direct mac analogue documented). Only the two sections directly tied to this
  session's new scripts were touched, to keep the change scoped to what Phase 4 actually
  asked for.

## Next session should

1. Get on a real Mac and exercise both new recovery scripts against an actual install —
   this is the one thing in this session that's unverified.
2. Watch the first `check-macos` CI run after this pushes.
3. Otherwise, per the last two handoffs: cross-machine client-mode verification (Phase 3)
   and a fresh `electron:build`/`electron:build:mac` regression pass are the two remaining
   owner-side tasks before this branch is mergeable.
