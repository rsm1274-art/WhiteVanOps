import { describe, test, expect, vi, beforeEach } from "vitest";
import { discardStuckOp, retargetStuckOp, handoffStuckOp } from "@/lib/syncResolution";
import { removeFromStuckOps, updateStuckOp, type StuckOp } from "@/lib/idb";

vi.mock("@/lib/idb", () => ({
  removeFromStuckOps: vi.fn(),
  updateStuckOp: vi.fn(),
}));

const stuckOp: StuckOp = {
  id: 7,
  opId: "01H8XJZ0000000000000000AA",
  url: "/api/time",
  method: "POST",
  body: { jobId: "job_dead", personnelId: "per_1", date: "2026-07-15", duration: "01:30" },
  queuedAt: 1752537600000,
  rejectedAt: 1752624000000,
  status: 404,
  message: "Job not found",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("discardStuckOp", () => {
  test("deletes locally only after the audit POST returns 200", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await discardStuckOp(stuckOp);

    // Assert — audit first, delete second: a discard with no trail is
    // impossible by construction.
    expect(result).toBe("discarded");
    expect(fetchMock).toHaveBeenCalledWith("/api/field/sync-resolution", expect.objectContaining({ method: "POST" }));
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({
      action: "discard",
      op: { url: "/api/time", method: "POST", queuedAt: 1752537600000 },
      rejection: { status: 404, message: "Job not found", rejectedAt: 1752624000000 },
    });
    expect(sent.op.body).toEqual(stuckOp.body);
    expect(removeFromStuckOps).toHaveBeenCalledWith(7);
  });

  test("does NOT delete locally when the audit POST fails", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    // Act
    const result = await discardStuckOp(stuckOp);

    // Assert
    expect(result).toBe("failed");
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });

  test("does NOT delete locally when the office is unreachable — a stuck record is already safe where it is", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    // Act
    const result = await discardStuckOp(stuckOp);

    // Assert
    expect(result).toBe("failed");
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });
});

describe("retargetStuckOp", () => {
  test("re-sends the corrected payload, audits, and clears locally when the server accepts it", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await retargetStuckOp(stuckOp, "job_new");

    // Assert — first call is the real write with the corrected jobId; second
    // is the audit, second precisely so it can only describe something that
    // actually happened.
    expect(result).toBe("retargeted");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/time");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ jobId: "job_new", duration: "01:30" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/field/sync-resolution");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ action: "retarget", newJobId: "job_new" });
    expect(removeFromStuckOps).toHaveBeenCalledWith(7);
  });

  test("refreshes the stored rejection and does NOT audit when the re-send is rejected again", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Job is closed" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await retargetStuckOp(stuckOp, "job_new");

    // Assert — never log a re-target that didn't land.
    expect(result).toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateStuckOp).toHaveBeenCalledWith(7, expect.objectContaining({ status: 409, message: "Job is closed" }));
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });

  test("is a complete no-op when the office is unreachable", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    // Act
    const result = await retargetStuckOp(stuckOp, "job_new");

    // Assert
    expect(result).toBe("unreachable");
    expect(updateStuckOp).not.toHaveBeenCalled();
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });

  test("still clears locally when the write landed but the follow-up audit POST fails", async () => {
    // Arrange — the server acknowledged the corrected write; keeping the
    // record stuck now would risk a double-submission on the next attempt.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await retargetStuckOp(stuckOp, "job_new");

    // Assert
    expect(result).toBe("retargeted");
    expect(removeFromStuckOps).toHaveBeenCalledWith(7);
  });
});

describe("handoffStuckOp", () => {
  test("deletes locally only on a 200", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await handoffStuckOp(stuckOp);

    // Assert
    expect(result).toBe("handed-off");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: "handoff" });
    expect(removeFromStuckOps).toHaveBeenCalledWith(7);
  });

  test("does NOT delete locally when the handoff POST fails", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    // Act
    const result = await handoffStuckOp(stuckOp);

    // Assert
    expect(result).toBe("failed");
    expect(removeFromStuckOps).not.toHaveBeenCalled();
  });
});
