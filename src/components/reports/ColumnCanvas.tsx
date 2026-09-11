"use client";

import { ArrowUp, ArrowDown, X } from "lucide-react";
import type { Aggregation, FieldDef, ReportColumn } from "@/lib/reports/types";
import { manyEdgeKeys } from "@/lib/reports/graph";
import { FIELD_DRAG_TYPE } from "./FieldCatalog";

// Reorder is up/down buttons rather than native drag-to-reorder: HTML5 DnD's
// reorder-within-a-list gesture is fiddly to get right (drop-position math,
// auto-scroll) and buttons are fully keyboard-accessible for free — a reasonable
// v1 simplification per the plan doc's Phase 2 step 4 note.

const AGGREGATIONS: readonly Aggregation[] = ["list", "count", "sum", "min", "max"];
const NUMBER_ONLY_AGGREGATIONS: ReadonlySet<Aggregation> = new Set(["sum", "min", "max"]);

interface Props {
  columns: readonly ReportColumn[];
  fieldByKey: ReadonlyMap<string, FieldDef>;
  expandRelation: string | undefined;
  onAddField: (field: FieldDef) => void;
  onRemoveColumn: (fieldKey: string) => void;
  onMoveColumn: (fromIndex: number, toIndex: number) => void;
  onLabelChange: (fieldKey: string, label: string | undefined) => void;
  onAggregationChange: (fieldKey: string, aggregation: Aggregation) => void;
  onExpandRelationChange: (relationKey: string | undefined) => void;
  resolveField: (key: string) => FieldDef | undefined;
}

/** The many-relation a field belongs to (its path's first edge), for the expand toggle. */
function relationGroupOf(field: FieldDef): string | undefined {
  return field.cardinality === "many" ? field.path.edges[0] : undefined;
}

export default function ColumnCanvas({
  columns,
  fieldByKey,
  expandRelation,
  onAddField,
  onRemoveColumn,
  onMoveColumn,
  onLabelChange,
  onAggregationChange,
  onExpandRelationChange,
  resolveField,
}: Props) {
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const fieldKey = e.dataTransfer.getData(FIELD_DRAG_TYPE);
    const field = fieldKey ? resolveField(fieldKey) : undefined;
    if (field) onAddField(field);
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="min-h-[120px] border-2 border-dashed border-zinc-200 rounded p-3 space-y-2"
    >
      {columns.length === 0 && (
        <p className="text-xs text-zinc-400 text-center py-6">
          Click or drag fields from the catalog to add columns.
        </p>
      )}

      {columns.map((col, index) => {
        const field = fieldByKey.get(col.fieldKey);
        if (!field) return null;
        const relationKey = relationGroupOf(field);
        const isExpandedRelation = relationKey !== undefined && relationKey === expandRelation;
        const isAnotherRelationExpanded = relationKey !== undefined && expandRelation !== undefined && expandRelation !== relationKey;
        const allowedAggregations = field.type === "number" ? AGGREGATIONS : AGGREGATIONS.filter((a) => !NUMBER_ONLY_AGGREGATIONS.has(a));

        return (
          <div key={col.fieldKey} className="flex flex-col gap-1.5 bg-white border border-zinc-200 rounded px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="flex flex-col shrink-0">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onMoveColumn(index, index - 1)}
                  className="text-zinc-400 hover:text-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`Move ${field.label} up`}
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={index === columns.length - 1}
                  onClick={() => onMoveColumn(index, index + 1)}
                  className="text-zinc-400 hover:text-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`Move ${field.label} down`}
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>

              <input
                type="text"
                value={col.label ?? field.label}
                onChange={(e) => onLabelChange(col.fieldKey, e.target.value === field.label ? undefined : e.target.value)}
                className="flex-1 min-w-0 text-xs font-medium text-zinc-800 border border-transparent hover:border-zinc-200 focus:border-blue-400 rounded px-1.5 py-1 focus:outline-none"
              />

              <button
                type="button"
                onClick={() => onRemoveColumn(col.fieldKey)}
                className="text-zinc-400 hover:text-red-600 shrink-0"
                aria-label={`Remove ${field.label}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {field.cardinality === "many" && (
              <div className="flex items-center gap-3 pl-6 flex-wrap">
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  Combine as
                  <select
                    value={col.aggregation ?? "list"}
                    onChange={(e) => onAggregationChange(col.fieldKey, e.target.value as Aggregation)}
                    className="border border-zinc-200 rounded px-1 py-0.5 text-[11px]"
                  >
                    {allowedAggregations.map((agg) => (
                      <option key={agg} value={agg}>
                        {agg}
                      </option>
                    ))}
                  </select>
                </label>

                {relationKey && manyEdgeKeys().includes(relationKey) && (
                  <label
                    className={`flex items-center gap-1.5 text-[11px] ${isAnotherRelationExpanded ? "text-zinc-300" : "text-zinc-500"}`}
                    title={
                      isAnotherRelationExpanded
                        ? "Only one relation can be expanded at a time — clear the other expansion first"
                        : "Show one row per item in this relation instead of combining them"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={isExpandedRelation}
                      disabled={isAnotherRelationExpanded}
                      onChange={(e) => onExpandRelationChange(e.target.checked ? relationKey : undefined)}
                    />
                    Expand to one row per {field.group.toLowerCase()}
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
