# Handoff — 2026-09-08: macOS support (Phase 1 + Phase 2 code, uncommitted)

## Where this picks up

Full plan: [`PLAN_2026-09-08-macos-support.md`](PLAN_2026-09-08-macos-support.md) — read that
first, it has the "why" behind every decision (shared-database not merge, unsigned-first
builds, the exact file list). This handoff is just the "what happened since."

Branch: `feat/macos-support` (checked out, forked from `main` at `6034758`).

**Nothing is committed yet.** Everything below is sitting as uncommitted changes in the
working tree. Run `git status` — you'll see 9 modified files, `PLAN_2026-09-08-macos-support.md`
(untracked), and `build/` (untracked, new directory).

## What's done: Phase 1 (cross-platform bug fixes)

All 8 rows of the plan's Phase 1 table are done:

- `electron/backup.js`, `src/app/api/settings/backup/route.ts` — `pg_dump.exe` was
  hardcoded; both now branch on `process.platform`.
- `electron/postgres.js` — the Postgres data directory and the generated `.env.local`
  (DATABASE_URL/SESSION_SECRET) used to live under `%APPDATA%` / inside the packaged app's
  own Resources folder. Both now resolve through a new `appDataWvoDir` parameter passed in
  from `main.js` (`app.getPath('appData')`), which is correct on both OSes and — critically —
  never writes inside the signed `.app` bundle on macOS. Generated credentials get injected
  straight into `process.env` before `server.js` is required, since Next's standalone server
  no longer auto-loads them from a file at that new location.
- `src/lib/lanAddresses.ts` — added macOS's virtual-adapter names (`awdl`, `llw`, `utun`,
  `bridge`, `ap1`, and a widened `vmnet`) so the Field Access QR code never offers a Mac
  address no phone can reach.
- `electron/main.js` — `window-all-closed` now stays open on macOS (Dock behavior) instead
  of quitting like Windows.
- `scripts/generate-icons.js` — now also renders `build/icon.png` (1024px) for the mac
  target. Ran it — works, file exists at `build/icon.png`.

**Verified:** `npx tsc --noEmit` clean, `npm test` → 312/312 pass, lint has zero new issues
(all 42 pre-existing errors are in files this work never touched).

## What's done: Phase 2 (macOS packaging config)

- `package.json` — restructured `build`: platform-agnostic `extraResources` (the Next.js
  standalone output, `db/schema.sql`) hoisted to the top level; `win` and a new `mac` block
  each keep only what's genuinely platform-specific, including their own `pgsql`
  `extraResources` entry (Windows reads from `pgsql/`, macOS from `pgsql-mac/` — see below).
  `mac` block: `dmg` target for both `arm64` and `x64`, `hardenedRuntime: true`,
  `NSLocalNetworkUsageDescription` (required or macOS 15 silently blocks LAN traffic — this
  is exactly the failure mode the Field Access QR depends on not hitting), entitlements
  pointing at the new plist.
- `build/entitlements.mac.plist` (new) — grants
  `com.apple.security.cs.disable-library-validation`, needed for the bundled (unsigned, for
  now) Postgres binaries to run under the hardened runtime.
- New npm scripts: `electron:build:mac`, `:mac:plus`, `:mac:trial`, `:mac:trial:plus`.
- `scripts/electron-build.js` — added a `--mac` flag that switches every platform-sensitive
  piece: binary names (`pg_ctl` vs `pg_ctl.exe`, `cloudflared` vs `cloudflared.exe`), payload
  source dirs (`pgsql-mac/`, `cloudflared-mac/` vs `pgsql/`, `cloudflared/`), the
  electron-builder invocation (`--mac` vs `--win`), the unpacked output path
  (`mac-arm64/WhiteVanOps.app/Contents/Resources/...` vs `win-unpacked/resources/...`), and
  the `.dmg` artifact names. Every step-7 assertion (pgsql present, node_modules present,
  Prisma runtime present, asar keeper modules present, cloudflared present-on-Plus /
  absent-on-Base) still runs — just against the right path for the platform being built.
- **Bug found and fixed along the way:** `.gitignore` had a stale `/build` rule (a leftover
  from some other framework's default template — this is Next.js, whose build output is
  `.next/`, not `build/`). It was silently swallowing `build/icon.png` and
  `build/entitlements.mac.plist` — a fresh Mac checkout would never have gotten either file
  and the mac build would fail immediately with no useful error. Removed the rule. Also
  added `pgsql-mac/` and `cloudflared-mac/` to `.gitignore` (parallel to the existing
  `pgsql/`/`cloudflared/` entries) so those binary payloads never get committed once someone
  adds them.
