import { describe, it, expect } from "vitest";
import { buildMappingProposal } from "./detect";
import { validateMappingShape } from "./mappingSchema";
import { buildImportPlan } from "./pipeline";
import { executeImport, type ImportDb, type ImportTx } from "./execute";
import type { SourceTable } from "./readers";

const table = (file: string, headers: string[], rows: string[][]): SourceTable => ({
  file,
  headers,
  rows: rows.map((cells, i) => ({
    rowNum: i + 2,
    values: Object.fromEntries(headers.map((h, c) => [h, cells[c] ?? ""])),
  })),
});

const customers = table("customers.csv", ["Customer", "Contact", "Address", "Terms"], [
  ["Acme Plumbing", "Jane Doe", "12 Main St", "Net 30"],
  ["Beta Electric", "Bob Row", "5 Oak Ave", "Net 15"],
]);
const vehicles = table("vehicles.csv", ["VIN", "Make", "Model", "Status"], [
  ["1FTBR3X89PKA55341", "Ford", "Transit 250", "Active"],
  ["2C4RDGCG0FR509876", "Dodge", "Grand Caravan", "Active"],
]);
const jobs = table("jobs.csv", ["Job #", "Customer", "Vehicle", "Date", "Status", "Notes"], [
  ["1001", "Acme Plumbing", "1FTBR3X89PKA55341", "7/10/2026", "Open", "Backflow test"],
  ["1003", "Acme Plumbing", "1FTBR3X89PKA55341", "7/15/2026", "WIP", "RTU install"],
  ["1002", "Beta Electric", "2C4RDGCG0FR509876", "7/12/2026", "Completed", "Panel swap"],
]);

interface CreatedRow { model: string; data: Record<string, unknown> }

function fakeDb(counts: Partial<Record<string, number>> = {}) {
  const createdRows: CreatedRow[] = [];
  let seq = 0;
  const delegate = (model: string) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createdRows.push({ model, data });
      return { id: `${model}-${++seq}` };
    },
  });
  const counter = (model: string) => ({ count: async () => counts[model] ?? 0 });
  const tx = {
    client: delegate("client"), personnel: delegate("personnel"),
    personnelQualification: delegate("personnelQualification"),
    vehicle: delegate("vehicle"), stockLocation: delegate("stockLocation"),
    equipment: delegate("equipment"), inventoryItem: delegate("inventoryItem"),
    stockLevel: delegate("stockLevel"), job: delegate("job"),
    jobAssignment: delegate("jobAssignment"), jobEquipment: delegate("jobEquipment"),
    jobLineItem: delegate("jobLineItem"),
  } satisfies ImportTx;
  const db: ImportDb = {
    $transaction: async (fn) => fn(tx),
    client: counter("client"), personnel: counter("personnel"), vehicle: counter("vehicle"),
    equipment: counter("equipment"), inventoryItem: counter("inventoryItem"),
    stockLocation: counter("stockLocation"), job: counter("job"),
  };
  return { db, createdRows };
}

describe("end-to-end: detect -> pipeline -> execute", () => {
  it("carries a detected mapping through planning and execution with FK ids wired up", async () => {
    const tables = [customers, vehicles, jobs];
    const { mapping } = buildMappingProposal(tables);

    // Clean fixture data: detection should require no manual edits.
    expect(validateMappingShape(mapping)).toEqual([]);

    const plan = buildImportPlan(mapping, tables);

    // 2 clients, 2 vehicles planned; 3 jobs in the fixture but the
    // "Completed" row (1002) is out of scope and skipped.
    expect(plan.entities.Client).toHaveLength(2);
    expect(plan.entities.Vehicle).toHaveLength(2);
    expect(plan.entities.Job).toHaveLength(2);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skippedJobSourceKeys.has("1002")).toBe(true);

    const { db, createdRows } = fakeDb();
    const result = await executeImport(db, plan);

    expect(result.created).toMatchObject({ Client: 2, Vehicle: 2, Job: 2 });

    const idsOf = (model: string) =>
      new Set(createdRows.map((r, i) => ({ r, i })).filter(({ r }) => r.model === model).map(({ i }) => `${model}-${i + 1}`));
    const clientIds = idsOf("client");
    const vehicleIds = idsOf("vehicle");
    const jobRows = createdRows.filter((r) => r.model === "job").map((r) => r.data);

    expect(jobRows).toHaveLength(2);
    // Both surviving jobs reference Acme Plumbing's client and the Ford
    // Transit — confirm the FK refs from detect's resolveBy round-tripped
    // through buildImportPlan and into executeImport's real fake-DB ids
    // (not left as raw natural-key strings).
    for (const job of jobRows) {
      expect(typeof job.clientId).toBe("string");
      expect(clientIds.has(job.clientId as string)).toBe(true);
      expect(typeof job.assignedVehicleId).toBe("string");
      expect(vehicleIds.has(job.assignedVehicleId as string)).toBe(true);
    }

    expect(result.jobs.map((j) => j.sourceKey).sort()).toEqual(["1001", "1003"]);
  });
});
