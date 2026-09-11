// Pure, immutable edit helpers for a ReportDefinition, used by the builder UI
// (Phase 2: FieldCatalog, ColumnCanvas, ConditionBuilder). Every function takes a
// ReportDefinition and returns a new one — never mutates its input. This is what
// makes the builder testable without a React testing stack: the components stay
// thin wrappers around these functions, and the functions carry the real test
// coverage (see definitionEdit.test.ts).
//
// v1 keeps filters as a single implicit AND group rather than the full
// ConditionGroup[] nesting ReportDefinition's type allows — see plan doc's Phase 2
// step 5 ("simplification, note if taken"). addCondition/updateCondition/
// removeCondition operate on filters[0].conditions, creating that one group lazily
// and dropping it once its last condition is removed, so an empty definition still
// serializes to filters: [].

import type { Aggregation, Condition, ReportColumn, ReportDefinition, ReportSort } from "./types";

export function emptyDefinition(): ReportDefinition {
  return { rootEntity: "job", columns: [], filters: [] };
}

function firstGroupConditions(def: ReportDefinition): readonly Condition[] {
  return def.filters[0]?.conditions ?? [];
}

function withConditions(def: ReportDefinition, conditions: readonly Condition[]): ReportDefinition {
  const filters = conditions.length === 0 ? [] : [{ join: "AND" as const, conditions: [...conditions] }];
  return { ...def, filters };
}

/** Appends a column. A field already present is left as-is (no duplicate columns). */
export function addColumn(def: ReportDefinition, fieldKey: string, aggregation?: Aggregation): ReportDefinition {
  if (def.columns.some((c) => c.fieldKey === fieldKey)) return def;
  const column: ReportColumn = { fieldKey, aggregation };
  return { ...def, columns: [...def.columns, column] };
}

export function removeColumn(def: ReportDefinition, fieldKey: string): ReportDefinition {
  return { ...def, columns: def.columns.filter((c) => c.fieldKey !== fieldKey) };
}

/** Out-of-range indices are clamped rather than throwing — a stale UI index should no-op, not crash. */
export function reorderColumns(def: ReportDefinition, fromIndex: number, toIndex: number): ReportDefinition {
  const count = def.columns.length;
  if (count === 0 || fromIndex < 0 || fromIndex >= count) return def;
  const clampedTo = Math.max(0, Math.min(toIndex, count - 1));
  if (fromIndex === clampedTo) return def;

  const columns = [...def.columns];
  const [moved] = columns.splice(fromIndex, 1);
  columns.splice(clampedTo, 0, moved);
  return { ...def, columns };
}

export function updateColumnLabel(def: ReportDefinition, fieldKey: string, label: string | undefined): ReportDefinition {
  return {
    ...def,
    columns: def.columns.map((c) => (c.fieldKey === fieldKey ? { ...c, label } : c)),
  };
}

export function updateColumnAggregation(def: ReportDefinition, fieldKey: string, aggregation: Aggregation): ReportDefinition {
  return {
    ...def,
    columns: def.columns.map((c) => (c.fieldKey === fieldKey ? { ...c, aggregation } : c)),
  };
}

export function addCondition(def: ReportDefinition, condition: Condition): ReportDefinition {
  return withConditions(def, [...firstGroupConditions(def), condition]);
}

/** Out-of-range indices are ignored — no matching condition to update. */
export function updateCondition(def: ReportDefinition, index: number, condition: Condition): ReportDefinition {
  const conditions = firstGroupConditions(def);
  if (index < 0 || index >= conditions.length) return def;
  const next = [...conditions];
  next[index] = condition;
  return withConditions(def, next);
}

/** Out-of-range indices are ignored. Removing the last condition drops the filter group entirely. */
export function removeCondition(def: ReportDefinition, index: number): ReportDefinition {
  const conditions = firstGroupConditions(def);
  if (index < 0 || index >= conditions.length) return def;
  return withConditions(def, conditions.filter((_, i) => i !== index));
}

/**
 * Sets, clears, or replaces the expanded relation. ReportDefinition.expandRelation is
 * a single optional string, so "only one relation expanded at a time" is a structural
 * property of the type — this setter just makes replacement explicit at the call site
 * rather than leaving components to spread expandRelation by hand.
 */
export function setExpandRelation(def: ReportDefinition, relationKey: string | undefined): ReportDefinition {
  return { ...def, expandRelation: relationKey };
}

export function setSort(def: ReportDefinition, sort: ReportSort[] | undefined): ReportDefinition {
  return { ...def, sort: sort && sort.length > 0 ? sort : undefined };
}

export interface SanitizeResult {
  definition: ReportDefinition;
  droppedFieldKeys: string[];
}

/**
 * Drops any column/condition/sort referencing a field key not in
 * `knownFieldKeys`, and clears expandRelation if it names a relation with no
 * surviving column (Phase 3: loading a SavedReport whose registry entries
 * have since been removed — "definition drift"). Runs client-side against
 * the already-fetched field catalog so the builder can open a stale saved
 * report with a visible banner instead of failing to load at all. This is a
 * UX convenience only — the server re-validates with validateDefinition on
 * every save/run regardless, per definition.ts's own doc comment.
 */
export function sanitizeAgainstCatalog(def: ReportDefinition, knownFieldKeys: ReadonlySet<string>): SanitizeResult {
  const dropped = new Set<string>();
  const keep = (key: string) => {
    if (knownFieldKeys.has(key)) return true;
    dropped.add(key);
    return false;
  };

  const columns = def.columns.filter((c) => keep(c.fieldKey));
  const filters = def.filters
    .map((group) => ({ ...group, conditions: group.conditions.filter((c) => keep(c.fieldKey)) }))
    .filter((group) => group.conditions.length > 0);
  const sort = def.sort?.filter((s) => keep(s.fieldKey));

  return {
    definition: {
      ...def,
      columns,
      filters,
      sort: sort && sort.length > 0 ? sort : undefined,
    },
    droppedFieldKeys: [...dropped],
  };
}
