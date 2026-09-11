# Plan — 2026-09-08: macOS support + shared-database mode

**Status: approved by the owner, not yet started.** Branch `feat/macos-support` exists and
is checked out, with no commits on it yet. Everything below is still to do.

## Context

WhiteVanOps ships today as a Windows-only Electron app. The owner uses both Mac and
Windows machines, wants a macOS build, wants phones to reach it, and wants Mac and
Windows machines to see the same data.

Three findings shaped this plan.

1. **Phones already work and need no new code.** Android and iOS are plain browsers
   loading `/field` as a PWA (`src/app/manifest.ts`). There is no native app in the repo
   and none is needed. They will reach a Mac host exactly as they reach a Windows host,
   once the Mac binds the LAN and its firewall allows it.

2. **Two databases cannot be merged.** `prisma/schema.prisma` has no `version` column, no
   `deletedAt`, and no origin/device id on any model. Deletes are hard and cascade, so a
   merge cannot tell "deleted there" from "not created yet" and would resurrect rows.
   `Invoice.invoiceNumber` and `Quote.quoteNumber` are `@unique` and minted from a
   `SystemSetting` counter, so two machines both mint `INV-0001`. `StockLevel.quantity` is
   an absolute `Int`, not a delta, so concurrent stock edits cannot commute.
   The owner was given the choice and chose the **shared-database** answer instead: one
   machine holds the data, every other machine and phone talks to it. True two-way merge
   was quoted at 2-3 months with a real risk of silent data loss, and rejected.

3. **The build config is Windows-shaped, not just Windows-flavoured.** All of
   `extraResources` sits under `build.win` in `package.json:45-65`, and
   `scripts/electron-build.js:233-236` writes to `builderConfig.win.*`. A `--mac` run today
   would throw, and if it did not it would ship an app with no server and no database.

Intended outcome: a `.dmg` a Mac user installs and runs, either as its own standalone
office server or as a client onto an existing Windows/Mac host, with phones working
against either.

## Two owner decisions the plan assumes

- **Shared database, not merge.** See finding 2 above.
- **Apple Developer account comes later.** First builds ship unsigned; the customer
  right-clicks → Open once. Signing is Phase 2d and needs no other code change.

---

## Branch

```bash
git checkout -b feat/macos-support   # already done
```

All work lands here. Windows installers get rebuilt and retested on this branch before
merge, because Phase 1 touches shared code paths.

---

## Phase 1 — Make the shared code cross-platform

These are real bugs on macOS, and several are latent quality fixes on Windows too. The
pattern to copy already exists at `electron/postgres.js:200-201, 217`:

```js
const isWin = process.platform === 'win32';
const bin = (exe) => path.join(pgDir, 'bin', isWin ? `${exe}.exe` : exe);
```

| File | Change |
|---|---|
| `electron/backup.js:40-58, 90` | `pg_dump.exe` is hardcoded with no platform branch — backup fails outright on macOS. Apply the `isWin` pattern. Reword the "Windows shell" comments. |
| `src/app/api/settings/backup/route.ts:31-44` | Same hardcoded `pg_dump.exe`. Worse than a crash: it falls through to a bare `pg_dump` on PATH, so on a Mac with Postgres.app installed it would silently dump the *wrong* database. Fix with the same branch. |
| `electron/postgres.js:218-222` | Data dir resolves to `~/whitevanops/pgdata` on macOS — a stray dot-less folder in the user's home, and inconsistent with the licence files. Derive it from `app.getPath('appData')` so it lands in `~/Library/Application Support/whitevanops/pgdata`. |
| `electron/postgres.js:176-182, 256-261` | `ensureEnvLocal()` writes `.env.local` into `process.resourcesPath`. On macOS that is *inside the signed `.app` bundle* — it breaks the code signature and fails under Gatekeeper translocation. **Move generated credentials to `getAppDataWvoDir()`**, and have the reader at `electron/main.js:272-280` check the app-data copy first, then the bundled one. |
| `src/lib/lanAddresses.ts:12-43` | `VIRTUAL_NAME_MARKERS` lists Windows adapters only. On a Mac the Field Access QR would happily offer `awdl0` or `bridge100`, which no phone can reach — the exact silent failure the comment at `:63-73` warns about. Add `awdl`, `llw`, `utun`, `bridge`, `vmnet`, `ap1`. |
| `electron/main.js:382-385` | Quits on `window-all-closed`. On macOS an app normally stays in the Dock. Guard with `process.platform !== 'darwin'` and make the existing `activate` handler (`:391`) rebuild the window. |
| `scripts/generate-icons.js` | Produces `favicon.ico` only. Add a `.icns` output (or a 1024px PNG, which electron-builder converts) at `build/icon.icns`. |
| `electron/main.js:26-34`, `electron/postgres.js:11` | Comments say `%APPDATA%`. The code is already portable via `app.getPath('appData')`. Reword only. |

