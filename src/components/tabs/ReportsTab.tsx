"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RotateCw, Save } from "lucide-react";
import type { Aggregation, FieldDef, ReportDefinition } from "@/lib/reports/types";
import type { SavedReport } from "@/types";
import {
  emptyDefinition,
  addColumn,
  removeColumn,
  reorderColumns,
  updateColumnLabel,
  updateColumnAggregation,
  addCondition,
  updateCondition,
  removeCondition,
  setExpandRelation,
  sanitizeAgainstCatalog,
} from "@/lib/reports/definitionEdit";
import FieldCatalog from "@/components/reports/FieldCatalog";
import ColumnCanvas from "@/components/reports/ColumnCanvas";
import ConditionBuilder from "@/components/reports/ConditionBuilder";
import PreviewTable, { type ReportPreviewResult } from "@/components/reports/PreviewTable";
import SavedReportsPanel from "@/components/reports/SavedReportsPanel";
import SaveReportModal from "@/components/modals/SaveReportModal";
import ExportMenu from "@/components/reports/ExportMenu";

// Container: owns the ReportDefinition being built and debounces a live preview
// fetch against it. Deliberately does NOT use useDashboardData — that hook's
// full-dashboard-reload-on-every-change model is wrong at the frequency and
// payload size a live query builder needs.

const PREVIEW_DEBOUNCE_MS = 300;

interface FieldsResponse {
  fields: FieldDef[];
  groups: string[];
  expandableRelations: string[];
}

interface Props {
  onShowToast: (text: string, isError?: boolean) => void;
}

