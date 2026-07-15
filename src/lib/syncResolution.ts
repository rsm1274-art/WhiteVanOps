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
