// Compiles a validated ReportDefinition into a parameterized SQL query. This
// is the report builder's correctness core (plan: "Risk: High") — read the
// module-level comments carefully before changing anything here.
//
// Safety model: every SQL *identifier* (table, column, alias) originates
// from registry.ts / graph.ts / dbTypes.ts — fixed, server-controlled
// constants — and is always emitted through `sql.ref`/`sql.table`, which
// quote and escape it. Every *value* (a condition's comparison value, a
// LIMIT/OFFSET number, even a json key derived from a registry field key) is
// interpolated into the `sql` template tag as a plain JS value, which Kysely
// automatically parameter-binds — it never becomes literal SQL text.
// Nothing in a ReportDefinition (untrusted client input, even after
// validateDefinition) is ever string-concatenated into the query.
//
// Row-shape model: the root is always exactly one row per Job. A `many`
// relation (personnel, line items, time entries, equipment, invoices,
// quotes) is folded into the root row via `LEFT JOIN LATERAL ... json_agg`,
// so selecting a many-valued field never multiplies the Job row count.
// `expandRelation` is the one opt-in exception: it turns exactly one many
// relation into a plain join (one row per child) while every other many
// relation stays aggregated. A condition on a many-valued field is compiled
// as `WHERE EXISTS (...)` against that relation's own table — never as a
// predicate on the LATERAL's joined columns, which would silently filter
// which children appear in the aggregate rather than which jobs match.

import { sql } from "kysely";
import { reportsDb } from "./kysely";
import { ENTITY_TABLE } from "./dbTypes";
import { getField } from "./registry";
import { getEdge } from "./graph";
import type { Aggregation, CompiledReport, Condition, FieldDef, Operator, ReportDefinition } from "./types";

type Frag = ReturnType<typeof sql>;

export interface CompileOptions {
  limit: number;
  offset: number;
}

/** sql.ref quotes each dot-separated part, so "alias.column" -> "alias"."column". */
function ref(alias: string, column: string): Frag {
  return sql.ref(`${alias}.${column}`);
}

function tableFor(entity: string): Frag {
  const table = ENTITY_TABLE[entity];
  if (!table) throw new Error(`compileReport: unknown entity "${entity}" (registry/dbTypes drift)`);
  return sql.ref(table);
}

/** The relation-group edge key a field's path belongs to, or undefined for a root/one-hop field. */
function manyGroupKey(field: FieldDef): string | undefined {
  if (field.cardinality !== "many") return undefined;
  return field.path.edges[0];
}

interface ResolvedField {
  /** Alias of the table (or lateral) that carries this column. */
  alias: string;
  /** Set when this field lives inside a LATERAL's json_agg rather than a plain joined table. */
  isAggregated: boolean;
}

interface ExpandedAliases {
  child: string;
  grandchild?: string;
}

/**
 * Accumulates the joins a report needs as fields are resolved, and hands
 * back the alias each field's column lives under. One instance per compile.
 */
class QueryBuilder {
  private readonly joins: Frag[] = [];
  private readonly oneHopAliases = new Map<string, string>(); // edge key -> alias
  private readonly aggGroupAliases = new Map<string, string>(); // edge key -> lateral alias
  private readonly expandedAliases = new Map<string, ExpandedAliases>(); // edge key -> aliases
  private existsCounter = 0;

  constructor(private readonly expandRelation: string | undefined) {}

  resolveForSelect(field: FieldDef): ResolvedField {
    if (field.path.edges.length === 0) return { alias: "job", isAggregated: false };

    const groupKey = manyGroupKey(field);
    if (groupKey === undefined) {
      return { alias: this.ensureOneHopJoin(field.path.edges[0]), isAggregated: false };
    }
    if (groupKey === this.expandRelation) {
      const edges = field.path.edges;
      const alias = edges.length === 2 ? this.ensureExpandedGrandchild(groupKey, edges[1]) : this.ensureExpandedChild(groupKey);
      return { alias, isAggregated: false };
    }
    const aggAlias = this.aggGroupAliases.get(groupKey);
    if (!aggAlias) {
      throw new Error(`compileReport: lateral for group "${groupKey}" was not pre-built (internal error)`);
    }
    return { alias: aggAlias, isAggregated: true };
  }

