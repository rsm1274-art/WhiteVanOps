// Relation graph for the report builder, rooted on Job. Pure module: no I/O, no DB.
//
// This is the single source of truth for join shape and cardinality. The compiler
// (compile.ts, Phase 1) decides LEFT JOIN vs. LEFT JOIN LATERAL ... json_agg purely
// from an edge's `kind` — keeping that declarative here is what makes "no row
// duplication by default" a property of the data model rather than something the
// compiler author has to remember on every branch.
//
// Node names are graph-internal identifiers, not table names — they match
// FieldDef.source.entity in registry.ts.

import type { RelationEdge } from "./types";

export const ROOT = "job" as const;

/**
 * Edges are one hop each, `kind` describing cardinality *relative to their own
 * `from` node* (not the root). A field's cardinality relative to the report root is
 * "many" iff any edge on its path from ROOT is "many" — see `pathCardinality`.
 */
export const EDGES: readonly RelationEdge[] = [
  { key: "client", from: "job", to: "client", kind: "one", localKey: "clientId", foreignKey: "id" },
  { key: "vehicle", from: "job", to: "vehicle", kind: "one", localKey: "assignedVehicleId", foreignKey: "id" },

  { key: "assignments", from: "job", to: "jobAssignment", kind: "many", localKey: "id", foreignKey: "jobId" },
  { key: "personnel", from: "jobAssignment", to: "personnel", kind: "one", localKey: "personnelId", foreignKey: "id" },

  { key: "lineItems", from: "job", to: "jobLineItem", kind: "many", localKey: "id", foreignKey: "jobId" },
  { key: "inventoryItem", from: "jobLineItem", to: "inventoryItem", kind: "one", localKey: "inventoryItemId", foreignKey: "id" },

  { key: "timeEntries", from: "job", to: "timeEntry", kind: "many", localKey: "id", foreignKey: "jobId" },

  { key: "equipmentAssignments", from: "job", to: "jobEquipment", kind: "many", localKey: "id", foreignKey: "jobId" },
  { key: "equipment", from: "jobEquipment", to: "equipment", kind: "one", localKey: "equipmentId", foreignKey: "id" },

  { key: "invoices", from: "job", to: "invoice", kind: "many", localKey: "id", foreignKey: "jobId" },
  { key: "quotes", from: "job", to: "quote", kind: "many", localKey: "id", foreignKey: "jobId" },
];

const EDGES_BY_KEY: ReadonlyMap<string, RelationEdge> = new Map(EDGES.map((e) => [e.key, e]));

export function getEdge(key: string): RelationEdge | undefined {
  return EDGES_BY_KEY.get(key);
}

/** All edge keys whose `kind` is "many" — the only relations eligible for expandRelation. */
export function manyEdgeKeys(): readonly string[] {
  return EDGES.filter((e) => e.kind === "many").map((e) => e.key);
}

/**
 * Walks an edge-key path from ROOT and returns the node it lands on, or undefined if
 * the path is empty, breaks the from/to chain, or names an unknown edge.
 */
export function resolvePath(edgeKeys: readonly string[]): string | undefined {
  let node: string = ROOT;
  for (const key of edgeKeys) {
    const edge = getEdge(key);
    if (!edge || edge.from !== node) return undefined;
    node = edge.to;
  }
  return node;
}

/**
 * Cardinality of a field relative to the report root: "many" iff any edge on the
 * path is "many". An empty path (fields on Job itself) is always "one".
 */
export function pathCardinality(edgeKeys: readonly string[]): "one" | "many" {
  for (const key of edgeKeys) {
    const edge = getEdge(key);
    if (edge?.kind === "many") return "many";
  }
  return "one";
}
