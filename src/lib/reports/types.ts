// Core types for the Plus-tier custom report builder. Pure module: no I/O, no DB.
//
// A ReportDefinition never carries a raw SQL identifier. Every column, join and
// condition names a `key` that is looked up in the field registry (registry.ts) —
// that lookup is the entire injection defence, so it lives here as a type-level
// contract, not as a sanitizer bolted on later. See docs/superpowers/plans/
// 2026-09-09-report-builder-plus.md for the full design.

import type { UserRole } from "@/types";

export type FieldDataType = "string" | "number" | "date" | "boolean" | "enum";

export type Operator =
  | "eq"
  | "neq"
  | "contains"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "isNull"
  | "isNotNull";

/** How a many-side relation's values are folded into one root row. */
export type Aggregation = "list" | "count" | "sum" | "min" | "max";

export type FieldSensitivity = "normal" | "money" | "pii";

/** Where an entity sits relative to the report root, and how to reach it. */
export interface RelationPath {
  /** Relation edge keys (see graph.ts) walked from the root to this field's entity. */
  edges: string[];
}

export interface LinkTarget {
  target: "job" | "client" | "vehicle" | "invoice" | "quote";
  /** Field key (on this same row) holding the id to link to. */
  idField: string;
}

/**
 * One whitelisted, reportable column. Only `key` is ever supplied by the client —
 * `source`/`path` are resolved server-side from the registry and are the only things
 * that become SQL identifiers.
 */
export interface FieldDef {
  key: string;
  label: string;
  group: string;
  type: FieldDataType;
  enumValues?: readonly string[];
  source: { entity: string; column: string };
  path: RelationPath;
  operators: readonly Operator[];
  /** Cardinality of this field's entity relative to the report root. */
  cardinality: "one" | "many";
  sensitivity: FieldSensitivity;
  requiresRole: readonly UserRole[];
  linkTo?: LinkTarget;
}

export interface Condition {
  fieldKey: string;
  operator: Operator;
  /**
   * Absent for isNull/isNotNull. An array for "in" (any length) and "between"
   * (exactly two elements, [min, max]) — definition.ts enforces the length.
   */
  value?: string | number | boolean | (string | number)[];
}

export type ConditionGroupJoin = "AND" | "OR";

export interface ConditionGroup {
  join: ConditionGroupJoin;
  conditions: Condition[];
}

export interface ReportColumn {
  fieldKey: string;
  /** Optional display override; falls back to the field's registry label. */
  label?: string;
  /** Required when the field's cardinality is "many"; ignored otherwise. */
  aggregation?: Aggregation;
}

export interface ReportSort {
  fieldKey: string;
  direction: "asc" | "desc";
}

/**
 * A user-composed report. Untrusted whether it arrives as a request body or is read
 * back out of SavedReport.definition — always re-validate with definition.ts before
 * compiling or executing.
 */
export interface ReportDefinition {
  rootEntity: "job";
  columns: ReportColumn[];
  filters: ConditionGroup[];
  sort?: ReportSort[];
  /**
   * At most one `many` relation may be expanded into one row per child instead of
   * being aggregated. Naming a relation here that appears nowhere in `columns` or
   * `filters` is still valid — it controls row shape, not column selection.
   */
  expandRelation?: string;
}

export interface RelationEdge {
  key: string;
  from: string;
  to: string;
  kind: "one" | "many";
  localKey: string;
  foreignKey: string;
  /** Join-table edge key, when this relation is reached through one (e.g. JobAssignment). */
  through?: string;
}

export interface CompiledReport {
  sql: string;
  parameters: readonly unknown[];
  columns: ReportColumn[];
}
