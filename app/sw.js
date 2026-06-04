const CACHE_NAME = 'auron-v1';
const APP_FILES = [
  './',
  './index.html',
  './js/auth.js',
  './js/gapi.js',
  './js/api.js',
  './js/config.js',
  './manifest.json'
];

// Install: pre-cache all app shell files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove stale caches from previous versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first for API calls, cache-first for app files
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  const isApiCall =
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('accounts.google.com');

  if (isApiCall) {
    // Network-first: always try to reach the API, no caching
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Cache-first: serve from cache, fall back to network and update cache
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
        return response;
      });
    })
  );
});
