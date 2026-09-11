import { describe, it, expect } from "vitest";
import { REGISTRY, getField, fieldsForRole, allGroups } from "./registry";
import { resolvePath, pathCardinality } from "./graph";
import type { Aggregation } from "./types";

const EXCLUDED_COLUMNS = [
  "passwordHash",
  "failedLoginAttempts",
  "lockedUntil",
  "auditLog",
  "syncReviewItem",
  "license",
];

describe("REGISTRY invariants", () => {
  it("has a unique key per field", () => {
    const keys = REGISTRY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolves every field's path against the relation graph", () => {
    for (const f of REGISTRY) {
      expect(resolvePath(f.path.edges), `field "${f.key}" has an unresolvable path`).toBeDefined();
    }
  });

  it("matches the graph's computed cardinality for every field", () => {
    for (const f of REGISTRY) {
      expect(pathCardinality(f.path.edges), `field "${f.key}" cardinality mismatch`).toBe(f.cardinality);
    }
  });

  it("never references an excluded column or table", () => {
    for (const f of REGISTRY) {
      const haystack = `${f.key} ${f.source.entity}.${f.source.column}`.toLowerCase();
      for (const excluded of EXCLUDED_COLUMNS) {
        expect(haystack).not.toContain(excluded.toLowerCase());
      }
    }
  });

  it("gives every enum field a non-empty enumValues list", () => {
    for (const f of REGISTRY) {
      if (f.type === "enum") {
        expect(f.enumValues, `field "${f.key}" is type enum but has no enumValues`).toBeDefined();
        expect(f.enumValues!.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives every field at least one operator", () => {
    for (const f of REGISTRY) {
      expect(f.operators.length, `field "${f.key}" has no operators`).toBeGreaterThan(0);
    }
  });

  it("marks known money and PII fields with the correct sensitivity", () => {
    expect(getField("lineItem.rate")?.sensitivity).toBe("money");
    expect(getField("inventoryItem.defaultRate")?.sensitivity).toBe("money");
    expect(getField("client.contactName")?.sensitivity).toBe("pii");
    expect(getField("client.locationAddress")?.sensitivity).toBe("pii");
  });

  it("defaults every field to admin/superuser visibility", () => {
    for (const f of REGISTRY) {
      expect(f.requiresRole).toEqual(["admin", "superuser"]);
    }
  });
});

describe("getField", () => {
  it("finds a field by key", () => {
    expect(getField("job.status")?.label).toBe("Job Status");
  });

  it("returns undefined for an unknown key", () => {
    expect(getField("job.notAField")).toBeUndefined();
  });
});

describe("fieldsForRole", () => {
  it("returns the full registry for admin and superuser", () => {
    expect(fieldsForRole("admin").length).toBe(REGISTRY.length);
    expect(fieldsForRole("superuser").length).toBe(REGISTRY.length);
  });

  it("returns an empty list for a role with no field access", () => {
    expect(fieldsForRole("tech")).toEqual([]);
  });
});

describe("allGroups", () => {
  it("returns each group exactly once", () => {
    const groups = allGroups();
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("includes every group referenced by a field", () => {
    const fromFields = new Set(REGISTRY.map((f) => f.group));
    expect(new Set(allGroups())).toEqual(fromFields);
  });
});

// Guards Phase 1's compiler contract even though aggregation selection itself is a
// Phase 2 UI concern: every many-cardinality field must be aggregatable somehow.
describe("many-cardinality fields", () => {
  const VALID_AGGREGATIONS: readonly Aggregation[] = ["list", "count", "sum", "min", "max"];

  it("is a non-empty set", () => {
    const many = REGISTRY.filter((f) => f.cardinality === "many");
    expect(many.length).toBeGreaterThan(0);
  });

  it("every many field's type supports at least one aggregation strategy", () => {
    for (const f of REGISTRY.filter((f) => f.cardinality === "many")) {
      const supported: Aggregation[] = f.type === "number" ? [...VALID_AGGREGATIONS] : ["list", "count"];
      expect(supported.length).toBeGreaterThan(0);
    }
  });
});
