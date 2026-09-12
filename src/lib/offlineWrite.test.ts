import { describe, test, expect, vi, beforeEach } from "vitest";
import { submitWrite, drainSyncQueue, classifyRejection } from "@/lib/offlineWrite";
import { addToSyncQueue, getSyncQueue, removeFromSyncQueue, moveToStuck, recordHistory, pruneHistory } from "@/lib/idb";

vi.mock("@/lib/idb", () => ({
  addToSyncQueue: vi.fn(),
  getSyncQueue: vi.fn(),
  removeFromSyncQueue: vi.fn(),
  moveToStuck: vi.fn(),
  recordHistory: vi.fn(),
  pruneHistory: vi.fn(),
}));

describe("submitWrite", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("returns 'synced' when the server accepts the write", async () => {
    // Arrange
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    );

    // Act
    const result = await submitWrite("/api/time", "POST", { duration: "01:00" });

    // Assert
    expect(result).toBe("synced");
    expect(addToSyncQueue).not.toHaveBeenCalled();
  });

  test("sends a stable X-WVO-Op-Id header on the inline attempt", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    await submitWrite("/api/time", "POST", { duration: "01:00" });

    // Assert
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(typeof headers["X-WVO-Op-Id"]).toBe("string");
    expect(headers["X-WVO-Op-Id"].length).toBeGreaterThan(0);
  });

  test("queues the write with the same opId that was sent on the failed inline attempt", async () => {
    // Arrange — a network failure means the id was generated but never
    // reached the server; the queued row must carry that same id rather than
    // minting a second one, so a later drain sends the identity the caller
    // already committed to.
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    // Act
    await submitWrite("/api/time", "POST", { duration: "01:00" });

    // Assert
    const sentOpId = (fetchMock.mock.calls[0][1].headers as Record<string, string>)["X-WVO-Op-Id"];
    expect(addToSyncQueue).toHaveBeenCalledWith("/api/time", "POST", { duration: "01:00" }, sentOpId);
  });

  test("queues the write when the server is unreachable even though the device is online", async () => {
    // Arrange — the office PC is shut down, but the phone has full signal.
    // This is the case navigator.onLine gating got wrong: it reports true, so
    // the write took the online branch and was lost instead of queued.
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    // Act
    const result = await submitWrite("/api/time", "POST", { duration: "01:00" });

    // Assert
    expect(result).toBe("queued");
    expect(addToSyncQueue).toHaveBeenCalledWith(
      "/api/time",
      "POST",
      { duration: "01:00" },
      expect.any(String)
    );
  });

  test("queues the write when the device has no connectivity", async () => {
    // Arrange
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    // Act
    const result = await submitWrite("/api/jobs", "PUT", { status: "Complete" });

    // Assert
    expect(result).toBe("queued");
    expect(addToSyncQueue).toHaveBeenCalledWith(
      "/api/jobs",
      "PUT",
      { status: "Complete" },
      expect.any(String)
    );
  });

  test("throws the server's message without queueing when the server rejects the write", async () => {
    // Arrange — a 400 is a reachable server refusing bad data. Queueing it
    // would replay a write that can never succeed.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "Duration must be greater than zero." }),
      })
    );

    // Act + Assert
    await expect(submitWrite("/api/time", "POST", { duration: "00:00" })).rejects.toThrow(
      "Duration must be greater than zero."
    );
    expect(addToSyncQueue).not.toHaveBeenCalled();
  });

  test("throws without queueing when the session has expired", async () => {
    // Arrange — a 401 must reach the tech as an error, not sit in the queue
    // replaying against a server that will keep rejecting it.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      })
    );

    // Act + Assert
    await expect(submitWrite("/api/jobs", "PUT", { status: "Complete" })).rejects.toThrow(
      "Unauthorized"
    );
    expect(addToSyncQueue).not.toHaveBeenCalled();
  });

  test("falls back to a generic message when an error response has no body", async () => {
    // Arrange
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      })
    );

    // Act + Assert
    await expect(submitWrite("/api/time", "POST", {})).rejects.toThrow("Request failed (500)");
    expect(addToSyncQueue).not.toHaveBeenCalled();
  });
});

