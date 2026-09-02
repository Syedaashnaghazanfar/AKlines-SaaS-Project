// Phase 1 PWA foundation - caches the static app shell so the app can install
// and reopen while offline. Deliberately does NOT cache or queue API/data
// requests: full offline transactions and sync are Phase 2 work.
const CACHE_NAME = 'akvisionflow-shell-v2';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never cache API calls - all business data must come from the network.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first, cache fallback. A cache-first strategy here would mean a
  // deployed update never reaches an already-installed app until the user
  // manually clears their cache - the whole point of shipping a fix is that
  // it should be visible on the next normal reload while online.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
