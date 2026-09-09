// Validates and normalizes a ReportDefinition. Pure module: no I/O, no DB.
//
// Runs on BOTH the client-supplied preview/save body and the JSON read back out of
// SavedReport.definition (Phase 3) — a saved definition is untrusted input on read,
// since the registry can shrink between releases. Every column/condition/sort field
// key is checked against the registry (registry.ts); nothing that fails this check
// may reach the compiler (compile.ts, Phase 1).
//
// Hand-rolled rather than a schema library (zod etc.), matching this codebase's only
// existing precedent for validating a user-composed structure —
// src/lib/import/mappingSchema.ts's validateMappingShape — for consistency. See
// docs/superpowers/plans/2026-09-09-report-builder-plus.md, Open Question 5.

import type { UserRole } from "@/types";
import { getField } from "./registry";
import { getEdge, manyEdgeKeys } from "./graph";
import type { Aggregation, Condition, ConditionGroup, FieldDef, Operator, ReportColumn, ReportDefinition, ReportSort } from "./types";

export const MAX_COLUMNS = 40;
export const MAX_CONDITIONS = 25;

const NUMBER_AGGREGATIONS: readonly Aggregation[] = ["list", "count", "sum", "min", "max"];
const NON_NUMBER_AGGREGATIONS: readonly Aggregation[] = ["list", "count"];

export interface ValidationResult {
  ok: boolean;
  /** Present only when ok is true. */
  definition?: ReportDefinition;
  errors: string[];
  /** Field keys referenced by the input that do not exist in the current registry. */
  unknownFieldKeys: string[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Looks up a field key, distinguishing "doesn't exist" (registry drift — reported
 * separately as unknownFieldKeys so the caller can degrade gracefully) from "exists
 * but this role can't see it" (a real validation error).
 */
function resolveField(key: string, role: UserRole, ctx: { errors: string[]; unknownFieldKeys: string[] }, where: string): FieldDef | undefined {
  const field = getField(key);
  if (!field) {
    ctx.unknownFieldKeys.push(key);
    return undefined;
  }
  if (!field.requiresRole.includes(role)) {
    ctx.errors.push(`${where}: field "${key}" is not permitted for this role`);
    return undefined;
  }
  return field;
}

function validateValueForField(field: FieldDef, operator: Operator, value: unknown, where: string, errors: string[]): void {
  if (operator === "isNull" || operator === "isNotNull") {
    if (value !== undefined) errors.push(`${where}: "${operator}" must not carry a value`);
    return;
  }
  if (operator === "in") {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`${where}: "in" requires a non-empty array of values`);
      return;
    }
    for (const v of value) validateScalarForField(field, v, where, errors);
    return;
  }
  if (operator === "between") {
    if (!Array.isArray(value) || value.length !== 2) {
      errors.push(`${where}: "between" requires exactly two values [min, max]`);
      return;
    }
    for (const v of value) validateScalarForField(field, v, where, errors);
    return;
  }
  validateScalarForField(field, value, where, errors);
}

