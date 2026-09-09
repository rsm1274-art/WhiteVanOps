# Handoff — 2026-09-09: shared-database ("client mode") — Phase 3 code done

## Where this picks up

Full context: [`PLAN_2026-09-08-macos-support.md`](PLAN_2026-09-08-macos-support.md), Phase 3
section — the design and the two owner decisions it rests on (shared database, not merge;
signing deferred). [`HANDOFF_2026-09-08-macos-support.md`](HANDOFF_2026-09-08-macos-support.md)
covers everything through Phase 2 (macOS packaging, done and pushed as of `d3bb29f`).

Branch: `feat/macos-support` (still checked out). This session's work is **committed and
pushed** — see below.

## What's done: Phase 3 (shared-database / client mode) — code

One machine (the **host**) runs the database and server exactly as every install always
has. Every other machine (a **client**) starts neither — it just opens the host's address in
its own window, the same relationship a field tech's phone already has with the office PC.

**Files:**
- `electron/main.js` — the bulk of the change:
  - `isWvoServer(port)` → `isWvoServer(host, port)`, `host` defaulting to `'localhost'` at
    every existing call site so same-machine reuse behavior (the PM2-server-on-3000 case) is
    unchanged. Client mode calls it with the configured remote host.
  - New `getHostConfigPath()` / `readHostConfig()` / `writeHostConfig()`, mirroring the
    existing `getLicensePath()` pattern — same `<appData>/whitevanops/` directory. Config
    lives at `host.json`: `{ "mode": "host" }` or
    `{ "mode": "client", "host": "...", "port": 3000 }`. **Absence of the file means host
    mode** — this is the whole backward-compatibility story: every existing install has
    never heard of `host.json` and behaves byte-for-byte as before.
  - `startServer()` early-returns for `mode: "client"`, before `ensurePostgres`,
    `require(server.js)`, or `startBackupScheduler` — a client never boots a database, never
    runs a server, never backs itself up.
  - New `showClientSetupWindow()` (`electron/client-setup.html` +
    `electron/client-setup-preload.js`, new files) — modeled file-for-file on the existing
    `showActivationWindow()`/`activation-preload.js`: same `ipcMain.on(...)` +
    `event.reply(...)` IPC shape (this codebase has no `ipcMain.handle` anywhere, so I kept
    it consistent rather than introducing a second pattern). Takes a host + port, verifies
    it's a real WhiteVanOps server via `isWvoServer` before writing `host.json`, so a client
    can never save an address that doesn't actually answer.
  - **Entry point:** `activation.html` — shown only when `verifyLicenseSilent()` fails, i.e.
    never on an already-activated machine — gained one link, *"Connecting to an existing
    office server instead?"*, that hands off to the client-setup window instead of
    activating a license. `showActivationWindow()` now resolves with
    `{ mode: 'host' }` or `{ mode: 'client', host, port }` so `app.whenReady()` knows which
    branch to take.
  - `createMainWindow()` now loads a module-level `connectionTarget` (`{host, port}`)
    instead of a hardcoded `localhost:${PORT}`. Set once at startup — by `startServer()`'s
    result for host mode, by the verified host config for client mode — and reused by the
    `activate` handler (macOS Dock re-click), which re-enters window creation on a separate
    path and must not re-prompt.
  - New `handleUnreachableHost()` — if a saved client-mode host doesn't answer at startup,
    shows a Retry / Reconfigure / Quit dialog. **Never falls back to booting a local
    database** — that's the exact divergent-copy failure mode shared-database mode exists to
    prevent. Reconfigure reopens the client-setup window (which re-verifies before writing).
  - `app.whenReady()` restructured around all of the above. Traced by hand (see
    Verification below) to confirm the no-`host.json` path is identical to the pre-change
    flow.
  - Licensing: a client-mode install skips `verifyLicenseSilent()`/`showActivationWindow()`
    entirely — entitlement comes from the host's own server-side `requirePlus` checks, same
    as a browser hitting the host directly.
- `electron/client-setup.html`, `electron/client-setup-preload.js` (new) — the setup window
  itself: host + port fields, a Connect button, verify/error round-trip.
- `electron/activation.html`, `electron/activation-preload.js` — added the "connect instead"
  link and its one new IPC call.
- `CLAUDE.md` — new "Shared-database mode (client mode)" subsection under Electron desktop
  app, documenting the `host.json` shape, why absence means host mode, why a client never
  self-boots, and where the UI entry point lives (so a future session doesn't duplicate it).
- `MANUAL_Setup_Installation.md` — new §7A, "Connecting a Second Machine (Client Mode)":
  what a host vs. client is, how to set up a client, what a client can't do (host must be
  on, no separate license, no separate backup), and that reconfiguring after initial setup
  has no in-app toggle yet.
- `MANUAL_Administrator.md` — a short plain-language paragraph after the Plans section
  pointing to §7A.

## What's NOT done

- **No cross-machine test.** This needs two physical machines (or at minimum a Mac and a
  Windows box, or two VMs on the same LAN) — this session's environment is a single ephemeral
  container with neither Electron nor a real network of machines to test against. The design
  plan's Verification steps 9-12 (set one machine host, the other client, create a record on
  one, confirm it shows on the other, turn the host off and confirm the "cannot reach"
  dialog with no local-DB fallback) are still the owner's to run — same as Mac packaging
  verification was in the last session.
- **No in-app way to reconfigure or flip a machine between host and client after initial
  setup**, except via the unreachable-host dialog's Reconfigure button (which only appears
  when the currently-configured host isn't answering). Documented as a known gap in the
  manual rather than built — out of scope per the approved plan; flag to the owner if this
  turns out to matter in practice (e.g. moving which machine is the host).
- **`npm run electron:build` was not run this session** — this container has no `pgsql/`
  binaries (133 MB, gitignored, machine-local per `CLAUDE.md`), so a packaged build can't be
  produced or smoke-tested here. `npx tsc --noEmit`, `npm test` (312/312), and `npm run lint`
  (same 42 pre-existing errors as the last session's baseline, none new) are all clean, and
  I hand-traced the `host.json`-absent code path against the pre-change `app.whenReady()` to
  confirm it's unchanged — but an actual packaged-app boot test of this code is still open.
- Phase 2's remaining doc gap (mac `cloudflared` lipo step in
  `MANUAL_Setup_Installation.md`), and Phase 4 (macOS shell scripts for firewall/password
  recovery, `macos-latest` CI job) are both still untouched — the owner chose Phase 3 for
  this session specifically.

## Committed and pushed

All of this session's changes are one commit on `feat/macos-support`, pushed to
`origin/feat/macos-support`.

## Next session should

1. Get this built and smoke-tested on a real machine with the `pgsql/` binaries present —
   confirm a fresh install with no `host.json` still boots exactly as before (the critical
   regression to rule out), then confirm the activation window's new link opens
   client-setup, connects to a real host, and the resulting client window loads the host's
   dashboard.
2. Run the design plan's Verification steps 9-12 across two real machines once both are
   buildable and installed.
3. Otherwise, pick up Phase 2's doc gap or Phase 4 (scripts/docs/CI) — both still open, per
   the previous handoff.