  private ensureOneHopJoin(edgeKey: string): string {
    const existing = this.oneHopAliases.get(edgeKey);
    if (existing) return existing;
    const edge = getEdge(edgeKey);
    if (!edge) throw new Error(`compileReport: unknown edge "${edgeKey}"`);
    const alias = edgeKey;
    this.joins.push(
      sql`LEFT JOIN ${tableFor(edge.to)} AS ${sql.ref(alias)} ON ${ref(alias, edge.foreignKey)} = ${ref("job", edge.localKey)}`
    );
    this.oneHopAliases.set(edgeKey, alias);
    return alias;
  }

  /** Ensures the (row-multiplying) plain join for the expanded relation's first hop. */
  ensureExpandedChild(groupKey: string): string {
    const existing = this.expandedAliases.get(groupKey);
    if (existing) return existing.child;
    const edge = getEdge(groupKey);
    if (!edge) throw new Error(`compileReport: unknown edge "${groupKey}"`);
    const alias = groupKey;
    this.joins.push(
      sql`LEFT JOIN ${tableFor(edge.to)} AS ${sql.ref(alias)} ON ${ref(alias, edge.foreignKey)} = ${ref("job", edge.localKey)}`
    );
    this.expandedAliases.set(groupKey, { child: alias });
    return alias;
  }

  private ensureExpandedGrandchild(groupKey: string, hop2Key: string): string {
    const existing = this.expandedAliases.get(groupKey);
    if (existing?.grandchild) return existing.grandchild;
    const child = this.ensureExpandedChild(groupKey);
    const hop2 = getEdge(hop2Key);
    if (!hop2) throw new Error(`compileReport: unknown edge "${hop2Key}"`);
    const alias = hop2Key;
    this.joins.push(
      sql`LEFT JOIN ${tableFor(hop2.to)} AS ${sql.ref(alias)} ON ${ref(alias, hop2.foreignKey)} = ${ref(child, hop2.localKey)}`
    );
    this.expandedAliases.set(groupKey, { child, grandchild: alias });
    return alias;
  }

  /** Builds the shared json_agg LATERAL for a many group, once, carrying every field it needs. */
  buildAggLateral(groupKey: string, edges: readonly string[], fieldsInGroup: readonly FieldDef[]): void {
    if (this.aggGroupAliases.has(groupKey)) return;
    const rootEdge = getEdge(edges[0]);
    if (!rootEdge) throw new Error(`compileReport: unknown edge "${edges[0]}"`);

    const childAlias = "c";
    const grandchildAlias = "cg";
    const hasHop2 = edges.length === 2;
    const hop2 = hasHop2 ? getEdge(edges[1]) : undefined;
    if (hasHop2 && !hop2) throw new Error(`compileReport: unknown edge "${edges[1]}"`);

    const objectPairs: Frag[] = [];
    for (const f of fieldsInGroup) {
      const colAlias = f.path.edges.length === 2 ? grandchildAlias : childAlias;
      objectPairs.push(sql`${f.key}, ${ref(colAlias, f.source.column)}`);
    }

    const lateralFrom = hasHop2
      ? sql`FROM ${tableFor(rootEdge.to)} AS ${sql.ref(childAlias)} LEFT JOIN ${tableFor(hop2!.to)} AS ${sql.ref(grandchildAlias)} ON ${ref(grandchildAlias, hop2!.foreignKey)} = ${ref(childAlias, hop2!.localKey)}`
      : sql`FROM ${tableFor(rootEdge.to)} AS ${sql.ref(childAlias)}`;

    const groupAlias = `${groupKey}_agg`;
    this.joins.push(
      sql`LEFT JOIN LATERAL (SELECT json_agg(jsonb_build_object(${sql.join(objectPairs)})) AS agg ${lateralFrom} WHERE ${ref(childAlias, rootEdge.foreignKey)} = ${ref("job", rootEdge.localKey)}) AS ${sql.ref(groupAlias)} ON true`
    );
    this.aggGroupAliases.set(groupKey, groupAlias);
  }

