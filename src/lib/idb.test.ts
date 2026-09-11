import { describe, test, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// idb.ts gates on `typeof window === "undefined"` to detect a server context.
// The vitest environment is "node", so window is undefined by default —
// stub it so openDB() actually runs against fake-indexeddb instead of
// short-circuiting with "IndexedDB is not available on the server".
vi.stubGlobal("window", {});

import { DB_NAME, DB_VERSION, openDB, addToSyncQueue, getSyncQueue, moveToStuck } from "@/lib/idb";

function freshIndexedDB() {
  // A brand-new fake-indexeddb instance per test so databases from one test
  // never leak into the next.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

beforeEach(() => {
  freshIndexedDB();
});

describe("openDB — fresh install (no prior version)", () => {
  test("creates the syncQueue store with a unique opId index", async () => {
    const db = await openDB();
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);

    const tx = db.transaction("syncQueue", "readonly");
    const store = tx.objectStore("syncQueue");
    expect(store.indexNames.contains("opId")).toBe(true);
    expect(store.index("opId").unique).toBe(true);
    db.close();
  });

  test("addToSyncQueue stores a generated opId on every new row", async () => {
    await addToSyncQueue("/api/time", "POST", { duration: "01:00" });
    await addToSyncQueue("/api/jobs", "PUT", { status: "Complete" });

    const queue = await getSyncQueue();
    expect(queue).toHaveLength(2);
    for (const row of queue) {
      expect(typeof row.opId).toBe("string");
      expect(row.opId).toHaveLength(26);
    }
    // Each row gets its own id.
    expect(queue[0].opId).not.toBe(queue[1].opId);
  });

  test("addToSyncQueue carries through a caller-supplied opId instead of generating a new one", async () => {
    await addToSyncQueue("/api/time", "POST", { duration: "01:00" }, "MYCUSTOMOPID0000000000AA");
    const queue = await getSyncQueue();
    expect(queue[0].opId).toBe("MYCUSTOMOPID0000000000AA");
  });

  test("moveToStuck carries the op's opId into the stuckOps record", async () => {
    await addToSyncQueue("/api/time", "POST", { duration: "01:00" });
    const [queued] = await getSyncQueue();

    await moveToStuck(queued, { status: 404, message: "Job not found" });

    const db = await openDB();
    const stuck: Array<{ opId: string }> = await new Promise((resolve, reject) => {
      const tx = db.transaction("stuckOps", "readonly");
      const req = tx.objectStore("stuckOps").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    expect(stuck).toHaveLength(1);
    expect(stuck[0].opId).toBe(queued.opId);
  });
});

describe("v2 -> v3 upgrade", () => {
  test("backfills opId on every pre-existing row, sorting correctly relative to timestamp and to new rows", async () => {
    // Arrange: build a real v2 database (no opId concept at all) with rows at
    // different timestamps, then close it.
    const v2db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("apiCache", { keyPath: "url" });
        const store = db.createObjectStore("syncQueue", { keyPath: "id", autoIncrement: true });
        store.createIndex("timestamp", "timestamp", { unique: false });
        db.createObjectStore("stuckOps", { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const oldTimestamp = 1_600_000_000_000; // older row
    const newerTimestamp = 1_700_000_000_000; // newer pre-existing row

    await new Promise<void>((resolve, reject) => {
      const tx = v2db.transaction("syncQueue", "readwrite");
      const store = tx.objectStore("syncQueue");
      store.add({ url: "/api/time", method: "POST", body: { a: 1 }, timestamp: oldTimestamp });
      store.add({ url: "/api/jobs", method: "PUT", body: { b: 2 }, timestamp: newerTimestamp });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    v2db.close();

    // Act: reopen at v3 through the real openDB(), triggering the migration.
    const db = await openDB();
    expect(db.version).toBe(3);
    db.close();

    const queue = await getSyncQueue();
    expect(queue).toHaveLength(2);
    for (const row of queue) {
      expect(typeof row.opId).toBe("string");
      expect(row.opId).toHaveLength(26);
    }

    const byTimestamp = [...queue].sort((a, b) => a.timestamp - b.timestamp);
    expect(byTimestamp[0].timestamp).toBe(oldTimestamp);
    expect(byTimestamp[1].timestamp).toBe(newerTimestamp);
    // Backfilled ids sort the same way their source timestamps do.
    expect(byTimestamp[0].opId < byTimestamp[1].opId).toBe(true);

    // Act: add a brand-new row after the upgrade — it must sort after both
    // backfilled rows, since "now" is far later than either fixture timestamp.
    await addToSyncQueue("/api/jobs", "PUT", { status: "Complete" });
    const withNew = await getSyncQueue();
    const newest = withNew.find((r) => !byTimestamp.some((b) => b.opId === r.opId))!;
    expect(newest.opId > byTimestamp[1].opId).toBe(true);
  });

  test("creates the opId index during the v2 -> v3 upgrade even though the store already existed", async () => {
    const v2db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("apiCache", { keyPath: "url" });
        const store = db.createObjectStore("syncQueue", { keyPath: "id", autoIncrement: true });
        store.createIndex("timestamp", "timestamp", { unique: false });
        db.createObjectStore("stuckOps", { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    v2db.close();

    const db = await openDB();
    const tx = db.transaction("syncQueue", "readonly");
    const store = tx.objectStore("syncQueue");
    expect(store.indexNames.contains("opId")).toBe(true);
    db.close();
  });
});
