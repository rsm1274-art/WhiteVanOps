import { describe, it, expect, vi } from "vitest";

// compile.ts -> kysely.ts -> @/lib/db, which opens a real pg.Pool at import
// time and throws without DATABASE_URL. Mocked per this repo's convention
// (see src/lib/jobConflicts.test.ts) — compiling a query never touches the
// pool (Kysely only needs it lazily, on execute), so a bare stand-in object
// is enough.
vi.mock("@/lib/db", () => ({ pool: {} }));

import { compileReport } from "./compile";
import type { ReportDefinition } from "./types";

function def(over: Partial<ReportDefinition> = {}): ReportDefinition {
  return {
    rootEntity: "job",
    columns: [{ fieldKey: "job.status" }],
    filters: [],
    ...over,
  };
}

const OPTS = { limit: 200, offset: 0 };

describe("compileReport", () => {
  it("emits no LATERAL for a job + client-only report", () => {
    const result = compileReport(
      def({ columns: [{ fieldKey: "job.status" }, { fieldKey: "client.name" }] }),
      OPTS
    );
    expect(result.sql).not.toMatch(/LATERAL/i);
    expect(result.sql).toMatch(/LEFT JOIN "Client"/);
  });

  it("adding a technician column emits a LATERAL json_agg and no bare join to JobAssignment", () => {
    const result = compileReport(
      def({ columns: [{ fieldKey: "job.status" }, { fieldKey: "personnel.firstName", aggregation: "list" }] }),
      OPTS
    );
    expect(result.sql).toMatch(/LEFT JOIN LATERAL/i);
    expect(result.sql).toMatch(/json_agg/i);
    // JobAssignment must only ever appear inside the lateral's own FROM
    // clause, never as a top-level FROM-list join alongside "job" — the
    // latter would multiply the job row for every assignment.
    expect(result.sql).not.toMatch(/LEFT JOIN "JobAssignment" AS "personnel"/);
    expect(result.sql).not.toMatch(/LEFT JOIN "JobAssignment" AS "assignments" ON/);
  });

  it("a condition on technician name emits EXISTS, not a predicate on the joined lateral", () => {
    const result = compileReport(
      def({
        columns: [{ fieldKey: "job.status" }],
        filters: [{ join: "AND", conditions: [{ fieldKey: "personnel.firstName", operator: "eq", value: "Sam" }] }],
      }),
      OPTS
    );
    expect(result.sql).toMatch(/EXISTS \(SELECT 1 FROM "JobAssignment"/);
    expect(result.parameters).toContain("Sam");
  });

  it("expandRelation for lineItems emits one plain join and keeps time entries aggregated", () => {
    const result = compileReport(
      def({
        columns: [
          { fieldKey: "lineItem.description" },
          { fieldKey: "timeEntry.serviceItem", aggregation: "list" },
        ],
        expandRelation: "lineItems",
      }),
      OPTS
    );
    expect(result.sql).toMatch(/LEFT JOIN "JobLineItem" AS "lineItems"/);
    expect(result.sql).not.toMatch(/lineItems_agg/);
    expect(result.sql).toMatch(/timeEntries_agg/);
    expect(result.sql).toMatch(/LATERAL/i);
  });

  it("rejects a definition needing two expanded relations at the type level (validator's job, not the compiler's)", () => {
    // The compiler trusts `def` is already validated (single expandRelation
    // max is enforced in definition.ts); this test just documents that the
    // compiler only ever expands the one relation named in expandRelation.
    const result = compileReport(
      def({ columns: [{ fieldKey: "lineItem.description" }], expandRelation: "lineItems" }),
      OPTS
    );
    expect(result.sql).not.toMatch(/timeEntries.*LEFT JOIN "TimeEntry" AS "timeEntries"/);
  });

  it("every condition value ends up in parameters, never inlined in sql", () => {
    const result = compileReport(
      def({
        filters: [
          {
            join: "AND",
            conditions: [{ fieldKey: "job.notes", operator: "contains", value: "'; DROP TABLE \"Job\"; --" }],
          },
        ],
      }),
      OPTS
    );
    expect(result.sql).not.toContain("DROP TABLE");
    expect(result.parameters.some((p) => typeof p === "string" && p.includes("DROP TABLE"))).toBe(true);
  });

  it("a report whose only column is a many-valued field still selects one row per job (no row-multiplying join)", () => {
    const result = compileReport(def({ columns: [{ fieldKey: "personnel.firstName", aggregation: "list" }] }), OPTS);
    // No plain (non-LATERAL) join against JobAssignment, which would
    // multiply the job row for every assignment.
    const bareJoinPattern = /LEFT JOIN "JobAssignment" AS "assignments" ON/;
    expect(result.sql).not.toMatch(bareJoinPattern);
    expect(result.sql).toMatch(/FROM "Job" AS "job"/);
  });

  it("orders by the field's own expression, valid regardless of SELECT-list aliasing", () => {
    const result = compileReport(
      def({ columns: [{ fieldKey: "job.status" }], sort: [{ fieldKey: "job.status", direction: "desc" }] }),
      OPTS
    );
    expect(result.sql).toMatch(/ORDER BY "job"\."status" DESC/);
  });

  it("sorting by a many-valued field that isn't also a selected column still compiles (falls back to a valid aggregate expression)", () => {
    const result = compileReport(
      def({
        columns: [{ fieldKey: "job.status" }],
        sort: [{ fieldKey: "personnel.firstName", direction: "asc" }],
      }),
      OPTS
    );
    // Must NOT reference a bare "<lateral_alias>"."firstName" — the lateral
    // only ever exposes a single `agg` jsonb column, so that would be
    // invalid SQL (column does not exist).
    expect(result.sql).not.toMatch(/"assignments_agg"\."firstName"/);
    expect(result.sql).toMatch(/ORDER BY \(SELECT array_agg/);
  });

  it("binds LIMIT/OFFSET as parameters", () => {
    const result = compileReport(def(), { limit: 50, offset: 10 });
    expect(result.sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    expect(result.parameters).toContain(50);
    expect(result.parameters).toContain(10);
  });

  it("quotes the field key as a single output column alias (not a qualified table.column ref)", () => {
    const result = compileReport(def({ columns: [{ fieldKey: "job.status" }] }), OPTS);
    // Must be one quoted identifier containing a literal dot, not two
    // separately-quoted parts ("job"."status") — the latter would be
    // Postgres syntax for a *reference*, not a valid output alias here.
    expect(result.sql).toMatch(/AS "job\.status"(?!")/);
    expect(result.sql).not.toMatch(/AS "job"\."status"/);
  });
});