export default function ReportsTab({ onShowToast }: Props) {
  const [catalog, setCatalog] = useState<FieldsResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [definition, setDefinition] = useState<ReportDefinition>(emptyDefinition());
  const [preview, setPreview] = useState<ReportPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<SavedReport | null>(null);
  const [driftBanner, setDriftBanner] = useState<string | null>(null);
  const [savedReportsRefreshToken, setSavedReportsRefreshToken] = useState(0);

  useEffect(() => {
    fetch("/api/reports/fields")
      .then((r) => r.json().then((json) => ({ ok: r.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) throw new Error(json.error || "Failed to load report fields");
        setCatalog(json);
      })
      .catch((err: unknown) => setCatalogError(err instanceof Error ? err.message : "Failed to load report fields"));
  }, []);

  const fieldByKey = useMemo(() => {
    const map = new Map<string, FieldDef>();
    for (const field of catalog?.fields ?? []) map.set(field.key, field);
    return map;
  }, [catalog]);

  // Debounced + cancellable preview fetch. Every dependency change (definition)
  // schedules a new fetch after PREVIEW_DEBOUNCE_MS and cancels whatever the
  // previous run had in flight, so a slow early response can never overwrite a
  // later one.
  useEffect(() => {
    if (definition.columns.length === 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsLoadingPreview(true);
      fetch("/api/reports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(definition),
        signal: controller.signal,
      })
        .then((r) => r.json().then((json) => ({ ok: r.ok, json })))
        .then(({ ok, json }) => {
          if (!ok) throw new Error(json.error || "Failed to run preview");
          setPreview(json);
          setPreviewError(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setPreviewError(err instanceof Error ? err.message : "Failed to run preview");
        })
        .finally(() => setIsLoadingPreview(false));
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [definition]);

  const handleAddField = (field: FieldDef) => {
    const aggregation: Aggregation | undefined = field.cardinality === "many" ? "list" : undefined;
    setDefinition((prev) => addColumn(prev, field.key, aggregation));
  };

  const handleLoadReport = (report: SavedReport) => {
    const known = new Set(fieldByKey.keys());
    const { definition: sanitized, droppedFieldKeys } = sanitizeAgainstCatalog(report.definition, known);
    setDefinition(sanitized);
    setEditingReport(report);
    setDriftBanner(
      droppedFieldKeys.length > 0
        ? `${droppedFieldKeys.length} column${droppedFieldKeys.length === 1 ? "" : "s"} in "${report.name}" no longer exist and were removed: ${droppedFieldKeys.join(", ")}.`
        : null
    );
  };

  const handleStartNewReport = () => {
    setDefinition(emptyDefinition());
    setEditingReport(null);
    setDriftBanner(null);
  };

  const selectedFieldKeys = useMemo(() => new Set(definition.columns.map((c) => c.fieldKey)), [definition.columns]);
  const conditions = definition.filters[0]?.conditions ?? [];

  if (catalogError) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded text-sm text-red-900">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {catalogError}
      </div>
    );
  }
  if (!catalog) {
    return (
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <RotateCw className="h-4 w-4 animate-spin" />
        Loading report fields...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-zinc-200 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Custom Reports</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Build an ad-hoc report from job data. Pick fields, add filters, and preview live.
            {editingReport && ` Editing "${editingReport.name}".`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportMenu
            definition={definition}
            disabled={definition.columns.length === 0}
            onError={(msg) => onShowToast(msg, true)}
          />
          {editingReport && (
            <button
              type="button"
              onClick={handleStartNewReport}
              className="text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-800 px-3 py-2"
            >
              New Report
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsSaveModalOpen(true)}
            disabled={definition.columns.length === 0}
            className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white bg-blue-700 hover:bg-blue-800 disabled:bg-zinc-300 disabled:cursor-not-allowed rounded px-3 py-2"
          >
            <Save className="h-3.5 w-3.5" />
            {editingReport ? "Update Report" : "Save Report"}
          </button>
        </div>
      </div>

      {driftBanner && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {driftBanner}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        <div className="space-y-4">
          <div className="lg:h-[420px]">
            <FieldCatalog
              fields={catalog.fields}
              groups={catalog.groups}
              selectedFieldKeys={selectedFieldKeys}
              onAddField={handleAddField}
            />
          </div>
          <div className="pt-3 border-t border-zinc-200">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Saved Reports</h4>
            <SavedReportsPanel
              refreshToken={savedReportsRefreshToken}
              onLoadReport={handleLoadReport}
              onError={(msg) => onShowToast(msg, true)}
            />
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Columns</h4>
            <ColumnCanvas
              columns={definition.columns}
              fieldByKey={fieldByKey}
              expandRelation={definition.expandRelation}
              onAddField={handleAddField}
              onRemoveColumn={(fieldKey) => setDefinition((prev) => removeColumn(prev, fieldKey))}
              onMoveColumn={(from, to) => setDefinition((prev) => reorderColumns(prev, from, to))}
              onLabelChange={(fieldKey, label) => setDefinition((prev) => updateColumnLabel(prev, fieldKey, label))}
              onAggregationChange={(fieldKey, aggregation) => setDefinition((prev) => updateColumnAggregation(prev, fieldKey, aggregation))}
              onExpandRelationChange={(relationKey) => setDefinition((prev) => setExpandRelation(prev, relationKey))}
              resolveField={(key) => fieldByKey.get(key)}
            />
          </div>

          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Filters</h4>
            <ConditionBuilder
              conditions={conditions}
              fields={catalog.fields}
              fieldByKey={fieldByKey}
              onAdd={(condition) => setDefinition((prev) => addCondition(prev, condition))}
              onUpdate={(index, condition) => setDefinition((prev) => updateCondition(prev, index, condition))}
              onRemove={(index) => setDefinition((prev) => removeCondition(prev, index))}
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Preview</h4>
              {isLoadingPreview && <RotateCw className="h-3 w-3 animate-spin text-zinc-400" />}
            </div>
            {previewError ? (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-900">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {previewError}
              </div>
            ) : (
              <PreviewTable
                result={preview}
                fieldByKey={fieldByKey}
                onLinkClick={() => onShowToast("Opening records from a report is coming soon.")}
              />
            )}
          </div>
        </div>
      </div>

      {isSaveModalOpen && (
        <SaveReportModal
          definition={definition}
          editing={editingReport}
          onClose={() => setIsSaveModalOpen(false)}
          onSuccess={(msg, report) => {
            onShowToast(msg);
            setEditingReport(report);
            setSavedReportsRefreshToken((n) => n + 1);
          }}
          onError={(msg) => onShowToast(msg, true)}
        />
      )}
    </div>
  );
}
