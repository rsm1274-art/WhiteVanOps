# Field Sync — Stuck Record Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a field tech resolve a permanently-rejected queued write (re-target, discard, or hand off to the office) without one dead record blocking the rest of the queue.

**Architecture:** Quarantine permanently-rejected ops from the IndexedDB `syncQueue` into a new `stuckOps` store and keep draining past them. A new client module (`syncResolution.ts`) and a new tech-reachable API route (`/api/field/sync-resolution`) implement the three resolution actions under one invariant: never delete from the device until the server has acknowledged. Handed-off records land in a new `SyncReviewItem` table surfaced to admins on the dashboard.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma + PostgreSQL, IndexedDB, Vitest (node env, no jsdom).

**Spec:** `docs/superpowers/specs/2026-07-15-field-sync-poison-op-resolution-design.md`

## Global Constraints

- **Not Plus-gated.** Never call `requirePlus` in any route added here (spec: "Do not call `requirePlus` in this route").
- **Route placement is load-bearing:** the tech-facing route MUST live at `/api/field/sync-resolution` — `TECH_ALLOWED_PREFIXES` in `src/middleware.ts:28` matches `/api/field` by `startsWith`, so no middleware change is needed. The admin route deliberately lives outside that allowlist.
- **Acknowledgement invariant:** never remove a record from the device until the server has acknowledged it (2xx). Every negative test in this plan defends this.
- **Rejection classification:** 400/404/409/422 = permanent (quarantine, continue). 401/403 = auth (stop, never quarantine). 408/429/5xx and *any unrecognized status* = transient (stop, retry later). Fetch rejection = unreachable (stop).
- **`personnelId` is derived from the session JWT, never trusted from the request body.**
- **Testing conventions** (from `CLAUDE.md`): mock `@/lib/db` in anything importing it; `vi.resetAllMocks()` in `beforeEach`; `vi.stubEnv` over direct `process.env` assignment; `environment: "node"` — logic in `src/lib/`, `.tsx` stays thin wiring; keep fake secret-shaped fixtures short.
- **Manual updates are part of the work**, not a follow-up (`MANUAL_Field_Tech.md`, `MANUAL_Administrator.md`).
- Commit message format: `<type>: <description>` (conventional commits).

## Assumptions (deviations from the spec's letter, surfaced deliberately)

1. **Re-target uses a raw `fetch`, not `submitWrite`.** The spec says "via `submitWrite`", but `submitWrite` (a) throws an `Error` carrying no HTTP status, and the spec requires refreshing the stored rejection with the new status; and (b) falls back to `addToSyncQueue` when unreachable, which would duplicate the op (once in `stuckOps`, once in `syncQueue`). A raw fetch that leaves the record untouched on network failure honors the spec's own invariant table ("Every action is a no-op when the office is down") exactly.
2. **Re-target clears locally once the corrected write is acknowledged, even if the follow-up audit POST fails.** The invariant protects data, and the data landed; keeping the record stuck after a successful re-send risks a double-submission. The audit is best-effort *after* the ack.
3. **Admin re-target is client-side:** the modal re-sends the corrected payload to the op's original URL under the admin's session (admins pass `requireRole` on `/api/time` and `/api/jobs` already), then marks the `SyncReviewItem` resolved. No server-side op-replay engine.
4. **Discard/retarget audits use `prisma.auditLog.create` directly, not the `audit()` helper.** `audit()` is fire-and-forget and never throws — a swallowed failure would return 200 and the device would delete the payload with no trail, violating "a discard with no audit trail is impossible by construction." Here the audit write must fail the request.

## File Structure

| File | Change |
|---|---|
| `src/lib/idb.ts` | Modify — `DB_VERSION` 2, `stuckOps` store, `StuckOp` type, `getStuckOps` / `moveToStuck` / `updateStuckOp` / `removeFromStuckOps` |
| `src/lib/offlineWrite.ts` | Modify — `classifyRejection`, quarantine-and-continue `drainSyncQueue`, new `DrainResult` |
| `src/lib/offlineWrite.test.ts` | Modify — new classification + drain tests |
| `src/lib/syncResolution.ts` | **New** — `discardStuckOp` / `retargetStuckOp` / `handoffStuckOp` |
| `src/lib/syncResolution.test.ts` | **New** |
| `prisma/schema.prisma` | Modify — `SyncReviewItem` model + `Personnel.syncReviewItems` back-relation |
| `src/app/api/field/sync-resolution/route.ts` | **New** — tech-facing discard/retarget/handoff |
| `src/app/api/field/sync-resolution/route.test.ts` | **New** |
| `src/app/api/sync-review/[id]/route.ts` | **New** — admin resolve/dismiss |
| `src/app/api/sync-review/[id]/route.test.ts` | **New** |
| `src/app/api/dashboard/route.ts` | Modify — return open `syncReviewItems` |
| `src/types.ts` | Modify — `"syncReview"` in `ModalType`, `SyncReviewItemData`, `DashboardData.syncReviewItems` |
| `src/components/modals/SyncReviewModal.tsx` | **New** |
| `src/components/tabs/OverviewTab.tsx` | Modify — Sync Review alert card |
| `src/app/page.tsx` | Modify — modal wiring + card handler |
| `src/app/field/page.tsx` | Modify — attention banner + resolution panel |
| `public/sw.js` | Modify — delete dead `sync` listener, `processSyncQueue()`, and its `openDB()` |
| `MANUAL_Field_Tech.md`, `MANUAL_Administrator.md` | Modify — document both surfaces |

---

### Task 1: `stuckOps` store in `idb.ts`

**Files:**
- Modify: `src/lib/idb.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3, 6, 8):
  - `interface StuckOp { id?: number; url: string; method: string; body: any; queuedAt: number; rejectedAt: number; status: number; message: string }`
  - `getStuckOps(): Promise<StuckOp[]>`
  - `moveToStuck(op: SyncOperation, rejection: { status: number; message: string }): Promise<void>`
  - `updateStuckOp(id: number, rejection: { status: number; message: string; rejectedAt: number }): Promise<void>`
  - `removeFromStuckOps(id: number): Promise<void>`

No unit tests for this task: `fake-indexeddb` is deliberately not installed (spec: the 1→2 upgrade is browser-verified, not shim-tested). Verification is `tsc` here and the browser checklist in Task 11.

- [ ] **Step 1: Bump the version and add the store**

In `src/lib/idb.ts`, change line 2 and extend `onupgradeneeded` (the existing `contains()` guards make the upgrade purely additive — a device holding queued rows is untouched):

```ts
export const DB_VERSION = 2;
```

```ts
    request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains("apiCache")) {
        db.createObjectStore("apiCache", { keyPath: "url" });
      }

      if (!db.objectStoreNames.contains("syncQueue")) {
        const store = db.createObjectStore("syncQueue", { keyPath: "id", autoIncrement: true });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }

      // v2: quarantine store for permanently-rejected ops. Separate store, not a
      // flag on syncQueue: getSyncQueue() keeps meaning "things that will send",
      // so no caller can forget to filter and count dead records as pending.
      if (!db.objectStoreNames.contains("stuckOps")) {
        db.createObjectStore("stuckOps", { keyPath: "id", autoIncrement: true });
      }
    };
```

- [ ] **Step 2: Add the type and the four helpers**

Append to `src/lib/idb.ts` (matching the file's existing promise-wrapper style):

```ts
export interface StuckOp {
  id?: number;
  url: string;
  method: string;
  body: any;
  queuedAt: number;
  rejectedAt: number;
  status: number;
  message: string;
}