describe("drainSyncQueue", () => {
  const op = (id: number, body: unknown) => ({
    id,
    opId: `OP${id}`,
    url: "/api/jobs",
    method: "PUT",
    body,
    timestamp: 1752537600000 + id,
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("reports nothing to do when the queue is empty", async () => {
    // Arrange
    vi.mocked(getSyncQueue).mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, stuck: 0, remaining: 0, stopped: "complete" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sends every queued op oldest-first and clears the queue when all succeed", async () => {
    // Arrange
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { status: "InProgress" }), op(2, { status: "Complete" })]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 2, stuck: 0, remaining: 0, stopped: "complete" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "InProgress" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ status: "Complete" });
    expect(removeFromSyncQueue).toHaveBeenNthCalledWith(1, 1);
    expect(removeFromSyncQueue).toHaveBeenNthCalledWith(2, 2);
  });

  test("sends each queued op's own opId as the X-WVO-Op-Id header", async () => {
    // Arrange
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 })]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    // Act
    await drainSyncQueue();

    // Assert
    expect(fetchMock.mock.calls[0][1].headers["X-WVO-Op-Id"]).toBe("OP1");
    expect(fetchMock.mock.calls[1][1].headers["X-WVO-Op-Id"]).toBe("OP2");
  });

  test("drains queued ops even though the device never lost connectivity", async () => {
    // Arrange — the office server was down overnight and is back up. The phone
    // held signal the whole time, so no online event ever fires; the drain has
    // to work when simply invoked, not only on a connectivity transition.
    vi.stubGlobal("navigator", { onLine: true });
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { status: "Complete" })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 1, stuck: 0, remaining: 0, stopped: "complete" });
    expect(removeFromSyncQueue).toHaveBeenCalledWith(1);
  });

  test("stops at the first unreachable op and leaves the rest queued in order", async () => {
    // Arrange — server dies partway through the drain.
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 }), op(3, { c: 3 })]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    );

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 1, stuck: 0, remaining: 2, stopped: "unreachable" });
    expect(removeFromSyncQueue).toHaveBeenCalledTimes(1);
    expect(removeFromSyncQueue).toHaveBeenCalledWith(1);
  });

  test("quarantines a permanently-rejected op and continues draining the rest", async () => {
    // Arrange — op 1 targets a deleted job (404); ops 2 and 3 are fine. One
    // dead record must not freeze the good ones behind it.
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 }), op(3, { c: 3 })]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: "Job not found" }) })
        .mockResolvedValue({ ok: true })
    );

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 2, stuck: 1, remaining: 0, stopped: "complete" });
    expect(moveToStuck).toHaveBeenCalledWith(op(1, { a: 1 }), { status: 404, message: "Job not found" });
    expect(removeFromSyncQueue).toHaveBeenCalledWith(2);
    expect(removeFromSyncQueue).toHaveBeenCalledWith(3);
    expect(removeFromSyncQueue).not.toHaveBeenCalledWith(1);
  });

  test("falls back to a generic quarantine message when the rejection has no JSON body", async () => {
    // Arrange
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 })]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => { throw new SyntaxError("Unexpected end of JSON input"); },
      })
    );

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, stuck: 1, remaining: 0, stopped: "complete" });
    expect(moveToStuck).toHaveBeenCalledWith(op(1, { a: 1 }), { status: 422, message: "Request failed (422)" });
  });

  test("quarantines a 403 (fieldOps.ts business rejection) and continues draining the rest — the actual bug this fixes", async () => {
    // Arrange — op 1 hits a job the tech isn't assigned to (403); op 2 is
    // fine. Before this fix, 403 was bucketed with 401 and halted the whole
    // drain, freezing op 2 behind a rejection re-login could never resolve.
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 })]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Not assigned to this job" }) })
        .mockResolvedValueOnce({ ok: true })
    );

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 1, stuck: 1, remaining: 0, stopped: "complete" });
    expect(moveToStuck).toHaveBeenCalledWith(op(1, { a: 1 }), { status: 403, message: "Not assigned to this job" });
    expect(removeFromSyncQueue).toHaveBeenCalledWith(2);
    expect(removeFromSyncQueue).not.toHaveBeenCalledWith(1);
  });

  test("records history for a successful op before removing it from the queue, then prunes", async () => {
    // Arrange
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { status: "Complete" })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    // Act
    await drainSyncQueue();

    // Assert
    expect(recordHistory).toHaveBeenCalledWith(op(1, { status: "Complete" }));
    expect(pruneHistory).toHaveBeenCalledTimes(1);

    // recordHistory must be called before removeFromSyncQueue for this op, so
    // a crash between the two still leaves the history entry behind.
    const recordOrder = vi.mocked(recordHistory).mock.invocationCallOrder[0];
    const removeOrder = vi.mocked(removeFromSyncQueue).mock.invocationCallOrder[0];
    expect(recordOrder).toBeLessThan(removeOrder);
  });

  test("does not record history for a quarantined or stopped-on op", async () => {
    // Arrange
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 })]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "Job not found" }) })
    );

    // Act
    await drainSyncQueue();

    // Assert
    expect(recordHistory).not.toHaveBeenCalled();
  });

  test("stops without quarantining when the session has expired, keeping every op queued", async () => {
    // Arrange — 401 means the cookie is bad, not the data. Quarantining here
    // would invite a tech to discard real work over a login prompt.
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, stuck: 0, remaining: 2, stopped: "auth" });
    expect(moveToStuck).not.toHaveBeenCalled();
    expect(removeFromSyncQueue).not.toHaveBeenCalled();
  });

  test("stops and holds the queue on a transient rejection", async () => {
    // Arrange — a 500 might succeed next attempt; op 2 must wait behind op 1
    // so same-job edits can't apply out of order.
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, stuck: 0, remaining: 2, stopped: "retry" });
    expect(moveToStuck).not.toHaveBeenCalled();
  });

  test("treats an unknown status as transient — keep the data, don't interrupt the tech", async () => {
    // Arrange
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 418, json: async () => ({}) }));

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, stuck: 0, remaining: 1, stopped: "retry" });
    expect(moveToStuck).not.toHaveBeenCalled();
  });
});

describe("classifyRejection", () => {
  test.each([400, 404, 409, 422])("classifies %i as permanent — bad data never succeeds on retry", (status) => {
    expect(classifyRejection(status)).toBe("permanent");
  });

  test("classifies 403 as permanent — it's a fieldOps.ts business rejection, not a cookie problem", () => {
    // Every field-write 403 now originates from fieldOps.ts (Phase 3): "not
    // assigned to this job" / "not linked to a personnel record". Re-logging
    // in can never fix that, so it must quarantine (like a 404) rather than
    // halt the entire drain the way a real session problem does.
    expect(classifyRejection(403)).toBe("permanent");
  });

  test("classifies 401 as auth — the data is fine, the cookie isn't", () => {
    // A 401 must never quarantine: surfacing an expired session as a stuck
    // record would invite a tech to discard real work over a login prompt.
    expect(classifyRejection(401)).toBe("auth");
  });

  test.each([408, 429, 500, 502, 503])("classifies %i as transient", (status) => {
    expect(classifyRejection(status)).toBe("transient");
  });

  test.each([418, 300, 499, 599])("defaults unknown status %i to transient — never quarantine what we cannot explain", (status) => {
    expect(classifyRejection(status)).toBe("transient");
  });
});
