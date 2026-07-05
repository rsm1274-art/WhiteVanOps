// Transactional executor: writes an ImportPlan to the database in
// dependency order. The db parameter is structurally typed so unit tests
// pass a fake and scripts/import/run.ts passes the real PrismaClient.
import { ENTITY_META, type EntityName } from "./mappingSchema";
import { naturalKeyOf, normKey, vehicleStockLocationName } from "./keys";
import type { ImportPlan } from "./pipeline";

interface CreateDelegate {
  create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
}
interface CountDelegate {
  count(): Promise<number>;
}

export interface ImportTx {
  client: CreateDelegate;
  personnel: CreateDelegate;
  personnelQualification: CreateDelegate;
  vehicle: CreateDelegate;
  stockLocation: CreateDelegate;
  equipment: CreateDelegate;
  inventoryItem: CreateDelegate;
  stockLevel: CreateDelegate;
  job: CreateDelegate;
  jobAssignment: CreateDelegate;
  jobEquipment: CreateDelegate;
  jobLineItem: CreateDelegate;
}

export interface ImportDb {
  $transaction<T>(fn: (tx: ImportTx) => Promise<T>): Promise<T>;
  client: CountDelegate;
  personnel: CountDelegate;
  vehicle: CountDelegate;
  equipment: CountDelegate;
  inventoryItem: CountDelegate;
  stockLocation: CountDelegate;
  job: CountDelegate;
}

export interface ImportResult {
  created: Partial<Record<EntityName, number>>;
  jobs: { sourceKey: string; id: string }[];
}

const DELEGATE: Record<EntityName, keyof ImportTx> = {
  Client: "client",
  Personnel: "personnel",
  PersonnelQualification: "personnelQualification",
  Vehicle: "vehicle",
  StockLocation: "stockLocation",
  Equipment: "equipment",
  InventoryItem: "inventoryItem",
  StockLevel: "stockLevel",
  Job: "job",
  JobAssignment: "jobAssignment",
  JobEquipment: "jobEquipment",
  JobLineItem: "jobLineItem",
};

const INSERT_ORDER = (Object.keys(ENTITY_META) as EntityName[]).sort(
  (a, b) => ENTITY_META[a].insertOrder - ENTITY_META[b].insertOrder
);

export async function assertEmptyDatabase(db: ImportDb): Promise<void> {
  const counts = await Promise.all([
    db.client.count(), db.personnel.count(), db.vehicle.count(), db.equipment.count(),
    db.inventoryItem.count(), db.stockLocation.count(), db.job.count(),
  ]);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total > 0) {
    throw new Error(
      `target database is not empty (${total} existing rows) — refusing to import. ` +
        `Wipe-and-retry: npx prisma migrate reset; npx tsx prisma/bootstrap.ts; rerun with --commit.`
    );
  }
}

export async function executeImport(db: ImportDb, plan: ImportPlan): Promise<ImportResult> {
  return db.$transaction(async (tx) => {
    const created: ImportResult["created"] = {};
    const jobs: ImportResult["jobs"] = [];
    const ids = new Map<EntityName, Map<string, string>>();

    const remember = (e: EntityName, key: string | null, id: string) => {
      if (!key) return;
      let m = ids.get(e);
      if (!m) {
        m = new Map();
        ids.set(e, m);
      }
      m.set(key, id);
    };
    const idFor = (e: EntityName, key: string): string => {
      const id = ids.get(e)?.get(normKey(key));
      if (!id) throw new Error(`internal: unresolved ${e} "${key}" reached executeImport`);
      return id;
    };

    for (const entity of INSERT_ORDER) {
      for (const r of plan.entities[entity] ?? []) {
        const data: Record<string, unknown> = {};
        for (const [f, v] of Object.entries(r.data)) {
          data[f] = ENTITY_META[entity].fields[f].kind === "date" ? new Date(String(v)) : v;
        }
        for (const [f, ref] of Object.entries(r.refs)) {
          data[f] = idFor(ref.entity, ref.key);
        }
        const row = await tx[DELEGATE[entity]].create({ data });
        created[entity] = (created[entity] ?? 0) + 1;
        remember(entity, naturalKeyOf(entity, r.data), row.id);
        if (entity === "Job" && r.sourceKey) {
          remember("Job", normKey(r.sourceKey), row.id);
          jobs.push({ sourceKey: r.sourceKey, id: row.id });
        }
        if (entity === "Vehicle") {
          const name = vehicleStockLocationName(String(r.data.model), String(r.data.vin));
          const loc = await tx.stockLocation.create({
            data: { name, type: "Vehicle", vehicleId: row.id },
          });
          created.StockLocation = (created.StockLocation ?? 0) + 1;
          remember("StockLocation", normKey(name), loc.id);
        }
      }
    }
    return { created, jobs };
  });
}
