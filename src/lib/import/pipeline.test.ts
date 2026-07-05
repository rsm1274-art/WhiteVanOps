import { describe, it, expect } from "vitest";
import { buildImportPlan } from "./pipeline";
import type { Mapping } from "./mappingSchema";
import type { SourceTable } from "./readers";

const table = (file: string, headers: string[], rows: string[][]): SourceTable => ({
  file,
  headers,
  rows: rows.map((cells, i) => ({
    rowNum: i + 2,
    values: Object.fromEntries(headers.map((h, c) => [h, cells[c] ?? ""])),
  })),
});

const mapping: Mapping = {
  version: 1,
  files: [
    {
      file: "customers.csv", entity: "Client", headerRow: 1,
      columns: {
        Customer: { field: "name" },
        Contact: { field: "contactName" },
        Address: { field: "locationAddress" },
      },
      defaults: { paymentTerms: "Net 30" },
      unmapped: [], unresolved: [],
    },
    {
      file: "jobs.csv", entity: "Job", headerRow: 1,
      columns: {
        "Job #": { role: "sourceKey" },
        Customer: { field: "clientId", resolveBy: "Client.name" },
        Date: { field: "scheduledDate", transform: "date-mdy" },
        Status: { field: "status" },
        Notes: { field: "notes" },
      },
      unmapped: [], unresolved: [],
    },
  ],
  valueMaps: { "Job.status": { Open: "Scheduled", WIP: "In Progress" } },
};

const customers = table("customers.csv", ["Customer", "Contact", "Address"], [
  ["Acme Plumbing", "Jane Doe", "12 Main St"],
  ["Acme Plumbing", "Dup Row", "99 Elm St"],
  ["", "No Name", "1 Void Ln"],
]);

const jobs = table("jobs.csv", ["Job #", "Customer", "Date", "Status", "Notes"], [
  ["1001", "Acme Plumbing", "7/10/2026", "Open", "Backflow test"],
  ["1002", "Acme Plumbing", "7/12/2026", "Completed", "Panel swap"],
  ["1003", "Acme Plumbing", "13/45/2026", "Open", "Bad date"],
  ["1004", "Ghost Co", "7/20/2026", "Open", "Dangling client"],
  ["1005", "Acme Plumbing", "7/22/2026", "Odd", "Unmapped status"],
]);

describe("buildImportPlan", () => {
  const plan = buildImportPlan(mapping, [customers, jobs]);

  it("plans clean rows with defaults applied and dates normalized", () => {
    expect(plan.entities.Client).toHaveLength(1);
    expect(plan.entities.Client![0].data).toEqual({
      name: "Acme Plumbing", contactName: "Jane Doe", locationAddress: "12 Main St", paymentTerms: "Net 30",
    });
    expect(plan.entities.Job).toHaveLength(1);
    expect(plan.entities.Job![0].data.scheduledDate).toBe("2026-07-10");
    expect(plan.entities.Job![0].sourceKey).toBe("1001");
    expect(plan.entities.Job![0].refs.clientId).toEqual({ entity: "Client", key: "Acme Plumbing" });
  });

  it("rejects duplicate natural keys, missing required fields, bad transforms, bad enums, dangling refs", () => {
    const reasons = plan.rejected.map((r) => `${r.file}:${r.row} ${r.reason}`).join("\n");
    expect(reasons).toMatch(/customers.csv:3 .*duplicate/);
    expect(reasons).toMatch(/customers.csv:4 .*missing required name/);
    expect(reasons).toMatch(/jobs.csv:4 .*not a M\/D\/Y date/);
    expect(reasons).toMatch(/jobs.csv:5 .*no Client matching "Ghost Co"/);
    expect(reasons).toMatch(/jobs.csv:6 .*"Odd" is not one of/);
  });

  it("skips completed jobs as out of scope and tracks their sourceKeys", () => {
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({ file: "jobs.csv", row: 3, entity: "Job" });
    expect(plan.skippedJobSourceKeys.has("1002")).toBe(true);
  });

  it("computes a per-entity summary", () => {
    expect(plan.summary.Client).toEqual({ planned: 1, rejected: 2, skipped: 0 });
    expect(plan.summary.Job).toEqual({ planned: 1, rejected: 3, skipped: 1 });
  });
});