`src/lib/licenseCrypto.ts:16-23`, `src/lib/trial.ts` and `src/lib/license.ts` are **already
correct on macOS** — `getAppDataWvoDir()` branches on `darwin`. Do not touch them.

---

## Phase 2 — macOS packaging

**2a. Restructure `package.json` `build`.** Hoist `extraResources` out of `win` to the top
level so both platforms inherit it, then keep only the genuinely platform-specific keys
under `win` and a new `mac`:

```json
"mac": {
  "target": [{ "target": "dmg", "arch": ["arm64", "x64"] }],
  "icon": "build/icon.icns",
  "category": "public.app-category.business",
  "hardenedRuntime": true,
  "entitlements": "build/entitlements.mac.plist",
  "extendInfo": { "NSLocalNetworkUsageDescription": "..." }
}
```

`NSLocalNetworkUsageDescription` is not optional — macOS 15 blocks LAN traffic without it,
which would break field-tech access in exactly the invisible way documented at
`electron/main.js:136-144`.

`build/entitlements.mac.plist` needs `com.apple.security.cs.disable-library-validation`
so the bundled Postgres binaries can run under the hardened runtime.

**2b. Get macOS PostgreSQL binaries.** The repo's `pgsql/` is Windows-only. A parallel
`pgsql-mac/` payload is required, gitignored like `pgsql/`. **This is the main unknown.**
Sourcing options, in order of preference: the `zonky` embedded-postgres darwin-arm64
archive (has native Apple Silicon), the EDB macOS archive (x86_64, needs Rosetta), or
extracting Postgres.app internals. Whichever is chosen, `extraResources` must preserve the
executable bit and the binaries must be signed.

**2c. Teach `scripts/electron-build.js` about macOS.** Currently Windows end to end.
Changes, matching the existing assertion style so a silently-empty build still hard-fails:

- Platform-aware `pg_ctl` / `cloudflared` name and payload dir (`:212-227`).
- Write `builderConfig.mac.*` instead of `builderConfig.win.*` (`:233-236`) — this is the
  line that throws today.
- `--mac` flag; `ARTIFACT_NAMES` gains `.dmg` entries (`:55-61`).
- Unpacked path is `mac-arm64/WhiteVanOps.app/Contents/Resources`, not `win-unpacked`
  (`:89-92, :244-278`).
- Keep every step-7 assertion (pgsql present, `nextjs/node_modules/next` present, asar
  keeper modules present, cloudflared present-on-Plus / **absent-on-Base**) — they are
  what stopped a DB-less installer shipping before.
- New npm scripts: `electron:build:mac`, `:mac:plus`, `:mac:trial`, `:mac:trial:plus`.

**2d. Signing — deferred, by the owner's decision.** First builds are unsigned. A customer
must right-click → Open once. When the Apple Developer account exists ($99/yr), add an
`afterSign` notarize hook and Developer ID cert; no other code changes.

**Base vs Plus:** build **Base first and verify it**. Plus is then roughly 30 extra minutes
— it is the same artifact plus a darwin `cloudflared` binary and two assertions. Do both in
this phase, Base gated first.

**Note:** the Mac build must run *on* the Mac. The code and config are written on Windows;
the owner runs one command on the Mac.

---

## Phase 3 — Shared-database mode ("client mode")

This is what makes Mac and Windows show the same data. No schema change, no merging, no
new failure modes.

**How it works.** One machine is the **host**: it runs the database and the server exactly
as today, and is the machine that gets backed up. Every other machine runs in **client
mode**: it starts no database, starts no server, and simply opens the host's address in the
app window. It is the same relationship a field tech's phone already has with the office
PC, just in a desktop window.

**The pieces already exist.** `electron/main.js:65-87` has `isWvoServer(port)`, which
identifies a real WhiteVanOps server via `GET /api/health`. `electron/postgres.js` already
no-ops when `DATABASE_URL` is remote or the port has a listener.

**Changes, all in `electron/main.js`:**

1. Read an optional host from `<appData>/whitevanops/host.json` (new file, written by a
   small setup window modelled on the existing activation window `showActivationWindow`).
