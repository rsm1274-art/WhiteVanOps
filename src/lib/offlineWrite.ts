import { addToSyncQueue, getSyncQueue, removeFromSyncQueue, moveToStuck, recordHistory, pruneHistory } from "@/lib/idb";
import { generateOpId } from "@/lib/opId";

export type WriteResult = "synced" | "queued";

export type RejectionClass = "permanent" | "auth" | "transient";

export type DrainResult = {
  synced: number;
  stuck: number;
  remaining: number;
  stopped: "complete" | "unreachable" | "auth" | "retry";
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
  // Generated once, up front, and reused on both branches below: whether this
  // write lands on the inline attempt or (on a network failure) gets queued,
  // it must carry the SAME opId either way. Every call site in JobCard.tsx
  // calls submitWrite exactly once per action rather than retrying it itself,
  // so there is no caller-driven second call to worry about — but generating
  // the id here, rather than letting addToSyncQueue mint its own, keeps the
  // inline fetch's header and the queued row's identity from ever diverging
  // within this one call.
  const opId = generateOpId();
  let res: Response;

  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-WVO-Op-Id": opId },
      body: JSON.stringify(body),
    });
  } catch {
    await addToSyncQueue(url, method, body, opId);
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
        headers: { "Content-Type": "application/json", "X-WVO-Op-Id": op.opId },
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

    // Record the history entry before removing the op from the queue: if the
    // device crashes between the two, the write is still recorded as having
    // happened rather than vanishing without a trace (the same crash-safety
    // standard moveToStuck follows above — never leave a gap where the op's
    // only record can disappear).
    await recordHistory(op);
    await removeFromSyncQueue(op.id!);
    synced++;
  }

  // Cheap cursor sweep over a bounded 30-day window — inline and awaited
  // rather than fire-and-forget, since it can't meaningfully slow the drain
  // and awaiting keeps the behavior deterministic for tests.
  await pruneHistory();

  return { synced, stuck, remaining: 0, stopped: "complete" };
}

/**
 * Classify a non-2xx status for the drain. The unknown-status default is
 * transient on purpose: the safe response to "I don't know what happened"
 * is to keep the data and not interrupt the tech. Never quarantine
 * something we cannot explain.
 *
 * 403 is bucketed with the other permanent rejections, not with 401. Every
 * field-write 403 now originates from fieldOps.ts (Phase 3) — "not assigned
 * to this job" / "not linked to a personnel record" — a genuine, permanent
 * business rejection that re-logging in can never fix. Treating it as "auth"
 * would stop the ENTIRE drain and tell the tech to sign in again for a
 * problem sign-in can't solve, freezing every other tech's queued writes
 * behind one misdirected op. 401 alone means the cookie is bad; that one
 * really is transient in the sense that a fresh login fixes it, so it keeps
 * halting the drain rather than quarantining real work.
 */
export function classifyRejection(status: number): RejectionClass {
  if (status === 400 || status === 403 || status === 404 || status === 409 || status === 422) return "permanent";
  if (status === 401) return "auth";
  return "transient";
}
