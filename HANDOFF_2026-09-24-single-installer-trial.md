# Handoff — 2026-09-24: one installer; the 30-day trial is chosen on first launch

## Where this picks up

Branch `claude/single-installer-trial` is **stacked on `claude/bold-ramanujan-4iw2e8`** ([PR #7](https://github.com/rsm1274-art/WhiteVanOps/pull/7): dispatch + migrations-on-upgrade), which wasn't merged yet. Merge #7 first, or merge this one after it. Read the two 2026-09-23 handoffs as well; their real-device checklists are still open.

## What the owner asked for

Build only one installer. On first run it asks for an activation key or offers a 30-day trial. When the trial ends, an activation key is required to continue. The database stays the customer's, untouched.

Decisions (owner: "go with your recommendations"):
1. The trial starts offline; no internet is needed.
2. The per-machine offline unlock code is kept as a hidden fallback.
3. No clock-rollback detection.

## What shipped

- **First-launch window** (`electron/activation.html` + preload) has three modes:
  - `first`: key, **Start 30-day free trial**, or client mode.
  - `expired`: key only; closing it quits.
  - `activate`: key only; closable. Reached from the new **Help → Enter activation key…** menu.
- **`electron/main.js`**
  - `getAccess()` decides at launch: licensed, trial with days left, trial expired, or none yet. `isTrialBuild()` is gone.
  - After the database starts, `reconcileTrialWithDb()` mirrors the trial start into `SystemSetting.trial_anchor`, and the earliest date wins. Deleting `trial.json` therefore doesn't reset the trial.
  - `watchTrialExpiry()` re-checks hourly for a PC left open.
- **`electron/trial.js`** (new) is the main-process trial logic. Its signatures must stay byte-identical to `src/lib/licenseCrypto.ts`; a test enforces this.
- **Server**
  - `src/lib/trial.ts` no longer depends on `WVO_IS_TRIAL` and never creates a trial. Activation (`license.json` or `trial-unlock.json`) always wins over it.
  - `license.ts` shows `TRIAL-ACTIVE` for any running trial.
  - `/api/dashboard` and `/api/field` refuse to load data once the trial has ended (`src/lib/trialGuard.ts`), and the clients redirect to `/trial-expired`. Writes are not blocked, so a tech's queued work is never rejected.
- **UI**
  - A "Trial: N days left" strip on the dashboard (`TrialBanner`).
  - The Settings trial box points to Help → Enter activation key…, with the offline code collapsed underneath.
  - `/trial-expired` rewritten: office-PC instructions, **Sign in again**, and the offline code collapsed.
- **Bug fixed:** a technician whose session was trial-locked redirect-looped between `/trial-expired` and `/field`. The old trial build had the same bug. The middleware now lets the trial pages through before role routing, and `/trial-expired` is on the tech allowlist.
- **Build:** `--trial`, `electron:build:trial`, `electron:build:mac:trial` and the `-Trial-Setup` artifacts are removed. `--trial` exits with an explanation, and any stale `WVO_IS_TRIAL` line is stripped from a bundled `.env.local`.
- **Docs updated:**
  - `MANUAL_Setup_Installation.md` §6 (rewritten)
  - `MANUAL_Administrator.md`
  - `docs/MANUAL_Troubleshooting.md` §1.6
  - `docs/BUSINESS_Purchase_to_Install_Playbook.md` (Parts 2 and 4, quick reference)
  - `docs/MANUAL_Golden_State_Demo.md`
  - `PROJECT_STATUS.md`
  - `CLAUDE.md`: new "30-day trial" section

## Verified

- `npx tsc --noEmit` is clean. `npm test` passes 612/612; the new tests are the rewritten `trial.test.ts`, `electron/trial.test.js` and a trial-lock case in `api/field/route.test.ts`. `npm run build` passes. ESLint shows only findings that already existed.
- **Live server** (built standalone server, throwaway PostgreSQL, a fake app-data directory):

  | State | Dashboard/field data | Other |
  |---|---|---|
  | No trial | Loads | — |
  | Day 5 of the trial | Loads | Shows 25 days left |
  | Day 31 | Refused (403) | New login redirected to `/trial-expired` |
  | `license.json` added | Loads again | Page says "activated — sign in again" |

- **Browser (Playwright):**
  - Screenshots of the activation window in `first` and `expired` modes, the dashboard banner, and the phone trial-ended page.
  - A tech session after expiry lands on `/trial-expired` with no loop.

## Not done / needs attention

- **Not run in a real Electron window** (no GUI here). Test by hand on Windows once an installer can be built:
  1. Fresh install shows the three choices. **Start trial** opens the app, and the banner shows 30 days.
  2. Help → Enter activation key… with a real `WVO-` key: the banner disappears and Settings shows the key.
  3. On a second machine, start a trial, then edit `trial.json`'s date back 31 days (the signature becomes invalid, so this counts as expired) or set the clock forward. Relaunch: "Your trial has ended". Enter a key: the app opens with the data intact.
  4. Delete `trial.json` on an expired trial and relaunch. **Start trial** appears, but after the database starts it falls straight into "Your trial has ended", because the database copy wins.
- The **public download** should be a generic build made **without** a project `.env.local` (documented in §6 and the playbook).
- Already-installed trial builds from before this change keep their existing `trial.json` and date, and continue as a trial under the new code.
