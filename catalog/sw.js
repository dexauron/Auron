/* Way Market · Каталог — service worker.
 * Стратегия «сначала сеть»: онлайн всегда свежая версия (версии кэша бампать
 * не нужно), офлайн — последняя сохранённая копия приложения. */
const CACHE = 'wm-catalog-v26';
// Отдельный «вечный» кэш для фото товаров: заполняется по мере просмотра,
// НЕ очищается при обновлении приложения — фото грузятся один раз и потом
// показываются мгновенно, работают офлайн и не тратят трафик.
const PHOTOS = 'wm-photos-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'js/app.js', 'js/config.js',
  'vendor/supabase.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/logo-round.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // чистим старые версии оболочки, но кэш фото (PHOTOS) не трогаем — он вечный
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PHOTOS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// фото товара? (картинка из Storage Supabase — всегда другой домен).
// Иконки самого приложения (свой домен) сюда не попадают — они в оболочке
// с «сначала сеть», чтобы обновлялись при выходе новой версии.
function isPhoto(url, req) {
  if (url.origin === self.location.origin) return false;
  return url.pathname.includes('/storage/v1/object/') || req.destination === 'image';
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // фото товаров (в т.ч. с другого домена) — «сначала кэш»: один раз скачали,
  // дальше показываем мгновенно и офлайн, фото держится постоянно
  if (isPhoto(url, e.request)) {
    e.respondWith(
      caches.open(PHOTOS).then((c) => c.match(e.request).then((hit) => {
        if (hit) return hit;
        return fetch(e.request).then((resp) => {
          if (resp.ok || resp.type === 'opaque') c.put(e.request, resp.clone());
          return resp;
        });
      })),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
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
