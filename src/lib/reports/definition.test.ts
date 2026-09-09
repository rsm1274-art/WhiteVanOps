import { describe, it, expect } from "vitest";
import { validateDefinition, MAX_COLUMNS, MAX_CONDITIONS } from "./definition";

const ADMIN = "admin" as const;
const TECH = "tech" as const;

function validReport(overrides: Record<string, unknown> = {}) {
  return {
    rootEntity: "job",
    columns: [{ fieldKey: "job.status" }],
    filters: [],
    ...overrides,
  };
}

describe("validateDefinition — shape", () => {
  it("rejects a non-object input", () => {
    const result = validateDefinition("not an object", ADMIN);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects the wrong rootEntity", () => {
    const result = validateDefinition(validReport({ rootEntity: "client" }), ADMIN);
    expect(result.ok).toBe(false);
  });

  it("rejects a definition with zero columns", () => {
    const result = validateDefinition(validReport({ columns: [] }), ADMIN);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("at least one column"))).toBe(true);
  });

  it("accepts a minimal valid definition", () => {
    const result = validateDefinition(validReport(), ADMIN);
    expect(result.ok).toBe(true);
    expect(result.definition?.columns).toEqual([{ fieldKey: "job.status", label: undefined, aggregation: undefined }]);
  });
});

describe("validateDefinition — unknown fields", () => {
  it("reports an unknown column field key separately from errors", () => {
    const result = validateDefinition(validReport({ columns: [{ fieldKey: "job.notReal" }] }), ADMIN);
    expect(result.ok).toBe(false);
    expect(result.unknownFieldKeys).toContain("job.notReal");
  });

  it("does not duplicate an unknown key across errors", () => {
    const result = validateDefinition(validReport({ columns: [{ fieldKey: "job.notReal" }] }), ADMIN);
    expect(result.errors.join(" ")).not.toContain("job.notReal");
  });
});

describe("validateDefinition — role permission", () => {
  it("rejects a field the role cannot see", () => {
    const result = validateDefinition(validReport(), TECH);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("not permitted for this role"))).toBe(true);
  });
});

describe("validateDefinition — column aggregation", () => {
  it("requires an aggregation on a many-cardinality column", () => {
    const result = validateDefinition(validReport({ columns: [{ fieldKey: "personnel.firstName" }] }), ADMIN);
    expect(result.ok).toBe(false);
  });

  it("accepts a many-cardinality column with a valid aggregation", () => {
    const result = validateDefinition(
      validReport({ columns: [{ fieldKey: "personnel.firstName", aggregation: "list" }] }),
      ADMIN
    );
    expect(result.ok).toBe(true);
  });

  it("rejects sum/min/max aggregation on a non-numeric many field", () => {
    const result = validateDefinition(
      validReport({ columns: [{ fieldKey: "personnel.firstName", aggregation: "sum" }] }),
      ADMIN
    );
    expect(result.ok).toBe(false);
  });

  it("accepts sum aggregation on a numeric many field", () => {
    const result = validateDefinition(validReport({ columns: [{ fieldKey: "lineItem.rate", aggregation: "sum" }] }), ADMIN);
    expect(result.ok).toBe(true);
  });

  it("rejects an aggregation supplied on a one-cardinality column", () => {
    const result = validateDefinition(validReport({ columns: [{ fieldKey: "job.status", aggregation: "count" }] }), ADMIN);
    expect(result.ok).toBe(false);
  });
});

