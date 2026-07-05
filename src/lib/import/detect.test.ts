import { describe, it, expect } from "vitest";
import { buildMappingProposal } from "./detect";
import { validateMappingShape } from "./mappingSchema";
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
]);
const vehicles = table("vehicles.csv", ["VIN", "Make", "Model", "Status"], [
  ["1FTBR3X89PKA55341", "Ford", "Transit 250", "Active"],
]);
const jobs = table("jobs.csv", ["Job #", "Customer", "Date", "Status", "Notes"], [
  ["1001", "Acme Plumbing", "7/10/2026", "Open", "Backflow test"],
  ["1003", "Acme Plumbing", "7/15/2026", "WIP", "RTU install"],
]);

describe("buildMappingProposal", () => {
  it("detects Client / Vehicle / Job sheets and maps their columns", () => {
    const { mapping } = buildMappingProposal([customers, vehicles, jobs]);
    const byEntity = Object.fromEntries(mapping.files.map((f) => [f.entity, f]));
    expect(byEntity.Client.file).toBe("customers.csv");
    expect(byEntity.Client.columns["Customer"]).toMatchObject({ field: "name" });
    expect(byEntity.Client.columns["Terms"]).toMatchObject({ field: "paymentTerms" });
    expect(byEntity.Vehicle.columns["VIN"]).toMatchObject({ field: "vin" });
    expect(byEntity.Job.columns["Job #"]).toMatchObject({ role: "sourceKey" });
    expect(byEntity.Job.columns["Customer"]).toMatchObject({ field: "clientId", resolveBy: "Client.name" });
    expect(byEntity.Job.columns["Date"]).toMatchObject({ field: "scheduledDate", transform: "date-mdy" });
  });

  it("proposes valueMaps for unknown enum vocab using common translations", () => {
    const { mapping } = buildMappingProposal([jobs]);
    expect(mapping.valueMaps?.["Job.status"]).toMatchObject({ Open: "Scheduled", WIP: "In Progress" });
  });

  it("marks truly unknown enum values UNRESOLVED and notes them", () => {
    const weird = table("jobs.csv", ["Job #", "Customer", "Date", "Status"], [
      ["1", "Acme", "7/10/2026", "Vibing"],
    ]);
    const { mapping, notes } = buildMappingProposal([weird]);
    expect(mapping.valueMaps?.["Job.status"]?.["Vibing"]).toBe("UNRESOLVED");
    expect(notes.join()).toMatch(/Vibing/);
  });

  it("puts uncovered required fields in unresolved unless a default suggestion exists", () => {
    const noTerms = table("customers.csv", ["Customer", "Contact", "Address"], [
      ["Acme", "Jane", "12 Main St"],
    ]);
    const { mapping } = buildMappingProposal([noTerms]);
    const fm = mapping.files[0];
    expect(fm.defaults).toMatchObject({ paymentTerms: "Net 30" }); // suggested default
    expect(fm.unresolved).toEqual([]);
    const bare = table("customers.csv", ["Customer", "Contact"], [["Acme", "Jane"]]);
    const { mapping: m2 } = buildMappingProposal([bare]);
    expect(m2.files[0].unresolved).toContain("locationAddress");
  });

  it("detects day-first dates from values and flags ambiguous ones", () => {
    const dmy = table("jobs.csv", ["Job #", "Customer", "Date", "Status"], [
      ["1", "Acme", "25/7/2026", "Open"],
    ]);
    expect(buildMappingProposal([dmy]).mapping.files[0].columns["Date"].transform).toBe("date-dmy");
    const ambiguous = table("jobs.csv", ["Job #", "Customer", "Date", "Status"], [
      ["1", "Acme", "3/4/2026", "Open"],
    ]);
    const r = buildMappingProposal([ambiguous]);
    expect(r.mapping.files[0].columns["Date"]).toMatchObject({ transform: "date-mdy", confidence: "low" });
    expect(r.notes.join()).toMatch(/ambiguous/i);
  });

  it("lists unrecognizable tables in unrecognized instead of guessing", () => {
    const junk = table("misc.csv", ["Foo", "Bar"], [["1", "2"]]);
    const { mapping, notes } = buildMappingProposal([junk]);
    expect(mapping.files).toHaveLength(0);
    expect(mapping.unrecognized).toEqual(["misc.csv"]);
    expect(notes.join()).toMatch(/misc.csv/);
  });

  it("emits proposals that are structurally valid per validateMappingShape", () => {
    const { mapping } = buildMappingProposal([customers, vehicles, jobs]);
    const errs = validateMappingShape(mapping).filter((e) => !/unresolved|UNRESOLVED/.test(e));
    expect(errs).toEqual([]);
  });
});
