const CACHE_NAME = 'auron-v54';          // кэш оболочки приложения (бампать при изменении фронта)
const DATA_CACHE = 'auron-data-v1';      // кэш последних ответов backend для офлайн-просмотра
const APP_FILES = [
  './',
  './index.html',
  './js/auth.js',
  './js/offline-queue.js',
  './js/integrations.js',
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

// Activate: удаляем старые версии кэша, но СОХРАНЯЕМ кэш данных (DATA_CACHE)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== DATA_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

const offlineJson = () =>
  new Response(JSON.stringify({ error: 'Offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });

// Стратегия:
//  • Запись на backend (не-GET, другой источник) — только по сети. Офлайн = НЕ пишем
//    (сознательно, по docs/05-ARCHITECTURE.md: офлайн = только просмотр, без конфликтов).
//  • Чтение с backend (GET, другой источник) — network-first: свежее с сети + кладём в
//    DATA_CACHE; при обрыве отдаём последнее сохранённое (офлайн-просмотр). Это и есть
//    stale-while-revalidate из архитектуры.
//  • Оболочка приложения (свой источник, GET) — cache-first.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isGet = event.request.method === 'GET';

  // 1. Запись на backend — сеть или явная офлайн-ошибка (никакого кэша)
  if (!isSameOrigin && !isGet) {
    event.respondWith(fetch(event.request).catch(offlineJson));
    return;
  }

  // 2. Чтение с backend — network-first с кэшированием для офлайн-просмотра
  if (!isSameOrigin && isGet) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(DATA_CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.open(DATA_CACHE)
            .then(cache => cache.match(event.request))
            .then(cached => cached || offlineJson())
        )
    );
    return;
  }

  // 3. Оболочка приложения — cache-first, затем сеть с дозаписью в кэш
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
