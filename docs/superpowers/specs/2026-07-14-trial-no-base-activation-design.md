# Trial installer: skip base activation, honor unlocked tier

**Date:** 2026-07-14
**Status:** Approved (design)
**Related:** [2026-07-13-trial-demo-installer-design.md](2026-07-13-trial-demo-installer-design.md)

## Problem

The trial/demo installer (`npm run electron:build:trial`) currently presents the
native Electron **base-activation** window on first launch, demanding a
`WVO-XXXX-XXXX-XXXX-XXXX` key validated against Firestore. This gate runs for
*every* build — it is not aware of trial builds — so a prospect cannot even reach
the login screen without a real, Firestore-backed license key.

That is wrong for a demo. A trial install should boot straight to password login,
run on Plus for 30 days, then lock and prompt for an activation key that converts
it to the purchased tier.

Two defects block that desired behavior:

1. **Base-activation window blocks trial boot.** `electron/main.js`
   `verifyLicenseSilent()` → `showActivationWindow()` runs before the Next.js
   server starts and is not trial-aware.
2. **Post-conversion tier is ignored.** Trial builds are stamped
   `WVO_DEFAULT_TIER="plus"`. `getLicense()` (`src/lib/license.ts`)
   unconditionally forces tier `plus` whenever that flag is set. So a customer who
   converts at day 30 with a **base** key would still run as Plus, and a **plus**
   unlock would even be reverted to base by the existing anti-tamper branch,
   because no verified Plus source is recognized for the trial-unlock path.

## Desired behavior

| Phase | Behavior |
|---|---|
| Trial install, day 0–30 | No `WVO-` base-activation prompt. Boot to password login. Run on Plus. |
| Trial, day 30+ | 30-day lock fires (unchanged). In-app `/trial-expired` prompt shown after login. |
| Day-30 unlock (base key) | App runs with **base** features. |
| Day-30 unlock (plus key) | App runs with **plus** features. |
| Base/Plus customer builds | Completely unchanged — base activation still required. |

Password login is untouched in every phase.

## Design

### 1. Skip base activation on trial builds (`electron/main.js`)

Add a build-time detector that reads the bundled env file — the single source of
truth already written by the build:

```js
// True when this packaged build was produced by `electron:build:trial`.
// The build writes WVO_IS_TRIAL="true" into resources/nextjs/.env.local
// (scripts/electron-build.js). Read it directly — main.js runs before the
// Next.js server (which is what normally loads .env.local) is required, and
// before the activation check.
function isTrialBuild() {
  try {
    const envPath = path.join(process.resourcesPath, 'nextjs', '.env.local');
    if (!fs.existsSync(envPath)) return false;
    return /^\s*WVO_IS_TRIAL\s*=\s*"?true"?\s*$/m.test(fs.readFileSync(envPath, 'utf8'));
  } catch {
    return false;
  }
}
```

In `app.whenReady()`:

```js
const isActivated = isTrialBuild() ? true : await verifyLicenseSilent();
if (!isActivated) {
  if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
  await showActivationWindow();
  createLoadingWindow();
}
```

Trial installs therefore never open the activation window and never contact
Firestore. A missing `.env.local` (non-trial builds, where it may be generated
later) reads as non-trial → activation still required. No behavior change for
base/plus customer builds.

### 2. Honor the unlocked tier after conversion (`src/lib/license.ts`)

Introduce a new, highest-precedence tier source in `getLicense()`: a validated
`trial-unlock.json`.

New precedence:

1. **Trial converted** — `WVO_IS_TRIAL === "true"` **and** a `trial-unlock.json`
   exists whose HMAC signature and `machineId` verify against this machine
   (same check the `/api/license` `unlock-trial` route performs). The license
   tier is exactly `payload.tier` with `payload.expiresAt`. A `plus` payload is
   treated as verified-Plus so the anti-tamper revert does **not** fire; a `base`
   payload yields base features. This overrides the `WVO_DEFAULT_TIER="plus"`
   force below.
2. **Trial active (unconverted)** — `WVO_DEFAULT_TIER === "plus"` → force Plus
   (`PRE-ACTIVATED-PLUS-BUILD`). Unchanged from today.
3. **Non-trial** — existing base-license / `plus_license.json` / DB logic,
   entirely unchanged.

Anti-tamper preserved: manually flipping the DB to Plus without a valid
`trial-unlock.json` still self-heals to base, because the unlock file is
signature- and machine-verified.

### 3. Shared crypto helper (`src/lib/licenseCrypto.ts`)

`getLicense()` must verify `trial-unlock.json`, but `trial.ts` already imports
`license.ts` — importing back would create a cycle. Extract the low-level pieces
both need into a new leaf module `src/lib/licenseCrypto.ts` with **no** intra-lib
imports:

- `LICENSE_SIGNING_SECRET`
- `getAppDataWvoDir()`
- `signTrialUnlock(machineId, tier, expiresAt)`
- `verifyTrialUnlock(payload, machineId)` (the machine-bound, timing-safe check)

`license.ts` and `trial.ts` both import from it. This removes the currently
duplicated HMAC formula rather than adding a third copy. `trial.ts` re-exports
the moved symbols it currently exports so its public API (and existing tests)
stay intact.

## Testing (TDD — tests first)

- **`licenseCrypto.test.ts`** — valid signature round-trips; wrong machine ID
  rejected; tampered signature rejected.
- **`license.test.ts`** (extend) — `getLicense()` precedence:
  - trial build + valid **plus** unlock file → tier `plus`, no revert
  - trial build + valid **base** unlock file → tier `base` (Plus default overridden)
  - trial build + **no** unlock file → forced `plus` (unconverted, unchanged)
  - trial build + **invalid / wrong-machine** unlock file → ignored; DB tampered-to-plus self-heals to base
  - non-trial build → identical to today
- **`trial.test.ts`** — remains green after the helper extraction.
- `isTrialBuild()` in `main.js` — no Electron-main unit harness; verified by
  rebuild + manual launch (fresh trial install boots to login, no `WVO-` prompt).

Full gate: `npm test`, `npx tsc --noEmit`, `npm run lint`, then
`npm run electron:build:trial` and a manual launch check.

## Docs to update

- `CLAUDE.md` — trial section: base activation is skipped on trial builds; the
  post-conversion tier now wins over the pre-activated-Plus default.
- `MANUAL_Setup_Installation.md` §6.4 — trial install has no activation key on
  first launch; day-30 unlock accepts a base or plus key and applies the matching
  features.

## Out of scope (YAGNI)

- No changes to the `/trial-expired` page or `TrialUnlockForm` — they already
  accept base/plus keys and unlock correctly.
- No new Electron activation window.
- No changes to base/plus customer builds or the Firestore base-activation flow.
