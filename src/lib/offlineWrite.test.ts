import { describe, test, expect, vi, beforeEach } from "vitest";
import { submitWrite, drainSyncQueue, classifyRejection } from "@/lib/offlineWrite";
import { addToSyncQueue, getSyncQueue, removeFromSyncQueue } from "@/lib/idb";

vi.mock("@/lib/idb", () => ({
  addToSyncQueue: vi.fn(),
  getSyncQueue: vi.fn(),
  removeFromSyncQueue: vi.fn(),
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
    expect(addToSyncQueue).toHaveBeenCalledWith("/api/time", "POST", { duration: "01:00" });
  });

  test("queues the write when the device has no connectivity", async () => {
    // Arrange
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    // Act
    const result = await submitWrite("/api/jobs", "PUT", { status: "Complete" });

    // Assert
    expect(result).toBe("queued");
    expect(addToSyncQueue).toHaveBeenCalledWith("/api/jobs", "PUT", { status: "Complete" });
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
    expect(result).toEqual({ synced: 0, remaining: 0, stopped: "complete" });
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
    expect(result).toEqual({ synced: 2, remaining: 0, stopped: "complete" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "InProgress" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ status: "Complete" });
    expect(removeFromSyncQueue).toHaveBeenNthCalledWith(1, 1);
    expect(removeFromSyncQueue).toHaveBeenNthCalledWith(2, 2);
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
    expect(result).toEqual({ synced: 1, remaining: 0, stopped: "complete" });
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
    expect(result).toEqual({ synced: 1, remaining: 2, stopped: "unreachable" });
    expect(removeFromSyncQueue).toHaveBeenCalledTimes(1);
    expect(removeFromSyncQueue).toHaveBeenCalledWith(1);
  });

  test("stops without removing when the server rejects an op, keeping later ops behind it", async () => {
    // Arrange — a reachable server refusing one op must not let subsequent ops
    // for the same job overtake it and apply out of order.
    vi.mocked(getSyncQueue).mockResolvedValue([op(1, { a: 1 }), op(2, { b: 2 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    // Act
    const result = await drainSyncQueue();

    // Assert
    expect(result).toEqual({ synced: 0, remaining: 2, stopped: "rejected" });
    expect(removeFromSyncQueue).not.toHaveBeenCalled();
  });
});

describe("classifyRejection", () => {
  test.each([400, 404, 409, 422])("classifies %i as permanent — bad data never succeeds on retry", (status) => {
    expect(classifyRejection(status)).toBe("permanent");
  });

  test.each([401, 403])("classifies %i as auth — the data is fine, the cookie isn't", (status) => {
    // A 401/403 must never quarantine: surfacing an expired session as a stuck
    // record would invite a tech to discard real work over a login prompt.
    expect(classifyRejection(status)).toBe("auth");
  });

  test.each([408, 429, 500, 502, 503])("classifies %i as transient", (status) => {
    expect(classifyRejection(status)).toBe("transient");
  });

  test.each([418, 300, 499, 599])("defaults unknown status %i to transient — never quarantine what we cannot explain", (status) => {
    expect(classifyRejection(status)).toBe("transient");
  });
});
