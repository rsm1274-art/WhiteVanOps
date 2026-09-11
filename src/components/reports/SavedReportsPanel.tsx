"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, Globe, RotateCw, Trash2 } from "lucide-react";
import type { ReportFolder, SavedReport } from "@/types";

// Lists saved reports grouped by folder. Every caller reaching the Reports
// tab at all is already admin/superuser (server-enforced, see
// src/lib/reports/permissions.ts's EDITOR_ROLES) — so unlike a
// creator-scoped feature, "can this user edit this report" is not a
// meaningful client-side distinction here and every row shows delete. The
// real gate is still server-side (canEditReport in every route).

interface Props {
  refreshToken: number;
  onLoadReport: (report: SavedReport) => void;
  onError: (msg: string) => void;
}

const NO_FOLDER = "__none__";

export default function SavedReportsPanel({ refreshToken, onLoadReport, onError }: Props) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [folders, setFolders] = useState<ReportFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch("/api/reports").then((r) => r.json()),
      fetch("/api/reports/folders").then((r) => r.json()),
    ])
      .then(([reportsJson, foldersJson]: [SavedReport[], ReportFolder[]]) => {
        setReports(reportsJson);
        setFolders(foldersJson);
      })
      .catch((err: unknown) => onError(err instanceof Error ? err.message : "Failed to load saved reports"))
      .finally(() => setIsLoading(false));
  }, [refreshToken, onError]);

  const handleDelete = async (report: SavedReport) => {
    if (!confirm(`Delete "${report.name}"? This cannot be undone.`)) return;
    setDeletingId(report.id);
    try {
      const res = await fetch(`/api/reports/${report.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to delete report");
      }
      setReports((prev) => prev.filter((r) => r.id !== report.id));
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to delete report");
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400 p-2">
        <RotateCw className="h-3 w-3 animate-spin" />
        Loading saved reports...
      </div>
    );
  }

  const grouped = new Map<string, SavedReport[]>();
  for (const report of reports) {
    const key = report.folderId ?? NO_FOLDER;
    grouped.set(key, [...(grouped.get(key) ?? []), report]);
  }
  const folderOrder: { id: string; name: string; isPublic: boolean }[] = [
    ...folders.map((f) => ({ id: f.id, name: f.name, isPublic: f.isPublic })),
    { id: NO_FOLDER, name: "Unfiled", isPublic: false },
  ];

  if (reports.length === 0) {
    return <p className="text-xs text-zinc-400 p-2">No saved reports yet.</p>;
  }

  return (
    <div className="space-y-3">
      {folderOrder.map((folder) => {
        const items = grouped.get(folder.id);
        if (!items || items.length === 0) return null;
        return (
          <div key={folder.id}>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
              <Folder className="h-3 w-3" />
              {folder.name}
              {folder.isPublic && (
                <span title="Public folder">
                  <Globe className="h-3 w-3 text-zinc-400" />
                </span>
              )}
            </div>
            <ul className="space-y-0.5">
              {items.map((report) => (
                <li key={report.id} className="flex items-center justify-between gap-2 group">
                  <button
                    type="button"
                    onClick={() => onLoadReport(report)}
                    className="flex items-center gap-1.5 text-xs text-zinc-700 hover:text-blue-700 truncate flex-1 text-left py-1"
                    title={report.description ?? undefined}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <span className="truncate">{report.name}</span>
                    {report.isShared && <span className="text-[9px] text-zinc-400 shrink-0">shared</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(report)}
                    disabled={deletingId === report.id}
                    className="text-zinc-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    aria-label={`Delete ${report.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
