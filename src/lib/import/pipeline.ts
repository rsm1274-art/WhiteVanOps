// Deterministic mapping execution: SourceTables + Mapping -> ImportPlan.
// Row problems are collected, never thrown. Assumes the mapping passed
// validateMappingShape and validateMappingAgainstTables.
import type { SourceRow, SourceTable } from "./readers";
import {
  ENTITY_META, JOB_IMPORT_STATUSES, findTable,
  type EntityName, type FieldMeta, type FileMapping, type Mapping,
} from "./mappingSchema";
import { applyTransform, applyValueMap, collapseWhitespace } from "./transforms";
import { normKey } from "./keys";
import { resolveReferences } from "./resolve";

export interface RowIssue {
  file: string;
  row: number;
  entity: EntityName;
  reason: string;
}

export interface PlannedRecord {
  entity: EntityName;
  data: Record<string, string | number>;
  refs: Record<string, { entity: EntityName; key: string }>;
  source: { file: string; row: number };
  sourceKey?: string;
}

export interface ImportPlan {
  entities: Partial<Record<EntityName, PlannedRecord[]>>;
  rejected: RowIssue[];
  skipped: RowIssue[];
  skippedJobSourceKeys: Set<string>;
  summary: Record<string, { planned: number; rejected: number; skipped: number }>;
}

export function buildImportPlan(mapping: Mapping, tables: SourceTable[]): ImportPlan {
  const plan: ImportPlan = {
    entities: {},
    rejected: [],
    skipped: [],
    skippedJobSourceKeys: new Set(),
    summary: {},
  };
  const seenKeys = new Map<EntityName, Set<string>>();
  const ordered = [...mapping.files].sort(
    (a, b) => ENTITY_META[a.entity].insertOrder - ENTITY_META[b.entity].insertOrder
  );
  for (const fm of ordered) {
    const table = findTable(tables, fm)!;
    for (const row of table.rows) {
      const rec = buildRecord(fm, row, mapping, plan);
      if (!rec) continue;
      const key = dupKey(rec);
      if (key !== null) {
        let set = seenKeys.get(fm.entity);
        if (!set) {
          set = new Set();
          seenKeys.set(fm.entity, set);
        }
        if (set.has(key)) {
          plan.rejected.push({ ...rec.source, entity: fm.entity, reason: `duplicate ${fm.entity} key "${key}"` });
          continue;
        }
        set.add(key);
      }
      (plan.entities[fm.entity] ??= []).push(rec);
    }
  }
  resolveReferences(plan);
  computeSummary(plan, mapping);
  return plan;
}

function buildRecord(fm: FileMapping, row: SourceRow, mapping: Mapping, plan: ImportPlan): PlannedRecord | null {
  const entity = fm.entity;
  const meta = ENTITY_META[entity];
  const source = { file: fm.file, row: row.rowNum };
  const data: PlannedRecord["data"] = {};
  const refs: PlannedRecord["refs"] = {};
  const problems: string[] = [];
  const covered = new Set<string>();
  let sourceKey: string | undefined;

  for (const [header, cm] of Object.entries(fm.columns)) {
    const raw = collapseWhitespace(row.values[header] ?? "");
    if (cm.role === "sourceKey") {
      sourceKey = raw;
      if (!raw) problems.push(`empty sourceKey ("${header}")`);
      continue;
    }
    const field = cm.field!;
    const f = meta.fields[field];
    covered.add(field);
    let v = raw;
    if (v !== "" && cm.transform) {
      const r = applyTransform(cm.transform, v);
      if (!r.ok) {
        problems.push(`${field}: ${r.reason}`);
        continue;
      }
      v = r.value;
    }
    v = applyValueMap(mapping.valueMaps, `${entity}.${field}`, v);
    if (v === "") {
      const d = fm.defaults?.[field];
      if (d !== undefined) v = d;
      else if (f.required) {
        problems.push(`missing required ${field}`);
        continue;
      } else continue;
    }
    place(v, f, field, data, refs, problems);
  }

  for (const [field, d] of Object.entries(fm.defaults ?? {})) {
    if (covered.has(field)) continue;
    place(d, meta.fields[field], field, data, refs, problems);
  }

  if (problems.length > 0) {
    plan.rejected.push({ ...source, entity, reason: problems.join("; ") });
    return null;
  }
  if (entity === "Job" && !JOB_IMPORT_STATUSES.includes(String(data.status))) {
    plan.skipped.push({ ...source, entity, reason: `out of scope: status "${data.status}"` });
    if (sourceKey) plan.skippedJobSourceKeys.add(normKey(sourceKey));
    return null;
  }
  return { entity, data, refs, source, ...(sourceKey !== undefined ? { sourceKey } : {}) };
}

function place(
  v: string,
  f: FieldMeta,
  field: string,
  data: PlannedRecord["data"],
  refs: PlannedRecord["refs"],
  problems: string[]
): void {
  const coerced = coerce(v, f, field, problems);
  if (coerced === undefined) return;
  if (f.resolvesTo) refs[field] = { entity: f.resolvesTo, key: String(coerced) };
  else data[field] = coerced;
}

function coerce(v: string, f: FieldMeta, field: string, problems: string[]): string | number | undefined {
  switch (f.kind) {
    case "string":
      return v;
    case "enum":
      if (!f.enumValues!.includes(v)) {
        problems.push(`${field}: "${v}" is not one of ${f.enumValues!.join(", ")} (add a valueMaps entry)`);
        return undefined;
      }
      return v;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        problems.push(`${field}: "${v}" is not YYYY-MM-DD (add a date transform)`);
        return undefined;
      }
      return v;
    case "int": {
      const n = Number(v);
      if (!Number.isInteger(n)) {
        problems.push(`${field}: "${v}" is not a whole number`);
        return undefined;
      }
      return n;
    }
    case "float": {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        problems.push(`${field}: "${v}" is not a number`);
        return undefined;
      }
      return n;
    }
  }
}

function dupKey(rec: PlannedRecord): string | null {
  const nk = ENTITY_META[rec.entity].naturalKey;
  if (nk) return normKey(nk.map((f) => String(rec.data[f] ?? rec.refs[f]?.key ?? "")).join(" "));
  if (rec.entity === "Job") return rec.sourceKey ? `job:${normKey(rec.sourceKey)}` : null;
  if (rec.entity === "JobAssignment" || rec.entity === "JobEquipment") {
    return Object.values(rec.refs).map((r) => normKey(r.key)).join("|");
  }
  return null; // JobLineItem / PersonnelQualification have no unique constraint
}

function computeSummary(plan: ImportPlan, mapping: Mapping): void {
  for (const entity of new Set(mapping.files.map((f) => f.entity))) {
    plan.summary[entity] = {
      planned: plan.entities[entity]?.length ?? 0,
      rejected: plan.rejected.filter((r) => r.entity === entity).length,
      skipped: plan.skipped.filter((r) => r.entity === entity).length,
    };
  }
}
