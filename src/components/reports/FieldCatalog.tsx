"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Layers } from "lucide-react";
import type { FieldDef } from "@/lib/reports/types";

// Drag-and-drop (draggable + onDragStart below) is a convenience, not the primary
// interaction: HTML5 DnD has no real keyboard path, so every field is ALSO a click
// target via onAddField. Click-to-add is the accessible route, not a fallback.

interface Props {
  fields: readonly FieldDef[];
  groups: readonly string[];
  selectedFieldKeys: ReadonlySet<string>;
  onAddField: (field: FieldDef) => void;
}

/** Payload MIME type used for the FieldCatalog -> ColumnCanvas HTML5 drag transfer. */
export const FIELD_DRAG_TYPE = "application/x-wvo-report-field";

export default function FieldCatalog({ fields, groups, selectedFieldKeys, onAddField }: Props) {
  const [filter, setFilter] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());

  const fieldsByGroup = useMemo(() => {
    const byGroup = new Map<string, FieldDef[]>();
    const needle = filter.trim().toLowerCase();
    for (const field of fields) {
      if (needle && !field.label.toLowerCase().includes(needle)) continue;
      const list = byGroup.get(field.group) ?? [];
      list.push(field);
      byGroup.set(field.group, list);
    }
    return byGroup;
  }, [fields, filter]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="relative mb-3 shrink-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter fields..."
          className="w-full pl-8 pr-2 py-1.5 text-xs border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-3">
        {groups.map((group) => {
          const groupFields = fieldsByGroup.get(group);
          if (!groupFields || groupFields.length === 0) return null;
          const isCollapsed = collapsedGroups.has(group);

          return (
            <div key={group}>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="flex items-center gap-1 w-full text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-800 mb-1"
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {group}
              </button>
              {!isCollapsed && (
                <div className="space-y-0.5">
                  {groupFields.map((field) => {
                    const isSelected = selectedFieldKeys.has(field.key);
                    return (
                      <div
                        key={field.key}
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData(FIELD_DRAG_TYPE, field.key)}
                        onClick={() => onAddField(field)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onAddField(field);
                          }
                        }}
                        className={`flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded cursor-pointer border transition-colors ${
                          isSelected
                            ? "bg-blue-50 border-blue-200 text-blue-800"
                            : "bg-white border-transparent hover:border-zinc-200 hover:bg-zinc-50 text-zinc-700"
                        }`}
                        title={field.cardinality === "many" ? "Multiple values per job — will be aggregated" : undefined}
                      >
                        <span className="truncate">{field.label}</span>
                        {field.cardinality === "many" && (
                          <Layers className="h-3 w-3 text-amber-500 shrink-0" aria-label="Multiple values per job" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {fields.length === 0 && <p className="text-xs text-zinc-400 px-1">No fields available.</p>}
      </div>
    </div>
  );
}
