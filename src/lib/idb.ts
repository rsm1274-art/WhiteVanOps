import { generateOpId } from "@/lib/opId";

export const DB_NAME = "WhiteVanOpsField";
export const DB_VERSION = 3;

export interface SyncOperation {
  id?: number;
  opId: string;
  url: string;
  method: string;
  body: any;
  timestamp: number;
}

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      return reject(new Error("IndexedDB is not available on the server"));
    }
    
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains("apiCache")) {
        db.createObjectStore("apiCache", { keyPath: "url" });
      }
      
      if (!db.objectStoreNames.contains("syncQueue")) {
        const store = db.createObjectStore("syncQueue", { keyPath: "id", autoIncrement: true });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }

      // v2: quarantine store for permanently-rejected ops. Separate store, not a
      // flag on syncQueue: getSyncQueue() keeps meaning "things that will send",
      // so no caller can forget to filter and count dead records as pending.
      if (!db.objectStoreNames.contains("stuckOps")) {
        db.createObjectStore("stuckOps", { keyPath: "id", autoIncrement: true });
      }

      // v3: idempotency identity for every queued op (Phase 2 of the v2.0
      // plan). Every syncQueue row gets a unique opId, indexed so a future
      // caller can look one up directly. Pre-existing v2 rows have no opId
      // yet, so backfill them in the same upgrade transaction — safe because
      // crypto.getRandomValues() is synchronous and an IDB upgrade
      // transaction cannot be async anyway. Each backfilled id's time
      // component is seeded from that row's own `timestamp` (not
      // Date.now()) so it keeps sorting correctly relative to both its
      // original queue position and any new op generated after the upgrade.
      if (e.oldVersion < 3) {
        const request = e.target as IDBOpenDBRequest;
        const store = request.transaction!.objectStore("syncQueue");
        if (!store.indexNames.contains("opId")) {
          store.createIndex("opId", "opId", { unique: true });
        }
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const row = cursor.value as SyncOperation;
          if (!row.opId) {
            row.opId = generateOpId(() => row.timestamp);
            cursor.update(row);
          }
          cursor.continue();
        };
      }
    };
  });
}

export async function cacheApiResponse(url: string, data: any) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("apiCache", "readwrite");
    const store = tx.objectStore("apiCache");
    store.put({ url, data, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedApiResponse(url: string): Promise<any | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("apiCache", "readonly");
    const store = tx.objectStore("apiCache");
    const request = store.get(url);
    request.onsuccess = () => {
      if (request.result) resolve(request.result.data);
      else resolve(null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * `opId` is optional so a caller that already generated one (submitWrite,
 * to keep the id it sent on its inline attempt) can carry it through instead
 * of getting a second, different id when the write ends up queued.
 */
export async function addToSyncQueue(
  url: string,
  method: string,
  body: any,
  opId?: string
): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    const request = store.add({ url, method, body, timestamp: Date.now(), opId: opId ?? generateOpId() });

    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(tx.error);
  });
}

export async function getSyncQueue(): Promise<SyncOperation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readonly");
    const store = tx.objectStore("syncQueue");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function removeFromSyncQueue(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface StuckOp {
  id?: number;
  opId: string;
  url: string;
  method: string;
  body: any;
  queuedAt: number;
  rejectedAt: number;
  status: number;
  message: string;
}

export async function getStuckOps(): Promise<StuckOp[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stuckOps", "readonly");
    const store = tx.objectStore("stuckOps");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Quarantine a permanently-rejected op: remove it from syncQueue and record it
 * in stuckOps in one transaction, so a crash between the two can't lose it.
 */
export async function moveToStuck(
  op: SyncOperation,
  rejection: { status: number; message: string }
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["syncQueue", "stuckOps"], "readwrite");
    tx.objectStore("stuckOps").add({
      opId: op.opId,
      url: op.url,
      method: op.method,
      body: op.body,
      queuedAt: op.timestamp,
      rejectedAt: Date.now(),
      status: rejection.status,
      message: rejection.message,
    });
    tx.objectStore("syncQueue").delete(op.id!);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Refresh the stored rejection after a re-target attempt is rejected again. */
export async function updateStuckOp(
  id: number,
  rejection: { status: number; message: string; rejectedAt: number }
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stuckOps", "readwrite");
    const store = tx.objectStore("stuckOps");
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        store.put({ ...getReq.result, ...rejection });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeFromStuckOps(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("stuckOps", "readwrite");
    tx.objectStore("stuckOps").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
