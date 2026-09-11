"use client";

import { Fragment, useMemo, useState } from "react";
import type { FieldDef, ReportColumn } from "@/lib/reports/types";
import { groupManyColumns, hasDrillDown, zipManyRows, type ManyColumnGroup } from "@/lib/reports/stacking";

// Row click -> "open the record" is stubbed rather than wired to an editJob-style
// modal (plan doc's Phase 2 step 6): every modal on the dashboard (editJob,
// client detail, invoice detail, ...) is opened with a full domain object already
// in memory (see src/app/page.tsx's onEditJob={(job) => ...}), but a report row
// only ever carries the specific columns the user chose to select — there is no
// clean existing hook point that accepts "just an id". Wiring this for real needs
// either a dedicated by-id fetch-and-open path or a byId lookup added to each
// modal, which is out of scope for the ad-hoc builder itself. onLinkClick below
// is a real, user-visible stub (a toast), not a silent no-op.

export interface ReportPreviewResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

interface Props {
  result: ReportPreviewResult | null;
  fieldByKey: ReadonlyMap<string, FieldDef>;
  onLinkClick: (target: string) => void;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined).join(", ");
  return String(value);
}

export default function PreviewTable({ result, fieldByKey, onLinkClick }: Props) {
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<number>>(new Set());

  const manyGroups = useMemo<ManyColumnGroup[]>(
    () => (result ? groupManyColumns(result.columns, fieldByKey) : []),
    [result, fieldByKey],
  );

  function toggleRow(rowIndex: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  if (!result) {
    return <p className="text-xs text-zinc-400 py-4">Add a column to see a preview.</p>;
  }

  if (result.columns.length === 0) {
    return <p className="text-xs text-zinc-400 py-4">Add a column to see a preview.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto border border-zinc-200 rounded">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              {manyGroups.length > 0 && <th className="w-6 px-1 py-2" aria-hidden="true" />}
              {result.columns.map((col) => {
                const field = fieldByKey.get(col.fieldKey);
                return (
                  <th key={col.fieldKey} className="text-left font-bold uppercase tracking-wider text-zinc-500 px-3 py-2 whitespace-nowrap">
                    {col.label ?? field?.label ?? col.fieldKey}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => {
              const canDrillDown = manyGroups.length > 0 && hasDrillDown(row, manyGroups);
              const isExpanded = canDrillDown && expandedRows.has(rowIndex);
              return (
                <Fragment key={rowIndex}>
                  <tr className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    {manyGroups.length > 0 && (
                      <td className="w-6 px-1 py-2 align-top">
                        {canDrillDown && (
                          <button
                            type="button"
                            onClick={() => toggleRow(rowIndex)}
                            aria-label={isExpanded ? "Collapse row detail" : "Expand row detail"}
                            aria-expanded={isExpanded}
                            className="text-zinc-400 hover:text-zinc-700 w-4"
                          >
                            {isExpanded ? "▾" : "▸"}
                          </button>
                        )}
                      </td>
                    )}
                    {result.columns.map((col) => {
                      const field = fieldByKey.get(col.fieldKey);
                      const isLink = Boolean(field?.linkTo);
                      return (
                        <td key={col.fieldKey} className="px-3 py-2 text-zinc-700 whitespace-nowrap">
                          {isLink ? (
                            <button
                              type="button"
                              onClick={() => onLinkClick(field!.linkTo!.target)}
                              className="text-blue-700 hover:underline"
                            >
                              {formatCell(row[col.fieldKey])}
                            </button>
                          ) : (
                            formatCell(row[col.fieldKey])
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && (
                    <tr key={`${rowIndex}-detail`} className="border-b border-zinc-100 bg-zinc-50/60">
                      <td />
                      <td colSpan={result.columns.length} className="px-3 py-3">
                        <div className="space-y-3">
                          {manyGroups.map((group) => {
                            const childRows = zipManyRows(row, group);
                            if (childRows.length === 0) return null;
                            return (
                              <table key={group.groupKey} className="text-xs border border-zinc-200 rounded overflow-hidden">
                                <thead className="bg-zinc-100">
                                  <tr>
                                    {group.columns.map((col) => {
                                      const field = fieldByKey.get(col.fieldKey);
                                      return (
                                        <th key={col.fieldKey} className="text-left font-bold uppercase tracking-wider text-zinc-500 px-2 py-1 whitespace-nowrap">
                                          {col.label ?? field?.label ?? col.fieldKey}
                                        </th>
                                      );
                                    })}
                                  </tr>
                                </thead>
                                <tbody>
                                  {childRows.map((childRow, childIndex) => (
                                    <tr key={childIndex} className="border-t border-zinc-100">
                                      {group.columns.map((col) => (
                                        <td key={col.fieldKey} className="px-2 py-1 text-zinc-700 whitespace-nowrap">
                                          {formatCell(childRow[col.fieldKey])}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={result.columns.length + (manyGroups.length > 0 ? 1 : 0)} className="px-3 py-6 text-center text-zinc-400">
                  No matching rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-zinc-500">
        Showing {result.rows.length} of {result.totalRows} row{result.totalRows === 1 ? "" : "s"}
        {result.truncated ? " — narrow the filters or save the report to export the full result" : ""}
      </p>
    </div>
  );
}
