import { addToSyncQueue, getSyncQueue, removeFromSyncQueue } from "@/lib/idb";

export type WriteResult = "synced" | "queued";

export type RejectionClass = "permanent" | "auth" | "transient";

export type DrainResult = {
  synced: number;
  remaining: number;
  stopped: "complete" | "unreachable" | "rejected";
};

/**
 * Send a field-module write to the server, falling back to the offline queue.
 *
 * The queue decision keys on whether the request actually failed, never on
 * `navigator.onLine`. That flag only reports whether the device has a network
 * interface up — it says nothing about whether the office server is reachable,
 * and reports true when the office PC is shut down but the tech's phone has
 * signal. Gating on it lost those writes instead of queueing them.
 *
 * A reachable server that refuses the write (4xx/5xx) throws rather than
 * queueing: replaying a rejected write can never succeed.
 */
export async function submitWrite(
  url: string,
  method: string,
  body: unknown
): Promise<WriteResult> {
  let res: Response;

  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    await addToSyncQueue(url, method, body);
    return "queued";
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const result = await res.json();
      if (result?.error) message = result.error;
    } catch {
      // Error response carried no JSON body; the status-code message stands.
    }
    throw new Error(message);
  }

  return "synced";
}

/**
 * Replay queued writes to the server, oldest first.
 *
 * Safe to call at any time — it probes by attempting the first write rather
 * than consulting `navigator.onLine`, so it works when the server has come
 * back up without the device ever having lost connectivity (the overnight
 * case: no online event fires, so nothing else would trigger a drain).
 *
 * Stops at the first op the server does not accept, leaving it and everything
 * behind it queued. Queued ops frequently target the same job, so letting a
 * later one overtake a stuck one could apply them out of order.
 */
export async function drainSyncQueue(): Promise<DrainResult> {
  const queue = await getSyncQueue();
  let synced = 0;

  for (const op of queue) {
    let res: Response;

    try {
      res = await fetch(op.url, {
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(op.body),
      });
    } catch {
      return { synced, remaining: queue.length - synced, stopped: "unreachable" };
    }

    if (!res.ok) {
      return { synced, remaining: queue.length - synced, stopped: "rejected" };
    }

    await removeFromSyncQueue(op.id!);
    synced++;
  }

  return { synced, remaining: 0, stopped: "complete" };
}

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
