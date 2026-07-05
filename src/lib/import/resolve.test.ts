import { describe, it, expect } from "vitest";
import { resolveReferences } from "./resolve";
import type { ImportPlan, PlannedRecord } from "./pipeline";
import type { EntityName } from "./mappingSchema";

const rec = (entity: EntityName, over: Partial<PlannedRecord> = {}): PlannedRecord => ({
  entity,
  data: {},
  refs: {},
  source: { file: "f.csv", row: 2 },
  ...over,
});

const emptyPlan = (): ImportPlan => ({
  entities: {},
  rejected: [],
  skipped: [],
  skippedJobSourceKeys: new Set(),
  summary: {},
});

describe("resolveReferences", () => {
  it("keeps records whose refs match planned natural keys (case-insensitive)", () => {
    const plan = emptyPlan();
    plan.entities.Client = [rec("Client", { data: { name: "Acme Plumbing" } })];
    plan.entities.Job = [
      rec("Job", {
        data: { status: "Scheduled", scheduledDate: "2026-07-10" },
        refs: { clientId: { entity: "Client", key: "ACME plumbing" } },
        sourceKey: "1001",
      }),
    ];
    resolveReferences(plan);
    expect(plan.entities.Job).toHaveLength(1);
    expect(plan.rejected).toEqual([]);
  });

  it("rejects records with dangling refs", () => {
    const plan = emptyPlan();
    plan.entities.Job = [
      rec("Job", { data: { status: "Scheduled" }, refs: { clientId: { entity: "Client", key: "Ghost Co" } }, sourceKey: "9" }),
    ];
    resolveReferences(plan);
    expect(plan.entities.Job).toEqual([]);
    expect(plan.rejected[0].reason).toMatch(/no Client matching "Ghost Co"/);
  });

  it("skips children of out-of-scope jobs but rejects children of unknown jobs", () => {
    const plan = emptyPlan();
    plan.skippedJobSourceKeys.add("1002");
    plan.entities.Personnel = [rec("Personnel", { data: { firstName: "Jane", lastName: "Doe" } })];
    plan.entities.JobAssignment = [
      rec("JobAssignment", { refs: { jobId: { entity: "Job", key: "1002" }, personnelId: { entity: "Personnel", key: "Jane Doe" } } }),
      rec("JobAssignment", { refs: { jobId: { entity: "Job", key: "777" }, personnelId: { entity: "Personnel", key: "Jane Doe" } } }),
    ];
    resolveReferences(plan);
    expect(plan.entities.JobAssignment).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/out of scope/);
    expect(plan.rejected[0].reason).toMatch(/unknown job reference "777"/);
  });

  it("resolves StockLevel refs against auto-created vehicle stock location names", () => {
    const plan = emptyPlan();
    plan.entities.Vehicle = [rec("Vehicle", { data: { vin: "1FTBR3X89PKA55341", make: "Ford", model: "Transit 250", status: "Active" } })];
    plan.entities.InventoryItem = [rec("InventoryItem", { data: { name: "Widget", category: "A", subCategory: "B", defaultRate: 5 } })];
    plan.entities.StockLevel = [
      rec("StockLevel", {
        data: { quantity: 3, minThreshold: 1 },
        refs: {
          inventoryItemId: { entity: "InventoryItem", key: "Widget" },
          stockLocationId: { entity: "StockLocation", key: "Van Transit 250 (1FTB) Stock" },
        },
      }),
    ];
    resolveReferences(plan);
    expect(plan.entities.StockLevel).toHaveLength(1);
    expect(plan.rejected).toEqual([]);
  });
});
