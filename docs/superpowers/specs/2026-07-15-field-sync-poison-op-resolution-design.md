# Field Sync — Stuck Record Resolution (Design)

**Date:** 2026-07-15
**Status:** Approved, pending implementation plan
**Surfaces:** `/field` (tech), dashboard (admin)
**Tier:** Base and Plus — not Plus-gated

---

## Problem

The field module queues writes to IndexedDB when they can't reach the server and replays them later. Two defects were fixed on 2026-07-15 (see "Prior work" below), leaving one behind: a queued write the server *permanently rejects* can never succeed, and there is no way to resolve it.

A record goes permanently bad when the office changes the world underneath it — the job it targets is cancelled, deleted, or otherwise no longer accepts the write. Retrying accomplishes nothing. Today `drainSyncQueue` stops at the first rejection, so one dead record at the head of the queue freezes every good record behind it, indefinitely.

The queue lives in IndexedDB **on the tech's phone**. It is origin-scoped, device-local storage. The office server cannot enumerate, read, or mutate it — so an admin cannot reach in and fix a stuck record. Only the device can act on it.

The crack in that constraint is the basis of this design: **a record only becomes permanently rejected when the server answers**. Reachability is proven by the very failure that stranded the record. The admin can't reach in, but the phone can push out.

## Goals

- A tech can resolve a stuck record: re-target it, discard it, or hand it to the office.
- A discard always leaves a server-side audit trail carrying the full lost payload.
- One stuck record never blocks unrelated queued work.
- A tech is interrupted only when a human decision is genuinely required.

## Non-goals

- Linux support (abandoned 2026-07-15).
- The always-on Windows Service (approved, tracked separately).
- Any cap or expiry on how long a stuck record may sit unresolved. Revisit only if techs demonstrably ignore the banner.

## Prior work (2026-07-15, same session)

1. **Writes were lost, not queued, when the server was down.** The four write paths in `src/app/field/page.tsx` branched on `navigator.onLine`, which reports whether the *device* has a network interface — not whether the *office server* is reachable. With the office PC shut down and the tech on full signal the flag reads `true`, so the write took the online branch, the fetch rejected, and the payload died in a catch block. Fixed by extracting `submitWrite` to `src/lib/offlineWrite.ts`, which queues on request failure rather than radio state.
2. **The queue never drained without a connectivity transition.** `processSync()` was only ever called from the `online` event handler. If the server was down while the device kept its connection, no `online` event fires and queued writes sat indefinitely. Fixed by extracting `drainSyncQueue` and calling it on mount.

---

## The ordering rule

One rule drives the drain, and it is what makes quarantine safe:

> **Stop if the op might still succeed later. Continue past it if it never will.**

A 500 or a dropped connection means op1 could go through on the next attempt, so op2 must wait behind it — otherwise a later edit to the same job could land first. A 404 means op1 is dead forever; nothing is preserved by making op2 wait for a corpse. Ops targeting *other* jobs were never ordered against op1 at all.

Skipping a stuck record cannot apply writes out of order. If op1 is stuck because job X was deleted, any later op targeting job X is rejected for the same reason and quarantined too. The behavior is self-consistent.

### Rejection classification

| Server response | Meaning | Drain behavior |
|---|---|---|
| 2xx | Accepted | Remove from queue, continue |
| 400, 404, 409, 422 | Bad data — permanently dead | **Quarantine, continue** |
| 401, 403 | Session expired / forbidden | Stop, prompt re-login |
| 408, 429, 5xx | Transient | Stop, retry later |
| *fetch rejects* | Server unreachable | Stop, retry later |
| Any other status | Unknown | Treat as transient |

The unknown-code default is deliberate. An unrecognized status means we do not understand what happened, and the safe response to "I don't know" is to keep the data and not interrupt the tech. Never quarantine something we cannot explain. The conservative default costs a retry; the aggressive one costs someone's afternoon.

`401`/`403` must never quarantine. The data is fine; the cookie isn't. Surfacing an expired session as a stuck record would invite a tech to discard real work over a login prompt — the exact data loss this work exists to prevent.

---

## Data model

### Device (IndexedDB, `DB_NAME` "WhiteVanOpsField", `DB_VERSION` 1 → 2)

`syncQueue` is unchanged: `{ id, url, method, body, timestamp }`.

