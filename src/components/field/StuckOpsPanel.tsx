"use client";

import { useState } from "react";
import type { StuckOp } from "@/lib/idb";
import { discardStuckOp, retargetStuckOp, handoffStuckOp } from "@/lib/syncResolution";
import type { FieldJob } from "@/app/field/page";

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

export default function StuckOpsPanel({
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
                  <p className="text-[10px] text-zinc-500">Don&apos;t see the right job? It may not be assigned to you — use &quot;Send to office&quot; instead.</p>
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