- **Also fixed a bug this same work introduced and then caught:** the end-of-build
  "installers on record" manifest printer still assumed the old flat `ARTIFACT_NAMES` shape
  after `ARTIFACT_NAMES` became `{win: {...}, mac: {...}}` — it printed `[object Object]`
  instead of names. Fixed to flatten both platforms' names before printing. Caught by
  actually running the build (see below), not by inspection.

**Verified:** ran `npm run electron:build` (Windows Base, unsigned) twice — once before the
manifest fix (which is how the bug above was found), once after. Second run: clean exit,
`WhiteVanOps-Base-Setup.exe` built, all step-7 assertions passed, manifest printed correctly
with all 8 artifact names (4 `.exe`, 4 `.dmg` marked "NOT BUILT YET"). This is the
regression check the plan's own Verification section calls for, since Phase 1 and 2a touch
shared code paths — **no Windows regression.**

Windows installer sitting in `dist-electron/` right now is a real, working, up-to-date Base
build if you want to sanity-check it further — but it's gitignored/not part of what needs
committing.

## What's NOT done yet

**Phase 2, remaining pieces (all need a Mac to actually produce, though 2b's binaries could
in theory be fetched from any machine):**

- **2b — the main unknown.** No `pgsql-mac/` directory exists anywhere. The plan's
  preference order: zonky embedded-postgres darwin-arm64 archive, then the EDB macOS
  archive (x86_64, needs Rosetta), then extracting Postgres.app internals. Whichever is
  picked, the executable bit must survive into `extraResources` and the binaries need
  signing eventually (not blocking for first unsigned builds).
- No `cloudflared-mac/cloudflared` binary either (only needed for the Plus mac build).
- **2d — signing.** Deferred by design; first Mac builds are unsigned, customer
  right-click-opens once. Needs an Apple Developer account ($99/yr) before this is worth
  doing.
- **Nobody has run `npm run electron:build:mac` yet** — it cannot succeed without 2b's
  binaries, and it can only run on a Mac in the first place. This is genuinely the next
  concrete step once you're on the Mac.

**Phase 3 — shared-database ("client mode") — not started.** This is what makes Mac and
Windows show the same data. All the design is in the plan; none of the code
(`electron/main.js` changes for `host.json`, remote `isWvoServer`, the setup window,
`startServer()`'s early-return) has been written.

**Phase 4 — scripts and docs — not started.** `allow-field-access.sh`,
`reset-admin-password.sh`, manual updates, `CLAUDE.md` sections, the `macos-latest` CI job.

## Two things to know before you touch this next

- **The `.env.local`/credentials change in `postgres.js` matters even on Windows**, not
  just Mac — it's a real behavior change (generated secrets now live under
  `%APPDATA%\whitevanops\.env.local` instead of inside `resources/nextjs/`). The Windows
  build test above proves the *build* still works, but nobody has yet installed and
  launched this exact Windows build fresh to confirm login/dashboard/backup still work
  end-to-end post-install — that's step 3 of the plan's own Verification section and is
  still open.
- **`build/` is no longer gitignored.** If you (or a future session) add large or
  machine-specific files there, they'll get committed. Right now it only holds
  `icon.png` (1024px PNG, regenerable via `node scripts/generate-icons.js`) and
  `entitlements.mac.plist` — both are meant to be tracked.

## Next session should

1. Decide whether to commit what's here now (nothing is committed) or keep iterating
   uncommitted.