  nextExistsAlias(): string {
    this.existsCounter += 1;
    return `ex${this.existsCounter}`;
  }

  getJoins(): readonly Frag[] {
    return this.joins;
  }
}

function scalarSqlValue(field: FieldDef, value: unknown): unknown {
  if (field.type === "date" && typeof value === "string") return new Date(value);
  return value;
}

function comparison(alias: string, field: FieldDef, operator: Operator, value: unknown): Frag {
  const column = ref(alias, field.source.column);
  switch (operator) {
    case "eq":
      return sql`${column} = ${scalarSqlValue(field, value)}`;
    case "neq":
      return sql`${column} != ${scalarSqlValue(field, value)}`;
    case "contains":
      return sql`${column} ILIKE ${`%${String(value)}%`}`;
    case "gt":
      return sql`${column} > ${scalarSqlValue(field, value)}`;
    case "gte":
      return sql`${column} >= ${scalarSqlValue(field, value)}`;
    case "lt":
      return sql`${column} < ${scalarSqlValue(field, value)}`;
    case "lte":
      return sql`${column} <= ${scalarSqlValue(field, value)}`;
    case "isNull":
      return sql`${column} IS NULL`;
    case "isNotNull":
      return sql`${column} IS NOT NULL`;
    case "in": {
      const values = (value as (string | number)[]).map((v) => scalarSqlValue(field, v));
      return sql`${column} IN (${sql.join(values)})`;
    }
    case "between": {
      const [lo, hi] = (value as (string | number)[]).map((v) => scalarSqlValue(field, v));
      return sql`${column} BETWEEN ${lo} AND ${hi}`;
    }
    /* istanbul ignore next -- exhaustiveness guard; every Operator is handled above */
    default: {
      const exhaustive: never = operator;
      throw new Error(`compileReport: unhandled operator "${exhaustive as string}"`);
    }
  }
}

/** One-valued (cardinality "one") field condition: a plain predicate on its already-joined alias. */
function oneFieldPredicate(qb: QueryBuilder, condition: Condition, field: FieldDef): Frag {
  const resolved = qb.resolveForSelect(field);
  return comparison(resolved.alias, field, condition.operator, condition.value);
}

/**
 * Many-valued field condition: an EXISTS subquery against the relation's own
 * table, scoped to this job — never a predicate against the LATERAL's
 * aggregated columns, which would filter the aggregate's contents instead of
 * the job set.
 */
function manyFieldPredicate(qb: QueryBuilder, condition: Condition, field: FieldDef): Frag {
  const edges = field.path.edges;
  const rootEdge = getEdge(edges[0]);
  if (!rootEdge) throw new Error(`compileReport: unknown edge "${edges[0]}"`);
  const alias = qb.nextExistsAlias();
  const hasHop2 = edges.length === 2;
  const hop2 = hasHop2 ? getEdge(edges[1]) : undefined;
  const grandAlias = `${alias}g`;

  const from = hasHop2
    ? sql`FROM ${tableFor(rootEdge.to)} AS ${sql.ref(alias)} INNER JOIN ${tableFor(hop2!.to)} AS ${sql.ref(grandAlias)} ON ${ref(grandAlias, hop2!.foreignKey)} = ${ref(alias, hop2!.localKey)}`
    : sql`FROM ${tableFor(rootEdge.to)} AS ${sql.ref(alias)}`;

  const colAlias = hasHop2 ? grandAlias : alias;
  const predicate = comparison(colAlias, field, condition.operator, condition.value);

  return sql`EXISTS (SELECT 1 ${from} WHERE ${ref(alias, rootEdge.foreignKey)} = ${ref("job", rootEdge.localKey)} AND ${predicate})`;
}

function conditionPredicate(qb: QueryBuilder, condition: Condition): Frag {
  const field = getField(condition.fieldKey);
  if (!field) throw new Error(`compileReport: unknown field "${condition.fieldKey}" (should have failed validation)`);
  return field.cardinality === "many" ? manyFieldPredicate(qb, condition, field) : oneFieldPredicate(qb, condition, field);
}

