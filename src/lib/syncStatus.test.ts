import { describe, expect, it } from "vitest";
import { deriveSyncStatus } from "@/lib/syncStatus";

const base = { pendingCount: 0, isDraining: false, lastStop: null, lastSyncedAt: null } as const;

describe("deriveSyncStatus", () => {
  it("is idle with no queue and no history", () => {
    expect(deriveSyncStatus(base)).toEqual({ kind: "idle", lastSyncedAt: null });
  });

  it("keeps the last-saved timestamp when the queue is empty", () => {
    expect(deriveSyncStatus({ ...base, lastSyncedAt: 1753000000000 })).toEqual({
      kind: "idle",
      lastSyncedAt: 1753000000000,
    });
  });

  it("reports draining while a drain is in flight", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 3, isDraining: true })).toEqual({
      kind: "draining",
      pendingCount: 3,
    });
  });

  // Nothing has been attempted yet, so claiming the office network is missing
  // would be a guess. Say only what is known: work is waiting.
  it("reports plain pending before any drain has been attempted", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 2 })).toEqual({
      kind: "pending",
      pendingCount: 2,
    });
  });

  // The bug this module exists to fix: an unreachable office server used to
  // render an amber "Syncing..." badge forever.
  it("reports waiting-network when the server was unreachable", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 2, lastStop: "unreachable" })).toEqual({
      kind: "waiting-network",
      pendingCount: 2,
    });
  });

  it("reports waiting-server on a transient rejection", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 1, lastStop: "retry" })).toEqual({
      kind: "waiting-server",
      pendingCount: 1,
    });
  });

  it("reports auth when the session expired", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 4, lastStop: "auth" })).toEqual({
      kind: "auth",
      pendingCount: 4,
    });
  });

  it("treats a completed drain with leftovers as plain pending", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 1, lastStop: "complete" })).toEqual({
      kind: "pending",
      pendingCount: 1,
    });
  });

  it("prefers idle over any stale stop reason once the queue empties", () => {
    expect(deriveSyncStatus({ ...base, lastStop: "unreachable", lastSyncedAt: 5 })).toEqual({
      kind: "idle",
      lastSyncedAt: 5,
    });
  });
});
