// Pure helpers for the preview table's "stacking"/drill-down feature (Phase 5):
// expanding a report row to show its aggregated (many-valued) children as a
// nested sub-table instead of just the collapsed comma-joined summary.
//
// No new API call or DB round-trip is involved — a "list"-aggregated many
// column already comes back from /api/reports/preview as a plain array (see
// compile.ts's `aggregatedSelect` "list" case: `array_agg(elem ->> field)`
// over the group's shared `json_agg` LATERAL, in guaranteed element order).
// Two list-aggregated columns from the *same* relation are therefore two
// arrays whose Nth elements describe the same child row — this module zips
// them back into child-row objects for display. Columns aggregated as
// count/sum/min/max are scalars, not arrays, and are excluded.

import type { FieldDef, ReportColumn } from "./types";

export interface ManyColumnGroup {
  /** The shared relation this group of columns is aggregated from (FieldDef.path.edges[0]). */
  groupKey: string;
  columns: ReportColumn[];
}

/**
 * Splits a report's selected columns into groups of list-aggregated,
 * many-cardinality columns sharing the same relation. Columns with any other
 * aggregation (count/sum/min/max), or whose field isn't many-cardinality, are
 * excluded — they render as plain scalar cells, nothing to drill into.
 */
export function groupManyColumns(
  columns: readonly ReportColumn[],
  fieldByKey: ReadonlyMap<string, FieldDef>,
): ManyColumnGroup[] {
  const byGroup = new Map<string, ReportColumn[]>();
  for (const col of columns) {
    const field = fieldByKey.get(col.fieldKey);
    if (!field || field.cardinality !== "many") continue;
    if (col.aggregation !== undefined && col.aggregation !== "list") continue;
    const groupKey = field.path.edges[0];
    if (groupKey === undefined) continue;
    const existing = byGroup.get(groupKey);
    if (existing) existing.push(col);
    else byGroup.set(groupKey, [col]);
  }
  return [...byGroup.entries()].map(([groupKey, cols]) => ({ groupKey, columns: cols }));
}

/**
 * Zips one row's list-aggregated array cells for a single group into child-row
 * records, one per array element. Uses the shortest array's length as a
 * defensive bound in case of a genuine length mismatch, so a malformed cell
 * can never index past the end of another column's array.
 */
export function zipManyRows(
  row: Record<string, unknown>,
  group: ManyColumnGroup,
): Record<string, unknown>[] {
  const arrays = group.columns.map((col) => {
    const value = row[col.fieldKey];
    return Array.isArray(value) ? value : [];
  });
  const length = arrays.length === 0 ? 0 : Math.min(...arrays.map((a) => a.length));
  const childRows: Record<string, unknown>[] = [];
  for (let i = 0; i < length; i++) {
    const childRow: Record<string, unknown> = {};
    group.columns.forEach((col, colIndex) => {
      childRow[col.fieldKey] = arrays[colIndex][i];
    });
    childRows.push(childRow);
  }
  return childRows;
}

/** True when a row has at least one many-column group with a non-empty array to drill into. */
export function hasDrillDown(
  row: Record<string, unknown>,
  groups: readonly ManyColumnGroup[],
): boolean {
  return groups.some((group) => zipManyRows(row, group).length > 0);
}