2. Generalise `isWvoServer(port)` to `isWvoServer(host, port)` so it can probe a remote
   address. Keep the `/api/health` identity check — probing a foreign app is exactly the
   2026-07-14 bug.
3. In `startServer()`: if a host is configured and answers, **return early** — skip
   `ensurePostgres`, skip `require(server.js)`, skip `startBackupScheduler` (the host backs
   itself up; a client must not).
4. In `createMainWindow()`: `loadURL` the host address instead of `localhost`.
5. If the host is unreachable, show a clear dialog — "cannot reach the office server at
   X" — with a button to reopen the setup window. Never silently fall back to booting a
   second database; that is how you end up with two divergent copies, which is the whole
   thing we are avoiding.

**Licensing.** A client-mode install **skips activation entirely**. Entitlement comes from
the host it connects to, because every Plus check (`requirePlus`) runs server-side on the
host. This opens no hole: a plain web browser can already reach that same server today.

**Cookies work unchanged.** `src/lib/auth.ts` derives cookie `secure` per request
(`isSecureRequest`), so a client on plain `http://` over the LAN logs in correctly. This is
precisely why the global `REQUIRE_HTTPS` flag was removed and must not come back.

**Honest limitation to state in the manual:** if the host machine is off or asleep, clients
cannot work. That is the trade for never losing or duplicating a record.

---

## Phase 4 — Scripts and docs

- `scripts/recovery/allow-field-access.sh` — macOS has no per-port inbound rule. The
  equivalent is per-app: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add
  /Applications/WhiteVanOps.app --unblockapp ...`, plus a note about the one-time "allow
  incoming connections" prompt and the macOS 15 Local Network toggle.
- `scripts/recovery/reset-admin-password.sh` — simpler than the `.ps1`: a plain
  `ELECTRON_RUN_AS_NODE=1 /Applications/WhiteVanOps.app/Contents/MacOS/WhiteVanOps ...`
  exec, no `Start-Process` workaround needed. Add an `.app/Contents/Resources` candidate to
  the path resolution in `scripts/recovery/reset-admin-password.js:70-95`.
- `MANUAL_Setup_Installation.md` — new macOS install section, the firewall step, host vs
  client setup, and the "host must be on" limitation.
- `MANUAL_Administrator.md` — host/client explained in plain language.
- `CLAUDE.md` — new sections mirroring the existing Electron notes: the platform-branch
  pattern, why generated config must not live in `Contents/Resources`, and why client mode
  never falls back to self-booting.
- `.github/workflows/ci.yml` — add a `macos-latest` job that runs `tsc`/tests. Packaging
  stays manual until signing exists.
- `HANDOFF_2026-09-08-macos-support.md` at the end.

**Out of scope, deliberately:** `ecosystem.config.js` and `run_locally.bat` are
machine-specific dev leftovers, not shipped.

---

## Verification

**On the Windows machine (Claude does this):**
1. `npx tsc --noEmit` and `npm test` green.
2. `npm run electron:build` — Windows Base installer still builds, all step-7 assertions
   pass. Phase 1 and 2a touch shared code, so **proving no Windows regression is required**
   before merge.
3. Install that Windows build and confirm login, dashboard, a manual backup, and the Field
   Access QR still work.

**On the Mac (owner does this):**
4. `npm run electron:build:mac` → `dist-electron/WhiteVanOps-Base-Setup.dmg`.
5. Install on a clean Mac. First launch must initdb its own database, bootstrap `admin`,
   and reach the dashboard. This is the step that proves the Postgres payload.
6. `netstat -an | grep 3000` shows `*.3000` / `0.0.0.0`, not `[::1]` only.
7. Open `/field` from an **Android phone and an iPhone** on the same WiFi using the QR
   address. Log time on a job. This is the mobile sync test — it needs no new code, so a
   failure here means the bind or the firewall, in that order.
8. Airplane-mode the phone, log time, rejoin WiFi, confirm the queue drains
   (`src/lib/offlineWrite.ts`).

**Shared-database test (needs both machines):**
9. Set the Windows PC as host. Put the Mac in client mode pointed at it.
10. Create a client on the Mac; confirm it appears on the Windows dashboard on refresh.
11. Reverse the roles and repeat.
12. Turn the host off; confirm the client shows the "cannot reach the office server"
    dialog and does **not** boot a second database.

---

## To resume in a new session

```bash
git checkout feat/macos-support
```

Then read this file and start at Phase 1. Nothing has been implemented yet.