New store:

```
stuckOps  { id, url, method, body, queuedAt, rejectedAt, status, message }
```

`keyPath: "id"`, `autoIncrement: true`.

Synthetic row:

```json
{
  "id": 1,
  "url": "/api/time",
  "method": "POST",
  "body": { "jobId": "job_abc", "personnelId": "per_xyz", "date": "2026-07-15", "duration": "01:30" },
  "queuedAt": 1752537600000,
  "rejectedAt": 1752624000000,
  "status": 404,
  "message": "Job not found"
}
```

The 1→2 upgrade is **purely additive**: `onupgradeneeded` creates an empty store and rewrites no existing rows, so a device holding queued work upgrades without touching it.

Separate stores rather than a `stuck: true` flag on `syncQueue`: `getSyncQueue()` keeps meaning "things that will send" and `getStuckOps()` means "things that need you." A shared store with a flag would force every caller to remember to filter, and the first one that forgets makes the pending badge count dead records as pending. That is the same shape as the `navigator.onLine` bug this session already paid to remove.

### Server (Prisma)

New model `SyncReviewItem` — records handed off to the office:

| Field | Notes |
|---|---|
| `id` | cuid |
| `personnelId` | who sent it, derived from session |
| `userId` | the sending user account |
| `url`, `method` | original op |
| `body` | `Json` — original payload |
| `queuedAt`, `rejectedAt` | timestamps from the device |
| `rejectionStatus`, `rejectionMessage` | why it stranded |
| `status` | `Open` \| `Resolved` \| `Dismissed` |
| `resolvedById`, `resolvedAt` | nullable |
| `createdAt` | default now |

Standard migration, ships to every install. **Not Plus-gated** — a Base customer losing a tech's hours is the same bug. Do not call `requirePlus` in this route.

---

## Modules

| Module | Responsibility |
|---|---|
| `src/lib/idb.ts` | Storage only. Adds `stuckOps` store, `DB_VERSION` → 2, `getStuckOps` / `moveToStuck` / `removeFromStuckOps`. |
| `src/lib/offlineWrite.ts` | Sending. Adds `classifyRejection(status)` and new `drainSyncQueue` semantics. |
| `src/lib/syncResolution.ts` *(new)* | Fixing. `discardStuckOp` / `retargetStuckOp` / `handoffStuckOp`. |
| `src/app/api/field/sync-resolution/route.ts` *(new)* | Server side of the three actions. |

Resolution lives in its own module rather than growing `offlineWrite.ts`: "send things" and "repair things a human touched" are different jobs, and both must stay small enough to test cleanly.

### `DrainResult`

```ts
type DrainResult = {
  synced: number;
  stuck: number;
  remaining: number;
  stopped: "complete" | "unreachable" | "auth" | "retry";
};
```

---

## The acknowledgement invariant

> **Never remove a record from the device until the server has acknowledged it.**

This single rule orders every action and is what stops this feature from becoming a new data-loss vector.

| Action | Sequence |
|---|---|
| **Discard** | POST the audit → **only on 200**, delete locally. If the office is unreachable, the record stays stuck. A discard with no audit trail is impossible by construction. |
| **Re-target** | Re-send the corrected payload via `submitWrite` → **only if it returns `"synced"`**, POST `action: "retarget"` to write the audit, then clear locally. If rejected again, refresh the stored rejection and stay stuck, writing no audit. Never log a re-target that didn't land. Note this is two server calls in sequence — the normal write route, then the audit — and the audit is second precisely so it can only describe something that actually happened. |
| **Hand off** | POST creates the `SyncReviewItem` and its audit in one transaction → **only on 200**, delete locally. |

Every action is a no-op when the office is down. That is correct: a stuck record is already safe where it is.

---

## API

`POST /api/field/sync-resolution`

```ts
{
  action: "discard" | "retarget" | "handoff";
  op: { url: string; method: string; body: unknown; queuedAt: number };
  rejection: { status: number; message: string; rejectedAt: number };
  newJobId?: string;   // retarget only — the job the payload was moved to
}
```

