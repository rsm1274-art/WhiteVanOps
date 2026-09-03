# Handoff — 2026-09-01: Installer build + version stamping

## What shipped

1. **Merged `feat/wifi-sync-base-tier` into `main`.** This branch had been built but
   forgotten — it added the WiFi-sync transport split (Base = office LAN only, Plus =
   Cloudflare tunnel) and updated `MANUAL_Administrator.md`, `MANUAL_Field_Tech.md`,
   `MANUAL_Setup_Installation.md`, and `docs/MANUAL_Troubleshooting.md` to match.
2. **Built all four installers** (Base, Plus, Base-Trial, Plus-Trial) from the
   merged `main`. Files are in `dist-electron/`.
3. **Added build stamping** (commit `34e7a28`) so a stale leftover `.exe` can't be
   mistaken for a fresh one. Every build now writes:
   - `<installer-name>.buildinfo.txt` — version, git commit, build time, dirty-tree flag
   - `dist-electron/BUILD-MANIFEST.txt` — all four side by side

## Current state (verified 2026-09-02)

- Working tree clean, `main` up to date with `origin/main`.
- All four installers on disk, all stamped with commit `34e7a28` (the version-stamping
  commit itself — built right after it landed):

  | File | Built |
  |---|---|
  | WhiteVanOps-Base-Setup.exe | 2026-09-02 00:45 UTC |
  | WhiteVanOps-Plus-Setup.exe | 2026-09-02 00:46 UTC |
  | WhiteVanOps-Base-Trial-Setup.exe | 2026-09-02 00:49 UTC |
  | WhiteVanOps-Plus-Trial-Setup.exe | 2026-09-02 00:50 UTC |

- Manuals are current — no follow-up edits needed.

## Not yet done / open items

- Installers have not been manually tested on a separate machine or phone yet
  (per the office-role-field-lockdown memory note, that testing was still pending
  before this session).
- No new code changes since the last build — the four `.exe` files above are still
  the ones to hand to a customer or tester.

## Next session should

Pick up with real-machine/phone verification of the four installers (Base LAN-only
sync, Plus tunnel access, both trial locks), not further code changes, unless the
owner redirects.
