import { describe, it, expect } from "vitest";
import { ENTITY_META, Mapping, validateMappingShape, validateMappingAgainstTables } from "./mappingSchema";
import { naturalKeyOf, normKey, vehicleStockLocationName } from "./keys";
import type { SourceTable } from "./readers";

const clientFile = (over: Partial<Mapping["files"][0]> = {}): Mapping["files"][0] => ({
  file: "customers.csv",
  entity: "Client",
  headerRow: 1,
  columns: {
    Customer: { field: "name" },
    Contact: { field: "contactName" },
    Address: { field: "locationAddress" },
    Terms: { field: "paymentTerms" },
  },
  unmapped: [],
  unresolved: [],
  ...over,
});

const valid = (): Mapping => ({ version: 1, files: [clientFile()] });

describe("validateMappingShape", () => {
  it("accepts a complete mapping", () => {
    expect(validateMappingShape(valid())).toEqual([]);
  });

  it("rejects unresolved entries", () => {
    const m: Mapping = { version: 1, files: [clientFile({ unresolved: ["locationAddress"] })] };
    expect(validateMappingShape(m).join()).toMatch(/unresolved required fields: locationAddress/);
  });

  it("rejects unknown fields and unknown transforms", () => {
    const m = valid();
    m.files[0].columns["Customer"] = { field: "fullName" };
    m.files[0].columns["Contact"] = { field: "contactName", transform: "shout" as never };
    const errs = validateMappingShape(m);
    expect(errs.join()).toMatch(/unknown field Client.fullName/);
    expect(errs.join()).toMatch(/unknown transform "shout"/);
  });

  it("rejects a required field with no column and no default, accepts one with a default", () => {
    const m = valid();
    delete m.files[0].columns["Terms"];
    expect(validateMappingShape(m).join()).toMatch(/Client.paymentTerms has no column and no default/);
    m.files[0].defaults = { paymentTerms: "Net 30" };
    expect(validateMappingShape(m)).toEqual([]);
  });

  it("rejects UNRESOLVED and out-of-vocab valueMap targets", () => {
    const m = valid();
    m.valueMaps = { "Job.status": { Open: "UNRESOLVED", WIP: "Working" } };
    const errs = validateMappingShape(m);
    expect(errs.join()).toMatch(/"Open" is UNRESOLVED/);
    expect(errs.join()).toMatch(/"WIP" .* not one of/);
  });

  it("requires a sourceKey column on Job when child sheets exist", () => {
    const m: Mapping = {
      version: 1,
      files: [
        {
          file: "jobs.csv", entity: "Job", headerRow: 1,
          columns: {
            Customer: { field: "clientId" },
            Date: { field: "scheduledDate", transform: "date-mdy" },
            Status: { field: "status" },
          },
          unmapped: [], unresolved: [],
        },
        {
          file: "crew.csv", entity: "JobAssignment", headerRow: 1,
          columns: { Job: { field: "jobId" }, Tech: { field: "personnelId" } },
          unmapped: [], unresolved: [],
        },
      ],
    };
    expect(validateMappingShape(m).join()).toMatch(/needs a sourceKey column/);
  });

  it("rejects sourceKey on non-Job sheets", () => {
    const m = valid();
    m.files[0].columns["Ref"] = { role: "sourceKey" };
    expect(validateMappingShape(m).join()).toMatch(/sourceKey role is only valid on Job sheets/);
  });
});

describe("validateMappingAgainstTables", () => {
  const tables: SourceTable[] = [
    { file: "customers.csv", headers: ["Customer", "Contact", "Address", "Terms"], rows: [] },
  ];
  it("passes when file and columns exist", () => {
    expect(validateMappingAgainstTables(valid(), tables)).toEqual([]);
  });
  it("flags missing files and missing columns", () => {
    const m = valid();
    m.files[0].columns["Fax"] = { field: "contactName" };
    m.files.push(clientFile({ file: "ghost.csv" }));
    const errs = validateMappingAgainstTables(m, tables);
    expect(errs.join()).toMatch(/column "Fax" not found/);
    expect(errs.join()).toMatch(/ghost.csv.*not found/);
  });
});

describe("keys", () => {
  it("normKey lowercases, trims, collapses spaces", () => {
    expect(normKey("  Acme   Plumbing ")).toBe("acme plumbing");
  });
  it("naturalKeyOf joins Personnel first+last, returns null for Job", () => {
    expect(naturalKeyOf("Personnel", { firstName: "Jane", lastName: "Doe" })).toBe("jane doe");
    expect(naturalKeyOf("Client", { name: "Acme" })).toBe("acme");
    expect(naturalKeyOf("Job", {})).toBeNull();
  });
  it("vehicleStockLocationName mirrors the fleet route format", () => {
    expect(vehicleStockLocationName("Transit 250", "1FTBR3X89PKA55341")).toBe("Van Transit 250 (1FTB) Stock");
  });
  it("every ENTITY_META resolvesTo target has a naturalKey or is Job", () => {
    for (const meta of Object.values(ENTITY_META)) {
      for (const f of Object.values(meta.fields)) {
        if (f.resolvesTo && f.resolvesTo !== "Job") {
          expect(ENTITY_META[f.resolvesTo].naturalKey).toBeDefined();
        }
      }
    }
  });
});