- `requireRole(user, "tech", "admin", "superuser")`.
- Do **not** call `requirePlus` — see tier note above.
- The tech supplies the payload, so the route re-derives `personnelId` from the session and never trusts the body, matching the rest of the tech surface.
- Audits via `audit(userId, action, entity, entityId, details)`. A discarded record never existed server-side, so there is no row to point at — the audit's value lives entirely in `details`, which must carry the full op and the rejection. Without the payload the trail reads "a tech discarded something," which helps nobody. With it, an admin sees "1.5h on job_abc, 2026-07-15, rejected 404" and can re-enter it.

**Route placement is load-bearing.** `TECH_ALLOWED_PREFIXES` in `src/middleware.ts` already contains `/api/field` and matches by `startsWith`, so `/api/field/sync-resolution` is reachable by techs with **no middleware change**. Any other path needs one.

---

## UI

### Tech (`/field`)

A banner appears only when `getStuckOps()` is non-empty: *"2 entries need attention."* Tapping opens a panel with one card per stuck record showing what it was ("1.5h on Maple St — 15 Jul"), why it's stuck in plain words ("that job no longer exists"), and the actions.

| Stuck op | Re-target | Discard | Send to office |
|---|---|---|---|
| Log time | Yes | Yes | Yes |
| Save notes | Yes | Yes | Yes |
| Save materials | Yes | Yes | Yes |
| Change job status | **No** | Yes | Yes |

Status changes are excluded from re-targeting: re-pointing "mark job X complete" at job Y is a different intent, not a correction, and could silently close the wrong work order with no admin in the loop.

The re-target picker can only offer the tech's **assigned** jobs, per existing role rules. When the correct job isn't theirs they cannot pick it — which is precisely when "send to office" earns its place.

### Admin (dashboard)

Follows existing patterns: new `"syncReview"` entry in `ModalType` (`src/types.ts`), `SyncReviewModal.tsx` built on `Modal`/`ModalHeader`, wired in `src/app/page.tsx`. `/api/dashboard` returns open items; an Overview card appears when the count is non-zero.

The admin re-targets against the **full** job list — not one tech's — which is the entire reason handoff exists. Dismiss is audited.

---

## `sw.js` cleanup

`public/sw.js` contains its own `processSyncQueue()` behind a `sync` listener for tag `sync-wvo-offline-writes`. That tag appears exactly once in the codebase — in the listener itself. Nothing calls `registration.sync.register(...)`, so the event has never fired and the code has never run.

**Delete the `sync` listener and `processSyncQueue()`.** It is a second, divergent copy of drain logic that knows nothing about classification or quarantine, and would re-send quarantined records if anyone ever wired up the tag. The page-side drain-on-mount covers the real case. The caching logic in `sw.js` is untouched.

---

## Testing

`vitest.config.ts` is `environment: "node"` with `include: ["src/**/*.test.ts"]` — no jsdom, no component tests. Logic stays in `src/lib/`; `.tsx` stays thin wiring.

**Unit**
- `classifyRejection` across every status class, including the unknown-code default.
- `drainSyncQueue`: quarantine-and-continue on permanent; stop-and-hold on auth, transient, and unreachable; correct `synced`/`stuck` counts; ordering preserved past a quarantine.

**`syncResolution`** — the negative cases carry the weight, since that is where a data-loss bug would hide:
- discard does **not** delete locally when the audit POST fails;
- re-target does **not** audit when the re-send is rejected;
- handoff deletes only on a 200.

**Route** — follows the existing `route.test.ts` pattern (`license`, `health`): role gating, audit written, `SyncReviewItem` created, `personnelId` taken from session not body.

**Browser-verified, not unit-tested** — the `DB_VERSION` 1→2 upgrade against a device holding existing queued rows. `fake-indexeddb` is not installed, and the real upgrade path is worth verifying in a real browser rather than trusting a shim for the one step that could strand a tech's data. Drive `/field`: queue with the server down, force a stuck record with a dead `jobId`, exercise all three resolutions.

Existing test conventions apply — mock `@/lib/db` in anything importing it, `vi.resetAllMocks()` in `beforeEach`, `vi.stubEnv` over direct `process.env` assignment.

---

## Docs

Per the manual policy in `CLAUDE.md`, this is user-facing on both surfaces and manual updates are part of the work:

- `MANUAL_Field_Tech.md` — the attention banner and the three actions.
- `MANUAL_Administrator.md` — the Sync Review card and modal.