function validateScalarForField(field: FieldDef, value: unknown, where: string, errors: string[]): void {
  switch (field.type) {
    case "string":
      if (typeof value !== "string") errors.push(`${where}: expected a string value`);
      break;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) errors.push(`${where}: expected a numeric value`);
      break;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${where}: expected a boolean value`);
      break;
    case "date":
      // Dates travel as ISO strings over JSON; the compiler (Phase 1) parses them.
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) errors.push(`${where}: expected an ISO date string`);
      break;
    case "enum":
      if (typeof value !== "string" || !field.enumValues?.includes(value)) {
        errors.push(`${where}: "${String(value)}" is not one of ${(field.enumValues ?? []).join(", ")}`);
      }
      break;
  }
}

function validateColumn(input: unknown, role: UserRole, ctx: { errors: string[]; unknownFieldKeys: string[] }): ReportColumn | undefined {
  if (!isRecord(input) || typeof input.fieldKey !== "string") {
    ctx.errors.push("column: missing or invalid fieldKey");
    return undefined;
  }
  const where = `column "${input.fieldKey}"`;
  const field = resolveField(input.fieldKey, role, ctx, where);
  if (!field) return undefined;

  if (input.label !== undefined && typeof input.label !== "string") {
    ctx.errors.push(`${where}: label must be a string`);
    return undefined;
  }

  let aggregation: Aggregation | undefined;
  if (field.cardinality === "many") {
    if (typeof input.aggregation !== "string") {
      ctx.errors.push(`${where}: is a many-valued field and requires an aggregation`);
      return undefined;
    }
    const allowed = field.type === "number" ? NUMBER_AGGREGATIONS : NON_NUMBER_AGGREGATIONS;
    if (!allowed.includes(input.aggregation as Aggregation)) {
      ctx.errors.push(`${where}: aggregation "${input.aggregation}" is not valid for a ${field.type} field`);
      return undefined;
    }
    aggregation = input.aggregation as Aggregation;
  } else if (input.aggregation !== undefined) {
    ctx.errors.push(`${where}: aggregation is only valid on a many-valued field`);
    return undefined;
  }

  return { fieldKey: input.fieldKey, label: input.label as string | undefined, aggregation };
}

function validateCondition(input: unknown, role: UserRole, ctx: { errors: string[]; unknownFieldKeys: string[] }): Condition | undefined {
  if (!isRecord(input) || typeof input.fieldKey !== "string" || typeof input.operator !== "string") {
    ctx.errors.push("condition: missing or invalid fieldKey/operator");
    return undefined;
  }
  const where = `condition "${input.fieldKey}" ${input.operator}`;
  const field = resolveField(input.fieldKey, role, ctx, where);
  if (!field) return undefined;

  const operator = input.operator as Operator;
  if (!field.operators.includes(operator)) {
    ctx.errors.push(`${where}: operator not permitted for this field`);
    return undefined;
  }

  const valueErrors: string[] = [];
  validateValueForField(field, operator, input.value, where, valueErrors);
  if (valueErrors.length > 0) {
    ctx.errors.push(...valueErrors);
    return undefined;
  }

  return { fieldKey: input.fieldKey, operator, value: input.value as Condition["value"] };
}

function validateFilterGroup(input: unknown, role: UserRole, ctx: { errors: string[]; unknownFieldKeys: string[] }): ConditionGroup | undefined {
  if (!isRecord(input) || (input.join !== "AND" && input.join !== "OR") || !Array.isArray(input.conditions)) {
    ctx.errors.push("filter group: missing or invalid join/conditions");
    return undefined;
  }
  const conditions: Condition[] = [];
  for (const raw of input.conditions) {
    const cond = validateCondition(raw, role, ctx);
    if (cond) conditions.push(cond);
  }
  return { join: input.join, conditions };
}

function validateSort(input: unknown, role: UserRole, ctx: { errors: string[]; unknownFieldKeys: string[] }): ReportSort | undefined {
  if (!isRecord(input) || typeof input.fieldKey !== "string" || (input.direction !== "asc" && input.direction !== "desc")) {
    ctx.errors.push("sort: missing or invalid fieldKey/direction");
    return undefined;
  }
  const where = `sort "${input.fieldKey}"`;
  const field = resolveField(input.fieldKey, role, ctx, where);
  if (!field) return undefined;
  return { fieldKey: input.fieldKey, direction: input.direction };
}

/**
 * Validates an untrusted ReportDefinition-shaped value. Never throws — every failure
 * mode is reported through the returned errors/unknownFieldKeys arrays so callers can
 * 400 (fresh input) or degrade with a banner (a saved report whose fields drifted)
 * rather than crash.
 */
export function validateDefinition(input: unknown, role: UserRole): ValidationResult {
  const errors: string[] = [];
  const unknownFieldKeys: string[] = [];
  const ctx = { errors, unknownFieldKeys };

  if (!isRecord(input)) {
    return { ok: false, errors: ["definition must be an object"], unknownFieldKeys };
  }
  if (input.rootEntity !== "job") {
    errors.push('rootEntity must be "job"');
  }
  if (!Array.isArray(input.columns)) {
    errors.push("columns must be an array");
  }
  if (!Array.isArray(input.filters)) {
    errors.push("filters must be an array");
  }
  if (input.sort !== undefined && !Array.isArray(input.sort)) {
    errors.push("sort must be an array when present");
  }
  if (input.expandRelation !== undefined && typeof input.expandRelation !== "string") {
    errors.push("expandRelation must be a string when present");
  }
  if (errors.length > 0) return { ok: false, errors, unknownFieldKeys };

  const columnsInput = input.columns as unknown[];
  const filtersInput = input.filters as unknown[];
  const sortInput = (input.sort as unknown[] | undefined) ?? [];

  if (columnsInput.length === 0) errors.push("a report needs at least one column");
  if (columnsInput.length > MAX_COLUMNS) errors.push(`too many columns (max ${MAX_COLUMNS})`);

  const conditionCount = filtersInput.reduce(
    (n: number, g) => n + (isRecord(g) && Array.isArray(g.conditions) ? g.conditions.length : 0),
    0
  );
  if (conditionCount > MAX_CONDITIONS) errors.push(`too many conditions (max ${MAX_CONDITIONS})`);

  const columns: ReportColumn[] = [];
  for (const raw of columnsInput) {
    const col = validateColumn(raw, role, ctx);
    if (col) columns.push(col);
  }

  const filters: ConditionGroup[] = [];
  for (const raw of filtersInput) {
    const group = validateFilterGroup(raw, role, ctx);
    if (group) filters.push(group);
  }

  const sort: ReportSort[] = [];
  for (const raw of sortInput) {
    const s = validateSort(raw, role, ctx);
    if (s) sort.push(s);
  }

  let expandRelation: string | undefined;
  if (typeof input.expandRelation === "string") {
    const edge = getEdge(input.expandRelation);
    if (!edge || edge.kind !== "many") {
      errors.push(`expandRelation "${input.expandRelation}" is not a valid many-cardinality relation`);
    } else if (!manyEdgeKeys().includes(input.expandRelation)) {
      // Unreachable given the check above, but keeps the invariant explicit: only
      // graph-declared many edges may ever be expanded.
      errors.push(`expandRelation "${input.expandRelation}" is not expandable`);
    } else {
      expandRelation = input.expandRelation;
    }
  }

  if (errors.length > 0 || unknownFieldKeys.length > 0) {
    return { ok: false, errors, unknownFieldKeys };
  }

  return {
    ok: true,
    definition: { rootEntity: "job", columns, filters, sort: sort.length > 0 ? sort : undefined, expandRelation },
    errors,
    unknownFieldKeys,
  };
}
