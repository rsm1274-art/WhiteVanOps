import { describe, it, expect } from "vitest";
import {
  emptyDefinition,
  addColumn,
  removeColumn,
  reorderColumns,
  updateColumnLabel,
  updateColumnAggregation,
  addCondition,
  updateCondition,
  removeCondition,
  setExpandRelation,
  setSort,
  sanitizeAgainstCatalog,
} from "./definitionEdit";
import type { ReportDefinition } from "./types";

describe("emptyDefinition", () => {
  it("returns a job-rooted definition with no columns or filters", () => {
    expect(emptyDefinition()).toEqual({ rootEntity: "job", columns: [], filters: [] });
  });
});

describe("addColumn", () => {
  it("appends a column with no aggregation for a one-valued field", () => {
    const def = addColumn(emptyDefinition(), "job.status");
    expect(def.columns).toEqual([{ fieldKey: "job.status", aggregation: undefined }]);
  });

  it("appends a column with an aggregation for a many-valued field", () => {
    const def = addColumn(emptyDefinition(), "personnel.firstName", "list");
    expect(def.columns).toEqual([{ fieldKey: "personnel.firstName", aggregation: "list" }]);
  });

  it("does not duplicate a column already present", () => {
    const once = addColumn(emptyDefinition(), "job.status");
    const twice = addColumn(once, "job.status");
    expect(twice.columns).toHaveLength(1);
    expect(twice).toBe(once); // unchanged input returned as-is, not just equal
  });

  it("does not mutate the input definition", () => {
    const original = emptyDefinition();
    addColumn(original, "job.status");
    expect(original.columns).toHaveLength(0);
  });
});

describe("removeColumn", () => {
  it("removes the named column", () => {
    const withTwo = addColumn(addColumn(emptyDefinition(), "job.status"), "job.notes");
    const withOne = removeColumn(withTwo, "job.status");
    expect(withOne.columns).toEqual([{ fieldKey: "job.notes", aggregation: undefined }]);
  });

  it("removing the last column leaves an empty column list", () => {
    const withOne = addColumn(emptyDefinition(), "job.status");
    const withNone = removeColumn(withOne, "job.status");
    expect(withNone.columns).toEqual([]);
  });

  it("is a no-op when the field key is not present", () => {
    const def = addColumn(emptyDefinition(), "job.status");
    expect(removeColumn(def, "job.notes")).toEqual(def);
  });
});

describe("reorderColumns", () => {
  function threeColumns(): ReportDefinition {
    return addColumn(addColumn(addColumn(emptyDefinition(), "job.status"), "job.notes"), "job.createdAt");
  }

  it("moves a column to a later index", () => {
    const def = reorderColumns(threeColumns(), 0, 2);
    expect(def.columns.map((c) => c.fieldKey)).toEqual(["job.notes", "job.createdAt", "job.status"]);
  });

  it("moves a column to an earlier index", () => {
    const def = reorderColumns(threeColumns(), 2, 0);
    expect(def.columns.map((c) => c.fieldKey)).toEqual(["job.createdAt", "job.status", "job.notes"]);
  });

  it("clamps a target index beyond the end of the list", () => {
    const def = reorderColumns(threeColumns(), 0, 99);
    expect(def.columns.map((c) => c.fieldKey)).toEqual(["job.notes", "job.createdAt", "job.status"]);
  });

  it("is a no-op for a negative source index", () => {
    const original = threeColumns();
    expect(reorderColumns(original, -1, 1)).toBe(original);
  });

  it("is a no-op for a source index past the end of the list", () => {
    const original = threeColumns();
    expect(reorderColumns(original, 5, 0)).toBe(original);
  });

  it("is a no-op when the source and clamped target are the same index", () => {
    const original = threeColumns();
    expect(reorderColumns(original, 1, 1)).toBe(original);
  });

  it("is a no-op on an empty column list", () => {
    const empty = emptyDefinition();
    expect(reorderColumns(empty, 0, 1)).toBe(empty);
  });
});

describe("updateColumnLabel", () => {
  it("sets a label override on the matching column", () => {
    const def = updateColumnLabel(addColumn(emptyDefinition(), "job.status"), "job.status", "Status");
    expect(def.columns[0].label).toBe("Status");
  });

  it("clears a label override when passed undefined", () => {
    const withLabel = updateColumnLabel(addColumn(emptyDefinition(), "job.status"), "job.status", "Status");
    const cleared = updateColumnLabel(withLabel, "job.status", undefined);
    expect(cleared.columns[0].label).toBeUndefined();
  });
});

describe("updateColumnAggregation", () => {
  it("sets the aggregation on the matching column", () => {
    const def = updateColumnAggregation(addColumn(emptyDefinition(), "personnel.firstName", "list"), "personnel.firstName", "count");
    expect(def.columns[0].aggregation).toBe("count");
  });
});

