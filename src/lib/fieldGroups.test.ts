import { describe, it, expect } from "vitest";
import { groupFieldJobs } from "./fieldGroups";

const day = (iso: string) => iso.slice(0, 10);

describe("groupFieldJobs", () => {
  it("splits by day relative to today and orders each group", () => {
    const jobs = [
      { id: "past-old", scheduledDate: "2026-09-01T12:00:00Z" },
      { id: "past-new", scheduledDate: "2026-09-09T12:00:00Z" },
      { id: "today-pm", scheduledDate: "2026-09-10T12:00:00Z", arrivalTime: "14:00" },
      { id: "today-am", scheduledDate: "2026-09-10T12:00:00Z", arrivalTime: "08:00" },
      { id: "later", scheduledDate: "2026-09-20T12:00:00Z" },
      { id: "soon", scheduledDate: "2026-09-11T12:00:00Z" },
    ];
    const g = groupFieldJobs(jobs, "2026-09-10", day);
    expect(g.today.map((j) => j.id)).toEqual(["today-am", "today-pm"]);
    expect(g.upcoming.map((j) => j.id)).toEqual(["soon", "later"]);
    expect(g.earlier.map((j) => j.id)).toEqual(["past-new", "past-old"]);
  });
});
