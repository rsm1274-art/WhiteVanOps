# Handoff — WiFi Sync on Base, Tunnel on Plus (2026-07-24)

**Branch:** `feat/wifi-sync-base-tier` (off `main` at `304c5d6`). **Not merged.**
**Spec:** `docs/superpowers/specs/2026-07-24-wifi-sync-base-tier-design.md` (committed on main, `25f7179`)
**Plan:** `docs/superpowers/plans/2026-07-24-wifi-sync-base-tier.md` (committed on main, `304c5d6`)
**Execution ledger:** `.superpowers/sdd/progress.md` (git-ignored scratch — the authoritative per-task record with commit ranges and review outcomes)

## What shipped on the branch (all 12 plan tasks, each implementer + reviewer gated)

| Commits | What |
|---|---|
| `d088978` | `fieldUrlVerdict()` + `isPrivateLan` in `src/lib/fieldAccessUrl.ts` (20 tests) |
| `91bff9a` | `GET /api/field-access/lan-address` — admin/superuser, private IPs first (3 tests) |
| `9a3614b` | Plan-aware `FieldAccessModal`: `isPlusLicensed` prop, detected-address chips, four verdict messages; LAN http no longer warns |
| `3262e45` | `deriveSyncStatus()` in `src/lib/syncStatus.ts` (9 tests) |
| `e4f82f8` + `72c3516` | Field page: honest sync strip (`SyncStatusBar`), kills the false "Syncing…" badge; `StuckOpsPanel`/`JobCard` extracted; page.tsx 1091→439 lines |
| `69b9232` | `signTrialPlan`/`verifyTrialPlan` in `licenseCrypto.ts` — HMAC stamp, fails closed to base (7 tests) |
| `5d33578` | `getLicense()` trial branch honours the signed stamp; regression test for unsigned `WVO_TRIAL_PLAN=plus` |
| `9c579ef` | Build script: four installers (`--base`/`--plus`/`--trial --plan base\|plus`), both-direction cloudflared assertion, `--upgrade` deleted |
| `74070cd` | `plus_license.json` reader annotated read-only legacy |
| `0ca6f6a` | CLAUDE.md + 4 manuals + launch checklist corrected to per-plan transport |
| `cb95be3` | Final-review fix wave (10 findings — see below) |

Verified at end: **264/264 vitest, `tsc --noEmit` clean, lint at the pre-existing 205-problem baseline** (no new issues).

## Four installers — BUILT and in `dist-electron/`

`WhiteVanOps-Base-Setup.exe` (186.6 MB), `WhiteVanOps-Plus-Setup.exe` (199.9 MB), `WhiteVanOps-Base-Trial-Setup.exe`, `WhiteVanOps-Plus-Trial-Setup.exe`. Plus artifacts contain `resources/cloudflared/cloudflared.exe`; Base artifacts asserted NOT to. **Note:** these were built from `9c579ef` — commit `cb95be3` changed `electron-build.js` (key-source fix) and UI strings afterwards, so **rebuild all four before shipping any of them.**

`cloudflared/cloudflared.exe` (gitignored) was copied from this machine's own install at `C:\Program Files (x86)\cloudflared\`.

## ✅ Final re-review: READY TO MERGE

The whole-branch review (opus) returned READY WITH FIXES; one fix subagent addressed all 10 actionable findings in `cb95be3`; the re-review then verified **each finding genuinely fixed with file:line evidence** and returned **READY TO MERGE** (264/264 tests, tsc clean, lint strictly improved). Points it examined closely:

1. **Finding 10 heuristic is sound:** `setLastStop(stopped)` runs before every early return in `processSync`, so the functional updater's null-guard can never overwrite a real stop reason (auth included); the one imprecise case (reopening on-network with a leftover queue) is masked by `isDraining` ranking above `lastStop` and self-corrects within one drain.
2. **Finding 6:** UI strings and `MANUAL_Field_Tech.md`'s table verified in exact agreement, string by string.

Its single residual — two stale current-state rows in `PROJECT_STATUS.md` (:161 "one installer serves both", :170 "Port Forwarding + Dynamic DNS") — was fixed by the controller in the same commit as this handoff.

## Known limitation, deliberately NOT fixed (record, don't re-litigate)

**The trial plan stamp is signed but not machine- or build-bound.** The two `WVO_TRIAL_PLAN(_SIG)` lines from any Plus-trial `.env.local` verify on any machine (same embedded `LICENSE_SIGNING_SECRET` trust model as every licence artifact in the product). It defeats the stated threat (one-word Notepad edit) but means "configuration alone never grants Plus" is slightly stronger than the truth for trial builds. Options if it ever matters: bind the stamp to `machineIdSync()` at first launch, or accept (trials are 30-day-locked either way).

## Manual verification still required (spec's checklist — cannot be done by an agent)

1. **Rebuild the four installers** from `cb95be3` (see above).
2. **Base end-to-end on a real phone:** install Base, activate a Base key, Field Access QR → detected address → green message → QR; phone on office WiFi logs time; off WiFi logs more (strip must read "N waiting · office network not found"); rejoin → drains, "Last saved to office" updates.
3. **Trial tamper test:** install Base trial, edit `WVO_TRIAL_PLAN` to `"plus"` in `resources/nextjs/.env.local`, restart — Analytics/Invoicing must stay hidden, `/api/analytics` 403.
4. **Electron login on `http://localhost:3000`** — the standing cookie-`secure` regression.
5. **Day-30 lock** on a trial install (or clock-forward test).

## Marketing site — separate repo, NOT PUSHED

`marketing/` is a **nested git repo** (gitignored in the app repo) tracking the public GitHub Pages site `rsm1274-art/WhiteVanOps`. Commits `ba1d553` + `96c26ab` sit on its local `main`: Base $500 + WiFi-sync bullet, Plus $1,000 no Upgrade badge + tunnel bullet, 25%-off cross-grade line, White Glove reword, both index.html and the alternate. **Pushing publishes the new pricing immediately — that is the owner's call.** Push when ready: `cd marketing && git push`.

## Merge path

Code review is complete (READY TO MERGE). Once the manual checks above pass: merge `feat/wifi-sync-base-tier` → `main` (use superpowers:finishing-a-development-branch). Minor accepted-as-is findings for some future pass are listed in the ledger (IPv6 host forms, type-import reverse dependency from `@/app/field/page`, Troubleshooting Part 2 CGNAT entries banner-gated rather than rewritten).

## Error-retry note (per session ground rule)

Nothing hit the three-strikes limit. No unresolved errors. The only interruption was a user pause after Task 2, resumed cleanly from the ledger.
