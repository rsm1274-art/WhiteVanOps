"use client";

import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import type { SyncStatus } from "@/lib/syncStatus";

interface Props {
  status: SyncStatus;
  onSyncNow: () => void;
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Tells a tech whether their work has reached the office. On the Base plan the
 * office WiFi is the only transport, so "we can't see the office yet" is normal
 * and must read as normal — not as an error, and never as "Syncing..." when
 * nothing is syncing.
 */
export default function SyncStatusBar({ status, onSyncNow }: Props) {
  if (status.kind === "idle") {
    if (status.lastSyncedAt === null) return null;
    return (
      <p className="text-[10px] text-zinc-500 px-4 py-1">
        Last saved to office {formatTime(status.lastSyncedAt)}
      </p>
    );
  }

  const n = status.pendingCount;

  if (status.kind === "draining") {
    return (
      <p className="text-[10px] text-amber-500 px-4 py-1 flex items-center gap-1">
        <RefreshCw className="h-3 w-3 animate-spin" /> Syncing {n}…
      </p>
    );
  }

  if (status.kind === "auth") {
    return (
      <p className="text-[10px] text-red-600 px-4 py-1 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" /> {n} waiting — sign in again to save
      </p>
    );
  }

  const detail =
    status.kind === "waiting-network"
      ? "office network not found"
      : status.kind === "waiting-server"
        ? "office server busy"
        : "waiting to save";

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-1">
      <p className="text-[10px] text-amber-500 flex items-center gap-1">
        <CloudOff className="h-3 w-3" /> {n} waiting · {detail}
      </p>
      <button
        type="button"
        onClick={onSyncNow}
        className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-white"
      >
        Try now
      </button>
    </div>
  );
}
