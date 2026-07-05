import { describe, it, expect } from "vitest";
import { assertEmptyDatabase, executeImport, type ImportDb, type ImportTx } from "./execute";
import type { ImportPlan, PlannedRecord } from "./pipeline";
import type { EntityName } from "./mappingSchema";

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

const rec = (entity: EntityName, over: Partial<PlannedRecord> = {}): PlannedRecord => ({
  entity, data: {}, refs: {}, source: { file: "f.csv", row: 2 }, ...over,
});

const plan = (): ImportPlan => ({
  entities: {
    Job: [rec("Job", {
      data: { status: "Scheduled", scheduledDate: "2026-07-10", notes: "n" },
      refs: { clientId: { entity: "Client", key: "ACME plumbing" }, assignedVehicleId: { entity: "Vehicle", key: "1FTBR3X89PKA55341" } },
      sourceKey: "1001",
    })],
    Client: [rec("Client", { data: { name: "Acme Plumbing", contactName: "J", locationAddress: "A", paymentTerms: "Net 30" } })],
    Vehicle: [rec("Vehicle", { data: { vin: "1FTBR3X89PKA55341", make: "Ford", model: "Transit 250", status: "Active" } })],
    JobAssignment: [rec("JobAssignment", {
      refs: { jobId: { entity: "Job", key: "1001" }, personnelId: { entity: "Personnel", key: "jane doe" } },
    })],
    Personnel: [rec("Personnel", { data: { firstName: "Jane", lastName: "Doe", role: "Technician" } })],
    StockLevel: [rec("StockLevel", {
      data: { quantity: 3, minThreshold: 1 },
      refs: {
        inventoryItemId: { entity: "InventoryItem", key: "Widget" },
        stockLocationId: { entity: "StockLocation", key: "Van Transit 250 (1FTB) Stock" },
      },
    })],
    InventoryItem: [rec("InventoryItem", { data: { name: "Widget", category: "A", subCategory: "B", defaultRate: 5 } })],
  },
  rejected: [], skipped: [], skippedJobSourceKeys: new Set(), summary: {},
});

describe("assertEmptyDatabase", () => {
  it("passes on an empty database", async () => {
    await expect(assertEmptyDatabase(fakeDb().db)).resolves.toBeUndefined();
  });
  it("throws when any imported table has rows", async () => {
    await expect(assertEmptyDatabase(fakeDb({ job: 3 }).db)).rejects.toThrow(/not empty/);
  });
});

describe("executeImport", () => {
  it("inserts in dependency order inside one transaction", async () => {
    const { db, createdRows } = fakeDb();
    await executeImport(db, plan());
    const order = createdRows.map((r) => r.model);
    expect(order.indexOf("client")).toBeLessThan(order.indexOf("job"));
    expect(order.indexOf("vehicle")).toBeLessThan(order.indexOf("stockLevel"));
    expect(order.indexOf("job")).toBeLessThan(order.indexOf("jobAssignment"));
  });

  it("wires refs to created ids, converts dates, auto-creates vehicle stock locations", async () => {
    const { db, createdRows } = fakeDb();
    const result = await executeImport(db, plan());
    const idOf = (model: string) => `${model}-${createdRows.findIndex((r) => r.model === model) + 1}`;
    const job = createdRows.find((r) => r.model === "job")!.data;
    expect(job.clientId).toBe(idOf("client"));
    expect(job.assignedVehicleId).toBe(idOf("vehicle"));
    expect(job.scheduledDate).toEqual(new Date("2026-07-10"));
    const autoLoc = createdRows.find((r) => r.model === "stockLocation")!;
    expect(autoLoc.data).toMatchObject({ name: "Van Transit 250 (1FTB) Stock", type: "Vehicle" });
    const locId = idOf("stockLocation");
    const level = createdRows.find((r) => r.model === "stockLevel")!.data;
    expect(level.stockLocationId).toBe(locId);
    expect(result.created).toMatchObject({ Client: 1, Vehicle: 1, StockLocation: 1, Job: 1, JobAssignment: 1, StockLevel: 1 });
    expect(result.jobs).toEqual([{ sourceKey: "1001", id: expect.stringMatching(/^job-/) }]);
    expect(createdRows.find((r) => r.model === "client")!.data.name).toBe("Acme Plumbing");
  });

  it("throws on an unresolved ref reaching execute (internal error)", async () => {
    const p = plan();
    p.entities.Job![0].refs.clientId = { entity: "Client", key: "Ghost" };
    await expect(executeImport(fakeDb().db, p)).rejects.toThrow(/internal: unresolved Client "Ghost"/);
  });
});
