export const DB_NAME = "WhiteVanOpsField";
export const DB_VERSION = 2;

export interface SyncOperation {
  id?: number;
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

export async function addToSyncQueue(url: string, method: string, body: any): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    const request = store.add({ url, method, body, timestamp: Date.now() });
    
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
