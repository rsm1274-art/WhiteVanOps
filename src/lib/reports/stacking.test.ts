import { describe, expect, it } from "vitest";
import { groupManyColumns, hasDrillDown, zipManyRows } from "./stacking";
import type { FieldDef, ReportColumn } from "./types";

function makeField(overrides: Partial<FieldDef> & Pick<FieldDef, "key" | "cardinality">): FieldDef {
  return {
    label: overrides.key,
    group: "Test",
    type: "string",
    source: { entity: "test", column: overrides.key },
    path: { edges: overrides.cardinality === "many" ? ["testRelation"] : [] },
    operators: ["eq"],
    sensitivity: "normal",
    requiresRole: ["admin", "superuser"],
    ...overrides,
  };
}

describe("groupManyColumns", () => {
  it("returns empty array when no columns are many-cardinality", () => {
    const fieldByKey = new Map([["job.status", makeField({ key: "job.status", cardinality: "one" })]]);
    const columns: ReportColumn[] = [{ fieldKey: "job.status" }];
    expect(groupManyColumns(columns, fieldByKey)).toEqual([]);
  });

  it("groups list-aggregated many columns sharing the same relation edge", () => {
    const tech = makeField({ key: "tech.name", cardinality: "many", path: { edges: ["assignments"] } });
    const techRole = makeField({ key: "tech.role", cardinality: "many", path: { edges: ["assignments"] } });
    const fieldByKey = new Map([
      ["tech.name", tech],
      ["tech.role", techRole],
    ]);
    const columns: ReportColumn[] = [{ fieldKey: "tech.name" }, { fieldKey: "tech.role" }];
    const groups = groupManyColumns(columns, fieldByKey);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe("assignments");
    expect(groups[0].columns.map((c) => c.fieldKey)).toEqual(["tech.name", "tech.role"]);
  });

  it("splits columns from different relations into separate groups", () => {
    const tech = makeField({ key: "tech.name", cardinality: "many", path: { edges: ["assignments"] } });
    const part = makeField({ key: "part.name", cardinality: "many", path: { edges: ["lineItems"] } });
    const fieldByKey = new Map([
      ["tech.name", tech],
      ["part.name", part],
    ]);
    const columns: ReportColumn[] = [{ fieldKey: "tech.name" }, { fieldKey: "part.name" }];
    const groups = groupManyColumns(columns, fieldByKey);
    expect(groups.map((g) => g.groupKey).sort()).toEqual(["assignments", "lineItems"]);
  });

  it("excludes many columns aggregated as count/sum/min/max, not just list", () => {
    const partCount = makeField({ key: "part.qty", cardinality: "many", path: { edges: ["lineItems"] } });
    const fieldByKey = new Map([["part.qty", partCount]]);
    const columns: ReportColumn[] = [{ fieldKey: "part.qty", aggregation: "sum" }];
    expect(groupManyColumns(columns, fieldByKey)).toEqual([]);
  });

  it("ignores a column whose field key is missing from the catalog", () => {
    const fieldByKey = new Map<string, FieldDef>();
    const columns: ReportColumn[] = [{ fieldKey: "unknown.field" }];
    expect(groupManyColumns(columns, fieldByKey)).toEqual([]);
  });
});

describe("zipManyRows", () => {
  it("zips two equal-length array cells into child-row records by index", () => {
    const group = {
      groupKey: "assignments",
      columns: [{ fieldKey: "tech.name" }, { fieldKey: "tech.role" }] as ReportColumn[],
    };
    const row = { "tech.name": ["Alice", "Bob"], "tech.role": ["Lead", "Helper"] };
    expect(zipManyRows(row, group)).toEqual([
      { "tech.name": "Alice", "tech.role": "Lead" },
      { "tech.name": "Bob", "tech.role": "Helper" },
    ]);
  });

  it("returns an empty array when the group has no columns", () => {
    const group = { groupKey: "assignments", columns: [] as ReportColumn[] };
    expect(zipManyRows({}, group)).toEqual([]);
  });

  it("returns an empty array when the cell value is missing or not an array", () => {
    const group = { groupKey: "assignments", columns: [{ fieldKey: "tech.name" }] as ReportColumn[] };
    expect(zipManyRows({ "tech.name": null }, group)).toEqual([]);
    expect(zipManyRows({}, group)).toEqual([]);
  });

  it("bounds output to the shortest array when arrays have mismatched lengths", () => {
    const group = {
      groupKey: "assignments",
      columns: [{ fieldKey: "tech.name" }, { fieldKey: "tech.role" }] as ReportColumn[],
    };
    const row = { "tech.name": ["Alice", "Bob", "Carol"], "tech.role": ["Lead"] };
    expect(zipManyRows(row, group)).toEqual([{ "tech.name": "Alice", "tech.role": "Lead" }]);
  });
});

describe("hasDrillDown", () => {
  it("returns false when there are no many-column groups", () => {
    expect(hasDrillDown({}, [])).toBe(false);
  });

  it("returns false when every group's arrays are empty", () => {
    const group = { groupKey: "assignments", columns: [{ fieldKey: "tech.name" }] as ReportColumn[] };
    expect(hasDrillDown({ "tech.name": [] }, [group])).toBe(false);
  });

  it("returns true when at least one group has a non-empty child row", () => {
    const group = { groupKey: "assignments", columns: [{ fieldKey: "tech.name" }] as ReportColumn[] };
    expect(hasDrillDown({ "tech.name": ["Alice"] }, [group])).toBe(true);
  });
});
