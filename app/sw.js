const CACHE_NAME = 'auron-v50';
const APP_FILES = [
  './',
  './index.html',
  './js/auth.js',
  './js/api.js',
  './js/config.js',
  './js/supabase.min.js',
  './js/chart.min.js',
  './manifest.json',
  './icons/icon.svg'
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

// Fetch: network-first for anything off-origin (backend/API), cache-first for the app shell.
// Detecting the backend by "different origin" (not by a hardcoded supabase.co host) is robust:
// the self-hosted backend lives on its own host/IP, and this keeps working if that host later
// becomes an HTTPS domain. Only same-origin app-shell files are cached.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only cache GET; never cache backend writes or non-GET requests.
  const isSameOrigin = url.origin === self.location.origin;
  const isApiCall = !isSameOrigin || event.request.method !== 'GET';

  if (isApiCall) {
    // Network-first: always try to reach the backend, no caching of financial data
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
