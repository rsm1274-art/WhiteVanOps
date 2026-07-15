"use client";

import { useState } from "react";
import Modal, { ModalHeader, selectCls } from "@/components/shared/Modal";
import { SyncReviewItemData, Job } from "@/types";
import { formatDate } from "@/lib/dateUtils";

interface Props {
  items: SyncReviewItemData[];
  jobs: Job[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
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
      onSuccess("Review item dismissed.");
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
      onSuccess("Review item marked resolved.");
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
      onSuccess("Entry applied to the new job and resolved.");
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
