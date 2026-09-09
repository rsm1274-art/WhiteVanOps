import { describe, it, expect } from "vitest";
import { canViewReport, canEditReport, forbiddenFieldKeys, type PermissionUser, type SavedReportRef } from "./permissions";
import type { ReportDefinition } from "./types";

const CREATOR: PermissionUser = { userId: "u-creator", role: "admin" };
const OTHER_ADMIN: PermissionUser = { userId: "u-other-admin", role: "admin" };
const SUPERUSER: PermissionUser = { userId: "u-super", role: "superuser" };

function report(overrides: Partial<SavedReportRef> = {}): SavedReportRef {
  return { createdById: "u-creator", isShared: false, folder: null, ...overrides };
}

describe("canViewReport", () => {
  it("lets the creator view their own private report", () => {
    expect(canViewReport(CREATOR, report())).toBe(true);
  });

  it("refuses another admin who is not the creator, on a private report in no folder", () => {
    expect(canViewReport(OTHER_ADMIN, report())).toBe(false);
  });

  it("lets anyone view a report marked isShared, regardless of folder", () => {
    expect(canViewReport(OTHER_ADMIN, report({ isShared: true }))).toBe(true);
  });

  it("lets anyone view a report inside a public folder, even if not itself shared", () => {
    expect(canViewReport(OTHER_ADMIN, report({ folder: { isPublic: true } }))).toBe(true);
  });

  it("refuses a private report in a private folder", () => {
    expect(canViewReport(OTHER_ADMIN, report({ folder: { isPublic: false } }))).toBe(false);
  });

  it("superuser gets no free pass on a private report they did not create", () => {
    expect(canViewReport(SUPERUSER, report())).toBe(false);
  });
});

describe("canEditReport", () => {
  it("lets the creator edit their own report", () => {
    expect(canEditReport(CREATOR, report())).toBe(true);
  });

  it("lets an admin edit a report they did not create", () => {
    expect(canEditReport(OTHER_ADMIN, report())).toBe(true);
  });

  it("lets a superuser edit a report they did not create", () => {
    expect(canEditReport(SUPERUSER, report())).toBe(true);
  });

  it("falls back to admin-only editing once the creator account is gone", () => {
    expect(canEditReport(OTHER_ADMIN, report({ createdById: null }))).toBe(true);
  });
});

describe("forbiddenFieldKeys", () => {
  const baseDefinition: ReportDefinition = {
    rootEntity: "job",
    columns: [{ fieldKey: "job.status" }],
    filters: [{ join: "AND", conditions: [{ fieldKey: "client.name", operator: "eq", value: "Acme" }] }],
    sort: [{ fieldKey: "job.scheduledDate", direction: "asc" }],
  };

  it("returns an empty list when every referenced field permits the role", () => {
    expect(forbiddenFieldKeys(baseDefinition, "admin")).toEqual([]);
  });

  it("returns an empty list for a role with no visible fields when the definition references none of them", () => {
    // tech has no fields in the registry (see registry.test.ts), but an empty
    // definition can't reference any — this asserts the function doesn't false-positive.
    expect(forbiddenFieldKeys({ rootEntity: "job", columns: [], filters: [] }, "tech")).toEqual([]);
  });

  it("flags every column, filter and sort field a role cannot see", () => {
    const forbidden = forbiddenFieldKeys(baseDefinition, "tech");
    expect(forbidden).toContain("job.status");
    expect(forbidden).toContain("client.name");
    expect(forbidden).toContain("job.scheduledDate");
    expect(forbidden.length).toBe(3);
  });

  it("ignores an unknown field key rather than reporting it as forbidden", () => {
    const def: ReportDefinition = { rootEntity: "job", columns: [{ fieldKey: "not.a.field" }], filters: [] };
    expect(forbiddenFieldKeys(def, "admin")).toEqual([]);
  });
});
