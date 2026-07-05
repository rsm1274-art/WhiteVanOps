const CACHE_NAME = 'wvo-field-v1';

const STATIC_ASSETS = [
  '/field',
  '/manifest.json',
  '/logo.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // We only cache GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip API requests from standard SW caching; our React app handles API caching via idb.ts
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return from cache, but update cache in background
        event.waitUntil(
          fetch(event.request).then((networkResponse) => {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }).catch(() => {})
        );
        return cachedResponse;
      }
      
      // If not in cache, go to network and cache the response
      return fetch(event.request).then((networkResponse) => {
        const cloned = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, cloned);
        });
        return networkResponse;
      }).catch(() => {
        // Offline fallback
        if (event.request.mode === 'navigate') {
          return caches.match('/field');
        }
      });
    })
  );
});

// IndexedDB Helper for SW
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("WhiteVanOpsField", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function processSyncQueue() {
  try {
    const db = await openDB();
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    
    const request = store.getAll();
    const ops = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    
    if (ops.length === 0) return;
    
    console.log(`[SW] Processing ${ops.length} queued operations...`);
    
    for (const op of ops) {
      try {
        const res = await fetch(op.url, {
          method: op.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(op.body)
        });
        
        if (res.ok) {
          // Operation successful, remove from queue
          await new Promise((resolve, reject) => {
            const delTx = db.transaction("syncQueue", "readwrite");
            const delStore = delTx.objectStore("syncQueue");
            const delReq = delStore.delete(op.id);
            delReq.onsuccess = resolve;
            delReq.onerror = reject;
          });
          console.log(`[SW] Successfully synced operation ${op.id}`);
        } else {
          console.error(`[SW] Sync failed for op ${op.id}:`, res.status);
          // Stop processing if we hit an error (maintain order)
          break; 
        }
      } catch (err) {
        console.error(`[SW] Network error during sync for op ${op.id}:`, err);
        // Break on network error, try again next time
        break;
      }
    }
  } catch (error) {
    console.error("[SW] Failed to process sync queue", error);
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-wvo-offline-writes') {
    event.waitUntil(processSyncQueue());
  }
});