/** SQL for a many-valued column's aggregation, reading out of its group's json_agg array. */
function aggregatedSelect(field: FieldDef, aggAlias: string, aggregation: Aggregation): Frag {
  const elements = sql`jsonb_array_elements(coalesce(${sql.ref(aggAlias)}.agg, '[]'::jsonb)) elem`;
  const extracted = sql`(elem ->> ${field.key})`;
  switch (aggregation) {
    case "count":
      return sql`(SELECT count(${extracted}) FROM ${elements})`;
    case "list":
      return sql`(SELECT array_agg(${extracted}) FROM ${elements})`;
    case "sum":
      return sql`(SELECT sum((${extracted})::numeric) FROM ${elements})`;
    case "min":
      return sql`(SELECT min((${extracted})::numeric) FROM ${elements})`;
    case "max":
      return sql`(SELECT max((${extracted})::numeric) FROM ${elements})`;
    /* istanbul ignore next -- exhaustiveness guard; every Aggregation is handled above */
    default: {
      const exhaustive: never = aggregation;
      throw new Error(`compileReport: unhandled aggregation "${exhaustive as string}"`);
    }
  }
}

/** Every field, across columns/filters/sort, that a many-group's LATERAL must carry. */
function fieldsByGroup(def: ReportDefinition): Map<string, FieldDef[]> {
  const byGroup = new Map<string, Map<string, FieldDef>>();
  const add = (field: FieldDef | undefined) => {
    if (!field) return;
    const groupKey = manyGroupKey(field);
    if (groupKey === undefined || groupKey === def.expandRelation) return;
    let m = byGroup.get(groupKey);
    if (!m) {
      m = new Map();
      byGroup.set(groupKey, m);
    }
    m.set(field.key, field);
  };
  for (const col of def.columns) add(getField(col.fieldKey));
  for (const group of def.filters) for (const cond of group.conditions) add(getField(cond.fieldKey));
  for (const s of def.sort ?? []) add(getField(s.fieldKey));

  const result = new Map<string, FieldDef[]>();
  for (const [k, m] of byGroup) result.set(k, [...m.values()]);
  return result;
}

/**
 * Builds the shared FROM/JOIN/WHERE scaffold for a definition: every
 * many-group LATERAL, the expanded relation's join (if any), and the WHERE
 * predicates. Used by both `compileReport` (adds SELECT/ORDER/LIMIT) and
 * `compileReportCount` (wraps in `count(*)`), so the row set the two agree
 * on can never drift apart.
 */
function prepareQuery(def: ReportDefinition): { qb: QueryBuilder; wherePredicates: Frag[] } {
  const qb = new QueryBuilder(def.expandRelation);

  // Pre-build every many-group's LATERAL before resolving individual fields,
  // so each group gets exactly one shared json_agg carrying every field it
  // needs, rather than rebuilding it per-field.
  for (const [groupKey, fields] of fieldsByGroup(def)) {
    qb.buildAggLateral(groupKey, fields[0].path.edges, fields);
  }

  // expandRelation may control row shape alone, with no column/filter
  // naming a field on it (see ReportDefinition.expandRelation's doc
  // comment) — force its join to exist even in that case.
  if (def.expandRelation) qb.ensureExpandedChild(def.expandRelation);

  const wherePredicates: Frag[] = [];
  for (const group of def.filters) {
    if (group.conditions.length === 0) continue;
    const parts = group.conditions.map((c) => conditionPredicate(qb, c));
    wherePredicates.push(sql`(${sql.join(parts, sql.raw(` ${group.join} `))})`);
  }

  return { qb, wherePredicates };
}

function withJoinsAndWhere(base: Frag, qb: QueryBuilder, wherePredicates: Frag[]): Frag {
  let query = base;
  const joins = qb.getJoins();
  if (joins.length > 0) query = sql`${query} ${sql.join(joins, sql.raw(" "))}`;
  if (wherePredicates.length > 0) query = sql`${query} WHERE ${sql.join(wherePredicates, sql.raw(" AND "))}`;
  return query;
}

/**
 * Builds the row query as a raw Kysely fragment (not yet compiled/executed).
 * `def` MUST already be the output of validateDefinition.
 */
