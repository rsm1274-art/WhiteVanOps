"use client";

import { useState } from "react";
import { Download, RotateCw } from "lucide-react";
import type { ReportDefinition } from "@/lib/reports/types";

type ExportFormat = "csv" | "xlsx" | "pdf";

const FORMAT_LABELS: Record<ExportFormat, string> = { csv: "CSV", xlsx: "Excel", pdf: "PDF" };

interface Props {
  definition: ReportDefinition;
  disabled?: boolean;
  onError: (message: string) => void;
}

/** Downloads the current ad-hoc definition as CSV/XLSX/PDF. Saved-report
 *  export can reuse the same /api/reports/export route with a savedReportId
 *  body instead — not wired here, since this menu lives in the ad-hoc
 *  builder next to the live-preview controls, not the saved-reports panel. */
export default function ExportMenu({ definition, disabled, onError }: Props) {
  const [pending, setPending] = useState<ExportFormat | null>(null);

  const handleExport = async (format: ExportFormat) => {
    setPending(format);
    try {
      const res = await fetch("/api/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition, format }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Failed to export as ${FORMAT_LABELS[format]}`);
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `report.${format}`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {(["csv", "xlsx", "pdf"] as const).map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => handleExport(format)}
          disabled={disabled || pending !== null}
          className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-600 hover:text-zinc-900 disabled:text-zinc-300 disabled:cursor-not-allowed border border-zinc-200 hover:border-zinc-300 rounded px-3 py-2"
        >
          {pending === format ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {FORMAT_LABELS[format]}
        </button>
      ))}
    </div>
  );
}
