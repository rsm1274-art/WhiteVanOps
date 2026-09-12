"use client";

import { useState } from "react";
import { LifeBuoy, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { verifyExport, type FieldExport } from "@/lib/fieldExport";

type Classification = "new" | "duplicate" | "superseded" | "invalid";

interface ClassificationDetail {
  opId: string;
  opType: string | null;
  jobId: string;
  jobLabel: string | null;
  classification: Classification;
  reason?: string;
}

type OpOutcome = "applied" | "superseded" | "duplicate" | "rejected";

interface ApplyDetail {
  opId: string;
  outcome: OpOutcome | "invalid";
  error?: string;
}

interface ApplyTally {
  applied: number;
  superseded: number;
  duplicate: number;
  rejected: number;
  invalid: number;
}

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  new: "New — will be applied",
  duplicate: "Already applied — will be skipped",
  superseded: "Superseded by newer work — will be skipped",
  invalid: "Could not be understood",
};

/**
 * Settings → Recover Field Work (Phase 5 of the v2.0 plan). A field tech can
 * export their queued/stuck/recent work to a JSON file from /field as a
 * manual backup, independent of WiFi sync. This is where an admin brings
 * that file back in.
 *
 * Deliberately separate from DataImportSection, which is bulk onboarding
 * data migration (spreadsheets → a fresh database) — a different job. This
 * one is small, frequent, and safe to repeat: importing the same file twice
 * is a guaranteed no-op (every op's own AppliedOp row makes a repeat import
 * apply nothing a second time), which is the property that makes it safe for
 * someone to use while anxious about losing work.
 */
export function RecoverFieldWorkSection({
  onShowToast,
  onImported,
}: {
  onShowToast: (text: string, isError?: boolean) => void;
  /** Reloads the dashboard so imported time entries/status changes/notes show up. */
  onImported?: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [exportData, setExportData] = useState<FieldExport | null>(null);
  const [classifications, setClassifications] = useState<ClassificationDetail[] | null>(null);
  const [tally, setTally] = useState<ApplyTally | null>(null);
  const [applyDetails, setApplyDetails] = useState<ApplyDetail[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const reset = () => {
    setFileName(null);
    setExportData(null);
    setClassifications(null);
    setTally(null);
    setApplyDetails(null);
    setFileError(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    reset();
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setFileName(file.name);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setFileError("This file is not valid JSON.");
      return;
    }

    // Validate locally first — fail fast on a corrupted/wrong-version file
    // before ever making a network call.
    const verified = verifyExport(parsed);
    if (!verified.ok) {
      setFileError(verified.error);
      return;
    }

    setExportData(verified.data);

    setPreviewing(true);
    try {
      const res = await fetch("/api/field/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview", export: verified.data }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to preview the import");
      setClassifications(data.classifications);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Failed to preview the import");
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!exportData) return;
    setApplying(true);
    setFileError(null);
    try {
      const res = await fetch("/api/field/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "apply", export: exportData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to apply the import");
      setTally(data.tally);
      setApplyDetails(data.details);
      onShowToast(
        `Import complete: ${data.tally.applied} applied, ${data.tally.duplicate} already present, ${data.tally.superseded} superseded, ${data.tally.rejected + data.tally.invalid} failed.`
      );
      onImported?.();
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : "Failed to apply the import", true);
    } finally {
      setApplying(false);
    }
  };

  const counts = classifications?.reduce(
    (acc, c) => {
      acc[c.classification]++;
      return acc;
    },
    { new: 0, duplicate: 0, superseded: 0, invalid: 0 } as Record<Classification, number>
  );

  return (
    <div className="bg-white rounded shadow-sm border border-zinc-200">
      <div className="border-b border-zinc-100 p-6 flex items-center gap-3">
        <div className="p-2 bg-amber-50 text-amber-600 rounded">
          <LifeBuoy className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-zinc-800">Recover Field Work</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Bring in a work file a technician exported from their phone — a manual backup, independent of WiFi sync.
          </p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div>
          <label className="flex items-center gap-2 w-fit px-4 py-2 bg-zinc-900 text-white text-sm font-bold uppercase tracking-wider rounded hover:bg-zinc-800 transition-colors cursor-pointer">
            <Upload className="h-4 w-4" />
            Choose a work file
            <input type="file" accept="application/json,.json" onChange={handleFileChange} className="hidden" />
          </label>
          {fileName && <p className="text-xs text-zinc-500 mt-2">{fileName}</p>}
        </div>

        {fileError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p>{fileError}</p>
          </div>
        )}

        {previewing && <p className="text-sm text-zinc-500">Checking this file against what&apos;s already saved…</p>}

        {classifications && counts && !tally && (
          <div className="space-y-4">
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded text-sm text-zinc-700">
              <p className="font-semibold mb-1">
                {counts.new} new, {counts.duplicate} already applied, {counts.superseded} superseded by newer work
                {counts.invalid > 0 ? `, ${counts.invalid} could not be understood` : ""}.
              </p>
              <p className="text-xs text-zinc-500">
                {exportData?.techName} — exported {exportData ? new Date(exportData.exportedAt).toLocaleString() : ""}
              </p>
            </div>

            <div className="border border-zinc-200 rounded max-h-64 overflow-y-auto divide-y divide-zinc-100">
              {classifications.map((c) => (
                <div key={c.opId} className="p-3 text-xs flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-zinc-800">
                      {c.opType ?? "Unknown"} — {c.jobLabel ?? "Unknown job"}
                    </p>
                    {c.reason && <p className="text-zinc-500 mt-0.5">{c.reason}</p>}
                  </div>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    {CLASSIFICATION_LABEL[c.classification]}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={handleApply}
              disabled={applying || counts.new === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-bold uppercase tracking-wider rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {applying ? "Applying…" : counts.new === 0 ? "Nothing new to apply" : `Apply ${counts.new} new item${counts.new === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {tally && applyDetails && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800 flex gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">
                {tally.applied} applied, {tally.duplicate} already present, {tally.superseded} superseded by newer work,{" "}
                {tally.rejected + tally.invalid} failed.
              </p>
              <p className="text-xs mt-1">
                Re-importing this same file will not apply anything a second time — it is safe to keep as a backup.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