export async function getStuckOps(): Promise<StuckOp[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stuckOps", "readonly");
    const store = tx.objectStore("stuckOps");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Quarantine a permanently-rejected op: remove it from syncQueue and record it
 * in stuckOps in one transaction, so a crash between the two can't lose it.
 */
export async function moveToStuck(
  op: SyncOperation,
  rejection: { status: number; message: string }
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["syncQueue", "stuckOps"], "readwrite");
    tx.objectStore("stuckOps").add({
      url: op.url,
      method: op.method,
      body: op.body,
      queuedAt: op.timestamp,
      rejectedAt: Date.now(),
      status: rejection.status,
      message: rejection.message,
    });
    tx.objectStore("syncQueue").delete(op.id!);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Refresh the stored rejection after a re-target attempt is rejected again. */
export async function updateStuckOp(
  id: number,
  rejection: { status: number; message: string; rejectedAt: number }
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stuckOps", "readwrite");
    const store = tx.objectStore("stuckOps");
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        store.put({ ...getReq.result, ...rejection });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeFromStuckOps(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stuckOps", "readwrite");
    tx.objectStore("stuckOps").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/idb.ts
git commit -m "feat(field): add stuckOps quarantine store (IndexedDB v2)"
```

---

### Task 2: `classifyRejection`

**Files:**
- Modify: `src/lib/offlineWrite.ts`
- Test: `src/lib/offlineWrite.test.ts`

**Interfaces:**
- Produces (used by Task 3):
  - `type RejectionClass = "permanent" | "auth" | "transient"`
  - `classifyRejection(status: number): RejectionClass`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/offlineWrite.test.ts` (import `classifyRejection` from `@/lib/offlineWrite` at the top):

```ts
describe("classifyRejection", () => {
  test.each([400, 404, 409, 422])("classifies %i as permanent — bad data never succeeds on retry", (status) => {
    expect(classifyRejection(status)).toBe("permanent");
  });

  test.each([401, 403])("classifies %i as auth — the data is fine, the cookie isn't", (status) => {
    // A 401/403 must never quarantine: surfacing an expired session as a stuck
    // record would invite a tech to discard real work over a login prompt.
    expect(classifyRejection(status)).toBe("auth");
  });

  test.each([408, 429, 500, 502, 503])("classifies %i as transient", (status) => {
    expect(classifyRejection(status)).toBe("transient");
  });

  test.each([418, 300, 499, 599])("defaults unknown status %i to transient — never quarantine what we cannot explain", (status) => {
    expect(classifyRejection(status)).toBe("transient");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/offlineWrite.test.ts`
Expected: FAIL — `classifyRejection` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/offlineWrite.ts`:

```ts
export type RejectionClass = "permanent" | "auth" | "transient";

/**
 * Classify a non-2xx status for the drain. The unknown-status default is
 * transient on purpose: the safe response to "I don't know what happened"
 * is to keep the data and not interrupt the tech. Never quarantine
 * something we cannot explain.
 */
export function classifyRejection(status: number): RejectionClass {
  if (status === 400 || status === 404 || status === 409 || status === 422) return "permanent";
  if (status === 401 || status === 403) return "auth";
  return "transient";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/lib/offlineWrite.test.ts`
Expected: new tests PASS (existing drain tests still pass — nothing changed yet).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offlineWrite.ts src/lib/offlineWrite.test.ts
git commit -m "feat(field): classify sync rejections as permanent, auth, or transient"
```

---

### Task 3: Quarantine-and-continue `drainSyncQueue`

**Files:**
- Modify: `src/lib/offlineWrite.ts`, `src/lib/offlineWrite.test.ts`
- Modify: `src/app/field/page.tsx:616-630` (only the `processSync` toast — keep the page compiling; the full UI is Task 8)

**Interfaces:**
- Consumes: `moveToStuck` from Task 1, `classifyRejection` from Task 2.
- Produces (used by Task 8):

```ts
export type DrainResult = {
  synced: number;
  stuck: number;
  remaining: number; // ops still in syncQueue (stuck ops are NOT remaining)
  stopped: "complete" | "unreachable" | "auth" | "retry";
};
```

The old `stopped: "rejected"` value disappears: a reachable rejection now either quarantines (permanent), stops as `"auth"`, or stops as `"retry"` (transient/unknown).

- [ ] **Step 1: Update the mock and write the failing tests**

In `src/lib/offlineWrite.test.ts`, extend the `@/lib/idb` mock:

```ts
vi.mock("@/lib/idb", () => ({
  addToSyncQueue: vi.fn(),
  getSyncQueue: vi.fn(),
  removeFromSyncQueue: vi.fn(),
  moveToStuck: vi.fn(),
}));
```

Import `moveToStuck` alongside the other idb imports. Then **replace** the existing test `"stops without removing when the server rejects an op, keeping later ops behind it"` with these (the `op(id, body)` helper already exists in the file):

```ts
  test("quarantines a permanently-rejected op and continues draining the rest", async () => {
    // Arrange — op 1 targets a deleted job (404); ops 2 and 3 are fine. One
    // dead record must not freeze the good ones behind it.
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 }), op(3, { c: 3 })]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: "Job not found" }) })
        .mockResolvedValue({ ok: true })
    );

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 2, stuck: 1, remaining: 0, stopped: "complete" });
    expect(moveToStuck).toHaveBeenCalledWith(op(1, { a: 1 }), { status: 404, message: "Job not found" });
    expect(removeFromSyncQueue).toHaveBeenCalledWith(2);
    expect(removeFromSyncQueue).toHaveBeenCalledWith(3);
    expect(removeFromSyncQueue).not.toHaveBeenCalledWith(1);
  });

  test("falls back to a generic quarantine message when the rejection has no JSON body", async () => {
    // Arrange
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 })]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => { throw new SyntaxError("Unexpected end of JSON input"); },
      })
    );

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, stuck: 1, remaining: 0, stopped: "complete" });
    expect(moveToStuck).toHaveBeenCalledWith(op(1, { a: 1 }), { status: 422, message: "Request failed (422)" });
  });

  test("stops without quarantining when the session has expired, keeping every op queued", async () => {
    // Arrange — 401 means the cookie is bad, not the data. Quarantining here
    // would invite a tech to discard real work over a login prompt.
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, stuck: 0, remaining: 2, stopped: "auth" });
    expect(moveToStuck).not.toHaveBeenCalled();
    expect(removeFromSyncQueue).not.toHaveBeenCalled();
  });

  test("stops and holds the queue on a transient rejection", async () => {
    // Arrange — a 500 might succeed next attempt; op 2 must wait behind op 1
    // so same-job edits can't apply out of order.
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, stuck: 0, remaining: 2, stopped: "retry" });
    expect(moveToStuck).not.toHaveBeenCalled();
  });

  test("treats an unknown status as transient — keep the data, don't interrupt the tech", async () => {
    // Arrange
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 418, json: async () => ({}) }));

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, stuck: 0, remaining: 1, stopped: "retry" });
    expect(moveToStuck).not.toHaveBeenCalled();
  });
```

Also update the three surviving drain tests' expected objects to include `stuck: 0` (empty queue, all-succeed, unreachable-midway), and the unreachable test's expectation to `{ synced: 1, stuck: 0, remaining: 2, stopped: "unreachable" }`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/offlineWrite.test.ts`
Expected: FAIL — `stuck` missing from `DrainResult`, `moveToStuck` never called.

- [ ] **Step 3: Implement**

In `src/lib/offlineWrite.ts`, change the idb import and replace `DrainResult` + `drainSyncQueue`:

```ts
import { addToSyncQueue, getSyncQueue, removeFromSyncQueue, moveToStuck } from "@/lib/idb";
```

```ts
export type DrainResult = {
  synced: number;
  stuck: number;
  remaining: number;
  stopped: "complete" | "unreachable" | "auth" | "retry";
};
```

```ts
/**
 * Replay queued writes to the server, oldest first.
 *
 * Safe to call at any time — it probes by attempting the first write rather
 * than consulting `navigator.onLine`, so it works when the server has come
 * back up without the device ever having lost connectivity.
 *
 * One rule drives the loop: stop if the op might still succeed later,
 * continue past it if it never will. A transient failure (5xx, unreachable)
 * stops the drain so same-job edits can't apply out of order. A permanent
 * rejection (400/404/409/422) quarantines the op into stuckOps and keeps
 * going — nothing is preserved by making live work wait behind a corpse, and
 * any later op rejected for the same reason is quarantined identically.
 */
export async function drainSyncQueue(): Promise<DrainResult> {
  const queue = await getSyncQueue();
  let synced = 0;
  let stuck = 0;

  for (const op of queue) {
    const remaining = queue.length - synced - stuck;
    let res: Response;

    try {
      res = await fetch(op.url, {
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(op.body),
      });
    } catch {
      return { synced, stuck, remaining, stopped: "unreachable" };
    }

    if (!res.ok) {
      const kind = classifyRejection(res.status);
      if (kind === "auth") return { synced, stuck, remaining, stopped: "auth" };
      if (kind === "transient") return { synced, stuck, remaining, stopped: "retry" };

      let message = `Request failed (${res.status})`;
      try {
        const result = await res.json();
        if (result?.error) message = result.error;
      } catch {
        // Rejection carried no JSON body; the status-code message stands.
      }
      await moveToStuck(op, { status: res.status, message });
      stuck++;
      continue;
    }

    await removeFromSyncQueue(op.id!);
    synced++;
  }

  return { synced, stuck, remaining: 0, stopped: "complete" };
}
```

- [ ] **Step 4: Keep `processSync` in `src/app/field/page.tsx` honest**

The page only reads `synced` and compares `stopped === "complete"`, so it still compiles — but its early return `if (synced === 0) return;` would now hide a quarantine. Minimal change (full UI comes in Task 8) — replace the body of `processSync` (`src/app/field/page.tsx:616-630`):

```ts
  const processSync = async () => {
    try {
      const { synced, stuck, stopped } = await drainSyncQueue();
      if (synced === 0 && stuck === 0) return;
      checkSyncStatus();
      if (tech) loadJobs(tech.id);
      showToast(
        stopped === "complete" && stuck === 0
          ? "Background sync completed. All changes saved to server."
          : `Synced ${synced} change${synced === 1 ? "" : "s"}. ${stuck > 0 ? `${stuck} need${stuck === 1 ? "s" : ""} attention.` : "The rest are still queued."}`,
        stuck > 0
      );
    } catch (err) {
      console.error("Sync failed", err);
    }
  };
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- src/lib/offlineWrite.test.ts` → all PASS.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/offlineWrite.ts src/lib/offlineWrite.test.ts src/app/field/page.tsx
git commit -m "feat(field): quarantine permanently-rejected ops and drain past them"
```

---

### Task 4: `SyncReviewItem` schema + migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces (used by Tasks 5, 7): Prisma model `SyncReviewItem` with fields exactly as below.

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, after the `AuditLog` model, add:

```prisma
// Field-sync records handed off to the office when a tech can't resolve a
// permanently-rejected offline write. Ships to every install — not Plus-gated.
model SyncReviewItem {
  id               String     @id @default(cuid())
  personnelId      String?
  personnel        Personnel? @relation(fields: [personnelId], references: [id])
  userId           String
  url              String
  method           String
  body             Json
  queuedAt         DateTime
  rejectedAt       DateTime
  rejectionStatus  Int
  rejectionMessage String
  status           String     @default("Open") // "Open" | "Resolved" | "Dismissed"
  resolvedById     String?
  resolvedAt       DateTime?
  createdAt        DateTime   @default(now())
}
```

And on the `Personnel` model, add the back-relation field:

```prisma
  syncReviewItems SyncReviewItem[]
```

- [ ] **Step 2: Migrate**

Run: `npx prisma migrate dev --name add_sync_review_item`
Expected: migration created and applied; `prisma generate` runs automatically.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (client regenerated with the new model).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): SyncReviewItem model for handed-off stuck sync records"
```

---

### Task 5: Tech route `POST /api/field/sync-resolution`

**Files:**
- Create: `src/app/api/field/sync-resolution/route.ts`
- Test: `src/app/api/field/sync-resolution/route.test.ts`

**Interfaces:**
- Consumes: `SyncReviewItem` model (Task 4); `getSessionUser`/`requireRole` from `@/lib/auth`.
- Produces (called by Task 6): `POST` accepting

```ts
{
  action: "discard" | "retarget" | "handoff";
  op: { url: string; method: string; body: unknown; queuedAt: number };
  rejection: { status: number; message: string; rejectedAt: number };
  newJobId?: string; // retarget only
}
```

Returns `{ ok: true }` (discard/retarget) or `{ ok: true, id }` (handoff); 400 on bad input, 401/403 via `requireRole`, 500 when the audit or transaction fails.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/field/sync-resolution/route.test.ts` (mocking pattern copied from `src/app/api/license/route.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma = {
    syncReviewItem: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  // Interactive transaction: hand the callback the same mocked client.
  prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  return { prisma };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

const sessionPayload = vi.hoisted(() => ({
  current: { userId: "u1", username: "tech1", displayName: "Tech One", role: "tech", personnelId: "per_1" },
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async () => ({ payload: sessionPayload.current })),
  };
});

import { prisma } from "@/lib/db";
import { POST } from "./route";

const validBody = {
  action: "discard",
  op: { url: "/api/time", method: "POST", body: { jobId: "job_abc", duration: "01:30" }, queuedAt: 1752537600000 },
  rejection: { status: 404, message: "Job not found", rejectedAt: 1752624000000 },
};

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/field/sync-resolution", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/field/sync-resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma));
    sessionPayload.current = { userId: "u1", username: "tech1", displayName: "Tech One", role: "tech", personnelId: "per_1" };
    vi.stubEnv("SESSION_SECRET", "test-secret-32-bytes-xxxxxxxxxxxx");
  });

  it("discard writes an audit row carrying the full op and rejection, then returns 200", async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

    const res = await POST(makeReq(validBody));

    expect(res.status).toBe(200);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        action: "DELETE",
        entity: "StuckSyncOp",
        details: expect.stringContaining("job_abc"),
      }),
    });
  });

  it("discard returns 500 when the audit write fails — a discard with no trail must not be acknowledged", async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("db down"));

    const res = await POST(makeReq(validBody));

    expect(res.status).toBe(500);
  });

  it("handoff creates the SyncReviewItem and its audit in one transaction, deriving personnelId from the session", async () => {
    vi.mocked(prisma.syncReviewItem.create).mockResolvedValue({ id: "sri_1" } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

    const res = await POST(makeReq({ ...validBody, action: "handoff", op: { ...validBody.op, body: { jobId: "job_abc", personnelId: "someone-else" } } }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("sri_1");
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.syncReviewItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        personnelId: "per_1", // session, never the body's claimed value
        userId: "u1",
        url: "/api/time",
        rejectionStatus: 404,
        rejectionMessage: "Job not found",
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CREATE", entity: "SyncReviewItem", entityId: "sri_1" }),
    });
  });

  it("retarget writes an UPDATE audit including the new job id", async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

    const res = await POST(makeReq({ ...validBody, action: "retarget", newJobId: "job_new" }));

    expect(res.status).toBe(200);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entity: "StuckSyncOp",
        details: expect.stringContaining("job_new"),
      }),
    });
  });

  it("rejects an unknown action with 400 and writes nothing", async () => {
    const res = await POST(makeReq({ ...validBody, action: "explode" }));

    expect(res.status).toBe(400);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.syncReviewItem.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed op with 400", async () => {
    const res = await POST(makeReq({ ...validBody, op: { url: 42 } }));

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/app/api/field/sync-resolution/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/field/sync-resolution/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";

// Server side of stuck-record resolution. Lives under /api/field on purpose:
// TECH_ALLOWED_PREFIXES in src/middleware.ts matches by startsWith, so techs
// reach it with no middleware change. Not Plus-gated — a Base customer losing
// a tech's hours is the same bug.
//
// Audits here use prisma.auditLog.create directly, NOT the fire-and-forget
// audit() helper: the device deletes its local copy on a 200, so a swallowed
// audit failure would make a discard with no trail possible. The audit write
// must fail the request.

interface ResolutionOp {
  url: string;
  method: string;
  body: unknown;
  queuedAt: number;
}

interface ResolutionRejection {
  status: number;
  message: string;
  rejectedAt: number;
}

function isValidOp(op: unknown): op is ResolutionOp {
  const o = op as ResolutionOp;
  return !!o && typeof o.url === "string" && typeof o.method === "string" && typeof o.queuedAt === "number";
}

function isValidRejection(r: unknown): r is ResolutionRejection {
  const rej = r as ResolutionRejection;
  return !!rej && typeof rej.status === "number" && typeof rej.message === "string" && typeof rej.rejectedAt === "number";
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  const denied = requireRole(user, "tech", "admin", "superuser");
  if (denied) return denied;

  let payload: {
    action?: string;
    op?: unknown;
    rejection?: unknown;
    newJobId?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, op, rejection, newJobId } = payload;
  if (
    (action !== "discard" && action !== "retarget" && action !== "handoff") ||
    !isValidOp(op) ||
    !isValidRejection(rejection)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (action === "retarget" && typeof newJobId !== "string") {
    return NextResponse.json({ error: "newJobId is required for retarget" }, { status: 400 });
  }

  // Re-derive from the session, never the body, matching the tech surface.
  const personnelId = user!.personnelId ?? null;

  try {
    if (action === "handoff") {
      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.syncReviewItem.create({
          data: {
            personnelId,
            userId: user!.userId,
            url: op.url,
            method: op.method,
            body: (op.body ?? {}) as object,
            queuedAt: new Date(op.queuedAt),
            rejectedAt: new Date(rejection.rejectedAt),
            rejectionStatus: rejection.status,
            rejectionMessage: rejection.message,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: user!.userId,
            action: "CREATE",
            entity: "SyncReviewItem",
            entityId: created.id,
            details: JSON.stringify({ op, rejection }),
          },
        });
        return created;
      });
      return NextResponse.json({ ok: true, id: item.id });
    }

    // discard / retarget: there is no server-side row to point at — the op only
    // ever existed on the device. The audit's value lives entirely in details,
    // which carries the full payload so an admin can re-enter the work.
    await prisma.auditLog.create({
      data: {
        userId: user!.userId,
        action: action === "discard" ? "DELETE" : "UPDATE",
        entity: "StuckSyncOp",
        entityId: "device-local",
        details: JSON.stringify(
          action === "retarget" ? { op, rejection, newJobId } : { op, rejection }
        ),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Sync resolution failed:", error);
    return NextResponse.json({ error: "Failed to record resolution" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- src/app/api/field/sync-resolution/route.test.ts` → all PASS.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/field/sync-resolution
git commit -m "feat(api): tech-facing sync-resolution route (discard/retarget/handoff)"
```

---

### Task 6: Client module `src/lib/syncResolution.ts`

**Files:**
- Create: `src/lib/syncResolution.ts`
- Test: `src/lib/syncResolution.test.ts`

**Interfaces:**
- Consumes: `StuckOp`, `removeFromStuckOps`, `updateStuckOp` from `@/lib/idb` (Task 1); the route from Task 5.
- Produces (used by Task 8):
  - `discardStuckOp(op: StuckOp): Promise<"discarded" | "failed">`
  - `retargetStuckOp(op: StuckOp, newJobId: string): Promise<"retargeted" | "rejected" | "unreachable">`
  - `handoffStuckOp(op: StuckOp): Promise<"handed-off" | "failed">`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/syncResolution.test.ts`. The negative cases carry the weight — that is where a data-loss bug would hide:

```ts
import { describe, test, expect, vi, beforeEach } from "vitest";
import { discardStuckOp, retargetStuckOp, handoffStuckOp } from "@/lib/syncResolution";
import { removeFromStuckOps, updateStuckOp, type StuckOp } from "@/lib/idb";

vi.mock("@/lib/idb", () => ({
  removeFromStuckOps: vi.fn(),
  updateStuckOp: vi.fn(),
}));

const stuckOp: StuckOp = {
  id: 7,
  url: "/api/time",
  method: "POST",
  body: { jobId: "job_dead", personnelId: "per_1", date: "2026-07-15", duration: "01:30" },
  queuedAt: 1752537600000,
  rejectedAt: 1752624000000,
  status: 404,
  message: "Job not found",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("discardStuckOp", () => {
  test("deletes locally only after the audit POST returns 200", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await discardStuckOp(stuckOp);

    // Assert — audit first, delete second: a discard with no trail is
    // impossible by construction.
    expect(result).toBe("discarded");
    expect(fetchMock).toHaveBeenCalledWith("/api/field/sync-resolution", expect.objectContaining({ method: "POST" }));
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({
      action: "discard",
      op: { url: "/api/time", method: "POST", queuedAt: 1752537600000 },
      rejection: { status: 404, message: "Job not found", rejectedAt: 1752624000000 },
    });
    expect(sent.op.body).toEqual(stuckOp.body);
    expect(removeFromStuckOps).toHaveBeenCalledWith(7);
  });

  test("does NOT delete locally when the audit POST fails", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    // Act
    const result = await discardStuckOp(stuckOp);

    // Assert
    expect(result).toBe("failed");
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });

  test("does NOT delete locally when the office is unreachable — a stuck record is already safe where it is", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    // Act
    const result = await discardStuckOp(stuckOp);

    // Assert
    expect(result).toBe("failed");
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });
});

describe("retargetStuckOp", () => {
  test("re-sends the corrected payload, audits, and clears locally when the server accepts it", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await retargetStuckOp(stuckOp, "job_new");

    // Assert — first call is the real write with the corrected jobId; second
    // is the audit, second precisely so it can only describe something that
    // actually happened.
    expect(result).toBe("retargeted");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/time");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ jobId: "job_new", duration: "01:30" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/field/sync-resolution");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ action: "retarget", newJobId: "job_new" });
    expect(removeFromStuckOps).toHaveBeenCalledWith(7);
  });

  test("refreshes the stored rejection and does NOT audit when the re-send is rejected again", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Job is closed" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await retargetStuckOp(stuckOp, "job_new");

    // Assert — never log a re-target that didn't land.
    expect(result).toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateStuckOp).toHaveBeenCalledWith(7, expect.objectContaining({ status: 409, message: "Job is closed" }));
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });

  test("is a complete no-op when the office is unreachable", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    // Act
    const result = await retargetStuckOp(stuckOp, "job_new");

    // Assert
    expect(result).toBe("unreachable");
    expect(updateStuckOp).not.toHaveBeenCalled();
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });

  test("still clears locally when the write landed but the follow-up audit POST fails", async () => {
    // Arrange — the server acknowledged the corrected write; keeping the
    // record stuck now would risk a double-submission on the next attempt.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await retargetStuckOp(stuckOp, "job_new");

    // Assert
    expect(result).toBe("retargeted");
    expect(removeFromStuckOps).toHaveBeenCalledWith(7);
  });
});

describe("handoffStuckOp", () => {
  test("deletes locally only on a 200", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await handoffStuckOp(stuckOp);

    // Assert
    expect(result).toBe("handed-off");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: "handoff" });
    expect(removeFromStuckOps).toHaveBeenCalledWith(7);
  });

  test("does NOT delete locally when the handoff POST fails", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    // Act
    const result = await handoffStuckOp(stuckOp);

    // Assert
    expect(result).toBe("failed");
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/syncResolution.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/syncResolution.ts`:

```ts
import { removeFromStuckOps, updateStuckOp, type StuckOp } from "@/lib/idb";

/**
 * Resolution of quarantined (stuck) sync ops. Lives apart from offlineWrite.ts
 * on purpose: "send things" and "repair things a human touched" are different
 * jobs, and both must stay small enough to test cleanly.
 *
 * One invariant orders every action here: never remove a record from the
 * device until the server has acknowledged it. Every action is therefore a
 * no-op when the office is down — a stuck record is already safe where it is.
 */

const RESOLUTION_URL = "/api/field/sync-resolution";

function resolutionPayload(op: StuckOp, extra?: Record<string, unknown>) {
  return JSON.stringify({
    op: { url: op.url, method: op.method, body: op.body, queuedAt: op.queuedAt },
    rejection: { status: op.status, message: op.message, rejectedAt: op.rejectedAt },
    ...extra,
  });
}

async function postResolution(body: string): Promise<boolean> {
  try {
    const res = await fetch(RESOLUTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Discard: POST the audit → only on 200, delete locally. */
export async function discardStuckOp(op: StuckOp): Promise<"discarded" | "failed"> {
  const ok = await postResolution(resolutionPayload(op, { action: "discard" }));
  if (!ok) return "failed";
  await removeFromStuckOps(op.id!);
  return "discarded";
}

/**
 * Re-target: re-send the payload with the corrected jobId. Only if the server
 * accepts it, POST the audit — second precisely so it can only describe
 * something that actually happened — then clear locally. If rejected again,
 * refresh the stored rejection and stay stuck; never log a re-target that
 * didn't land.
 *
 * Uses a raw fetch rather than submitWrite: submitWrite's error carries no
 * status (needed to refresh the rejection), and its queue-on-unreachable
 * fallback would duplicate the op into syncQueue while it also sits here.
 */
export async function retargetStuckOp(
  op: StuckOp,
  newJobId: string
): Promise<"retargeted" | "rejected" | "unreachable"> {
  const corrected = { ...(op.body as Record<string, unknown>), jobId: newJobId };

  let res: Response;
  try {
    res = await fetch(op.url, {
      method: op.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corrected),
    });
  } catch {
    return "unreachable";
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const result = await res.json();
      if (result?.error) message = result.error;
    } catch {
      // Rejection carried no JSON body; the status-code message stands.
    }
    await updateStuckOp(op.id!, { status: res.status, message, rejectedAt: Date.now() });
    return "rejected";
  }

  // The write is acknowledged — clearing locally is now safe regardless of
  // whether the audit lands; keeping it stuck would risk double-submission.
  await postResolution(resolutionPayload(op, { action: "retarget", newJobId }));
  await removeFromStuckOps(op.id!);
  return "retargeted";
}

/** Hand off: the server stores the record and audit in one transaction → only on 200, delete locally. */
export async function handoffStuckOp(op: StuckOp): Promise<"handed-off" | "failed"> {
  const ok = await postResolution(resolutionPayload(op, { action: "handoff" }));
  if (!ok) return "failed";
  await removeFromStuckOps(op.id!);
  return "handed-off";
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- src/lib/syncResolution.test.ts` → all PASS.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syncResolution.ts src/lib/syncResolution.test.ts
git commit -m "feat(field): client-side stuck-op resolution under the acknowledgement invariant"
```

---

### Task 7: Admin route + dashboard data + types

**Files:**
- Create: `src/app/api/sync-review/[id]/route.ts`
- Test: `src/app/api/sync-review/[id]/route.test.ts`
- Modify: `src/app/api/dashboard/route.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: `SyncReviewItem` model (Task 4).
- Produces (used by Task 9):
  - `PATCH /api/sync-review/:id` with `{ action: "resolve" | "dismiss" }` → `{ ok: true }`; admin/superuser only.
  - `DashboardData.syncReviewItems: SyncReviewItemData[]` (open items only).
  - `src/types.ts`:

```ts
export interface SyncReviewItemData {
  id: string;
  personnelId: string | null;
  personnel: { firstName: string; lastName: string } | null;
  url: string;
  method: string;
  body: Record<string, unknown>;
  queuedAt: string;
  rejectedAt: string;
  rejectionStatus: number;
  rejectionMessage: string;
  status: string;
  createdAt: string;
}
```

- [ ] **Step 1: Write the failing route tests**

Create `src/app/api/sync-review/[id]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    syncReviewItem: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

const sessionPayload = vi.hoisted(() => ({
  current: { userId: "u1", username: "admin", displayName: "Admin", role: "admin" } as Record<string, unknown>,
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async () => ({ payload: sessionPayload.current })),
  };
});

import { prisma } from "@/lib/db";
import { PATCH } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/sync-review/sri_1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "sri_1" });

describe("PATCH /api/sync-review/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionPayload.current = { userId: "u1", username: "admin", displayName: "Admin", role: "admin" };
    vi.stubEnv("SESSION_SECRET", "test-secret-32-bytes-xxxxxxxxxxxx");
  });

  it("marks the item Resolved with resolver and timestamp, and audits", async () => {
    vi.mocked(prisma.syncReviewItem.update).mockResolvedValue({ id: "sri_1" } as any);

    const res = await PATCH(makeReq({ action: "resolve" }), { params });

    expect(res.status).toBe(200);
    expect(prisma.syncReviewItem.update).toHaveBeenCalledWith({
      where: { id: "sri_1" },
      data: expect.objectContaining({ status: "Resolved", resolvedById: "u1", resolvedAt: expect.any(Date) }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "UPDATE", entity: "SyncReviewItem", entityId: "sri_1" }),
    });
  });

  it("marks the item Dismissed and audits — dismiss must leave a trail", async () => {
    vi.mocked(prisma.syncReviewItem.update).mockResolvedValue({ id: "sri_1" } as any);

    const res = await PATCH(makeReq({ action: "dismiss" }), { params });

    expect(res.status).toBe(200);
    expect(prisma.syncReviewItem.update).toHaveBeenCalledWith({
      where: { id: "sri_1" },
      data: expect.objectContaining({ status: "Dismissed" }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("forbids techs — this route is deliberately outside TECH_ALLOWED_PREFIXES too", async () => {
    sessionPayload.current = { userId: "u2", username: "tech1", displayName: "Tech", role: "tech", personnelId: "per_1" };

    const res = await PATCH(makeReq({ action: "resolve" }), { params });

    expect(res.status).toBe(403);
    expect(prisma.syncReviewItem.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown action with 400", async () => {
    const res = await PATCH(makeReq({ action: "explode" }), { params });

    expect(res.status).toBe(400);
    expect(prisma.syncReviewItem.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/app/api/sync-review/[id]/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/sync-review/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";

// Admin disposition of handed-off sync records. Deliberately NOT under
// /api/field: techs must not resolve or dismiss office review items.
// Not Plus-gated.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const denied = requireRole(user, "admin", "superuser");
  if (denied) return denied;

  const { id } = await params;

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "resolve" && body.action !== "dismiss") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  try {
    const item = await prisma.syncReviewItem.update({
      where: { id },
      data: {
        status: body.action === "resolve" ? "Resolved" : "Dismissed",
        resolvedById: user!.userId,
        resolvedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: user!.userId,
        action: "UPDATE",
        entity: "SyncReviewItem",
        entityId: item.id,
        details: JSON.stringify({ disposition: body.action }),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Sync review update failed:", error);
    return NextResponse.json({ error: "Failed to update review item" }, { status: 500 });
  }
}
```

(The audit here is written directly for consistency with the route's sibling; a dismissed record's payload survives in `SyncReviewItem.body` regardless, so the audit is a trail of *who dispositioned it*, not the payload's only copy.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/app/api/sync-review/[id]/route.test.ts`
Expected: all PASS.

- [ ] **Step 5: Add open items to `/api/dashboard`**

In `src/app/api/dashboard/route.ts`, add `syncReviewItems` to the destructured `Promise.all` (after `invoices` in both the destructuring and the array). This data is **always** fetched — not Plus-gated:

```ts
      prisma.syncReviewItem.findMany({
        where: { status: "Open" },
        include: { personnel: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "asc" },
      }),
```

And add `syncReviewItems,` to the returned JSON object (after `recurringJobTemplates`).

- [ ] **Step 6: Add the types**

In `src/types.ts`:

1. Add `| "syncReview"` to `ModalType` (after `"recordPayment"`, before `| null`).
2. Add to `DashboardData`:

```ts
  /** Field-sync records handed to the office by techs. Open items only. */
  syncReviewItems: SyncReviewItemData[];
```

3. Add the `SyncReviewItemData` interface (shown in this task's Interfaces block) near `DashboardData`.

- [ ] **Step 7: Full test run and typecheck**

Run: `npm test` → all PASS.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/sync-review src/app/api/dashboard/route.ts src/types.ts
git commit -m "feat(api): admin sync-review disposition route and dashboard data"
```

---

### Task 8: Tech UI — attention banner and resolution panel in `/field`

**Files:**
- Modify: `src/app/field/page.tsx`

**Interfaces:**
- Consumes: `getStuckOps`, `StuckOp` from `@/lib/idb`; `discardStuckOp`, `retargetStuckOp`, `handoffStuckOp` from `@/lib/syncResolution`; existing `jobs: FieldJob[]` state, `showToast`, `checkSyncStatus`, `loadJobs`.
- Produces: nothing consumed by later tasks.

No unit tests (`.tsx` stays thin wiring per the testing section; behavior lives in the modules tested in Tasks 2, 3, 6). Verification is `tsc` + the browser checklist in Task 11.

- [ ] **Step 1: Imports and state**

In `src/app/field/page.tsx`:

```ts
import { cacheApiResponse, getCachedApiResponse, getSyncQueue, getStuckOps, type StuckOp } from "@/lib/idb";
import { submitWrite, drainSyncQueue } from "@/lib/offlineWrite";
import { discardStuckOp, retargetStuckOp, handoffStuckOp } from "@/lib/syncResolution";
```

In the main page component (next to `pendingSync` at `src/app/field/page.tsx:602`):

```ts
  const [stuckOps, setStuckOps] = useState<StuckOp[]>([]);
  const [showStuckPanel, setShowStuckPanel] = useState(false);
```

Extend `checkSyncStatus` to also load stuck ops:

```ts
  const checkSyncStatus = async () => {
    try {
      const q = await getSyncQueue();
      setPendingSync(q.length > 0);
      setStuckOps(await getStuckOps());
    } catch { }
  };
```

- [ ] **Step 2: Surface the auth stop and quarantines in `processSync`**

Replace `processSync` (adjusting the Task 3 version — the auth stop must tell the tech to log back in, and a drain that only quarantined still needs the badge refresh):

```ts
  const processSync = async () => {
    try {
      const { synced, stuck, stopped } = await drainSyncQueue();
      if (stopped === "auth") {
        showToast("Session expired. Log in again to sync your changes.", true);
        return;
      }
      if (synced === 0 && stuck === 0) return;
      checkSyncStatus();
      if (tech) loadJobs(tech.id);
      if (stuck > 0) {
        showToast(`${stuck} change${stuck === 1 ? "" : "s"} could not be saved and need${stuck === 1 ? "s" : ""} your attention.`, true);
      } else {
        showToast(
          stopped === "complete"
            ? "Background sync completed. All changes saved to server."
            : `Synced ${synced} change${synced === 1 ? "" : "s"}. The rest are still queued.`
        );
      }
    } catch (err) {
      console.error("Sync failed", err);
    }
  };
```

- [ ] **Step 3: The banner**

Directly below the header block containing the Offline/Syncing badges (around `src/app/field/page.tsx:830`), render:

```tsx
      {stuckOps.length > 0 && (
        <button
          onClick={() => setShowStuckPanel(true)}
          className="w-full flex items-center gap-2 bg-amber-500/15 border border-amber-500/40 text-amber-500 text-xs font-bold uppercase tracking-wider rounded-lg px-4 py-3"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {stuckOps.length} {stuckOps.length === 1 ? "entry needs" : "entries need"} attention
        </button>
      )}
```

(`AlertTriangle` is already imported in this file.)

- [ ] **Step 4: The description helper**

Add near the other module-level helpers in the file:

```ts
/** Plain-words description of a stuck op for its card, e.g. "Time entry — 01:30 on 2026-07-15". */
function describeStuckOp(op: StuckOp, jobs: FieldJob[]): { what: string; why: string; isStatusChange: boolean } {
  const body = (op.body ?? {}) as Record<string, unknown>;
  const job = jobs.find((j) => j.id === body.jobId);
  const target = job ? `job for ${job.client?.name ?? job.id.substring(0, 8)}` : "a job that is no longer available";

  let what: string;
  const isStatusChange = op.url === "/api/jobs" && typeof body.status === "string";
  if (op.url === "/api/time") what = `Time entry — ${body.duration} on ${body.date}`;
  else if (isStatusChange) what = `Status change → ${body.status}`;
  else if ("notes" in body) what = "Job notes";
  else if ("lineItems" in body) what = "Materials update";
  else what = `${op.method} ${op.url}`;

  const why =
    op.status === 404
      ? "That job no longer exists."
      : `The server rejected it: ${op.message}`;

  return { what: `${what} — ${target}`, why, isStatusChange };
}
```

> If `FieldJob` in this file lacks a `client` field, use whatever field the existing job cards render for the client name; the lookup shape is the point, not the property name.

- [ ] **Step 5: The panel component**

Add a component in the same file (matching the file's pattern of colocated components). It renders one card per stuck op; re-target is hidden for status changes (re-pointing "mark job X complete" at job Y is a different intent, not a correction) and only offers the tech's assigned jobs (the `jobs` state — when the correct job isn't theirs, "Send to office" is the path):

```tsx
function StuckOpsPanel({
  stuckOps,
  jobs,
  onClose,
  onResolved,
  onError,
}: {
  stuckOps: StuckOp[];
  jobs: FieldJob[];
  onClose: () => void;
  onResolved: (message: string) => void;
  onError: (message: string, isError?: boolean) => void;
}) {
  const [retargetFor, setRetargetFor] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const message = await fn();
      if (message) onResolved(message);
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = (op: StuckOp) =>
    act(async () => {
      if (!window.confirm("Discard this entry? The office keeps a record of what was discarded.")) return null;
      const result = await discardStuckOp(op);
      if (result === "failed") {
        onError("Could not reach the office to record the discard. The entry is kept.", true);
        return null;
      }
      return "Entry discarded. The office has a record of it.";
    });

  const handleHandoff = (op: StuckOp) =>
    act(async () => {
      const result = await handoffStuckOp(op);
      if (result === "failed") {
        onError("Could not reach the office. The entry is kept.", true);
        return null;
      }
      return "Sent to the office for review.";
    });

  const handleRetarget = (op: StuckOp) =>
    act(async () => {
      if (!selectedJobId) return null;
      const result = await retargetStuckOp(op, selectedJobId);
      if (result === "unreachable") {
        onError("Could not reach the office. The entry is kept.", true);
        return null;
      }
      if (result === "rejected") {
        onError("The server rejected it for that job too. The entry is kept.", true);
        return null;
      }
      setRetargetFor(null);
      return "Entry saved to the selected job.";
    });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-4 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">Entries needing attention</h3>
          <button onClick={onClose} className="text-zinc-400 text-xs font-bold uppercase">Close</button>
        </div>
        {stuckOps.map((op) => {
          const { what, why, isStatusChange } = describeStuckOp(op, jobs);
          return (
            <div key={op.id} className="border border-zinc-700 rounded-lg p-4 space-y-3">
              <p className="text-sm font-semibold text-zinc-100">{what}</p>
              <p className="text-xs text-amber-500">{why}</p>
              {retargetFor === op.id ? (
                <div className="space-y-2">
                  <select
                    value={selectedJobId}
                    onChange={(e) => setSelectedJobId(e.target.value)}
                    className="w-full p-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-100"
                  >
                    <option value="">Choose one of your jobs…</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.client?.name ?? j.id.substring(0, 8)} — {j.scheduledDate?.substring(0, 10)}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button disabled={busy || !selectedJobId} onClick={() => handleRetarget(op)} className="flex-1 py-2 bg-blue-700 rounded text-xs font-bold uppercase text-white disabled:opacity-50">Save to this job</button>
                    <button disabled={busy} onClick={() => setRetargetFor(null)} className="py-2 px-3 bg-zinc-800 rounded text-xs font-bold uppercase text-zinc-300">Cancel</button>
                  </div>
                  <p className="text-[10px] text-zinc-500">Don't see the right job? It may not be assigned to you — use "Send to office" instead.</p>
                </div>
              ) : (
                <div className="flex gap-2">
                  {!isStatusChange && (
                    <button disabled={busy} onClick={() => { setRetargetFor(op.id!); setSelectedJobId(""); }} className="flex-1 py-2 bg-blue-700 rounded text-xs font-bold uppercase text-white disabled:opacity-50">Re-target</button>
                  )}
                  <button disabled={busy} onClick={() => handleHandoff(op)} className="flex-1 py-2 bg-zinc-700 rounded text-xs font-bold uppercase text-zinc-100 disabled:opacity-50">Send to office</button>
                  <button disabled={busy} onClick={() => handleDiscard(op)} className="py-2 px-3 bg-red-900/60 rounded text-xs font-bold uppercase text-red-200 disabled:opacity-50">Discard</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Wire it at the bottom of the main component's JSX:

```tsx
      {showStuckPanel && stuckOps.length > 0 && (
        <StuckOpsPanel
          stuckOps={stuckOps}
          jobs={jobs}
          onClose={() => setShowStuckPanel(false)}
          onResolved={(message) => {
            showToast(message);
            checkSyncStatus();
            if (tech) loadJobs(tech.id);
            getStuckOps().then((s) => { if (s.length === 0) setShowStuckPanel(false); });
          }}
          onError={showToast}
        />
      )}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run lint` → no new errors in `src/app/field/page.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/app/field/page.tsx
git commit -m "feat(field): attention banner and stuck-record resolution panel"
```

---

### Task 9: Admin UI — `SyncReviewModal` + Overview card

**Files:**
- Create: `src/components/modals/SyncReviewModal.tsx`
- Modify: `src/components/tabs/OverviewTab.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `SyncReviewItemData`, `DashboardData.syncReviewItems`, `ModalType "syncReview"` (Task 7); `PATCH /api/sync-review/:id` (Task 7); `Modal`/`ModalHeader`/`selectCls` from `src/components/shared/Modal.tsx`.
- Produces: nothing consumed later.

Admin re-target follows Assumption 3: re-send the corrected payload to the op's original URL under the admin session, then PATCH `resolve`.

- [ ] **Step 1: Create the modal**

Create `src/components/modals/SyncReviewModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import Modal, { ModalHeader, selectCls } from "@/components/shared/Modal";
import { SyncReviewItemData, Job } from "@/types";
import { formatDate } from "@/lib/dateUtils";

interface Props {
  items: SyncReviewItemData[];
  jobs: Job[];
  onClose: () => void;
  onSuccess: () => void;
  onError: (message: string) => void;
}

function describeItem(item: SyncReviewItemData): { what: string; isStatusChange: boolean } {
  const body = item.body ?? {};
  const isStatusChange = item.url === "/api/jobs" && typeof body.status === "string";
  if (item.url === "/api/time") return { what: `Time entry — ${body.duration} on ${body.date}`, isStatusChange };
  if (isStatusChange) return { what: `Status change → ${body.status}`, isStatusChange };
  if ("notes" in body) return { what: "Job notes", isStatusChange };
  if ("lineItems" in body) return { what: "Materials update", isStatusChange };
  return { what: `${item.method} ${item.url}`, isStatusChange };
}

export default function SyncReviewModal({ items, jobs, onClose, onSuccess, onError }: Props) {
  const [selectedJob, setSelectedJob] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const disposition = async (id: string, action: "resolve" | "dismiss") => {
    const res = await fetch(`/api/sync-review/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) throw new Error("Failed to update review item");
  };

  const handleDismiss = async (item: SyncReviewItemData) => {
    setBusy(true);
    try {
      await disposition(item.id, "dismiss");
      onSuccess();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to dismiss");
    } finally {
      setBusy(false);
    }
  };

  const handleMarkResolved = async (item: SyncReviewItemData) => {
    setBusy(true);
    try {
      await disposition(item.id, "resolve");
      onSuccess();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to resolve");
    } finally {
      setBusy(false);
    }
  };

  // Re-send the original payload with the corrected jobId to its original
  // route under this admin's session, then mark the item resolved. The write
  // must land before the item is resolved — same order as the tech side.
  const handleRetarget = async (item: SyncReviewItemData) => {
    const newJobId = selectedJob[item.id];
    if (!newJobId) return;
    setBusy(true);
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item.body, jobId: newJobId }),
      });
      if (!res.ok) {
        let message = `The server rejected it for that job too (${res.status}).`;
        try {
          const result = await res.json();
          if (result?.error) message = result.error;
        } catch { /* no JSON body */ }
        onError(message);
        return;
      }
      await disposition(item.id, "resolve");
      onSuccess();
    } catch {
      onError("Could not apply the entry. The review item is kept.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="lg">
      <ModalHeader title="Field Sync Review" subtitle={`${items.length} open item${items.length === 1 ? "" : "s"} from field techs`} onClose={onClose} />
      <div className="space-y-4">
        {items.length === 0 && <p className="text-sm text-zinc-500 py-2">No open items.</p>}
        {items.map((item) => {
          const { what, isStatusChange } = describeItem(item);
          const techName = item.personnel ? `${item.personnel.firstName} ${item.personnel.lastName}` : "Unknown tech";
          return (
            <div key={item.id} className="border border-zinc-200 rounded p-4 space-y-3">
              <div>
                <p className="text-sm font-bold text-zinc-800">{what}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  From {techName} • queued {formatDate(item.queuedAt)} • rejected {item.rejectionStatus}: {item.rejectionMessage}
                </p>
              </div>
              <pre className="text-[10px] font-mono bg-zinc-50 border border-zinc-200 rounded p-2 overflow-x-auto">
                {JSON.stringify(item.body, null, 2)}
              </pre>
              <div className="flex flex-wrap gap-2 items-center">
                {!isStatusChange && (
                  <>
                    <select
                      value={selectedJob[item.id] || ""}
                      onChange={(e) => setSelectedJob({ ...selectedJob, [item.id]: e.target.value })}
                      className={selectCls + " flex-1 min-w-40"}
                    >
                      <option value="">Re-target to job…</option>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.client.name} — {formatDate(j.scheduledDate)}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={busy || !selectedJob[item.id]}
                      onClick={() => handleRetarget(item)}
                      className="py-2 px-3 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs uppercase tracking-wider rounded disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </>
                )}
                <button
                  disabled={busy}
                  onClick={() => handleMarkResolved(item)}
                  className="py-2 px-3 border border-zinc-300 font-bold text-xs uppercase tracking-wider rounded text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Mark resolved
                </button>
                <button
                  disabled={busy}
                  onClick={() => handleDismiss(item)}
                  className="py-2 px-3 border border-red-200 font-bold text-xs uppercase tracking-wider rounded text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Overview card**

In `src/components/tabs/OverviewTab.tsx`, add an `onOpenSyncReview` prop and a clickable alert card that appears only when there are open items:

```tsx
interface Props {
  data: DashboardData;
  onOpenSyncReview: () => void;
}

export default function OverviewTab({ data, onOpenSyncReview }: Props) {
```

Directly above the KPI scorecards grid, add:

```tsx
      {data.syncReviewItems.length > 0 && (
        <button
          onClick={onOpenSyncReview}
          className="w-full text-left p-4 bg-amber-50 border border-amber-300 rounded flex items-center justify-between"
        >
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Field Sync Review</span>
            <p className="text-sm text-amber-800 mt-0.5">
              {data.syncReviewItems.length} record{data.syncReviewItems.length === 1 ? "" : "s"} from field techs need
              {data.syncReviewItems.length === 1 ? "s" : ""} office review.
            </p>
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Review →</span>
        </button>
      )}
```

- [ ] **Step 3: Wire in `src/app/page.tsx`**

Following the file's existing pattern:
1. Import: `import SyncReviewModal from "@/components/modals/SyncReviewModal";`
2. Where `<OverviewTab data={data} />` is rendered, pass `onOpenSyncReview={() => setActiveModal("syncReview")}`.
3. At the bottom of the modal block (after the `recordPayment` entry at `src/app/page.tsx:1088`):

```tsx
      {activeModal === "syncReview" && (
        <SyncReviewModal
          items={data.syncReviewItems}
          jobs={data.jobs}
          onClose={() => setActiveModal(null)}
          onSuccess={() => { setActiveModal(null); reload(); }}
          onError={(message) => showToast?.(message)}
        />
      )}
```

> Match the file's actual close/success/toast handler names — use whatever the neighboring modals use (e.g. if others call `onSuccess={handleModalSuccess}`, do the same).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run lint` → no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/SyncReviewModal.tsx src/components/tabs/OverviewTab.tsx src/app/page.tsx
git commit -m "feat(dashboard): sync review card and modal for handed-off field records"
```

---

### Task 10: Delete the dead `sw.js` sync path

**Files:**
- Modify: `public/sw.js`

The tag `sync-wvo-offline-writes` appears exactly once in the codebase — in the listener itself. Nothing calls `registration.sync.register(...)`, so this code has never run, and it is a divergent copy of drain logic that would re-send quarantined records if anyone ever wired up the tag. Bonus: its `openDB()` calls `indexedDB.open("WhiteVanOpsField", 1)`, which would throw `VersionError` after Task 1's version bump — deleting it removes that hazard too.

- [ ] **Step 1: Delete lines 85–148 of `public/sw.js`**

Remove the `// IndexedDB Helper for SW` comment, `openDB()`, `processSyncQueue()`, and the `self.addEventListener('sync', ...)` block. The caching logic (lines 1–83) is untouched.

- [ ] **Step 2: Verify nothing references the removed code**

Grep the repo for `processSyncQueue|sync-wvo-offline-writes`.
Expected: no matches anywhere.

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "refactor(sw): delete never-fired background-sync drain (divergent copy of drain logic)"
```

---

### Task 11: Manuals + browser verification

**Files:**
- Modify: `MANUAL_Field_Tech.md`
- Modify: `MANUAL_Administrator.md`

- [ ] **Step 1: `MANUAL_Field_Tech.md`**

Add a section to the offline/sync part of the manual (match the surrounding tone and heading style):

```markdown
### Entries that need attention

Sometimes a change you saved offline can no longer be applied — for example the office
cancelled or deleted the job it was for. When that happens, the app sets the entry
aside instead of blocking your other changes, and an amber banner appears:
**"N entries need attention."**

Tap the banner to see each entry and choose what to do with it:

- **Re-target** — save the entry to a different one of your jobs (for time, notes, and
  materials; not available for status changes). The list only shows jobs assigned to
  you — if the right job isn't there, use *Send to office*.
- **Send to office** — hands the entry to the office. An administrator sees it on the
  dashboard and can apply it to the right job.
- **Discard** — deletes the entry from your device. The office always keeps a record
  of exactly what was discarded, so nothing disappears silently.

All three actions need the office server to be reachable. If it isn't, the entry
simply stays on your device — nothing is lost.
```

- [ ] **Step 2: `MANUAL_Administrator.md`**

Add to the dashboard/Overview documentation:

```markdown
### Field Sync Review

When a field tech's offline change can no longer be applied (for example, the job it
targeted was deleted) and the tech chooses **Send to office**, the record appears on
the dashboard: the Overview tab shows a **Field Sync Review** card whenever there are
open items. Clicking it opens the review modal, which shows for each record: which
tech sent it, what it was (time entry, notes, materials, or status change), the full
original payload, and why the server rejected it.

For each record you can:

- **Re-target** — apply the entry to any job in the system (not limited to the tech's
  assignments), then the item is marked Resolved. Not available for status changes.
- **Mark resolved** — use after re-entering the data manually through the normal tabs.
- **Dismiss** — close the item without applying it. Dismissals are recorded in the
  audit log.

Discarded (rather than handed-off) entries never appear here, but their full payloads
are preserved in the audit log (entity "StuckSyncOp") and can be re-entered manually.
```

- [ ] **Step 3: Full verification suite**

Run: `npm test` → all PASS.
Run: `npx tsc --noEmit` → no errors.
Run: `npm run lint` → no new errors.

- [ ] **Step 4: Browser verification (the part unit tests deliberately don't cover)**

Start the dev server (`npm run electron:dev` or the launch.json entry) and drive `/field`:

1. **Upgrade path:** on a profile that already has the v1 database (ideally with queued rows created before this branch), load `/field` and confirm existing queued rows survive and drain. At minimum: DevTools → Application → IndexedDB shows `WhiteVanOpsField` v2 with `apiCache`, `syncQueue`, and `stuckOps`.
2. **Quarantine:** stop the server, log time on a job, restart the server, delete that job from the dashboard, reload `/field` → the drain quarantines the entry (amber banner appears) and other queued writes still sync.
3. **Re-target:** open the panel, re-target the entry to another assigned job → entry disappears, time entry appears on the new job, `AuditLog` has an `UPDATE StuckSyncOp` row with `newJobId`.
4. **Discard:** force another stuck record; discard it → confirm the `AuditLog` `DELETE StuckSyncOp` row carries the full payload in `details`.
5. **Hand off:** force another; send to office → dashboard Overview shows the Field Sync Review card; open the modal; re-target it to a job → time entry lands, item leaves the list, `SyncReviewItem.status` is `Resolved`.
6. **Office down:** with the server stopped, attempt a discard → toast says the entry is kept; the record is still in the panel.
7. **Status-change op:** force a stuck status change → its card shows no Re-target button.

- [ ] **Step 5: Commit**

```bash
git add MANUAL_Field_Tech.md MANUAL_Administrator.md
git commit -m "docs: manuals for field stuck-record resolution and admin sync review"
```
