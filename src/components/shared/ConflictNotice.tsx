"use client";

import { ClientConflicts } from "@/lib/clientJobConflicts";

interface Props {
  conflicts: ClientConflicts;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}

/**
 * Live availability feedback for the job modals. Blocking conflicts (repair,
 * time off, equipment already out) render red — the server will refuse the
 * save. A van/tech double-booking renders amber with a "book anyway"
 * checkbox: an in-form acknowledgement rather than window.confirm(), which
 * gives no feedback when a webview swallows it (see DataImportSection).
 * Callers gate submit on `needsAcknowledgement()`.
 */
export default function ConflictNotice({ conflicts, acknowledged, onAcknowledge }: Props) {
  const { blocking, advisory } = conflicts;
  if (blocking.length === 0 && advisory.length === 0) return null;

  return (
    <div className="space-y-2">
      {blocking.length > 0 && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-900 space-y-1">
          <p className="font-bold uppercase tracking-wider text-[10px]">
            Unavailable — cannot be scheduled
          </p>
          {blocking.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
      {advisory.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-1">
          <p className="font-bold uppercase tracking-wider text-[10px]">Already booked this day</p>
          {advisory.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
          <label className="flex items-center gap-2 pt-1 font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => onAcknowledge(e.target.checked)}
              className="accent-amber-700"
            />
            Book anyway — this is more than one job that day
          </label>
        </div>
      )}
    </div>
  );
}

export function needsAcknowledgement(conflicts: ClientConflicts, acknowledged: boolean): boolean {
  return conflicts.advisory.length > 0 && !acknowledged;
}

export const ACKNOWLEDGE_MESSAGE =
  "This van or technician already has a job that day. Tick \"Book anyway\" to schedule it too.";
