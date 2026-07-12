/* Way Market · Каталог — service worker.
 * Стратегия «сначала сеть»: онлайн всегда свежая версия (версии кэша бампать
 * не нужно), офлайн — последняя сохранённая копия приложения. */
const CACHE = 'wm-catalog-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'js/app.js', 'js/config.js',
  'vendor/supabase.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/logo-round.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