describe("validateDefinition — conditions and operators", () => {
  it("rejects an operator not permitted for the field", () => {
    const result = validateDefinition(
      validReport({ filters: [{ join: "AND", conditions: [{ fieldKey: "job.status", operator: "gt", value: "Scheduled" }] }] }),
      ADMIN
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a value not in the enum's allowed set", () => {
    const result = validateDefinition(
      validReport({ filters: [{ join: "AND", conditions: [{ fieldKey: "job.status", operator: "eq", value: "Bogus" }] }] }),
      ADMIN
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a valid enum eq condition", () => {
    const result = validateDefinition(
      validReport({ filters: [{ join: "AND", conditions: [{ fieldKey: "job.status", operator: "eq", value: "Scheduled" }] }] }),
      ADMIN
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a non-numeric value on a numeric field", () => {
    const result = validateDefinition(
      validReport({ filters: [{ join: "AND", conditions: [{ fieldKey: "lineItem.quantity", operator: "gt", value: "five" }] }] }),
      ADMIN
    );
    expect(result.ok).toBe(false);
  });

  it("rejects isNull carrying a value", () => {
    const result = validateDefinition(
      validReport({ filters: [{ join: "AND", conditions: [{ fieldKey: "job.completionDate", operator: "isNull", value: "x" }] }] }),
      ADMIN
    );
    expect(result.ok).toBe(false);
  });

  it("accepts isNotNull with no value", () => {
    const result = validateDefinition(
      validReport({ filters: [{ join: "AND", conditions: [{ fieldKey: "job.completionDate", operator: "isNotNull" }] }] }),
      ADMIN
    );
    expect(result.ok).toBe(true);
  });

  it("requires exactly two values for between", () => {
    const result = validateDefinition(
      validReport({
        filters: [{ join: "AND", conditions: [{ fieldKey: "job.scheduledDate", operator: "between", value: ["2026-01-01"] }] }],
      }),
      ADMIN
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a valid two-value between", () => {
    const result = validateDefinition(
      validReport({
        filters: [
          {
            join: "AND",
            conditions: [{ fieldKey: "job.scheduledDate", operator: "between", value: ["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"] }],
          },
        ],
      }),
      ADMIN
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an empty array for in", () => {
    const result = validateDefinition(
      validReport({ filters: [{ join: "AND", conditions: [{ fieldKey: "job.status", operator: "in", value: [] }] }] }),
      ADMIN
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a non-empty array of valid enum values for in", () => {
    const result = validateDefinition(
      validReport({
        filters: [{ join: "AND", conditions: [{ fieldKey: "job.status", operator: "in", value: ["Scheduled", "In Progress"] }] }],
      }),
      ADMIN
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a SQL-injection-shaped string value as an ordinary invalid value, not specially", () => {
    // The value never reaches SQL in this module — the compiler (Phase 1) parameter-binds
    // it. This test just confirms a hostile string is treated as plain data: rejected here
    // only if it fails the field's own type/enum check, not because of its content.
    const result = validateDefinition(
      validReport({ filters: [{ join: "AND", conditions: [{ fieldKey: "job.notes", operator: "contains", value: "'; DROP TABLE job; --" }] }] }),
      ADMIN
    );
    expect(result.ok).toBe(true);
    expect(result.definition?.filters[0].conditions[0].value).toBe("'; DROP TABLE job; --");
  });
});

describe("validateDefinition — sort", () => {
  it("rejects an invalid direction", () => {
    const result = validateDefinition(validReport({ sort: [{ fieldKey: "job.scheduledDate", direction: "sideways" }] }), ADMIN);
    expect(result.ok).toBe(false);
  });

  it("accepts a valid sort", () => {
    const result = validateDefinition(validReport({ sort: [{ fieldKey: "job.scheduledDate", direction: "desc" }] }), ADMIN);
    expect(result.ok).toBe(true);
  });
});

describe("validateDefinition — expandRelation", () => {
  it("accepts a valid many-cardinality relation key", () => {
    const result = validateDefinition(validReport({ expandRelation: "lineItems" }), ADMIN);
    expect(result.ok).toBe(true);
    expect(result.definition?.expandRelation).toBe("lineItems");
  });

  it("rejects a one-cardinality relation key", () => {
    const result = validateDefinition(validReport({ expandRelation: "client" }), ADMIN);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown relation key", () => {
    const result = validateDefinition(validReport({ expandRelation: "notARelation" }), ADMIN);
    expect(result.ok).toBe(false);
  });

  it("the schema has no way to express two expansion relations at once", () => {
    // expandRelation is a single optional string, not an array — this is enforced by
    // TypeScript at the type level for any caller inside this codebase. A raw JSON body
    // with an array there fails the type check below instead.
    const result = validateDefinition(validReport({ expandRelation: ["lineItems", "timeEntries"] }), ADMIN);
    expect(result.ok).toBe(false);
  });
});

describe("validateDefinition — caps", () => {
  it("rejects more than MAX_COLUMNS columns", () => {
    const columns = Array.from({ length: MAX_COLUMNS + 1 }, () => ({ fieldKey: "job.status" }));
    const result = validateDefinition(validReport({ columns }), ADMIN);
    expect(result.ok).toBe(false);
  });

  it("rejects more than MAX_CONDITIONS conditions across all filter groups", () => {
    const conditions = Array.from({ length: MAX_CONDITIONS + 1 }, () => ({ fieldKey: "job.status", operator: "eq", value: "Scheduled" }));
    const result = validateDefinition(validReport({ filters: [{ join: "AND", conditions }] }), ADMIN);
    expect(result.ok).toBe(false);
  });
});
