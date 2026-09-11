"use client";

import { Plus, X } from "lucide-react";
import type { Condition, FieldDef, Operator } from "@/lib/reports/types";
import { todayLocalStr } from "@/lib/dateUtils";

// v1 keeps conditions as a single implicit AND list (see definitionEdit.ts's
// withConditions) rather than the full AND/OR nested-group UI the plan sketched —
// a genuine simplification, noted per the plan doc's Phase 2 step 5. Every date
// input below binds directly to a "YYYY-MM-DD" string (the native <input
// type="date"> value shape), never through `new Date(str)`, per this repo's
// date-handling rule.

const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  in: "is any of",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  isNull: "is empty",
  isNotNull: "is not empty",
};

interface Props {
  conditions: readonly Condition[];
  fields: readonly FieldDef[];
  fieldByKey: ReadonlyMap<string, FieldDef>;
  onAdd: (condition: Condition) => void;
  onUpdate: (index: number, condition: Condition) => void;
  onRemove: (index: number) => void;
}

function defaultValueFor(field: FieldDef, operator: Operator): Condition["value"] {
  if (operator === "isNull" || operator === "isNotNull") return undefined;
  if (operator === "in") return field.type === "enum" ? [field.enumValues?.[0] ?? ""] : [""];
  if (operator === "between") return field.type === "date" ? [todayLocalStr(), todayLocalStr()] : [0, 0];
  switch (field.type) {
    case "number":
      return 0;
    case "boolean":
      return true;
    case "date":
      return todayLocalStr();
    case "enum":
      return field.enumValues?.[0] ?? "";
    default:
      return "";
  }
}

function ValueInput({
  field,
  operator,
  value,
  onChange,
}: {
  field: FieldDef;
  operator: Operator;
  value: Condition["value"];
  onChange: (value: Condition["value"]) => void;
}) {
  if (operator === "isNull" || operator === "isNotNull") return null;

  if (operator === "between") {
    const [lo, hi] = (Array.isArray(value) ? value : [value, value]) as [string | number, string | number];
    const inputType = field.type === "date" ? "date" : "number";
    return (
      <div className="flex items-center gap-1.5">
        <input
          type={inputType}
          value={lo ?? ""}
          onChange={(e) => onChange([field.type === "date" ? e.target.value : Number(e.target.value), hi])}
          className="w-32 border border-zinc-200 rounded px-1.5 py-1 text-xs"
        />
        <span className="text-[11px] text-zinc-400">and</span>
        <input
          type={inputType}
          value={hi ?? ""}
          onChange={(e) => onChange([lo, field.type === "date" ? e.target.value : Number(e.target.value)])}
          className="w-32 border border-zinc-200 rounded px-1.5 py-1 text-xs"
        />
      </div>
    );
  }

  if (field.type === "enum") {
    if (operator === "in") {
      const selected = new Set((Array.isArray(value) ? value : []) as string[]);
      return (
        <div className="flex flex-wrap gap-2">
          {(field.enumValues ?? []).map((v) => (
            <label key={v} className="flex items-center gap-1 text-[11px] text-zinc-600">
              <input
                type="checkbox"
                checked={selected.has(v)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(v);
                  else next.delete(v);
                  onChange([...next]);
                }}
              />
              {v}
            </label>
          ))}
        </div>
      );
    }
    return (
      <select
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="border border-zinc-200 rounded px-1.5 py-1 text-xs"
      >
        {(field.enumValues ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "date") {
    return (
      <input
        type="date"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="border border-zinc-200 rounded px-1.5 py-1 text-xs"
      />
    );
  }

  if (field.type === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 border border-zinc-200 rounded px-1.5 py-1 text-xs"
      />
    );
  }

  return (
    <input
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      className="border border-zinc-200 rounded px-1.5 py-1 text-xs flex-1 min-w-0"
    />
  );
}

export default function ConditionBuilder({ conditions, fields, fieldByKey, onAdd, onUpdate, onRemove }: Props) {
  const filterableFields = fields.filter((f) => f.operators.length > 0);

  const handleAdd = () => {
    const field = filterableFields[0];
    if (!field) return;
    const operator = field.operators[0];
    onAdd({ fieldKey: field.key, operator, value: defaultValueFor(field, operator) });
  };

  return (
    <div className="space-y-2">
      {conditions.map((condition, index) => {
        const field = fieldByKey.get(condition.fieldKey);
        if (!field) return null;

        return (
          <div key={index} className="flex items-center gap-2 flex-wrap bg-white border border-zinc-200 rounded px-2.5 py-1.5">
            <select
              value={condition.fieldKey}
              onChange={(e) => {
                const nextField = fieldByKey.get(e.target.value);
                if (!nextField) return;
                const operator = nextField.operators[0];
                onUpdate(index, { fieldKey: nextField.key, operator, value: defaultValueFor(nextField, operator) });
              }}
              className="border border-zinc-200 rounded px-1.5 py-1 text-xs"
            >
              {filterableFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>

            <select
              value={condition.operator}
              onChange={(e) => {
                const operator = e.target.value as Operator;
                onUpdate(index, { fieldKey: field.key, operator, value: defaultValueFor(field, operator) });
              }}
              className="border border-zinc-200 rounded px-1.5 py-1 text-xs"
            >
              {field.operators.map((op) => (
                <option key={op} value={op}>
                  {OPERATOR_LABELS[op]}
                </option>
              ))}
            </select>

            <ValueInput
              field={field}
              operator={condition.operator}
              value={condition.value}
              onChange={(value) => onUpdate(index, { ...condition, value })}
            />

            <button
              type="button"
              onClick={() => onRemove(index)}
              className="ml-auto text-zinc-400 hover:text-red-600"
              aria-label="Remove condition"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={handleAdd}
        disabled={filterableFields.length === 0}
        className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus className="h-3 w-3" />
        Add filter
      </button>
    </div>
  );
}