describe("addCondition / updateCondition / removeCondition", () => {
  it("creates the implicit AND group when the first condition is added", () => {
    const def = addCondition(emptyDefinition(), { fieldKey: "job.status", operator: "eq", value: "Scheduled" });
    expect(def.filters).toEqual([{ join: "AND", conditions: [{ fieldKey: "job.status", operator: "eq", value: "Scheduled" }] }]);
  });

  it("appends a second condition to the same group", () => {
    const withOne = addCondition(emptyDefinition(), { fieldKey: "job.status", operator: "eq", value: "Scheduled" });
    const withTwo = addCondition(withOne, { fieldKey: "job.notes", operator: "isNotNull" });
    expect(withTwo.filters[0].conditions).toHaveLength(2);
  });

  it("updates a condition at the given index", () => {
    const withOne = addCondition(emptyDefinition(), { fieldKey: "job.status", operator: "eq", value: "Scheduled" });
    const updated = updateCondition(withOne, 0, { fieldKey: "job.status", operator: "eq", value: "Completed" });
    expect(updated.filters[0].conditions[0].value).toBe("Completed");
  });

  it("is a no-op when updating an out-of-range condition index", () => {
    const withOne = addCondition(emptyDefinition(), { fieldKey: "job.status", operator: "eq", value: "Scheduled" });
    expect(updateCondition(withOne, 5, { fieldKey: "job.status", operator: "eq", value: "Completed" })).toBe(withOne);
  });

  it("removes a condition at the given index", () => {
    const withOne = addCondition(emptyDefinition(), { fieldKey: "job.status", operator: "eq", value: "Scheduled" });
    const withTwo = addCondition(withOne, { fieldKey: "job.notes", operator: "isNotNull" });
    const backToOne = removeCondition(withTwo, 0);
    expect(backToOne.filters[0].conditions).toEqual([{ fieldKey: "job.notes", operator: "isNotNull" }]);
  });

  it("removing the last condition drops the filter group entirely", () => {
    const withOne = addCondition(emptyDefinition(), { fieldKey: "job.status", operator: "eq", value: "Scheduled" });
    const withNone = removeCondition(withOne, 0);
    expect(withNone.filters).toEqual([]);
  });

  it("is a no-op when removing an out-of-range condition index", () => {
    const withOne = addCondition(emptyDefinition(), { fieldKey: "job.status", operator: "eq", value: "Scheduled" });
    expect(removeCondition(withOne, 5)).toBe(withOne);
  });
});

describe("setExpandRelation", () => {
  it("sets the expanded relation", () => {
    const def = setExpandRelation(emptyDefinition(), "lineItems");
    expect(def.expandRelation).toBe("lineItems");
  });

  it("replaces rather than accumulates a previously set relation", () => {
    const withOne = setExpandRelation(emptyDefinition(), "lineItems");
    const withOther = setExpandRelation(withOne, "timeEntries");
    expect(withOther.expandRelation).toBe("timeEntries");
  });

  it("clears the expanded relation when passed undefined", () => {
    const withOne = setExpandRelation(emptyDefinition(), "lineItems");
    expect(setExpandRelation(withOne, undefined).expandRelation).toBeUndefined();
  });
});

describe("setSort", () => {
  it("sets a sort list", () => {
    const def = setSort(emptyDefinition(), [{ fieldKey: "job.scheduledDate", direction: "desc" }]);
    expect(def.sort).toEqual([{ fieldKey: "job.scheduledDate", direction: "desc" }]);
  });

  it("normalizes an empty array to undefined", () => {
    expect(setSort(emptyDefinition(), []).sort).toBeUndefined();
  });

  it("normalizes undefined to undefined", () => {
    expect(setSort(emptyDefinition(), undefined).sort).toBeUndefined();
  });
});

describe("sanitizeAgainstCatalog", () => {
  const known = new Set(["job.status", "client.name"]);

  it("keeps columns, conditions, and sort whose field keys are known", () => {
    let def = addColumn(emptyDefinition(), "job.status");
    def = addCondition(def, { fieldKey: "job.status", operator: "eq", value: "Scheduled" });
    def = setSort(def, [{ fieldKey: "job.status", direction: "asc" }]);

    const { definition, droppedFieldKeys } = sanitizeAgainstCatalog(def, known);
    expect(definition).toEqual(def);
    expect(droppedFieldKeys).toEqual([]);
  });

  it("drops a column referencing an unknown field key and reports it", () => {
    const def = addColumn(emptyDefinition(), "personnel.payRate");
    const { definition, droppedFieldKeys } = sanitizeAgainstCatalog(def, known);
    expect(definition.columns).toEqual([]);
    expect(droppedFieldKeys).toEqual(["personnel.payRate"]);
  });

  it("drops only the unknown condition and removes an emptied filter group", () => {
    let def = addCondition(emptyDefinition(), { fieldKey: "personnel.payRate", operator: "gt", value: 10 });
    const { definition, droppedFieldKeys } = sanitizeAgainstCatalog(def, known);
    expect(definition.filters).toEqual([]);
    expect(droppedFieldKeys).toEqual(["personnel.payRate"]);
  });

  it("keeps a known condition in its group while dropping an unknown sibling", () => {
    let def = addCondition(emptyDefinition(), { fieldKey: "job.status", operator: "eq", value: "Scheduled" });
    def = addCondition(def, { fieldKey: "personnel.payRate", operator: "gt", value: 10 });
    const { definition, droppedFieldKeys } = sanitizeAgainstCatalog(def, known);
    expect(definition.filters).toEqual([{ join: "AND", conditions: [{ fieldKey: "job.status", operator: "eq", value: "Scheduled" }] }]);
    expect(droppedFieldKeys).toEqual(["personnel.payRate"]);
  });

  it("normalizes an all-dropped sort list to undefined", () => {
    const def = setSort(emptyDefinition(), [{ fieldKey: "personnel.payRate", direction: "desc" }]);
    const { definition } = sanitizeAgainstCatalog(def, known);
    expect(definition.sort).toBeUndefined();
  });
});