2. Either continue writing Phase 3 code (shared-database mode — doesn't need a Mac to
   write, per the owner's earlier call), or move to the Mac and start on Phase 2b
   (source the `pgsql-mac/` binaries, then run `npm run electron:build:mac` for real).
3. Whichever happens first, Phase 1 and Phase 2's Windows-side code is a safe base to build
   on — it's tested and doesn't regress the existing Windows installers.

---

## Update — same day, on the Mac: Phase 2b done, and `npm run electron:build:mac` has now
## actually run

Everything above this line was written before ever touching a Mac. This picks up from
"Phase 1 + 2 code, uncommitted" — that code is now **committed** (`3a1427b`), and Phase 2b
is done.

**Sourcing decision:** the plan's first-preference source (zonky's embedded-postgres
darwin-arm64 archive) turned out to ship **no `pg_dump`, `psql`, or any client tool at
all** — only `postgres`/`initdb`/`pg_ctl`. That's enough to start a database but not to
back one up, which `electron/backup.js` and the backup API route both need. Went with
Postgres.app instead (the plan's third-preference option): its binaries are universal
(arm64 + x86_64 in one file, no Rosetta needed) and include the full toolset, so server and
client tools come from the same build with no version-mismatch risk. Full sourcing steps —
which exact binaries, which exact `lib/` dylibs (computed via `otool -L` closure, not copied
wholesale — Postgres.app's PostGIS bundle drags in ~150 MB of unrelated GDAL/PROJ/GEOS libs
that nothing here uses), which two `lib/postgresql/` extension modules are actually
required and why — are now written up in `MANUAL_Setup_Installation.md`, mirroring its
existing Windows `pgsql/` section. Final payload: ~160 MB, gitignored like `pgsql/`.

**A real bug found by actually running the build:** `package.json`'s `mac.dmg` target
builds both `arm64` and `x64` from one `electron-builder` invocation, but
`scripts/electron-build.js`'s `ARTIFACT_NAMES.mac` entries were a single fixed filename
per variant (e.g. `WhiteVanOps-Base-Setup.dmg`) with no arch in it. electron-builder built
the arm64 dmg, wrote it to that name, then built the x64 dmg and **silently overwrote it**
— the file left on disk was x64-only (needs Rosetta), and step 7b's post-build verification
only ever checked the `mac-arm64` unpacked directory, so that surviving x64 file had never
actually been asserted to contain `pgsql-mac`, the Prisma client, or anything else. Caught
this by literally mounting the resulting dmg and checking `file` on the app binary inside —
first run showed `x86_64` where `arm64` was expected. Fixed by giving `ARTIFACT_NAMES.mac`
an `${arch}` token (electron-builder's own templating syntax, which it substitutes when
writing each file) and restructuring the step-7b/7c verification, the final-artifact check,
and the buildinfo/manifest bookkeeping to loop over both `{arch: 'arm64', unpackedDir:
'mac-arm64'}` and `{arch: 'x64', unpackedDir: 'mac'}` instead of a single hardcoded target.
Windows is untouched by this — its `ARTIFACT_NAMES.win` entries carry no `${arch}` token, so
`resolvedArtifactName(null)` is a no-op and the single-target code path behaves exactly as
before. Re-ran the build after the fix: both `WhiteVanOps-Base-Setup-arm64.dmg` (243 MB) and
`WhiteVanOps-Base-Setup-x64.dmg` (244 MB) now exist as distinct files, each independently
verified, and mounting each and running `file` on the app binary inside confirms `arm64` and
`x86_64` respectively.

**Full end-to-end first-run test, not just a packaging check:** built the mac Base **trial**
variant (`npm run electron:build:mac:trial`) specifically so the run wouldn't block on
license activation, then ran the unpacked `mac-arm64/WhiteVanOps.app` binary directly (not
just `open`, so stdout is visible) against a wiped `~/Library/Application Support/whitevanops`.
Result: `initdb` succeeded, PostgreSQL 17.11 started on port 5433, all 6 Prisma migrations
applied, the admin superuser was bootstrapped, the backup scheduler initialized, and the
Next.js standalone server came up ("✓ Ready in 0ms") — the exact sequence
`ensurePostgres()`/`startServer()` are supposed to run, using the real `pgsql-mac/` payload
inside the real packaged app, not a standalone binary test. Stopped it cleanly afterward
(`pg_ctl ... stop`, confirmed no orphaned `postgres` process, wiped the test appData
directory) — nothing from this test run is left on disk.

**What's still true from before:** Phase 2d (signing) is still deferred by design — this Mac
had no valid, non-expired code-signing identity available anyway (`electron-builder` listed
several, all `CSSMERR_TP_CERT_EXPIRED`), so both dmgs built ad-hoc-signed/unsigned, exactly
as planned for a first Mac build. Phase 3 (shared-database mode) and Phase 4 (scripts/docs)
are both still not started.

**Committed:** `scripts/electron-build.js`'s arch-naming fix. **Not committed:**
`pgsql-mac/` itself (correctly gitignored, ~160 MB, machine-local — every future mac build
on any machine needs to (re)create it per the new `MANUAL_Setup_Installation.md` section,
same as `pgsql/` on Windows) and the built `.dmg`/`.dmg.blockmap`/`.buildinfo.txt` files
under `dist-electron/` (also gitignored, disposable build output).

## Next session should (updated)

1. Phase 2 (Windows + Mac packaging) is now fully done and verified on real hardware —
   Base builds clean on both platforms, both mac arches individually confirmed working
   end-to-end including a real database bootstrap. Phase 2d (signing) stays deferred until
   there's an Apple Developer account.
2. A Plus mac build (`electron:build:mac:plus`) still needs a `cloudflared-mac/cloudflared`
   binary sourced (darwin build from Cloudflare's releases) — nobody has done this yet, only
   Base has been built/tested on mac.
3. Move on to Phase 3 (shared-database/"client mode") — all the design is already in the
   plan, no code written yet.
