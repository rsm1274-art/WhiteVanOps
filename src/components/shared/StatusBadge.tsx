import { JobStatus, SyncStatus } from "@/types";

interface JobStatusBadgeProps {
  status: JobStatus;
}

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const cls =
    status === "Completed"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "In Progress"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : status === "Cancelled"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-blue-50 text-blue-700 border-blue-200";

  return (
    <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border ${cls}`}>
      {status}
    </span>
  );
}

interface SyncStatusBadgeProps {
  status: SyncStatus;
}

export function SyncStatusBadge({ status }: SyncStatusBadgeProps) {
  return (
    <span
      className={`text-xs font-semibold ${
        status === "Exported" ? "text-emerald-600" : "text-amber-600"
      }`}
    >
      {status}
    </span>
  );
}
