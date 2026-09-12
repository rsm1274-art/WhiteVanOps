# Handoff — 2026-09-13: fixed a field-module bug where queued writes appeared to vanish

## Where this picks up

Read `HANDOFF_2026-09-12-v2-merged-installer-blocked.md` first — the installer still hasn't been
built in any environment, and that's unrelated to this session's work. This session was a live
bug report from the owner's own first trial run, not planned work.

## What happened

The owner ran the trial installer on a laptop (self-booted host, own DB) while traveling, and used
the Field Access QR code to open `/field` on their phone over the same WiFi — the correct,
intended single-machine setup, not client mode. Two things went wrong:

1. **They didn't know per-user login/roles still exist.** They do — nothing changed here. Answered
   inline, no code change.
2. **A real bug:** notes and a "Start Job" status change made on the phone didn't show up — not
   even back on the same phone/page. They ended up using Settings → Recover Field Work
   (export JSON → email → import) to move the data, which is meant as *disaster recovery*, not
   routine sync, and is exactly as clunky as it sounds for that purpose.

## Root cause

`src/components/field/JobCard.tsx` called `submitWrite()` for every save (status, notes, time,
materials) but **ignored its return value** (`"synced" | "queued"`). Every path — synced or merely
queued to IndexedDB after a network hiccup — called the same `onRefresh()`, which did a full
`GET /api/field` refetch. If the write had only been *queued* (not yet reached the server), the
refetch pulled the **old** server state and silently overwrote whatever the tech had just entered
on screen. Nothing was actually lost (it was safely sitting in the IndexedDB sync queue and would
have drained automatically next time `processSync()` ran), but visually it looked exactly like the
save had failed or been forgotten — which is what triggered the manual export/email workaround.

This was very plausible to hit on hotel/travel WiFi: any momentary drop during the `fetch()` call
in `submitWrite` is enough to flip a write from synced to queued.

## Fix (this session)

- `src/lib/offlineWrite.ts` — unchanged, `WriteResult` already existed, just wasn't being consumed.
- `src/components/field/JobCard.tsx` — every write path (`changeStatus`, `LogTimePanel`,
  `NotesPanel`, `MaterialsPanel`) now builds a local `Partial<FieldJob>` patch describing the
  change and calls a new `onWriteResult(result, patch)` callback instead of a bare
  `onSuccess()`/`onRefresh()`.
- `src/app/field/page.tsx` — new `handleWriteResult(jobId, result, patch)`: applies the patch to
  local `jobs` state immediately in both cases (so the UI always reflects what the tech just did),
  and **only** triggers a server refetch (`loadJobs`) when `result === "synced"`. On `"queued"` it
  shows a distinct toast ("Saved on this device — will sync automatically once you're back on the
  office network.") instead of refetching — the next successful `drainSyncQueue()` run (via
  `processSync()`) reconciles with the server as before.
- `MANUAL_Field_Tech.md` — added a line under "Working Offline" explaining that a save now always
  stays visible immediately, queued or not, and describing the new toast wording.

Verified: `npx tsc --noEmit` clean, `npm test` (563 tests) passes, `eslint` on the two changed
files shows only pre-existing unrelated warnings (confirmed via `git stash` diff — present on the
pre-change file too).

**Not done / out of scope for this session:** this was never run against a live phone + packaged
app (no installer available in this environment, per the prior handoff). The fix is a plausible,
verified-by-code-reading root cause and passes all existing automated checks, but the owner should
re-test the exact repro (phone on office WiFi, save a note/status, confirm it stays visible) once a
build is available.

## Still true from before

No installer exists yet for v2.0 in any environment that's touched this repo (see 09-12 handoff).
That's still the bigger blocker before any real device testing — including re-verifying this fix —
can happen.

## Next session should

1. If the owner reports the fix worked (or didn't), pick up from their next message rather than
   re-diagnosing from scratch.
2. Separately, the underlying UX complaint stands even after this fix: **the field module has no
   day-to-day multi-device story beyond "same office WiFi."** Worth a conversation with the owner
   about whether the current queued/synced toast is enough, or whether they want something more
   visible (e.g. a persistent per-job "unsynced" badge) — didn't build that speculatively this
   session since it wasn't asked for and the reported symptom is fixed by the change above.