function buildRowQuery(def: ReportDefinition, opts: CompileOptions): Frag {
  const { qb, wherePredicates } = prepareQuery(def);

  function exprFor(fieldKey: string, aggregation: Aggregation | undefined): Frag {
    const field = getField(fieldKey);
    if (!field) throw new Error(`compileReport: unknown field "${fieldKey}" (should have failed validation)`);
    const resolved = qb.resolveForSelect(field);
    if (resolved.isAggregated) {
      // A resolved-aggregated field's alias only ever exposes a single
      // `agg` jsonb column (built by buildAggLateral) — there is no raw
      // per-row column to fall back to, so an aggregation is mandatory here
      // even when the caller (ORDER BY on an unselected field) didn't name
      // one. "list" is a safe default: valid for every field type, unlike
      // sum/min/max which only apply to numbers.
      return aggregatedSelect(field, resolved.alias, aggregation ?? "list");
    }
    return ref(resolved.alias, field.source.column);
  }

  const selectItems: Frag[] = [];
  for (const col of def.columns) {
    // sql.id (not sql.ref): fieldKey is a single identifier that happens to
    // contain a literal "." (e.g. "job.status") — sql.ref would split on
    // that dot and treat it as a qualified table.column reference instead.
    selectItems.push(sql`${exprFor(col.fieldKey, col.aggregation)} AS ${sql.id(col.fieldKey)}`);
  }

  // ORDER BY re-derives the same expression rather than referencing the
  // output alias: Postgres only lets ORDER BY reference a SELECT-list alias
  // when that alias is actually present, and def.sort is not required to
  // name only fields that also appear in def.columns.
  const orderItems: Frag[] = [];
  for (const s of def.sort ?? []) {
    const col = def.columns.find((c) => c.fieldKey === s.fieldKey);
    orderItems.push(sql`${exprFor(s.fieldKey, col?.aggregation)} ${sql.raw(s.direction === "desc" ? "DESC" : "ASC")}`);
  }

  let query = withJoinsAndWhere(sql`SELECT ${sql.join(selectItems)} FROM ${tableFor("job")} AS ${sql.ref("job")}`, qb, wherePredicates);
  if (orderItems.length > 0) query = sql`${query} ORDER BY ${sql.join(orderItems)}`;
  query = sql`${query} LIMIT ${opts.limit} OFFSET ${opts.offset}`;
  return query;
}

/** Builds the matching `count(*)` query as a raw Kysely fragment. */
function buildCountQuery(def: ReportDefinition): Frag {
  const { qb, wherePredicates } = prepareQuery(def);
  return withJoinsAndWhere(sql`SELECT count(*) AS count FROM ${tableFor("job")} AS ${sql.ref("job")}`, qb, wherePredicates);
}

/**
 * Compiles a validated ReportDefinition into a parameterized query
 * description ({ sql, parameters }) for inspection/testing. `def` MUST
 * already be the output of validateDefinition — this function trusts field
 * keys/operators/value shapes are legal and does not re-derive that from
 * raw input.
 */
export function compileReport(def: ReportDefinition, opts: CompileOptions): CompiledReport {
  const compiled = buildRowQuery(def, opts).compile(reportsDb);
  return { sql: compiled.sql, parameters: compiled.parameters, columns: def.columns };
}

/**
 * Compiles the matching `count(*)` query for `def` (no SELECT list, no
 * ORDER BY, no LIMIT/OFFSET) — same FROM/JOIN/WHERE scaffold as
 * `compileReport`, so `runReport`'s `totalRows` always describes the exact
 * same row set the paged query returns from.
 */
export function compileReportCount(def: ReportDefinition): { sql: string; parameters: readonly unknown[] } {
  const compiled = buildCountQuery(def).compile(reportsDb);
  return { sql: compiled.sql, parameters: compiled.parameters };
}

/**
 * Internal, execution-ready variants for run.ts: return the raw Kysely
 * fragment itself (rather than a pre-compiled {sql, parameters} string pair)
 * so the executor can call `.execute(trx)` directly instead of re-parsing
 * SQL text and losing its bound parameters in the process.
 */
export const _executable = {
  rowQuery: buildRowQuery,
  countQuery: buildCountQuery,
};
