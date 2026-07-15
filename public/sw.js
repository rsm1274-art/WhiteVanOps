const CACHE_NAME = 'wvo-field-v2';

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

  // Navigations are network-first: pages carry auth redirects and fresh data,
  // and serving them cache-first can hand a stale (or wrong-login) page to a
  // live server. The cache is only an offline fallback here.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        const cloned = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, cloned);
        });
        return networkResponse;
      }).catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('/field'))
      )
    );
    return;
  }

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
