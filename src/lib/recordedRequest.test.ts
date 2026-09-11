import { describe, it, expect } from "vitest";
import { parseRecordedRequest } from "./recordedRequest";

describe("parseRecordedRequest — legacy shapes", () => {
  it("parses legacy POST /api/time as a time op", () => {
    const res = parseRecordedRequest({
      url: "/api/time",
      method: "POST",
      body: { jobId: "job1", personnelId: "per_1", date: "2026-09-01", duration: "01:00" },
    });
    expect(res).toEqual({
      opType: "time",
      jobId: "job1",
      body: { jobId: "job1", personnelId: "per_1", date: "2026-09-01", duration: "01:00" },
    });
  });

  it("parses legacy PUT /api/jobs with notes as a notes op", () => {
    const res = parseRecordedRequest({
      url: "/api/jobs",
      method: "PUT",
      body: { jobId: "job1", notes: "site notes" },
    });
    expect(res).toEqual({ opType: "notes", jobId: "job1", body: { jobId: "job1", notes: "site notes" } });
  });

  it("parses legacy PUT /api/jobs with lineItems as a lineItems op", () => {
    const res = parseRecordedRequest({
      url: "/api/jobs",
      method: "PUT",
      body: { jobId: "job1", lineItems: [{ inventoryItemId: "item1", quantity: "1", rate: "2" }] },
    });
    expect(res?.opType).toBe("lineItems");
    expect(res?.jobId).toBe("job1");
  });

  it("parses legacy PUT /api/jobs with status as a status op", () => {
    const res = parseRecordedRequest({
      url: "/api/jobs",
      method: "PUT",
      body: { jobId: "job1", status: "Completed" },
    });
    expect(res).toEqual({ opType: "status", jobId: "job1", body: { jobId: "job1", status: "Completed" } });
  });

  it("handles a full origin-prefixed URL, not just a bare path", () => {
    const res = parseRecordedRequest({
      url: "http://192.168.1.50:3000/api/time",
      method: "POST",
      body: { jobId: "job1", personnelId: "per_1", date: "2026-09-01", duration: "00:30" },
    });
    expect(res?.opType).toBe("time");
  });
});

describe("parseRecordedRequest — new consolidated shape", () => {
  it("parses POST /api/field/ops with duration as a time op", () => {
    const res = parseRecordedRequest({
      url: "/api/field/ops",
      method: "POST",
      body: { jobId: "job1", personnelId: "per_1", date: "2026-09-01", duration: "01:00" },
    });
    expect(res?.opType).toBe("time");
  });

  it("parses POST /api/field/ops with notes as a notes op", () => {
    const res = parseRecordedRequest({
      url: "/api/field/ops",
      method: "POST",
      body: { jobId: "job1", notes: "hi" },
    });
    expect(res?.opType).toBe("notes");
  });

  it("parses POST /api/field/ops with lineItems as a lineItems op", () => {
    const res = parseRecordedRequest({
      url: "/api/field/ops",
      method: "POST",
      body: { jobId: "job1", lineItems: [] },
    });
    expect(res?.opType).toBe("lineItems");
  });

  it("parses POST /api/field/ops with status as a status op", () => {
    const res = parseRecordedRequest({
      url: "/api/field/ops",
      method: "POST",
      body: { jobId: "job1", status: "In Progress" },
    });
    expect(res?.opType).toBe("status");
  });
});

describe("parseRecordedRequest — malformed or unknown input", () => {
  it("returns null for an unknown URL", () => {
    expect(parseRecordedRequest({ url: "/api/vehicles", method: "POST", body: { jobId: "job1", status: "x" } })).toBeNull();
  });

  it("returns null when jobId is missing", () => {
    expect(parseRecordedRequest({ url: "/api/jobs", method: "PUT", body: { status: "Completed" } })).toBeNull();
  });

  it("returns null when the body is not a plain object", () => {
    expect(parseRecordedRequest({ url: "/api/jobs", method: "PUT", body: null })).toBeNull();
    expect(parseRecordedRequest({ url: "/api/jobs", method: "PUT", body: "notanobject" })).toBeNull();
    expect(parseRecordedRequest({ url: "/api/jobs", method: "PUT", body: [1, 2] })).toBeNull();
  });

  it("returns null for a PUT /api/jobs body with none of the recognized fields", () => {
    expect(parseRecordedRequest({ url: "/api/jobs", method: "PUT", body: { jobId: "job1", clientId: "c1" } })).toBeNull();
  });

  it("returns null for the wrong method on a known URL", () => {
    expect(parseRecordedRequest({ url: "/api/jobs", method: "GET", body: { jobId: "job1", status: "x" } })).toBeNull();
    expect(parseRecordedRequest({ url: "/api/time", method: "GET", body: { jobId: "job1", duration: "01:00" } })).toBeNull();
  });

  it("returns null when the request itself is malformed", () => {
    expect(parseRecordedRequest({ url: 42, method: "POST", body: {} } as never)).toBeNull();
    expect(parseRecordedRequest(null as never)).toBeNull();
  });
});
