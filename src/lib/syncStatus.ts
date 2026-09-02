import type { DrainResult } from "./offlineWrite";

// ---------------------------------------------------------------------------
// What the field module tells a tech about unsent work.
//
// This replaces a boolean. The old UI rendered an amber "Syncing..." badge
// whenever the queue was non-empty and `navigator.onLine` was true — so a tech
// off-site all day, with full signal and an unreachable office server, watched
// "Syncing..." indefinitely while nothing synced. On the Base plan, where the
// office WiFi IS the transport, "we cannot see the office" is the single most
// important thing to say out loud.
// ---------------------------------------------------------------------------

export type SyncStatus =
  | { kind: "idle"; lastSyncedAt: number | null }
  | { kind: "draining"; pendingCount: number }
  | { kind: "pending"; pendingCount: number }
  | { kind: "waiting-network"; pendingCount: number }
  | { kind: "waiting-server"; pendingCount: number }
  | { kind: "auth"; pendingCount: number };

export interface SyncStatusInput {
  /** Rows currently in the IndexedDB syncQueue (never counts stuckOps). */
  pendingCount: number;
  isDraining: boolean;
  /** Why the most recent drain stopped, or null if none has run this session. */
  lastStop: DrainResult["stopped"] | null;
  /** Epoch ms of the last drain that reached the server, from localStorage. */
  lastSyncedAt: number | null;
}

export function deriveSyncStatus({
  pendingCount,
  isDraining,
  lastStop,
  lastSyncedAt,
}: SyncStatusInput): SyncStatus {
  // An empty queue outranks every stop reason: a stale "unreachable" from
  // earlier must not keep warning about work that has since been saved.
  if (pendingCount === 0) return { kind: "idle", lastSyncedAt };
  if (isDraining) return { kind: "draining", pendingCount };
  if (lastStop === "unreachable") return { kind: "waiting-network", pendingCount };
  if (lastStop === "retry") return { kind: "waiting-server", pendingCount };
  if (lastStop === "auth") return { kind: "auth", pendingCount };
  // null (nothing attempted yet) or "complete" with leftovers. Neither
  // justifies naming a cause, so say only that work is waiting.
  return { kind: "pending", pendingCount };
}
