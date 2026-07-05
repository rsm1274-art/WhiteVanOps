// In-memory FK resolution over an ImportPlan (fresh-DB import: every
// reference must resolve to another planned record).
import { type EntityName } from "./mappingSchema";
import { naturalKeyOf, normKey, vehicleStockLocationName } from "./keys";
import type { ImportPlan, PlannedRecord } from "./pipeline";

export function resolveReferences(plan: ImportPlan): void {
  const index = new Map<EntityName, Set<string>>();
  const add = (e: EntityName, k: string) => {
    let set = index.get(e);
    if (!set) {
      set = new Set();
      index.set(e, set);
    }
    set.add(k);
  };

  for (const [entity, records] of Object.entries(plan.entities) as [EntityName, PlannedRecord[]][]) {
    for (const r of records) {
      const k = naturalKeyOf(entity, r.data);
      if (k) add(entity, k);
      if (entity === "Vehicle") {
        add("StockLocation", normKey(vehicleStockLocationName(String(r.data.model), String(r.data.vin))));
      }
    }
  }
  const jobKeys = new Set((plan.entities.Job ?? []).map((r) => normKey(r.sourceKey ?? "")));

  for (const [entity, records] of Object.entries(plan.entities) as [EntityName, PlannedRecord[]][]) {
    const kept: PlannedRecord[] = [];
    for (const r of records) {
      let verdict: "ok" | "skip" | "reject" = "ok";
      let reason = "";
      for (const [field, ref] of Object.entries(r.refs)) {
        const k = normKey(ref.key);
        if (ref.entity === "Job") {
          if (jobKeys.has(k)) continue;
          if (plan.skippedJobSourceKeys.has(k)) {
            verdict = "skip";
            reason = `parent job "${ref.key}" is out of scope`;
          } else {
            verdict = "reject";
            reason = `unknown job reference "${ref.key}"`;
          }
          break;
        }
        if (!index.get(ref.entity)?.has(k)) {
          verdict = "reject";
          reason = `${field}: no ${ref.entity} matching "${ref.key}"`;
          break;
        }
      }
      if (verdict === "ok") kept.push(r);
      else (verdict === "skip" ? plan.skipped : plan.rejected).push({ ...r.source, entity, reason });
    }
    plan.entities[entity] = kept;
  }
}
